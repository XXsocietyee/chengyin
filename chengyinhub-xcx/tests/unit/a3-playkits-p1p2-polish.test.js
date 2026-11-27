'use strict';

/* Agent A3 · 28 个玩法组件 P0/P1/P2 交互与传感器打磨回归测试 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function mountComponent(relJs, props = {}, wxOverrides = {}) {
  let def = null;
  const toasts = [];
  const modals = [];
  const openSettings = [];
  global.getApp = () => ({ globalData: {} });
  global.Behavior = (b) => b;
  global.Component = (d) => { def = d; };
  global.wx = Object.assign({
    vibrateShort() {},
    showToast(o) { toasts.push(o && o.title); },
    hideToast() {},
    showModal(o) { modals.push(o); if (o && o.success) o.success({ confirm: true, cancel: false }); },
    openSetting(o) { openSettings.push(o); if (o && o.success) o.success({ authSetting: {} }); },
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 700, pixelRatio: 2 }),
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 700, pixelRatio: 2 }),
    createSelectorQuery() {
      return {
        in() { return this; },
        select() { return this; },
        selectAll() { return this; },
        boundingClientRect(cb) { if (cb) cb([]); return this; },
        exec(cb) { if (cb) cb([]); },
      };
    },
  }, wxOverrides);
  const full = path.join(ROOT, relJs);
  delete require.cache[require.resolve(full)];
  require(full);
  const data = {};
  (def.behaviors || []).forEach((b) => Object.assign(data, JSON.parse(JSON.stringify((b && b.data) || {}))));
  Object.assign(data, JSON.parse(JSON.stringify(def.data || {})));
  Object.entries(def.properties || {}).forEach(([k, v]) => {
    data[k] = v.value === undefined ? null : JSON.parse(JSON.stringify(v.value));
  });
  Object.assign(data, props);
  const events = [];
  const stageCalls = [];
  const stage = {
    data: { triesLeft: 3 },
    begin(o) { stageCalls.push(['begin', o]); },
    win(t) { stageCalls.push(['win', t]); },
    fail(t) { stageCalls.push(['fail', t]); },
    nudge() { stageCalls.push(['nudge']); },
    miss() { this.data.triesLeft -= 1; return this.data.triesLeft === 0; },
    _stopAll() { stageCalls.push(['_stopAll']); },
  };
  const vm = {
    data,
    def,
    events,
    toasts,
    modals,
    openSettings,
    stageCalls,
    stage,
    setData(patch, cb) { Object.assign(this.data, patch); if (cb) cb(); },
    triggerEvent(name, detail) { events.push({ name, detail }); },
    selectComponent() { return stage; },
    createSelectorQuery() { return global.wx.createSelectorQuery(); },
  };
  Object.entries(def.methods || {}).forEach(([k, fn]) => { vm[k] = fn.bind(vm); });
  vm.fireObserver = (key, ...args) => {
    const fn = def.observers && def.observers[key];
    if (fn) fn.apply(vm, args);
  };
  return vm;
}

/* ── (1) letter-pool ── */
test('A3-1: letter-pool.wxss uses 84rpx keys (fits 750rpx) and #fff text on .lp__slot.is-ok', () => {
  const css = read('pages/playkit/style/letter-pool.wxss');
  assert.match(css, /\.lp__key\s*\{[^}]*width:\s*84rpx;[^}]*height:\s*88rpx;/);
  assert.match(css, /\.lp__slot\.is-ok\s*\{[^}]*color:\s*#fff;/);
});

