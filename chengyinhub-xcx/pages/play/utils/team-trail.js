// 第九轮 m2 第 2 项:同场队伍路线(客户端)。
// 只在有场次(activityId>0)、作者没关、本人开着分享时工作。约 12 秒一次轮询,失败退避到 60 秒;
// 页面藏到后台就停,回来再开。每次只上报自上次成功以来新走的点。没有 socket。
const { createPoller } = require('./poller.js');
const { TEAM_ROUTE_COLORS } = require('../../../utils/play-visual-tokens.js');

const INTERVAL_MS = 12000;
const MAX_INTERVAL_MS = 60000;
const MAX_UPLOAD = 40;

// L02-103:队色按队伍 key 取哈希,不按本机先看到谁 —— 两个队友看同一支队是同一种颜色
function colorForKey(key) {
  const text = String(key == null ? '' : key);
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return TEAM_ROUTE_COLORS[hash % TEAM_ROUTE_COLORS.length];
}
/** L02-103:积压的新点多于一次上限时均匀抽稀(保留首尾),不再只留最后 40 个 —— 共享路线不会出现一大段直线缺口 */
function thin(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** 后端回的队伍 → 地图要的线(光晕 + 亮线)、头像图钉、右侧一排 */
function shapeTeams(rows, colorByKey) {
  const teams = [];
  (Array.isArray(rows) ? rows : []).forEach((t) => {
    if (!t || !t.key || !Array.isArray(t.pts)) return;
    const pts = t.pts.filter((p) => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map((p) => ({ latitude: Number(p[0]), longitude: Number(p[1]) }));
    if (!pts.length) return;
    if (!colorByKey[t.key]) colorByKey[t.key] = colorForKey(t.key);
    const done = Math.max(0, Number(t.done) || 0);
    teams.push({
      key: String(t.key), color: colorByKey[t.key], name: String(t.name || ''), avatar: String(t.avatar || ''),
      tag: done > 0 ? '第 ' + done + ' 站' : '', points: pts, last: pts[pts.length - 1],
    });
  });
  return teams;
}

function teamLines(teams) {
  const out = [];
  (teams || []).forEach((t) => {
    if (t.points.length < 2) return;
    out.push({ points: t.points, color: t.color + '42', width: 13, borderWidth: 0 });
    out.push({ points: t.points, color: t.color, width: 4, borderColor: '#00000052', borderWidth: 1 }); /* ds-ok 原生 polyline 只吃字面色 */
  });
  return out;
}

/** 头像图钉的 marker id 段:与节点 id、玩家/箭头保留 id 都不撞 */
const PIN_BASE = 880000000;
// 第十二轮 k7(j4 F16):没头像的队不再是一枚空黑圆,圆里写队名(或队长昵称)的第一个字,用队色
function initialOf(name) {
  const s = String(name || '').trim();
  return s ? Array.from(s)[0] : '';
}

function teamPins(teams) {
  return (teams || []).map((t, i) => ({
    id: PIN_BASE + i, key: t.key, lat: t.last.latitude, lng: t.last.longitude,
    img: t.avatar, color: t.color, tag: t.tag, initial: t.avatar ? '' : initialOf(t.name),
  }));
}

/**
 * opts: { api: { state(data), consent(data), sync(data) } → Promise<res>, activityId, readPoints() → [{lat,lng}], done() → number,
 *         onTeams(teams), onState(state) }
 */
function createTeamTrail(opts) {
  const o = opts || {};
  const colorByKey = {};
  let sentCount = 0;
  let stopped = false;
  let state = { available: false, share: false, decided: false };
  let lastSig = null;  // L02-016
  // L01-039(业主 2026-11-24 默认 A):本人在本机选过「分享」才算同意;服务端对没表过态的人默认 share=true,不能据此上传
  let chosenShare = false;
  const emitTeams = (teams) => {
    const sig = JSON.stringify(teams.map((t) => [t.key, t.name, t.avatar, t.tag, t.points.length, t.last.latitude, t.last.longitude]));
    if (sig === lastSig) return;
    lastSig = sig;
    if (o.onTeams) o.onTeams(teams);
  };

  function run() {
    if (stopped) return Promise.resolve(true);
    const all = o.readPoints ? o.readPoints() : [];
    if (sentCount > all.length) sentCount = 0;
    const fresh = thin(all.slice(sentCount), MAX_UPLOAD);
    const upto = all.length;
    return Promise.resolve(o.api.sync({
      activityId: o.activityId,
      pts: fresh.map((p) => [Number(p.lat), Number(p.lng)]),
      done: o.done ? o.done() : 0,
    })).then((res) => {
      if (stopped) return true;
      if (!res || String(res.code) !== '200' || !res.data) return false;
      sentCount = upto;
      const d = res.data;
      if (!d.available || !d.share) {
        state = { available: !!d.available, share: !!d.share, decided: state.decided };
        poller.stop();
        emitTeams([]);
        if (o.onState) o.onState(state);
        return true;
      }
      emitTeams(shapeTeams(d.teams, colorByKey));
      return true;
    }, () => false);
  }

  const poller = createPoller({ run, interval: INTERVAL_MS, maxInterval: MAX_INTERVAL_MS });

  return {
    state: () => state,
    load() {
      return Promise.resolve(o.api.state({ activityId: o.activityId })).then((res) => {
        const d = res && String(res.code) === '200' && res.data ? res.data : null;
        state = d && d.available ? { available: true, share: !!d.share, decided: !!d.decided } : { available: false, share: false, decided: false };
        return state;
      }, () => state);
    },
    /** 本人表态。服务端没确认时按本人刚选的来:选了关就本机也关(不轮询、不上传),不能沿用服务端默认的开 */
    consent(share) {
      lastSig = null;
      chosenShare = !!share;
      const failed = () => {
        state = { available: state.available, share: !!share && state.share, decided: false };
        return Object.assign({ ok: false }, state);
      };
      return Promise.resolve(o.api.consent({ activityId: o.activityId, share: !!share })).then((res) => {
        const d = res && String(res.code) === '200' && res.data ? res.data : null;
        if (!d) return failed();
        state = { available: !!d.available, share: !!d.share, decided: true };
        return Object.assign({ ok: true }, state);
      }, failed);
    },
    start() { lastSig = null; if (!stopped && state.available && state.share && (state.decided || chosenShare)) poller.start(); },
    pause() { poller.stop(); },
    isRunning: () => poller.isActive(),
    /** 本人结束本局:通知服务端删掉自己的点,之后不再轮询 */
    finish() {
      poller.stop();
      if (stopped) return Promise.resolve();
      stopped = true;
      if (!state.available || !state.share) return Promise.resolve();
      return Promise.resolve(o.api.sync({ activityId: o.activityId, pts: [], done: 0, finished: true })).catch(() => {});
    },
    tick: run,
  };
}

module.exports = { createTeamTrail, shapeTeams, teamLines, teamPins, initialOf, PIN_BASE, INTERVAL_MS, MAX_INTERVAL_MS };
