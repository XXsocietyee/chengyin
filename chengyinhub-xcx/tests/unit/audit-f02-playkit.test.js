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
  const vm = { data, triggered: [], triggerEvent(name, detail) { this.triggered.push([name, detail]); }, selectComponent: () => null };
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
    Object.entries(def.properties || {}).forEach(([k, v]) => { if (keys.includes(k) && v.observer) v.observer.call(vm, vm.data[k]); });
  };
  vm.def = def;
  vm.setProps(props);
  return vm;
}

test('L02-003: blindtaste re-opens the confirm button after a wrong answer', () => {
  const vm = mount('../../pages/playkit/components/playkit-blindtaste/index.js',
    { show: true, options: [{ key: 'A' }, { key: 'B' }], attempts: 0, reducedMotion: true });
  vm.setData({ stage: 2 });
  vm.onPick({ currentTarget: { dataset: { key: 'A' } } });
  vm.onConfirm();
  assert.equal(vm.data.answering, true);
  vm.setProps({ attempts: 1 });          // server judged it wrong, not solved
  assert.equal(vm.data.answering, false);
  vm.onConfirm();
  assert.equal(vm.triggered.filter((t) => t[0] === 'answer').length, 2);
});

test('L02-003: blindtaste recovers by close/reopen after a network failure', () => {
  const vm = mount('../../pages/playkit/components/playkit-blindtaste/index.js',
    { show: true, options: [{ key: 'A' }], reducedMotion: true });
  vm.setData({ stage: 2, chosenKey: 'A' });
  vm.onConfirm();
  vm.setProps({ show: false });
  vm.setProps({ show: true });
  assert.equal(vm.data.answering, false);
});

test('L02-004: predict wheel ticks only send the per-card transform strings, slices live once', () => {
  const vm = mount('../../pages/playkit/components/playkit-predict/index.js', { reducedMotion: true });
  const patches = [];
  const base = vm.setData;
  vm.setData = (p) => { patches.push(p); base(p); };
  vm.setProps({ show: true, options: [{ key: 'A', label: 'a' }, { key: 'B', label: 'b' }, { key: 'C', label: 'c' }] });
  assert.equal(vm.data.slices.length, 10);
  assert.ok(vm.data.cards.every((c) => !('slices' in c)));
  patches.length = 0;
  vm._angle += 3;
  vm._paint();
  assert.equal(patches.length, 1);
  assert.deepEqual(Object.keys(patches[0]), ['wraps']);
  assert.ok(JSON.stringify(patches[0]).length < 400);
});

test('L02-038: predict wheel resumes spinning when the page shows again', () => {
  const vm = mount('../../pages/playkit/components/playkit-predict/index.js', { reducedMotion: false });
  vm.setProps({ show: true, options: [{ key: 'A' }, { key: 'B' }] });
  assert.ok(vm._timer);
  vm.def.pageLifetimes.hide.call(vm);
  assert.equal(vm._timer, null);
  vm.def.pageLifetimes.show.call(vm);
  assert.ok(vm._timer);
  vm._stop();
});

test('L02-005: pickPlayKit maps hiddenObject foundIds and missCount', () => {
  const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js');
  const kit = pickPlayKit({ sessionId: 's1', version: 1, playKit: { hiddenObject: {
    title: '找猫', total: 3, maxTries: 4, missCount: 1, foundIds: ['c2'],
    targets: [{ id: 'c1', label: '橘猫' }, { id: 'c2', label: '狸花' }, { id: 'c3', label: '黑猫' }],
  } } }, new Date());
  assert.deepEqual(kit.targets.map((t) => t.found), [false, true, false]);
  assert.equal(kit.used, 1);
  assert.ok(kit.targets.every((t) => !('x' in t)), 'still no coordinates');
});

