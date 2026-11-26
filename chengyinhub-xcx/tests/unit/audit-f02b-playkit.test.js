'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

/** Mounts a Component definition with a minimal property/observer runtime. */
function mount(file, props = {}, wxExtra = {}) {
  let def;
  global.getApp = () => ({ globalData: {} });
  global.wx = Object.assign({ showToast() {}, vibrateShort() {}, getStorageSync() {}, setStorageSync() {},
    getSystemInfoSync: () => ({}), getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812 }) }, wxExtra);
  global.Component = (d) => { def = d; };
  global.Behavior = (b) => b;
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  require(file);
  const data = {};
  (def.behaviors || []).forEach((b) => Object.assign(data, JSON.parse(JSON.stringify((b && b.data) || {}))));
  Object.assign(data, JSON.parse(JSON.stringify(def.data || {})));
  Object.entries(def.properties || {}).forEach(([k, v]) => { data[k] = JSON.parse(JSON.stringify(v.value === undefined ? null : v.value)); });
  const vm = { data, properties: data, triggered: [], triggerEvent(name, detail) { this.triggered.push([name, detail]); }, selectComponent: () => null };
  Object.entries(def.methods || {}).forEach(([k, fn]) => { vm[k] = fn.bind(vm); });
  const observers = Object.entries(def.observers || {});
  vm.setData = (patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let target = vm.data;
      parts.slice(0, -1).forEach((part) => { target = target[part] || (target[part] = {}); });
      target[parts[parts.length - 1]] = value;
    });
  };
  vm.setProps = (patch) => {
    Object.assign(vm.data, patch);
    const keys = Object.keys(patch);
    observers.forEach(([spec, fn]) => {
      const fields = spec.split(',').map((s) => s.trim());
      if (fields.some((f) => keys.includes(f))) fn.apply(vm, fields.map((f) => vm.data[f]));
    });
    Object.entries(def.properties || {}).forEach(([k, v]) => { if (keys.includes(k) && v.observer) (typeof v.observer === 'string' ? vm[v.observer] : v.observer).call(vm, vm.data[k]); });
  };
  vm.def = def;
  vm.setProps(props);
  return vm;
}

test('L02-150: dice pips carry a unique wx:key', () => {
  const vm = mount('../../pages/playkit/components/playkit-diceroll/index.js', { mode: 'd6', reducedMotion: true });
  vm.setProps({ show: true, values: [5] });
  const pips = vm.data.dice[0].pips;
  assert.equal(pips.length, 9);
  assert.equal(new Set(pips.map((p) => p.k)).size, 9);
  assert.equal(pips.filter((p) => p.on).length, 5);
});

test('L02-157: classify, compare, accusation and daily-sign send one submit until a receipt arrives', () => {
  const realSet = global.setTimeout; global.setTimeout = () => 1;
  try {
    const cf = mount('../../pages/playkit/components/playkit-classify/index.js', {});
    cf.setData({ placed: 2, total: 2 }); cf._rows = [{ id: 'a', bin: 'x' }, { id: 'b', bin: 'y' }];
    cf.onSubmit(); cf.onSubmit();
    assert.equal(cf.triggered.filter((t) => t[0] === 'submit').length, 1);
    cf.setProps({ attempts: 1, passed: false });
    cf.onSubmit();
    assert.equal(cf.triggered.filter((t) => t[0] === 'submit').length, 2);
    cf.setProps({ attempts: 2, passed: true });
    const before = JSON.stringify(cf._rows);
    cf.onPickBin({ currentTarget: { dataset: { i: 0, b: 'z' } } });
    cf.onTakeBack({ currentTarget: { dataset: { i: 1 } } });
    assert.equal(JSON.stringify(cf._rows), before, 'no edits after passed');

    const cp = mount('../../pages/playkit/components/playkit-compare/index.js', {});
    cp.setData({ markedCount: 1, sides: [] });
    cp.onSubmit(); cp.onSubmit();
    assert.equal(cp.triggered.filter((t) => t[0] === 'submit').length, 1);

    const ac = mount('../../pages/playkit/components/playkit-accusation/index.js', {});
    ac._clearPop = () => {};
    ac.setData({ suspects: [{ id: 's1', name: '甲' }], cur: 0, confirmOpen: true });
    ac.onConfirmGo();
    ac.setData({ confirmOpen: true });
    ac.onConfirmGo();
    assert.equal(ac.triggered.filter((t) => t[0] === 'submit').length, 1);

    const ds = mount('../../pages/playkit/components/playkit-dailysign/index.js', {});
    ds.setData({ writing: true, claimed: false });
    ds.onAccept(); ds.onAccept();
    assert.equal(ds.triggered.filter((t) => t[0] === 'accept').length, 1);
  } finally { global.setTimeout = realSet; }
});

