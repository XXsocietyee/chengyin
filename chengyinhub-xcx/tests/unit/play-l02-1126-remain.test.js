'use strict';
// 2026-11-26:仍在的 L02 —— 卸载后还在 setData 的计时器,以及只按主题分键、换号会串的缓存。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPlayTrail, STORE_KEY } = require('../../pages/play/utils/play-trail.js');

function mem() {
  const m = {};
  return { m, getStorageSync: (k) => m[k], setStorageSync: (k, v) => { m[k] = v; }, removeStorageSync: (k) => { delete m[k]; } };
}
function loc(lat, lng) { return { latitude: lat, longitude: lng, accuracy: 10 }; }

test('轨迹按账号分键;退出登录不读不写只按主题共用的旧键', () => {
  const st = mem();
  st.m[STORE_KEY] = { key: 't:31#1', startedAt: 1, points: [{ lat: 9, lng: 9 }] };
  let id = 7;
  const saved = global.getApp;
  global.getApp = () => ({ getUserID: () => id });
  try {
    const a = createPlayTrail(st, 't:31#1', () => 1e9);
    assert.equal(a.note(loc(31.23, 121.47)), true);
    assert.equal(a.note(loc(31.24, 121.48)), true);
    a.persist();
    assert.equal(st.m[STORE_KEY + ':7'].points.length, 2);
    assert.deepEqual(st.m[STORE_KEY].points, [{ lat: 9, lng: 9 }], '不带账号的旧键不被登录用户改写');
    id = 8;
    const b = createPlayTrail(st, 't:31#1', () => 1e9);
    assert.equal(b.points().length, 0, '同一主题另一账号看不到上一个人的点');
    id = '';
    const guest = createPlayTrail(st, 't:31#1', () => 1e9);
    assert.equal(guest.points().length, 0, '退出后不读旧的主题键,也不读上一个账号');
    assert.equal(guest.note(loc(31.25, 121.49)), true);
    guest.persist();
    assert.equal(st.m[STORE_KEY].points.length, 1, '退出后的点不写回共用键');
    assert.equal(createPlayTrail(st, 't:31#1', () => 1e9).points().length, 0);
  } finally { if (saved) global.getApp = saved; else delete global.getApp; }
});

test('同一条轨迹对象换号时,不把上一个账号的点写进新账号', () => {
  const st = mem();
  let id = 7;
  const saved = global.getApp;
  global.getApp = () => ({ getUserID: () => id });
  try {
    const tr = createPlayTrail(st, 't:31#1', () => 1e9);
    tr.note(loc(31.23, 121.47));
    tr.note(loc(31.24, 121.48));
    id = 8;
    assert.equal(tr.note(loc(31.30, 121.50)), true);
    tr.persist();
    assert.equal(st.m[STORE_KEY + ':7'].points.length, 2);
    assert.equal(st.m[STORE_KEY + ':8'].points.length, 1);
    assert.equal(tr.points().length, 1);
  } finally { if (saved) global.getApp = saved; else delete global.getApp; }
});

test('没有 App 的单测仍把轨迹落在注入的存储里', () => {
  const saved = global.getApp;
  delete global.getApp;
  try {
    const st = mem();
    const tr = createPlayTrail(st, 'a:7', () => 1e9);
    tr.note(loc(31.23, 121.47));
    tr.persist();
    assert.equal(st.m[STORE_KEY].points.length, 1);
  } finally { if (saved) global.getApp = saved; }
});

test('读数滚动、解码、成绩计数在页面卸载后停掉', async () => {
  const roll = require('../../pages/play/utils/count-roll.js');
  const look = require('../../pages/play/utils/play-look.js').methods();
  const hud = require('../../pages/play/utils/play-hud-overlays.js');
  let sets = 0;
  const page = { data: {}, setData() { sets += 1; } };
  roll.roll(page, 'facts', { dist: 12 }, {});
  assert.ok(page._cuRollTimers.facts);
  page._playDisposed = true;
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(page._cuRollTimers.facts, null);
  const after = sets;
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(sets, after, '卸载后不再 setData');

  const pending = [];
  const realTimeout = global.setTimeout;
  const realClear = global.clearTimeout;
  global.setTimeout = (fn) => { pending.push(fn); return pending.length; };
  global.clearTimeout = (id) => { pending[id - 1] = null; };
  try {
    const chars = [{ i: 0, ch: '你' }, { i: 1, ch: '好' }];
    let paints = 0;
    const reader = Object.assign(Object.create(look), {
      data: { reducedMotion: false, chapterParas: [{ text: '你好', chars }] },
      setData(patch) {
        paints += 1;
        const m = /^chapterParas\[(\d+)\]\.chars$/.exec(Object.keys(patch)[0]);
        if (m) this.data.chapterParas[Number(m[1])].chars = patch[Object.keys(patch)[0]];
      },
    });
    reader._decodeLine(0);
    const scheduled = pending.length;
    const painted = paints;
    reader._playDisposed = true;
    pending[scheduled - 1]();
    assert.equal(paints, painted, '卸载后的下一拍不再写回乱码');
  } finally { global.setTimeout = realTimeout; global.clearTimeout = realClear; }

  const intervals = [];
  const realInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  global.clearInterval = (id) => { intervals[id - 1] = null; };
  try {
    let shown = 0;
    const score = Object.assign(Object.create(hud.methods(() => {})), {
      data: { scoreOv: { show: true, shown: '0' } },
      setData() { shown += 1; },
    });
    score._countScore(32);
    score._playDisposed = true;
    intervals[0]();
    assert.equal(shown, 0);
    assert.equal(intervals[0], null);
  } finally { global.setInterval = realInterval; global.clearInterval = realClearInterval; }
});

