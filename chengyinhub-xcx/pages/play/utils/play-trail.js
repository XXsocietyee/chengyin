// 第九轮 m2 第 1 项:主题游玩里「我走过的路」。
// 只吃页面已有的定位回调(前台 / 后台规则不变,不另开监听);只在地图露出且页面在前台时才 setData。
// 按场次落本机一份抽稀后的副本,页面重进还能接上;换一场就丢掉上一场的。
const { createRouteLine } = require('../../../utils/my-route-line.js');
const { simplifyTrack } = require('../../../utils/roam-track-simplify.js');

const STORE_KEY = 'cy_play_trail';
// OR-014:轨迹副本按账号分键(cy_play_trail:<账号>)。没有账号就不读写:
// 不带账号的旧键只按场次(主题)分开,退出登录后下一个人会读到上一个人的点。
// 单测没有 App 时才退回不带账号的键(注入的内存存储,不跨账号)。
function accountStoreKey() {
  try {
    if (typeof getApp !== 'function') return STORE_KEY;
    const app = getApp();
    const id = app && typeof app.getUserID === 'function' ? String(app.getUserID() || '') : '';
    return /^[1-9]\d*$/.test(id) ? STORE_KEY + ':' + id : '';
  } catch (e) { return ''; }
}
const MIN_STEP_M = 8;        // 小于这个位移不记,原地抖动不画毛刺
const MAX_ACCURACY_M = 60;   // 精度太差的点不画
const MAX_POINTS = 4000;     // 内存上限,超出先抽稀
const SAVE_MS = 30000;

function distM(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}

function createPlayTrail(storage, sessionKey, now) {
  const clock = typeof now === 'function' ? now : Date.now;
  const line = createRouteLine();
  let points = [];
  let startedAt = 0, savedAt = 0, dirty = false;
  // 没有本局键时只在内存里记:不能读、也不能覆盖按主题/场次留下的上一局。
  const scoped = typeof sessionKey === 'string' && sessionKey.trim() !== '';
  let boundKey;

  function snapshot() {
    return { key: sessionKey, startedAt, points: simplifyTrack(points, { maxPoints: 600, epsilonMeters: 3 }) };
  }
  function read(key) {
    points = []; startedAt = 0;
    if (!scoped || !key || !storage || !storage.getStorageSync) return;
    try {
      const saved = storage.getStorageSync(key);
      if (saved && saved.key === sessionKey && Array.isArray(saved.points)) {
        points = saved.points.filter((q) => q && Number.isFinite(q.lat) && Number.isFinite(q.lng));
        startedAt = Number(saved.startedAt) || 0;
      }
    } catch (e) { points = []; startedAt = 0; }
  }
  // 账号变了先把脏点写回旧键,再清空内存。不能把上一个账号的点写进新键。
  function rebind() {
    const next = accountStoreKey();
    if (boundKey === next) return next;
    if (scoped && boundKey && dirty && storage && storage.setStorageSync) {
      try { storage.setStorageSync(boundKey, snapshot()); } catch (e) { /* 存不下不影响换号 */ }
    }
    dirty = false;
    if (boundKey !== undefined) line.reset();
    boundKey = next;
    read(next);
    return next;
  }
  function persist(force) {
    const key = rebind();
    if (!scoped || !key || !dirty || !storage || !storage.setStorageSync) return;
    const t = clock();
    if (!force && t - savedAt < SAVE_MS) return;
    savedAt = t; dirty = false;
    try { storage.setStorageSync(key, snapshot()); } catch (e) { /* 存不下不影响画线 */ }
  }
  rebind();

  return {
    key: scoped ? sessionKey : '',
    note(loc) {
      rebind();
      if (!loc) return false;
      const lat = Number(loc.latitude), lng = Number(loc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      const acc = Number(loc.accuracy);
      if (Number.isFinite(acc) && acc > MAX_ACCURACY_M) return false;
      const p = { lat, lng };
      const last = points[points.length - 1];
      if (last && distM(last, p) < MIN_STEP_M) return false;
      if (!startedAt) startedAt = clock();
      points.push(p);
      if (points.length > MAX_POINTS) points = simplifyTrack(points, { maxPoints: 1000, epsilonMeters: 3 });
      dirty = true;
      persist(false);
      return true;
    },
    points() { return points.slice(); },
    startedAt() { return startedAt; },
    lines() { return line.lines(points); },
    persist() { persist(true); },
    clear() {
      const key = rebind();
      points = []; startedAt = 0; dirty = false; line.reset();
      if (!scoped) return;
      try { if (key && storage && storage.removeStorageSync) storage.removeStorageSync(key); } catch (e) { /* noop */ }
    },
  };
}

module.exports = { createPlayTrail, STORE_KEY, MIN_STEP_M, MAX_ACCURACY_M, distM };