test('L02-173: match does not re-raise the wrong verdict on a same-attempts refresh', () => {
  let nudges = 0;
  const vm = mount('../../pages/playkit/components/playkit-match/index.js', {});
  vm.selectComponent = () => ({ begin() {}, nudge() { nudges += 1; } });
  vm.setProps({ show: true, left: [{ id: 'a' }], right: [{ id: '1' }] });
  vm.setProps({ attempts: 1, passed: false, lastCorrect: false });
  assert.equal(vm.data.verdict, 'no'); assert.equal(nudges, 1);
  vm.setData({ verdict: '' });                       // player starts re-pairing
  vm.setProps({ attempts: 1, passed: false, lastCorrect: false });   // kit refresh, same attempts
  assert.equal(vm.data.verdict, ''); assert.equal(nudges, 1);
  vm.setProps({ attempts: 2, passed: true, lastCorrect: true });
  assert.equal(vm.data.verdict, 'ok'); assert.equal(nudges, 1);
});

test('L02-118: cy-frames hidden during its enter delay re-enters on show', () => {
  const realSet = global.setTimeout; const fns = [];
  global.setTimeout = (fn) => { fns.push(fn); return fns.length; };
  try {
    const vm = mount('../../pages/play/components/cy-frames/index.js', { reducedMotion: false, sheets: [{ n: 4 }], w: 100, fw: 100, cols: 2, mode: 'loop' });
    vm.def.lifetimes.attached.call(vm);
    assert.equal(vm.data.on, false);
    vm.def.pageLifetimes.hide.call(vm);
    fns.length = 0;
    vm.def.pageLifetimes.show.call(vm);
    assert.equal(fns.length, 1, 'enter re-armed');
    fns[0]();
    assert.equal(vm.data.on, true);
  } finally { global.setTimeout = realSet; }
});

test('L02-139: replay-motion puts the animation back only after the reset frame rendered', () => {
  global.Behavior = (b) => b;
  const beh = require('../../pages/playkit/behaviors/replay-motion.js');
  const realSet = global.setTimeout; const timers = [];
  global.setTimeout = (fn, ms) => { timers.push(ms); fn(); return 1; };
  try {
    const states = []; const callbacks = [];
    const vm = { data: { reducedMotion: false }, setData(p, cb) { states.push(p._motionReset); if (cb) callbacks.push(cb); } };
    beh.methods.replayMotion.call(vm);
    assert.deepEqual(states, [true]);
    callbacks.shift()();
    assert.deepEqual(states, [true, false]);
    assert.deepEqual(timers, [16]);
  } finally { global.setTimeout = realSet; }
});

test('L02-138: playkit-steps keeps only the step rows that have callers', () => {
  const steps = require('../../pages/playkit/utils/playkit-steps.js');
  assert.equal(steps.stepIcons('blindtaste').length, 3);
  assert.equal(steps.stepIcons('steps').length, 3);
  assert.deepEqual(steps.stepIcons('dailysign'), []);
});