test('卡包流光在页面藏起后不再排下一拍', () => {
  const pack = require('../../pages/play/utils/pack-detail.js');
  const page = {
    data: { reducedMotion: false, mode: 2, seatTiles: [1] },
    animate(sel, frames, ms, cb) { this._last = cb; this._n = (this._n || 0) + 1; },
  };
  pack.ensure(page);
  const started = page._n;
  page._themeHidden = true;
  page._last();
  assert.equal(page._packDetailOn, false);
  assert.equal(page._n, started);
});

test('内嵌检定的延迟对准在页面卸载后不再 setData', () => {
  const r5 = require('../../pages/play/utils/r5-player-runtime.js');
  const pending = [];
  const realTimeout = global.setTimeout;
  const realClear = global.clearTimeout;
  global.setTimeout = (fn, ms) => { pending.push({ fn, ms }); return pending.length; };
  global.clearTimeout = (id) => { if (pending[id - 1]) pending[id - 1].fn = null; };
  try {
    let sets = 0;
    const page = Object.assign(Object.create(r5.methods()), {
      data: { journeyCheck: { show: true, present: 'inline', nodeId: 3 }, chapterFull: true, chapterParas: [{ kind: 'journeyCheck', in: false }] },
      setData() { sets += 1; },
    });
    page._guardInlineCheck();
    const late = pending.filter((p) => p.ms >= 1200 && p.fn);
    page._playDisposed = true;
    const before = sets;
    late.forEach((p) => p.fn());
    assert.equal(sets, before);
  } finally { global.setTimeout = realTimeout; global.clearTimeout = realClear; }
});

test('勋章屏、碎片和抽卡倒计时在卸下后不再 setData', async () => {
  let medal;
  global.Component = (d) => { medal = d; };
  global.wx = { getWindowInfo: () => ({}), createOffscreenCanvas: () => ({ getContext: () => ({}) }) };
  delete require.cache[require.resolve('../../pages/play/components/medal-screen/index.js')];
  require('../../pages/play/components/medal-screen/index.js');
  let sets = 0;
  const md = Object.assign(Object.create(medal.methods), {
    data: { show: true, reducedMotion: false, stats: [{ v: 3 }] },
    setData() { sets += 1; },
  });
  medal.observers['show, items'].call(md, true, [{}]);
  medal.lifetimes.detached.call(md);
  const afterDetach = sets;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sets, afterDetach);
  assert.equal(md._onTimer, 0);
  assert.equal(md._countTimer, 0);

  let frag;
  global.Behavior = (b) => b;
  global.Component = (d) => { frag = d; };
  delete require.cache[require.resolve('../../pages/play/components/fragment/index.js')];
  require('../../pages/play/components/fragment/index.js');
  let flips = 0;
  const chip = { data: { reducedMotion: false, fly: false }, setData() { flips += 1; }, triggerEvent() { flips += 1; } };
  frag.properties.show.observer.call(chip, true);
  frag.lifetimes.detached.call(chip);
  const flipped = flips;
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(flips, flipped);

  global.getApp = () => ({ getUserID: () => 7, globalData: {} });
  let game;
  global.Component = (d) => { game = d; };
  delete require.cache[require.resolve('../../pages/play/components/advanced-game/index.js')];
  require('../../pages/play/components/advanced-game/index.js');
  let ticks = 0;
  const intervals = [];
  const realInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.setInterval = (fn) => { intervals.push(fn); return intervals.length; };
  global.clearInterval = (id) => { intervals[id - 1] = null; };
  const vm = Object.assign(Object.create(game.methods), {
    data: { state: { sessionId: 3, deadlineAt: Date.now() + 5000, config: {} }, remainingSeconds: null },
    setData() { ticks += 1; },
    triggerEvent() {},
  });
  vm.syncTimer();
  const running = ticks;
  vm._detached = true;
  intervals[0]();
  assert.equal(intervals[0], null);
  assert.equal(ticks, running, '卸下后倒计时不再 setData');
  global.setInterval = realInterval;
  global.clearInterval = realClearInterval;
  let destroyed = 0;
  vm._detached = true;
  vm._drawAudio = { stop() { destroyed += 1; }, destroy() { destroyed += 1; throw new Error('gone'); } };
  vm.destroyDrawAudio();
  assert.equal(destroyed, 2);
  assert.equal(ticks, running, '销毁音频不再 setData');
});