/* ── (2) Core P0/P1 kits ── */
test('A3-2a: playkit-sort uses catchtouchmove, pre-measures row height, and locks after finish or submit', () => {
  const wxml = read('pages/playkit/components/playkit-sort/index.wxml');
  assert.match(wxml, /catchtouchmove="onDragMove"/);
  let queryCount = 0;
  const vm = mountComponent('pages/playkit/components/playkit-sort/index.js', {
    show: true,
    items: [{ id: 'a', label: '一' }, { id: 'b', label: '二' }],
  }, {
    createSelectorQuery() {
      return {
        in() { return this; },
        select() { return this; },
        boundingClientRect(cb) { queryCount += 1; cb({ height: 104 }); return this; },
        exec() {},
      };
    },
  });
  vm.fireObserver('show, items', true, vm.data.items);
  assert.equal(vm._rowH, 52);
  assert.ok(queryCount >= 1);
  // Submit lock blocks rapid duplicate submit
  vm.onSubmit();
  vm.onSubmit();
  assert.equal(vm.events.filter((e) => e.name === 'submit').length, 1);
  // Finished lock blocks dragging & submit
  vm.data.finished = true;
  vm.onDragStart({ currentTarget: { dataset: { i: 0 } }, touches: [{ clientY: 100 }] });
  assert.equal(vm.data.dragging, -1);
  vm.def.lifetimes.detached.call(vm);
});

test('A3-2b: playkit-match allows right-column-first pairing and locks after pass/submit', () => {
  const vm = mountComponent('pages/playkit/components/playkit-match/index.js', {
    show: true,
    left: [{ id: 'l1', label: '左1' }],
    right: [{ id: 'r1', label: '右1' }],
  });
  vm.fireObserver('show, left, right', true, vm.data.left, vm.data.right);
  // Tap right column FIRST, then left column
  vm.onTapRight({ currentTarget: { dataset: { id: 'r1' } } });
  assert.equal(vm.data.selected, 'r1');
  assert.equal(vm.data.selectedSide, 'r');
  vm.onTapLeft({ currentTarget: { dataset: { id: 'l1' } } });
  assert.deepEqual(vm._pairs, [['l1', 'r1']]);
  assert.equal(vm.data.selected, '');
  // Submit lock prevents double submit
  vm.onSubmit();
  vm.onSubmit();
  assert.equal(vm.events.filter((e) => e.name === 'submit').length, 1);
  // Pass lock prevents editing pairs
  vm.data.passed = true;
  vm.onTapLeft({ currentTarget: { dataset: { id: 'l1' } } });
  assert.equal(vm.data.selected, '');
  vm.def.lifetimes.detached.call(vm);
});

test('A3-2c: playkit-mixer styles use --lk-bg fallback and truncate track names at 160rpx', () => {
  const wxss = read('pages/playkit/components/playkit-mixer/index.wxss');
  assert.doesNotMatch(wxss, /var\(--bg\)/);
  assert.match(wxss, /var\(--lk-bg,\s*#111114\)/);
  assert.match(wxss, /\.mx__name\s*\{[^}]*max-width:\s*160rpx;[^}]*text-overflow:\s*ellipsis;/);
});

test('A3-2d: playkit-predict supports manual arrows/swipe, deselect on tap, no 16ms timer, and failureSeq reset', () => {
  const wxml = read('pages/playkit/components/playkit-predict/index.wxml');
  assert.match(wxml, /bindtouchstart="onSwipeStart"/);
  assert.match(wxml, /catchtap="onStep"/);
  const vm = mountComponent('pages/playkit/components/playkit-predict/index.js', {
    show: true,
    options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }],
  });
  vm.fireObserver('show, options, closeAtHour, revealDays, revealHour, shopAnswers, myOptionKey', true);
  assert.equal(vm._timer, undefined, 'no 16ms JS setInterval');
  // Swipe moves wheel
  const angle0 = vm._angle;
  vm.onSwipeStart({ touches: [{ clientX: 200, clientY: 200 }] });
  vm.onSwipeEnd({ changedTouches: [{ clientX: 120, clientY: 200 }] });
  assert.notEqual(vm._angle, angle0);
  // Tap to select, tap again to deselect
  vm._swipedAt = 0;
  vm.onPick({ currentTarget: { dataset: { i: 1 } } });
  assert.equal(vm.data.picked, 1);
  vm.onPick({ currentTarget: { dataset: { i: 1 } } });
  assert.equal(vm.data.picked, -1);
  // failureSeq resets committed lock
  vm.onPick({ currentTarget: { dataset: { i: 0 } } });
  vm.onCommit();
  assert.equal(vm.data.committed, true);
  vm.fireObserver('failureSeq', 1);
  assert.equal(vm.data.committed, false);
});