test('L02-005/L02-036: hidden counts server hits and does not replay the count-in per receipt', () => {
  let begins = 0; let wins = 0; let nudges = 0;
  const stage = { begin() { begins += 1; }, win() { wins += 1; }, nudge() { nudges += 1; } };
  const vm = mount('../../pages/playkit/components/playkit-hidden/index.js', {}, { createSelectorQuery: () => ({ in: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }) }) });
  vm.selectComponent = () => stage;
  const t = (found) => ['a', 'b'].map((id) => ({ id, label: id, found: found.includes(id) }));
  vm.setProps({ total: 2, used: 0 });
  vm.setProps({ show: true, targets: t([]) });
  assert.equal(begins, 1);
  vm.setProps({ targets: t(['a']) });
  assert.equal(vm.data.foundCount, 1);
  vm.setProps({ used: 1 });
  assert.equal(nudges, 1);
  vm.setProps({ targets: t(['a', 'b']) });
  assert.equal(vm.data.foundCount, 2);
  assert.equal(wins, 1);
  assert.equal(begins, 1, 'count-in ran only once');
});

test('L02-024: a hide during 3-2-1 restarts the count on show; the run timer resumes', () => {
  const ci = mount('../../pages/playkit/components/play-countin/index.js', { reducedMotion: false });
  ci.setProps({ show: true });
  assert.ok(ci._timer);
  ci.def.pageLifetimes.hide.call(ci);
  assert.equal(ci._timer, null);
  ci.def.pageLifetimes.show.call(ci);
  assert.ok(ci._timer, 'count-in restarted');
  ci._stop();

  const cal = mount('../../pages/playkit/components/play-calibrate/index.js', {});
  cal.setProps({ show: true });
  cal.def.pageLifetimes.hide.call(cal);
  cal.def.pageLifetimes.show.call(cal);
  assert.ok(cal._timer, 'calibration restarted');
  cal._stop();

  const st = mount('../../pages/playkit/components/play-stage/index.js', { limitSeconds: 30 });
  st.setProps({ show: true });
  st._run();
  assert.ok(st._tick && st._deadline);
  st.def.pageLifetimes.hide.call(st);
  assert.equal(st._tick, null);
  st.def.pageLifetimes.show.call(st);
  assert.ok(st._tick, 'local limit bar resumes');
  st._stopAll(); clearTimeout(st._deadline);
});

test('L02-025: cy-scratch draws its cover even when the caller binds no revealed property', () => {
  let prepared = 0;
  const vm = mount('../../pages/playkit/components/scratch/index.js', {});
  vm._prepare = () => { prepared += 1; };
  const base = vm.setData;
  vm.setData = (p, cb) => { base(p); if (cb) cb(); };
  vm.def.lifetimes.attached.call(vm);
  vm.def.lifetimes.ready.call(vm);
  assert.equal(vm.data._masked, true);
  assert.equal(prepared, 1);
});

test('L02-034: coinflip recovers from a failed flip and reopens with the current result', () => {
  const realSet = global.setTimeout; const timers = [];
  global.setTimeout = (fn) => { timers.push(fn); return timers.length; };
  try {
    const vm = mount('../../pages/playkit/components/playkit-coinflip/index.js', { reducedMotion: true, headsLabel: '正', headsAction: 'a', tailsLabel: '反', tailsAction: 'b' });
    vm.def.lifetimes.attached.call(vm);
    vm.setProps({ show: true });
    vm.onFlip();
    vm.onFlip();
    assert.equal(vm.triggered.filter((t) => t[0] === 'flip').length, 1);
    timers.forEach((fn) => fn());                // no face came back: guard releases the lock
    vm.onFlip();
    assert.equal(vm.triggered.filter((t) => t[0] === 'flip').length, 2);
    vm.setProps({ face: 'HEADS' });
    assert.equal(vm.data.big, '正');
    const settled = vm.triggered.filter((t) => t[0] === 'settled').length;
    vm.setProps({ show: false });
    vm.setProps({ show: true });
    assert.equal(vm.data.big, '正', 'reopen shows the current result, not the idle prompt');
    assert.equal(vm.triggered.filter((t) => t[0] === 'settled').length, settled, 'no duplicate settled event');
  } finally { global.setTimeout = realSet; }
});