test('L02-135: ring meter sends only the lit count when the percent changes', () => {
  const vm = mount('../../pages/playkit/components/ring-meter/index.js', {});
  vm.setProps({ percent: 0, segments: 48, size: 360 });
  const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
  vm.setProps({ percent: 50 });
  assert.deepEqual(Object.keys(patches[0]), ['lit']);
  assert.equal(vm.data.lit, 24);
  patches.length = 0;
  vm.setProps({ percent: 50.4 });
  assert.equal(patches.length, 0, 'same lit count: nothing sent');
});

test('L02-143: compass ticks with nothing new besides the needle send only needle and rose', () => {
  const vm = mount('../../pages/playkit/components/playkit-compass/index.js', { target: 90, tolerance: 15, holdSeconds: 3 });
  vm._current = () => true; vm._fresh = () => true;
  vm._attempt = { phase: 'run', lastFrame: Date.now(), startedAt: Date.now(), frames: 1 };
  vm.setData({ phase: 'run', stageKeys: [0] });
  vm._target = 90; vm._heading = 10; vm._held = 0; vm._lowAccuracy = false;
  const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
  vm._tick();
  vm._heading = 10.2;
  vm._tick();
  assert.ok(Object.keys(patches[0]).length > 2);
  assert.deepEqual(Object.keys(patches[1]).sort(), ['needleDeg', 'roseDeg']);
});

test('L02-154: daily-sign opening does not resend the barcode it already has', () => {
  const realSet = global.setTimeout; global.setTimeout = () => 1;
  try {
    const vm = mount('../../pages/playkit/components/playkit-dailysign/index.js', { serialLabel: 'No.0042' });
    assert.ok(vm.data.bars.length > 0);
    const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
    vm.setProps({ show: true });
    assert.ok(patches.length > 0);
    assert.ok(patches.every((p) => !('bars' in p)), 'bars come from the serial observer only');
  } finally { global.setTimeout = realSet; }
});

test('L02-140: album glass measures the width once and lets go of its timers and canvases on close', () => {
  let asks = 0; const cleared = [];
  const realClear = global.clearTimeout; global.clearTimeout = (t) => { cleared.push(t); };
  try {
    const ctx = new Proxy({}, { get: () => () => ({}) });
    const node = { width: 0, height: 0, getContext: () => ctx, createImage: () => ({}), requestAnimationFrame: () => 7, cancelAnimationFrame(id) { cleared.push('raf' + id); } };
    const vm = mount('../../pages/playkit/components/album-glass/index.js', {}, {
      getWindowInfo: () => { asks += 1; return { windowWidth: 400, pixelRatio: 2 }; },
      createOffscreenCanvas: () => ({ getContext: () => ctx, createImage: () => ({}) }),
    });
    vm.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: (cb) => cb([{ node }]) }) }) });
    vm.def.lifetimes.attached.call(vm);
    vm.def.lifetimes.ready.call(vm);
    const before = asks;
    vm.setData({ images: [{ url: 'a' }, { url: 'b' }] });
    vm.onTouchStart({ touches: [{ clientX: 200 }] });
    vm.onTap({ detail: { x: 10 } });
    assert.equal(asks, before, 'no window query per gesture');
    assert.equal(vm._step, 240);
    vm._timer = 99; vm._raf = 7;
    vm.def.lifetimes.detached.call(vm);
    assert.ok(cleared.includes(99) && cleared.includes('raf7'));
    assert.equal(vm._off, null); assert.equal(vm._ctx, null); assert.deepEqual(vm._imgs, {});
  } finally { global.clearTimeout = realClear; }
});