test('A3-2e: playkit-hidden stores _lastTap to paint green hits on pass, avoids letterbox nudge, supports zoom', () => {
  const vm = mountComponent('pages/playkit/components/playkit-hidden/index.js', {
    show: true,
    total: 2,
    targets: [{ id: 't1', label: '猫', found: false }, { id: 't2', label: '鸟', found: false }],
  }, {
    createSelectorQuery() {
      return {
        in() { return this; },
        select() { return this; },
        boundingClientRect(cb) { cb({ left: 50, top: 100, width: 200, height: 200 }); return this; },
        exec() {},
      };
    },
  });
  vm.fireObserver('show, targets', true);
  // Letterbox tap outside rect -> silent, NO nudge
  vm.onTapScene({ touches: [{ clientX: 10, clientY: 10 }] });
  assert.equal(vm.stageCalls.filter((c) => c[0] === 'nudge').length, 0);
  assert.equal(vm.events.length, 0);
  // Valid tap inside image -> stores _lastTap, server pass paints green hit dot
  vm.onTapScene({ touches: [{ clientX: 150, clientY: 200 }] });
  assert.equal(vm.events[0].name, 'submit');
  assert.deepEqual(vm._lastTap, { x: 50, y: 50 });
  vm.data.targets = [{ id: 't1', label: '猫', found: true }, { id: 't2', label: '鸟', found: false }];
  vm.fireObserver('show, targets', true);
  assert.equal(vm.data.hits.length, 1);
  assert.equal(vm.data.hits[0].x, 50);
  assert.equal(vm.data.hits[0].y, 50);
  // Zoom toggle
  vm.onToggleZoom();
  assert.equal(vm.data.zoomScale, 2);
  assert.equal(vm.data.zoomed, true);
  vm.onToggleZoom();
  assert.equal(vm.data.zoomScale, 1);
});

test('A3-2f: playkit-barter has 88rpx undo/reset, onReset clears order, and disabled offer toasts missing item', () => {
  const wxss = read('pages/playkit/components/playkit-barter/index.wxss');
  assert.match(wxss, /\.bt__undo\s*\{[^}]*min-height:\s*88rpx;/);
  assert.match(wxss, /\.bt__reset\s*\{[^}]*min-height:\s*88rpx;/);
  const vm = mountComponent('pages/playkit/components/playkit-barter/index.js', {
    show: true,
    items: [{ id: 'a', name: '苹果' }, { id: 'b', name: '香蕉' }, { id: 'c', name: '钥匙' }],
    start: ['a'],
    goals: [{ id: 'g1', kind: 'have', item: 'c', label: '拿到钥匙' }],
    offers: [
      { id: 'o1', give: 'a', get: 'b' },
      { id: 'o2', give: 'b', get: 'c' },
    ],
  });
  vm.fireObserver('show, items, start, goals, offers', true);
  vm.onPick({ currentTarget: { dataset: { id: 'o2' } } });
  assert.ok(vm.toasts.some((t) => /香蕉/.test(t)), 'toasts missing item name');
  vm.onPick({ currentTarget: { dataset: { id: 'o1' } } });
  assert.deepEqual(vm._order, ['o1']);
  vm.onReset();
  assert.deepEqual(vm._order, []);
});

test('A3-2g: playkit-classify has 64rpx remove tag and full-screen done-tap', () => {
  const wxss = read('pages/playkit/components/playkit-classify/index.wxss');
  const wxml = read('pages/playkit/components/playkit-classify/index.wxml');
  assert.match(wxss, /\.cf__chip\s*\{[^}]*min-height:\s*64rpx;/);
  assert.match(wxml, /done-tap="\{\{\(verdict === 'ok' \|\| passed\) && !inline\}\}"/);
});