test('L02-035: compass can resubmit after a submit the server never recorded', () => {
  const vm = mount('../../pages/playkit/components/playkit-compass/index.js', {});
  vm.data.stageKeys = [0];
  vm.setProps({ show: true });
  vm._sent = true;                      // _finish ran, SUBMIT_COMPASS failed, done stays false
  vm.setProps({ show: false });
  assert.equal(vm._sent, false);
  assert.equal(vm.data.phase, 'idle');
  vm.setProps({ show: true });
  vm._sent = true;
  vm.setProps({ done: true });          // recorded: stays done
  vm.setProps({ show: false });
  assert.equal(vm.data.phase, 'done');
});

test('L02-036: pricepair and estimate run the count-in once per showing, not per receipt', () => {
  let begins = 0;
  const stage = { begin() { begins += 1; } };
  const pp = mount('../../pages/playkit/components/playkit-pricepair/index.js', {});
  pp.selectComponent = () => stage;
  const items = [{ id: 'a' }, { id: 'b' }];
  pp.setProps({ show: true, items });
  pp.setProps({ attempts: 1, lastPickId: 'a' });
  pp.setProps({ attempts: 2, lastPickId: 'b' });
  assert.equal(begins, 1);
  pp.setProps({ show: false });
  pp.setProps({ show: true });
  assert.equal(begins, 2);

  begins = 0;
  const es = mount('../../pages/playkit/components/playkit-estimate/index.js', {});
  es.selectComponent = () => stage;
  es.setProps({ show: true, min: 0, max: 1000 });
  es.setProps({ min: 0, max: 1000 });
  assert.equal(begins, 1);
});

test('L02-042: estimate reel shows the submitted guess and stays put while locked', () => {
  const es = mount('../../pages/playkit/components/playkit-estimate/index.js', {});
  es.setProps({ show: true, min: 0, max: 1000 });
  es.setProps({ submitted: true, tier: 'CLOSE', guess: 320, answer: 300 });
  assert.equal(es.data.locked, true);
  assert.equal(es.data.curText, '320');
  const before = es.data.curText;
  es.onScroll({ detail: { value: [0] } });
  assert.equal(es.data.curText, before);
});

test('L02-037: hangman keyboard input starts clean for the next puzzle on the same instance', () => {
  const vm = mount('../../pages/playkit/components/playkit-hangman/index.js', {});
  const slots = [{ fixed: false }, { fixed: false }];
  vm.setProps({ show: true, title: '第一题', slots });
  vm.setData({ typedText: 'AB', verdict: 'no' });
  vm.setProps({ show: false });
  assert.equal(vm.data.typedText, '');
  vm.setProps({ title: '第二题' });
  vm.setProps({ show: true, slots: [{ fixed: false }, { fixed: false }, { fixed: false }] });
  assert.equal(vm.data.typedText, '');
  assert.notEqual(vm.data.verdict, 'no');
});

test('L02-039: object-card spinner needs two setData calls, not ten per second', () => {
  const realSet = global.setTimeout; const fns = [];
  global.setTimeout = (fn) => { fns.push(fn); return fns.length; };
  try {
    const vm = mount('../../pages/playkit/components/playkit-objectcard/index.js', { reducedMotion: false });
    let calls = 0; const base = vm.setData;
    vm.setData = (p) => { calls += 1; base(p); };
    vm._startSpin();
    fns.forEach((fn) => fn());
    assert.equal(calls, 2);
    assert.match(vm.data.spinStyle, /steps\(600, end\)/);
    vm._stopSpin();
    assert.equal(vm.data.spinStyle, '');
  } finally { global.setTimeout = realSet; }
});