test('L02-141: coin faces are built once and not resent when the copy did not change', () => {
  const vm = mount('../../pages/playkit/components/playkit-coinflip/index.js', { headsLabel: '正', headsAction: '喝', tailsLabel: '反', tailsAction: '唱' }, { onAccelerometerChange() {}, offAccelerometerChange() {}, startAccelerometer() {}, stopAccelerometer() {} });
  vm.setProps({ show: true });
  const faceB = vm.data.faceB;
  assert.ok(vm.data.faceA.startsWith('data:image/svg+xml') && faceB.startsWith('data:image/svg+xml'));
  const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
  vm.setProps({ show: false }); vm.setProps({ show: true });
  assert.ok(patches.every((p) => !('faceA' in p) && !('faceB' in p)), 'reopen with the same copy sends no face');
  vm.setProps({ tailsAction: '跳' });
  assert.ok(patches.some((p) => p.lab && p.lab.includes('跳') && !('faceA' in p)));
  vm.setProps({ headsAction: '跑' });
  const sent = patches.find((p) => 'faceA' in p);
  assert.ok(sent && sent.faceA !== faceB && sent.faceB === faceB);
});

test('L02-177: time-window and silent-order clocks follow the wall clock across a background stay', () => {
  const realNow = Date.now; const realSI = global.setInterval; const realCI = global.clearInterval;
  let now = 1000000; Date.now = () => now;
  let ticks = []; global.setInterval = (fn) => { ticks.push(fn); return ticks.length; }; global.clearInterval = () => {};
  try {
    const tw = mount('../../pages/playkit/components/playkit-timewindow/index.js', { remainSeconds: 120, show: true });
    assert.equal(tw.data.clock, '00:02:00');
    tw.def.pageLifetimes.hide.call(tw);
    now += 60000;
    tw.def.pageLifetimes.show.call(tw);
    assert.equal(tw.data.clock, '00:01:00', 'a minute in the background is a minute off the countdown');
    now += 61000; ticks[ticks.length - 1]();
    assert.deepEqual(tw.triggered.map((t) => t[0]), ['open']);

    ticks = [];
    const so = mount('../../pages/playkit/components/playkit-silentorder/index.js', { elapsedSeconds: 5, show: true });
    so.def.pageLifetimes.hide.call(so);
    now += 30000;
    so.def.pageLifetimes.show.call(so);
    assert.equal(so.data.clock, '00:35');
    so.onGiveUp();
    assert.equal(so.triggered[0][1].elapsedSeconds, 35);
    const n = ticks.length; so.def.pageLifetimes.show.call(so);
    assert.equal(ticks.length, n, 'no restart after giving up');
  } finally { Date.now = realNow; global.setInterval = realSI; global.clearInterval = realCI; }
});

test('L02-180: sort drag sends nothing for sub-pixel moves and only the offset within a row', () => {
  const vm = mount('../../pages/playkit/components/playkit-sort/index.js', {});
  vm.setData({ rows: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], dragging: -1, dragOffset: 0, picked: -1 });
  vm._dragFrom = 0; vm._dragAt = 0; vm._dragY = 100; vm._rowH = 60; vm._moved = true;
  const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
  vm.onDragMove({ touches: [{ clientY: 110 }] });
  vm.onDragMove({ touches: [{ clientY: 110.3 }] });
  vm.onDragMove({ touches: [{ clientY: 115 }] });
  assert.equal(patches.length, 2);
  assert.deepEqual(Object.keys(patches[1]), ['dragOffset']);
  assert.equal(vm.data.dragOffset, 15);
});

test('L02-134: scratch reads the canvas once per measure and still reveals past the threshold', () => {
  const vm = mount('../../pages/playkit/components/scratch/index.js', { threshold: 0.5 });
  const W = 34, H = 17; const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++) for (let x = 0; x < 26; x++) data[(y * W + x) * 4 + 3] = 0;
  let reads = 0;
  vm._canvas = { width: W, height: H };
  vm._ctx = { getImageData: (x, y, w, h) => { reads += 1; assert.deepEqual([x, y, w, h], [0, 0, W, H]); return { data }; } };
  let finished = 0; vm._finish = () => { finished += 1; };
  vm._measure();
  assert.equal(reads, 1);
  assert.equal(finished, 1);
});