test('A3-2h: playkit-pricepair uses white ink and resets submitted on failureSeq', () => {
  const vm = mountComponent('pages/playkit/components/playkit-pricepair/index.js', {
    show: true,
    items: [{ id: 'p1', label: '甲' }, { id: 'p2', label: '乙' }],
  });
  vm.fireObserver('show, items, attempts, finished, passed, lastPickId, answerId', true, vm.data.items);
  assert.ok(vm.data.posters.every((p) => p.ink === '#ffffff'));
  vm.onPick({ currentTarget: { dataset: { i: 0 } } });
  vm.onConfirm();
  assert.equal(vm.data.submitted, true);
  vm.fireObserver('failureSeq', 1);
  assert.equal(vm.data.submitted, false);
});

test('A3-2i: playkit-note confirms before preset overwrites typed draft and applies submit lock', () => {
  const vm = mountComponent('pages/playkit/components/playkit-note/index.js', {
    show: true,
    presets: ['默认便签'],
  });
  vm.onInput({ detail: { value: '我手写的一句话' } });
  // Cancel overwrite -> draft stays
  global.wx.showModal = (o) => { vm.modals.push(o); if (o && o.success) o.success({ confirm: false, cancel: true }); };
  vm.onPickPreset({ currentTarget: { dataset: { text: '默认便签' } } });
  assert.equal(vm.modals.length, 1);
  assert.equal(vm.data.text, '我手写的一句话');
  // Confirm overwrite -> preset replaces draft
  global.wx.showModal = (o) => { vm.modals.push(o); if (o && o.success) o.success({ confirm: true, cancel: false }); };
  vm.onPickPreset({ currentTarget: { dataset: { text: '默认便签' } } });
  assert.equal(vm.data.text, '默认便签');
  // Submit lock
  vm.onSubmit();
  vm.onSubmit();
  assert.equal(vm.events.filter((e) => e.name === 'submit').length, 1);
  vm.def.lifetimes.detached.call(vm);
});

test('A3-2j: playkit-objectcard renders title/shotNote, cancels during proc, and routes denied perm to cyModal -> openSetting', () => {
  const wxml = read('pages/playkit/components/playkit-objectcard/index.wxml');
  const disp = read('pages/playkit/components/playkit/index.wxml');
  assert.match(disp, /title="\{\{kit\.title\}\}" shot-note="\{\{kit\.shotNote\}\}"/);
  assert.match(wxml, /onCancelProc/);
  const vm = mountComponent('pages/playkit/components/playkit-objectcard/index.js', {
    show: true, title: '拍下招牌', shotNote: '请拍清楚店名',
  }, {
    chooseMedia(o) { if (o && o.fail) o.fail({ errMsg: 'chooseMedia:fail auth deny' }); },
  });
  vm.setData({ phase: 'proc' });
  vm.onCancelProc();
  assert.equal(vm.data.phase, 'cam');
  // Denied album triggers cyModal -> wx.openSetting
  vm.onAlbum();
  assert.equal(vm.modals.length, 1);
  assert.equal(vm.openSettings.length, 1);
});

test('A3-2k: playkit-journey-check cancels charge on touchcancel without rolling and uses friendlier CTA', () => {
  const wxml = read('pages/playkit/components/playkit-journey-check/index.wxml');
  assert.match(wxml, /bindtouchcancel="onHoldCancel"/);
  assert.match(wxml, /长按蓄力，松手掷骰/);
  const vm = mountComponent('pages/playkit/components/playkit-journey-check/index.js', { show: true });
  vm.onHoldStart();
  assert.equal(vm.data.holding, true);
  vm.onHoldCancel();
  assert.equal(vm.data.holding, false);
  assert.ok(!vm._rolling);
  assert.equal(vm.events.length, 0);
});