test('L02-040: note and profile drafts are written once after typing stops, and flushed on hide', () => {
  const store = {}; let writes = 0;
  const realSet = global.setTimeout; const fns = [];
  const wxStore = { setStorageSync: (k, v) => { writes += 1; store[k] = v; }, getStorageSync: (k) => store[k], removeStorageSync: (k) => { delete store[k]; } };
  global.setTimeout = (fn) => { fns.push(fn); return fns.length; };
  try {
    const note = mount('../../pages/playkit/components/playkit-note/index.js', { draftKey: 'n1', maxLength: 50 }, wxStore);
    writes = 0;
    ['a', 'ab', 'abc'].forEach((v) => note.onInput({ detail: { value: v } }));
    assert.equal(writes, 0);
    note.def.pageLifetimes.hide.call(note);
    assert.equal(writes, 1);
    assert.deepEqual(store['cy_kit_draft:n1'], { text: 'abc' });

    const prof = mount('../../pages/playkit/components/playkit-profile/index.js', { draftKey: 'p1' }, wxStore);
    prof.setData({ questions: [{ key: 'name', kind: 'text', maxLength: 12 }], step: 0, form: {}, currentQuestion: { key: 'name' } });
    let calls = 0; const base = prof.setData; prof.setData = (p, cb) => { calls += 1; base(p); if (cb) cb(); };
    writes = 0;
    prof.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '阿' } });
    assert.equal(calls, 1, 'one setData per keystroke');
    assert.equal(prof.data.form.name, '阿');
    assert.equal(prof.data.ctaLabel, '完成建档');
    fns.forEach((fn) => fn());
    assert.equal(writes, 1);
  } finally { global.setTimeout = realSet; }
});

test('L02-045: qa and scan audio buttons follow the page-owned playing state', () => {
  for (const kit of ['playkit-qa', 'playkit-scan']) {
    const vm = mount(`../../pages/playkit/components/${kit}/index.js`, {});
    vm.setData({ playing: true });                 // player tapped play
    vm.setProps({ audioPlaying: true });
    vm.setProps({ audioPlaying: false });          // page: clip ended / errored
    assert.equal(vm.data.playing, false, kit);
  }
});

test('L02-046: dragging a card sends one small path setData per move', () => {
  const vm = mount('../../pages/playkit/components/playkit-random/index.js', { reducedMotion: false });
  vm._deck = [{ id: 'a' }, { id: 'b' }]; vm._active = 0; vm._dragging = true; vm._x0 = 100; vm._w = 300;
  vm.setData({ deck: [{ id: 'a', art: 'x'.repeat(2000), cls: '', style: '' }, { id: 'b', art: 'y'.repeat(2000) }] });
  const patches = []; const base = vm.setData; vm.setData = (p) => { patches.push(p); base(p); };
  vm.onMove({ touches: [{ clientX: 40 }] });
  assert.equal(patches.length, 1);
  assert.ok(!('deck' in patches[0]));
  assert.ok(JSON.stringify(patches[0]).length < 300);
  assert.match(vm.data.deck[0].style, /translate/);
});

test('L02-048: quiethold sends no setData for frames that change nothing', () => {
  const vm = mount('../../pages/playkit/components/playkit-quiethold/index.js', {});
  vm._current = () => true; vm._watch = () => {}; vm._total = () => 10; vm._mid = 0.5; vm._hot = 0.9; vm._held = 0;
  const attempt = { phase: 'running', lastFrame: null, serial: 0, runFrame: null };
  const quiet = new Int16Array(64).fill(10).buffer;
  const calls = []; const base = vm.setData; vm.setData = (p) => { calls.push(p); base(p); };
  vm._onFrame(attempt, { frameBuffer: quiet });     // first frame: band + left change
  const first = calls.length;
  attempt.lastFrame = Date.now(); attempt.runFrame = Date.now();
  vm._onFrame(attempt, { frameBuffer: quiet });     // same band, <0.1 s elapsed: nothing to send
  assert.equal(first, 1);
  assert.equal(calls.length, 1);
});