test('L02-165: holding the roll button sends no setData per tick; the bar fills by CSS', () => {
  const fs = require('fs'); const path = require('path');
  const dir = path.join(__dirname, '../../pages/playkit/components/playkit-journey-check/');
  const wxml = fs.readFileSync(dir + 'index.wxml', 'utf8'); const wxss = fs.readFileSync(dir + 'index.wxss', 'utf8');
  assert.match(wxml, /class="jc__charge \{\{holding \? 'is-on' : ''\}\}"/);
  assert.match(wxss, /\.jc__charge\.is-on\s*\{[^}]*transform:\s*scaleX\(1\)[^}]*transition:\s*transform 1\.4s linear/);
  const ticks = []; const realSI = global.setInterval; global.setInterval = (fn) => { ticks.push(fn); return 1; };
  try {
    const vm = mount('../../pages/playkit/components/playkit-journey-check/index.js', {});
    vm.setData({ unknown: false, loading: false, receipt: null, r5: false });
    const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
    vm.onHoldStart();
    ticks[0](); ticks[0](); ticks[0]();
    assert.deepEqual(patches, [{ holding: true }]);
  } finally { global.setInterval = realSI; }
});

test('L02-125/144/167/183: the skin table lives in a stage-only file; kits no longer carry it; dead stage shake is gone', () => {
  const fs = require('fs'); const path = require('path');
  const root = path.join(__dirname, '../../');
  const surface = fs.readFileSync(root + 'pages/playkit/style/play-surface.wxss', 'utf8');
  const skins = fs.readFileSync(root + 'pages/playkit/style/play-skins.wxss', 'utf8');
  const stage = fs.readFileSync(root + 'pages/playkit/components/play-stage/index.wxss', 'utf8');
  assert.doesNotMatch(surface, /^\.skin-[a-z]+\s*\{/m);
  assert.equal((skins.match(/^\.skin-[a-z]+\s*\{/gm) || []).length, 11);
  assert.match(stage, /@import "\/pages\/playkit\/style\/play-skins\.wxss";/);
  assert.doesNotMatch(stage, /st--shake|st-shake/);
  const importers = [];
  (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.wxss$/.test(e.name) && /@import "[^"]*play-skins\.wxss"/.test(fs.readFileSync(p, 'utf8'))) importers.push(path.relative(root, p)); }); })(root + 'pages');
  assert.deepEqual(importers, ['pages/playkit/components/play-stage/index.wxss']);
  const wxmls = [];
  (function walk(d) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.wxml$/.test(e.name) && /class="[^"]*\bskin-/.test(fs.readFileSync(p, 'utf8'))) wxmls.push(path.relative(root, p)); }); })(root + 'pages');
  assert.deepEqual(wxmls, ['pages/playkit/components/play-stage/index.wxml'], 'only the stage puts skin-* on a node');
});

test('L02-136/117: cy-illus has no dead n property and sends its layers once per name', () => {
  const realSet = global.setTimeout; global.setTimeout = () => 1;
  try {
    const vm = mount('../../pages/playkit/components/cy-illus/index.js', {}, { getStorageSync: () => '' });
    assert.equal('n' in vm.def.properties, false);
    const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
    vm.setProps({ name: 'key' });
    vm.def.lifetimes.attached.call(vm);
    assert.equal(patches.filter((p) => 'layers' in p).length, 1);
    vm.setProps({ name: 'clue' });
    assert.equal(patches.filter((p) => 'layers' in p).length, 2);
  } finally { global.setTimeout = realSet; }
});