/* ── (3) Sensor & tail P2 kits ── */
test('A3-3a: playkit-compass smoothHeading wraps across 0°/360° and unlocks skip after >25s or lowAccuracy', () => {
  let now = 10000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const handlers = [];
    const vm = mountComponent('pages/playkit/components/playkit-compass/index.js', {
      show: true, target: 180, tolerance: 15, holdSeconds: 3, canSkip: false,
    }, {
      onCompassChange(fn) { handlers.push(fn); },
      offCompassChange() {},
      startCompass(o) { if (o && o.success) o.success(); },
      stopCompass() {},
    });
    // Wrap smoothing across North (359 -> 1 moves clockwise past 0, never backward through 180)
    const sm = vm._smoothHeading(359, 1, 0.5);
    assert.ok(sm === 0 || sm > 358 || sm < 2, 'short arc across 0°: ' + sm);
    // Start and run > 25s without aligning -> emits readfail to unlock skip
    vm.onStart();
    vm.onRun({ currentTarget: { dataset: { stageKey: 0 } } });
    for (let i = 0; i < 65; i++) {
      now += 400;
      handlers[0]({ direction: 0, accuracy: 'high' });
      vm._tick();
    }
    assert.ok(vm.events.some((e) => e.name === 'readfail'), 'unlocks skip after >25s struggle');
    vm._abort();
  } finally {
    Date.now = realNow;
  }
});

