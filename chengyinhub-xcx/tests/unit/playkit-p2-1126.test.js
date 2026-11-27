'use strict';
// 预发布 1126：卸下要清计时；显示值没变不再 setData；解开前不亮正确答案；
// 猜词 / 问答 / 指认反馈去掉段首一个「[手写]」。故事正文的手写段不在这里。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '../..');
const { stripLeadingHandMark } = require('../../pages/playkit/utils/hand-mark.js');
const questo = require('../../pages/playkit/utils/playkit-questo.js');
const playQuesto = require('../../pages/play/utils/playkit-questo.js');

function load(rel, kind) {
  let def = null;
  const prevC = global.Component;
  const prevB = global.Behavior;
  global.Behavior = (b) => { if (kind === 'behavior') def = b; return b; };
  global.Component = (d) => { if (kind !== 'behavior') def = d; };
  const file = path.join(ROOT, rel);
  delete require.cache[require.resolve(file)];
  require(file);
  global.Component = prevC;
  global.Behavior = prevB;
  return def;
}

function host(def, extra) {
  const more = extra || {};
  const data = Object.assign({}, def.data, more.data);
  const inst = Object.assign({}, def.methods, {
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent() {},
    selectComponent() { return null; },
  }, more);
  inst.data = data;
  return inst;
}

test('段首只去掉一个「[手写]」，中间的和第二个都留着', () => {
  assert.equal(stripLeadingHandMark('[手写] 恭喜'), '恭喜');
  assert.equal(stripLeadingHandMark('[手写]恭喜'), '恭喜');
  assert.equal(stripLeadingHandMark('[手写]\u3000下一句'), '下一句');
  assert.equal(stripLeadingHandMark('[手写][手写]再留一个'), '[手写]再留一个');
  assert.equal(stripLeadingHandMark('她说[手写]不算'), '她说[手写]不算');
  assert.equal(stripLeadingHandMark(''), '');
  assert.equal(stripLeadingHandMark(null), '');
});

test('questo 反馈去掉段首标记，没解开不给出通关句，导出键与 play 副本一致', () => {
  assert.equal(questo.stripLeadingHandMark, undefined);
  assert.deepEqual(Object.keys(playQuesto).sort(), Object.keys(questo).sort());
  assert.equal(questo.hangmanKit({ solved: true, feedback: '[手写] 恭喜', slots: [] }).feedback, '恭喜');
  assert.equal(questo.hangmanKit({ solved: false, lastFeedback: '[手写]再猜', slots: [] }).wrongFeedback, '再猜');
  assert.equal(questo.hangmanKit({ solved: false, feedback: '[手写]不该出现', slots: [] }).feedback, '');
  assert.equal(questo.hangmanStationText({ solved: true, feedback: '' }, { passText: '[手写]\u3000下一句' }).feedback, '下一句');
  assert.equal(questo.hangmanStationText({ solved: false }, { passText: '[手写]不该出现' }).feedback, '');
  const kit = questo.accusationKit({}, { attempts: 1, finished: false, passed: false, lastFeedback: '[手写] 他有不在场证明' }, () => '');
  assert.equal(kit.retryNote, '他有不在场证明');
  assert.equal(kit.wrongAttempt, true);
});

test('猜词、问答、指认屏上不显示段首「[手写]」', () => {
  const hangman = load('pages/playkit/components/playkit-hangman/index.js');
  const hm = host(hangman);
  hangman.observers.feedback.call(hm, '[手写] 恭喜');
  hangman.observers.wrongFeedback.call(hm, '[手写][手写]再留一个');
  assert.equal(hm.data.passShown, '恭喜');
  assert.equal(hm.data.wrongShown, '[手写]再留一个');
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit-hangman/index.wxml'), 'utf8');
  assert.match(wxml, /solved && passShown/);
  assert.doesNotMatch(wxml, /hm__pass[\s\S]{0,80}\{\{feedback\}\}/);

  const qa = load('pages/playkit/components/playkit-qa/index.js');
  const q = host(qa, { data: Object.assign({}, qa.data, { mode: 'pick', feedback: '' }) });
  q.setData = function (patch) { Object.assign(this.data, patch); };
  qa.observers.answerText.call(q, '[手写]钟楼');
  assert.equal(q.data.answerShown, '钟楼');
  q.settle(false, { feedback: '[手写] 再想想' });
  assert.equal(q.data.feedback, '再想想');
  const qaWxml = fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit-qa/index.wxml'), 'utf8');
  assert.match(qaWxml, /finished && answerShown/);

  const acc = load('pages/playkit/components/playkit-accusation/index.js');
  const a = host(acc);
  acc.observers.retryNote.call(a, '[手写] 还不是');
  assert.equal(a.data.retryShown, '还不是');
});