test('L02-182: walk and steps format thousands with one shared helper', () => {
  const fs = require('fs'); const path = require('path');
  const { groupThousands } = require('../../pages/playkit/utils/group-thousands.js');
  assert.equal(groupThousands(4286), '4,286'); assert.equal(groupThousands(1234567), '1,234,567');
  assert.equal(groupThousands(-3), '0'); assert.equal(groupThousands('x'), '0');
  for (const k of ['walk', 'steps']) {
    const src = fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit-' + k + '/index.js'), 'utf8');
    assert.match(src, /require\('\.\.\/\.\.\/utils\/group-thousands\.js'\)/);
    assert.doesNotMatch(src, /\\B\(\?=/);
  }
});

test('L02-189: scan AR loads the plane reticle only in plane mode and drops the unbound arready event', () => {
  const fs = require('fs'); const path = require('path');
  const dir = path.join(__dirname, '../../pages/playkit/components/playkit-scan/ar/');
  const wxml = fs.readFileSync(dir + 'index.wxml', 'utf8');
  assert.match(wxml, /<xr-asset-load wx:if="\{\{mode === 'PLANE'\}\}" type="texture" asset-id="reticle"/);
  assert.match(wxml, /<xr-asset-material wx:if="\{\{mode === 'PLANE'\}\}" asset-id="reticle-mat"/);
  const vm = mount('../../pages/playkit/components/playkit-scan/ar/index.js', {});
  vm.handleArReady();
  assert.equal(vm.data.arReady, true);
  assert.deepEqual(vm.triggered, []);
});

test('pass 2: dead rules no wxml can reach are gone from isolated kits', () => {
  const fs = require('fs'); const path = require('path');
  const d = path.join(__dirname, '../../pages/playkit/components/');
  const css = (k) => fs.readFileSync(d + k + '/index.wxss', 'utf8');
  assert.doesNotMatch(css('playkit-qa'), /\.qa__tail\b/);
  assert.doesNotMatch(css('playkit-sort'), /\.so__hint\b/);
  assert.doesNotMatch(css('playkit-stopwatch'), /\.sw__hat-s\b/);
  assert.doesNotMatch(css('playkit-dailysign'), /\.ds__save\b/);
});

test('L02-191: quiet-hold and shout remount the stage only after a real attempt', () => {
  for (const k of ['quiethold', 'shout']) {
    const vm = mount('../../pages/playkit/components/playkit-' + k + '/index.js', { seconds: 5 }, { getRecorderManager: () => ({}) });
    let stops = 0;
    vm.selectComponent = () => ({ _stopAll() { stops += 1; } });
    vm.setProps({ show: true });
    vm.setProps({ show: false });
    assert.deepEqual(vm.data.stageKeys, [0], k + ': opening and closing without a run does not remount');
    assert.equal(stops, 0, k + ': and does not retire the untouched stage');
    vm._attempt = { stage: { _stopAll() { stops += 1; } }, handlers: {} };
    vm._abort();
    assert.deepEqual(vm.data.stageKeys, [1], k + ': after an attempt the stage is fresh');
    assert.equal(stops, 1);
  }
});

test('L02-031: ballshake shares the accelerometer; closing it does not stop the sensor an inline coin still holds', () => {
  const { holdAccelerometer } = require('../../pages/playkit/utils/play-shake.js');
  let stops = 0; let starts = 0; const listeners = new Set();
  const api = { onAccelerometerChange: (f) => listeners.add(f), offAccelerometerChange: (f) => listeners.delete(f),
    startAccelerometer: () => { starts += 1; }, stopAccelerometer: () => { stops += 1; } };
  const coin = []; const releaseCoin = holdAccelerometer(api, (r) => coin.push(r));
  const vm = mount('../../pages/playkit/components/playkit-ballshake/index.js', {}, api);
  Object.assign(api, global.wx, { onAccelerometerChange: api.onAccelerometerChange, offAccelerometerChange: api.offAccelerometerChange, startAccelerometer: api.startAccelerometer, stopAccelerometer: api.stopAccelerometer });
  global.wx = api;   // 同一个 wx 对象 = 同一个传感器 hub
  vm._idleShake = () => {}; vm.setData({ show: true, running: false, awaitingResult: false, skipped: false, challenge: null });
  vm._armIdleShake();
  assert.equal(starts, 1, 'second holder does not restart the sensor');
  vm._offIdleShake();
  assert.equal(stops, 0, 'the coin still holds it');
  [...listeners][0]({ x: 1, y: 0, z: 0 });
  assert.equal(coin.length, 1, 'readings go back to the coin');
  releaseCoin();
  assert.equal(stops, 1);
  let failed = 0;
  const api2 = Object.assign({}, api, { startAccelerometer: (o) => o.fail() });
  const rel = holdAccelerometer(api2, () => {}, () => { failed += 1; });
  assert.equal(failed, 1); assert.equal(typeof rel, 'function');
});

test('L02-049: quiet-hold and shout share one pcmPeak / denied from play-audio-level', () => {
  const fs = require('fs'); const path = require('path');
  const lvl = require('../../pages/playkit/utils/play-audio-level.js');
  assert.equal(lvl.denied({ errMsg: 'operateRecorder:fail auth denied' }), true);
  assert.equal(lvl.denied({ errMsg: 'operateRecorder:fail busy' }), false);
  assert.equal(lvl.pcmPeak(new ArrayBuffer(3)), null);
  for (const k of ['quiethold', 'shout']) {
    const src = fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit-' + k + '/index.js'), 'utf8');
    assert.doesNotMatch(src, /function (pcmPeak|denied)\(/, k);
    assert.match(src, /pcmPeak, denied \} = require\('\.\.\/\.\.\/utils\/play-audio-level\.js'\)/, k);
  }
});

test('L02-170: photocheck takes the camera context from the component, like objectcard', () => {
  let arg = 'unset';
  const vm = mount('../../pages/playkit/components/playkit-photocheck/index.js', {}, { createCameraContext: (a) => { arg = a; return { takePhoto() {} }; } });
  vm.setData({ busy: false });
  vm.onFrameShutter();
  assert.equal(arg, vm);
  const fs = require('fs'); const path = require('path');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit-photocheck/index.wxml'), 'utf8'), /\{\{lastUrl \? 'is-filled' : ''\}\}/);
});

test('L02-030: ballshake sends nothing for ticks where the ball did not move, and hits/flash only on a hit', () => {
  const vm = mount('../../pages/playkit/components/playkit-ballshake/index.js', {});
  const attempt = { phase: 'running', lastFrame: Date.now(), startedAt: Date.now() };
  vm._attempt = attempt; vm._current = () => true;
  vm.setData({ running: true, ball: { x: 100, y: 100 }, trail: [], hits: 0, flash: '', goal: 99 });
  Object.assign(vm, { _x: 100, _y: 100, _vx: 0, _vy: 0, _gx: 0, _gy: 0, _r: 20, _w: 375, _h: 600, _hits: 0 });
  const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
  vm._step();
  assert.equal(patches.length, 0, 'still ball: no setData');
  vm._vx = 5; vm._step();
  assert.deepEqual(Object.keys(patches[0]).sort(), ['ball', 'trail']);
  vm._x = 10; vm._vx = -5; vm._step();
  assert.deepEqual(Object.keys(patches[1]).sort(), ['ball', 'flash', 'hits', 'trail']);
  assert.equal(patches[1].flash, 'left');
});

test('L02-156: the daily-sign poster layout engine lives in utils/dailysign-poster.js; the component only requires it', () => {
  const fs = require('fs'); const path = require('path');
  const util = require('../../pages/playkit/utils/dailysign-poster.js');
  for (const k of ['DAILY_SIGN_CARD', 'SLIP', 'FONT', 'wrapText', 'buildSignPoster', 'buildBars']) assert.ok(util[k], k);
  assert.equal(util.wrapText('一二三四', 1000, '', (t) => t.length * 10).join(''), '一二三四');
  const src = fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit-dailysign/index.js'), 'utf8');
  assert.match(src, /require\('\.\.\/\.\.\/utils\/dailysign-poster\.js'\)/);
  assert.doesNotMatch(src, /^function (wrapText|buildSignPoster|buildBars|signPaperPath)\(/m);
  assert.doesNotMatch(src, /^const (DAILY_SIGN_CARD|SLIP|FONT) = /m);
});