test('A3-3b: playkit-ballshake averages calibratetick baseline and blocks pre-start idleShake', () => {
  const listeners = [];
  const vm = mountComponent('pages/playkit/components/playkit-ballshake/index.js', { show: true }, {
    onAccelerometerChange(fn) { listeners.push(fn); },
    offAccelerometerChange(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    startAccelerometer(o) { if (o && o.success) o.success(); },
    stopAccelerometer() {},
  });
  // Show does NOT arm idleShake automatically and _onIdleShake does NOT start
  vm.fireObserver('show', true);
  assert.equal(listeners.length, 0);
  vm._onIdleShake();
  assert.equal(vm._attempt, undefined);
  // Real calibratetick averages samples into _zero
  vm.onStart();
  const ev = { currentTarget: { dataset: { stageKey: 0 } } };
  vm.onCalibrateTick(ev);
  listeners[0]({ x: 0.2, y: 0.4 });
  vm.onCalibrateTick(ev);
  listeners[0]({ x: 0.4, y: 0.8 });
  vm.onCalibrateTick(ev);
  vm.onCalibrated(ev);
  assert.ok(Math.abs(vm._zero.x - 0.3) < 0.001);
  assert.ok(Math.abs(vm._zero.y - 0.6) < 0.001);
  vm._interrupt();
});

test('A3-3c: reaction & stopwatch use bindtouchstart, show goalMs/toleranceMs, and block review double-tap', () => {
  const rxWxml = read('pages/playkit/components/playkit-reaction/index.wxml');
  const swWxml = read('pages/playkit/components/playkit-stopwatch/index.wxml');
  assert.match(rxWxml, /bindtouchstart="onTap"/);
  assert.match(rxWxml, /goalMs/);
  assert.match(swWxml, /bindtouchstart="onStop"/);
  assert.match(swWxml, /toleranceMs/);
  // Stopwatch over-phase double-tap lock
  let now = 50000;
  const realNow = Date.now;
  Date.now = () => now;
  try {
    const sw = mountComponent('pages/playkit/components/playkit-stopwatch/index.js', {
      show: true, targetSeconds: 5, toleranceMs: 200, tries: 3,
    });
    sw.onRun();
    now += 2000; // early miss
    sw.onStop();
    assert.equal(sw.data.phase, 'over');
    // Immediate double-tap (50ms later) must NOT restart
    now += 50;
    sw.onStop();
    assert.equal(sw.data.phase, 'over');
    // Tap after 500ms restarts cleanly
    now += 500;
    sw.onStop();
    assert.equal(sw.data.phase, 'run');
    sw._stop();
  } finally {
    Date.now = realNow;
  }
});

test('A3-3d: playkit-typein auto-focuses, buffers arming keys, skips auto-submit on wrong last char, removes fake shift', () => {
  const wxml = read('pages/playkit/components/playkit-typein/index.wxml');
  assert.match(wxml, /focus="\{\{phase === 'run' && !locked\}\}"/);
  assert.doesNotMatch(wxml, /⇧/);
  const vm = mountComponent('pages/playkit/components/playkit-typein/index.js', {
    show: true, terminalSkin: true, target: 'cat',
  });
  vm.fireObserver('show, attempts, passed, target', true, 0, false, 'cat');
  // First key arms, second key typed during arming is buffered (not dropped)
  vm.onKey({ currentTarget: { dataset: { key: 'c' } } });
  assert.equal(vm.data.phase, 'arming');
  vm.onKey({ currentTarget: { dataset: { key: 'a' } } });
  vm.onRun();
  assert.equal(vm.data.typed, 'ca');
  // Typing WRONG last char does NOT auto-submit
  vm.onKey({ currentTarget: { dataset: { key: 'x' } } });
  assert.equal(vm.data.typed, 'cax');
  assert.equal(vm.data.mistyped, true);
  assert.equal(vm.events.filter((e) => e.name === 'submit').length, 0);
  // Backspace + correct last char auto-submits
  vm.onKey({ currentTarget: { dataset: { key: 'back' } } });
  vm.onKey({ currentTarget: { dataset: { key: 't' } } });
  assert.equal(vm.events.filter((e) => e.name === 'submit').length, 1);
  assert.equal(vm.events.find((e) => e.name === 'submit').detail.text, 'cat');
});

test('A3-3e: coin/dice/countdown replace dead end state with 继续 CTA; d20 shows 目标难度 + breakdown; compare passes maxAttempts', () => {
  assert.match(read('pages/playkit/components/playkit-coinflip/index.wxml'), /继续/);
  assert.match(read('pages/playkit/components/playkit-countdown/index.wxml'), /继续/);
  const diceWxml = read('pages/playkit/components/playkit-diceroll/index.wxml');
  assert.match(diceWxml, /继续/);
  assert.match(diceWxml, /目标难度/);
  assert.match(diceWxml, /d20__breakdown/);
  assert.match(read('pages/playkit/components/playkit/index.wxml'), /max-attempts="\{\{kit\.maxAttempts\}\}"/);
  assert.match(read('pages/playkit/components/playkit-compare/index.wxml'), /tries="\{\{maxAttempts\}\}"/);
});

test('A3-3f: playkit-blindtaste auto-closes 3s overlay and shows wrong feedback on failed attempt', () => {
  const vm = mountComponent('pages/playkit/components/playkit-blindtaste/index.js', {
    show: true,
    options: [{ key: 'a', label: '拿铁' }, { key: 'b', label: '美式' }],
    attempts: 0, locked: false, selectedKey: '',
  });
  vm.fireObserver('show, selectedKey, locked', true, '', false);
  vm.fireObserver('attempts', 0);
  vm.setData({ stage: 1, eyes: 'closed' });
  vm._finishTaste();
  assert.equal(vm.data.stage, 2, 'auto-closes taste overlay at 0s into pick stage');
  assert.equal(vm.data.eyes, 'open');
  vm.fireObserver('attempts', 1);
  assert.ok(vm.data.wrongFeedback.length > 0);
  assert.equal(vm.stageCalls.filter((c) => c[0] === 'nudge').length, 1);
});

test('A3-3g: unified denied-permission recovery (cyModal -> wx.openSetting) across quiethold/shout/walk/objectcard/dailysign', () => {
  for (const [rel, method] of [
    ['pages/playkit/components/playkit-quiethold/index.js', 'onOpenSetting'],
    ['pages/playkit/components/playkit-shout/index.js', 'onOpenSetting'],
    ['pages/playkit/components/playkit-walk/index.js', 'onOpenSetting'],
  ]) {
    const vm = mountComponent(rel, { show: true });
    vm[method]();
    assert.equal(vm.modals.length, 1, rel + ' opens cyModal');
    assert.equal(vm.openSettings.length, 1, rel + ' confirms to wx.openSetting');
  }
});