test('还有次数时答错不亮出正确答案，用完或已经结束才亮', () => {
  const qa = load('pages/playkit/components/playkit-qa/index.js');
  function settle(miss, extra) {
    const inst = host(qa, {
      data: Object.assign({}, qa.data, {
        mode: 'pick', multi: false, judge: true, reveal: true, finished: false, passed: false,
        answerId: 'latte',
        optionList: [{ id: 'cold', state: 'is-on' }, { id: 'latte', state: '' }],
      }, extra),
      selectComponent: () => ({ miss: () => miss, nudge() {}, fail() {} }),
    });
    inst.setData = function (patch) { Object.assign(this.data, patch); };
    inst.settle(false, { index: 0, feedback: '再选一次' });
    return inst.data.optionList.map((o) => o.state);
  }
  assert.deepEqual(settle(false), ['is-wrong', '']);
  assert.deepEqual(settle(true), ['is-wrong', 'is-right']);
  assert.deepEqual(settle(false, { finished: true }), ['is-wrong', 'is-right']);
});

test('钟面和罗盘在显示值没变时不再 setData', () => {
  const clock = load('pages/playkit/components/playkit-timewindow/index.js');
  const vm = host(clock);
  const calls = [];
  vm.setData = function (patch) { calls.push(patch); Object.assign(this.data, patch); };
  vm._deadline = Date.now() + 9000;
  vm._tick();
  const n = calls.length;
  assert.ok(n >= 1);
  vm._tick();
  assert.equal(calls.length, n);

  const compass = load('pages/playkit/components/playkit-compass/index.js');
  const cp = host(compass, {
    data: Object.assign({}, compass.data, { show: true, phase: 'run', holdSeconds: 3, tolerance: 15 }),
  });
  const paints = [];
  cp.setData = function (patch) { paints.push(patch); Object.assign(this.data, patch); };
  cp._target = 135;
  cp._heading = 140;
  cp._held = 0;
  cp._lowAccuracy = false;
  cp._prevNeedle = null;
  cp._prevRose = null;
  cp._sent = false;
  const attempt = { phase: 'run', lastFrame: Date.now(), frames: 0, startedAt: Date.now() };
  cp._attempt = attempt;
  cp._tick();
  const painted = paints.length;
  assert.ok(painted >= 1);
  cp._tick();
  assert.equal(paints.length, painted);
});

test('卸下时清掉还能 setData 的计时器', () => {
  const cleared = [];
  const realClear = global.clearTimeout;
  global.clearTimeout = (id) => { cleared.push(id); if (realClear) realClear(id); };

  const random = load('pages/playkit/components/playkit-random/index.js');
  const deck = host(random);
  deck._wipeStart = 41;
  deck._clear();
  assert.equal(deck._wipeStart, null);

  const scan = load('pages/playkit/components/playkit-scan/index.js');
  const sc = host(scan);
  sc._codeTimer = 7;
  scan.lifetimes.detached.call(sc);
  assert.equal(sc._codeTimer, null);

  const ar = load('pages/playkit/components/playkit-scan/ar/index.js');
  const marker = host(ar, { data: { markerLocked: false } });
  marker._lockT = 30;
  ar.lifetimes.detached.call(marker);
  assert.equal(marker._gone, true);
  assert.equal(marker._lockT, null);
  const sets = [];
  marker.setData = (patch) => { sets.push(patch); };
  marker.scene = {};
  marker._lockMarker();
  assert.equal(sets.length, 0);

  const motion = load('pages/playkit/behaviors/replay-motion.js', 'behavior');
  const replay = host(motion, { data: { reducedMotion: false, _motionReset: false } });
  const states = [];
  replay.setData = function (patch, cb) { states.push(patch._motionReset); Object.assign(this.data, patch); if (cb) cb(); };
  const realSet = global.setTimeout;
  global.setTimeout = (fn) => { replay._held = fn; return 9; };
  motion.methods.replayMotion.call(replay);
  motion.lifetimes.detached.call(replay);
  replay._held();
  assert.deepEqual(states, [true]);
  assert.equal(replay._motionT, null);
  global.setTimeout = realSet;

  const walk = load('pages/playkit/components/playkit-walk/index.js');
  const wk = host(walk);
  wk._skipT = 3;
  walk.lifetimes.detached.call(wk);
  assert.equal(wk._skipT, null);

  const journey = load('pages/playkit/components/playkit-journey-check/index.js');
  const die = host(journey, { _stopHold() {}, _destroyDie() {} });
  die._rollReset = 5;
  journey.lifetimes.detached.call(die);
  assert.equal(die._rollReset, null);

  global.clearTimeout = realClear;
  assert.ok(cleared.includes(41));
  assert.ok(cleared.includes(7));
  assert.ok(cleared.includes(30));
  assert.ok(cleared.includes(9));
  assert.ok(cleared.includes(3));
  assert.ok(cleared.includes(5));
});