test('L02-050: typein releases 提交中 when no receipt comes back', () => {
  const realSet = global.setTimeout; const fns = [];
  global.setTimeout = (fn) => { fns.push(fn); return fns.length; };
  try {
    const vm = mount('../../pages/playkit/components/playkit-typein/index.js', {});
    vm.setData({ phase: 'run', typed: 'abc', canSubmit: true, locked: false, submitting: false });
    vm.onSubmit();
    assert.equal(vm.data.submitting, true);
    fns.forEach((fn) => fn());
    assert.equal(vm.data.submitting, false);
    assert.equal(vm.data.canSubmit, true);
    assert.equal(vm.data.typed, 'abc');
  } finally { global.setTimeout = realSet; }
});

test('L02-043: qa runs the count-in once per showing, not on each wrong-answer echo', () => {
  let begins = 0;
  const vm = mount('../../pages/playkit/components/playkit-qa/index.js', {});
  vm.selectComponent = (id) => (id === '#cy-play-stage' ? { begin() { begins += 1; }, _stopAll() {} } : null);
  vm.setProps({ show: true, mode: 'pick', options: [{ id: 'a', t: 'A' }, { id: 'b', t: 'B' }], sessionId: 's', nodeId: 'n' });
  vm.setProps({ lastOptionId: 'a', feedbackText: '不对' });
  vm.setProps({ lastOptionId: 'b' });
  assert.equal(begins, 1);
  vm.setProps({ finished: true });
  vm.setProps({ finished: false });               // server reopened the round
  assert.equal(begins, 2);
});

test('L02-049: shout treats "fail auth denied" as a denied microphone like quiethold', () => {
  const vm = mount('../../pages/playkit/components/playkit-shout/index.js', {});
  vm._current = () => true; vm._abort = () => {}; vm.data.stageKeys = [1];
  vm._failure({ phase: 'running' }, { errMsg: 'startRecorder:fail auth denied' });
  assert.equal(vm.data.micDenied, true);
  assert.deepEqual(vm.triggered.map((t) => t[0]), ['micdenied']);
});

test('L02-176: walk CTA label follows the syncing property', () => {
  const vm = mount('../../pages/playkit/components/playkit-walk/index.js', {});
  vm.setProps({ show: true, goal: 5000, steps: 100 });
  vm.setProps({ syncing: true });
  assert.equal(vm.data.ctaLabel, '同步中…');
  vm.setProps({ syncing: false });
  assert.equal(vm.data.ctaLabel, '同步微信运动');
});

test('L02-158: album clears its auto-close timer on detach', () => {
  const vm = mount('../../pages/playkit/components/playkit-album/index.js', {});
  let cleared = 0; const real = global.clearTimeout;
  global.clearTimeout = (id) => { if (id === 77) cleared += 1; return real(id); };
  try { vm._doneTimer = 77; vm.def.lifetimes.detached.call(vm); } finally { global.clearTimeout = real; }
  assert.equal(cleared, 1);
});

test('L02-175: stopwatch cannot submit twice after a hit', () => {
  const vm = mount('../../pages/playkit/components/playkit-stopwatch/index.js', { toleranceMs: 100000, target: 0 });
  vm.selectComponent = () => ({ miss: () => false, win() {}, fail() {}, data: { triesLeft: 1 } });
  vm.onRun(); vm._stop();
  vm.onStop();
  vm.onStop();
  assert.equal(vm.triggered.filter((t) => t[0] === 'submit').length, 1);
});

test('L02-142: dice taps before the server values arrive send one roll', () => {
  const realSet = global.setTimeout; const fns = [];
  global.setTimeout = (fn) => { fns.push(fn); return fns.length; };
  try {
    const vm = mount('../../pages/playkit/components/playkit-diceroll/index.js', { mode: 'd6' });
    vm.onRoll(); vm.onRoll(); vm.onRoll();
    assert.equal(vm.triggered.filter((t) => t[0] === 'roll').length, 1);
    vm._rollPending = false;           // failure guard elapsed
    vm.onRoll();
    assert.equal(vm.triggered.filter((t) => t[0] === 'roll').length, 2);
  } finally { global.setTimeout = realSet; }
});
