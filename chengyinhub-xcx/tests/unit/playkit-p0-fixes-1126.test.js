'use strict';
// 2026-11-26 玩家视角全量体验报告 Top 3 / Top 8 / Top 9 客户端 P0/P1 修复回归测试
// 覆盖: (a) hangman 中文输入法 + JS 字数校验; (b) qa 多选答错不重提;
//       (c) play-verdict/play-stage 轻点继续 + 失败/超时可点屏退出 + st__back catchtap;
//       (d) 证据表 #974 极简引导 + 违规规则自动展开 + 小屏列宽横滚 + 内嵌去底隙;
//       (e) .g-col 小屏纵滚让位底钮 + photoCheck 取景层避让微信胶囊;
//       (f) 核心提交类组件防连点锁 + failureSeq 复位与页面接线。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js');

function loadComponent(rel) {
  let def = null;
  const prevC = global.Component;
  const prevB = global.Behavior;
  global.Behavior = (b) => b;
  global.Component = (d) => { def = d; };
  try {
    const abs = path.join(ROOT, rel);
    delete require.cache[require.resolve(abs)];
    require(abs);
  } finally {
    global.Component = prevC;
    global.Behavior = prevB;
  }
  assert.ok(def, rel + ' must call Component()');
  return def;
}

function mount(rel, props = {}, wxExtra = {}) {
  const prevWx = global.wx;
  const prevApp = global.getApp;
  global.getApp = () => ({ globalData: {} });
  global.wx = Object.assign({
    vibrateShort() {},
    vibrateLong() {},
    showToast() {},
    hideToast() {},
    getStorageSync() { return ''; },
    setStorageSync() {},
    getSystemInfoSync: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 667 }),
    getWindowInfo: () => ({ statusBarHeight: 44, windowWidth: 375, windowHeight: 667 }),
    createSelectorQuery() {
      let cb = null;
      const q = {
        in() { return q; },
        select() { return { boundingClientRect(fn) { cb = fn; return q; } }; },
        selectAll() { return { boundingClientRect() { return q; } }; },
        exec(fn) {
          if (typeof fn === 'function') fn([null, []]);
          else if (typeof cb === 'function') cb({ left: 0, top: 0, width: 200, height: 200 });
        },
      };
      return q;
    },
  }, wxExtra);
  const def = loadComponent(rel);
  const data = {};
  Object.entries(def.properties || {}).forEach(([k, v]) => {
    data[k] = v && v.value !== undefined ? JSON.parse(JSON.stringify(v.value)) : null;
  });
  Object.assign(data, JSON.parse(JSON.stringify(def.data || {})));
  data.reducedMotion = true;
  const events = [];
  const stage = {
    nudges: 0, wins: 0, fails: 0, begins: 0, misses: 0,
    nudge() { this.nudges += 1; },
    win() { this.wins += 1; },
    fail() { this.fails += 1; },
    begin() { this.begins += 1; },
    miss() { this.misses += 1; return false; },
    _stopAll() {},
  };
  const vm = {
    def,
    data,
    events,
    stage,
    triggerEvent(name, detail, options) { events.push({ name, detail, options }); },
    selectComponent: () => stage,
    createSelectorQuery: () => global.wx.createSelectorQuery(),
  };
  Object.entries(def.methods || {}).forEach(([k, fn]) => { vm[k] = fn.bind(vm); });
  vm.setData = (patch, cb) => {
    Object.assign(vm.data, patch);
    if (typeof cb === 'function') cb();
  };
  vm.setProps = (patch) => {
    Object.assign(vm.data, patch);
    const keys = Object.keys(patch || {});
    Object.entries(def.observers || {}).forEach(([spec, fn]) => {
      const fields = spec.split(',').map((s) => s.trim());
      if (fields.some((f) => keys.includes(f))) fn.apply(vm, fields.map((f) => vm.data[f]));
    });
  };
  vm.restore = () => { global.wx = prevWx; global.getApp = prevApp; };
  if (Object.keys(props).length) vm.setProps(props);
  return vm;
}

// ==================== (a) playkit-hangman 中文输入法与字数校验 ====================
test('(a) playkit-hangman: 去掉 maxlength 保中文拼音组合态，JS 严格校验最终字数', () => {
  const wxml = read('pages/playkit/components/playkit-hangman/index.wxml');
  assert.doesNotMatch(wxml, /<input class="hm__in[^>]*maxlength=/, '不得用 maxlength 截断中文拼音输入');
  const slots = [{ i: 0, kind: 'BLANK', ch: '' }, { i: 1, kind: 'BLANK', ch: '' }];
  const vm = mount('pages/playkit/components/playkit-hangman/index.js', { show: true, slots, solved: false, inputMode: 'keyboard' });
  try {
    // 中文拼音输入中间态: "beijing" 7 个字母，不被截断但不可提交
    vm.onInput({ detail: { value: 'beijing' } });
    assert.equal(vm.data.typedText, 'beijing', '拼音组合串不得被强行截断');
    assert.equal(vm.data.overLimit, true);
    assert.equal(vm.data.canSubmit, false);
    vm.onSubmit();
    assert.equal(vm.events.length, 0, '超出空位数时不能提交');

    // 输入法落字为 2 个汉字: "北京"
    vm.onInput({ detail: { value: '北京' } });
    assert.equal(vm.data.overLimit, false);
    assert.equal(vm.data.canSubmit, true);
    assert.deepEqual(vm.data.groups[0].cells.map((c) => c.ch), ['北', '京']);
    vm.onSubmit();
    assert.deepEqual(vm.events, [{ name: 'submit', detail: { slots: { 0: '北', 1: '京' } }, options: undefined }]);

    // 误多打 1 个汉字: "北京城" -> 复位后再测
    vm.setProps({ failureSeq: 1 });
    vm.onInput({ detail: { value: '北京城' } });
    assert.equal(vm.data.overLimit, true);
    assert.equal(vm.data.canSubmit, false);
    vm.onSubmit();
    assert.equal(vm.events.length, 1, '超过 2 字不能提交');
  } finally {
    vm.restore();
  }
});

// ==================== (b) playkit-qa 多选答错不变成「知道了」且不重提 ====================
test('(b) playkit-qa 多选答错: 按钮不变「知道了」，点按钮只清错态不重复提交', () => {
  const vm = mount('pages/playkit/components/playkit-qa/index.js', {
    show: true, mode: 'pick', multi: true, judge: true, sessionId: 'S-multi', nodeId: 'N-multi',
    options: [{ id: 'a', t: '甲' }, { id: 'b', t: '乙' }, { id: 'c', t: '丙' }],
    maxTries: 3, attempts: 0, passed: false, finished: false,
  });
  try {
    vm.onPick({ currentTarget: { dataset: { i: 0 } } });
    vm.onPick({ currentTarget: { dataset: { i: 1 } } });
    vm.onCta();
    assert.equal(vm.events.length, 1);
    assert.deepEqual(vm.events[0].detail, { mode: 'pick', optionIds: ['a', 'b'] });

    vm.settle(false, { feedback: '差一个' });
    assert.notEqual(vm.data.ctaLabel, '知道了', '不得显示误导的「知道了」');
    assert.equal(vm.data.ctaLabel, '重新选择');
    assert.equal(vm.data.ctaDisabled, false);
    assert.deepEqual(vm.data.optionList.map((o) => o.state), ['is-wrong', 'is-wrong', '']);

    // 点「重新选择」只清错误态，不再次触发 submit
    vm.onCta();
    assert.equal(vm.events.length, 1, '点按钮绝不可重复提交错答案');
    assert.deepEqual(vm.data.optionList.map((o) => o.state), ['', '', '']);
    assert.equal(vm.data.feedback, '');
    assert.equal(vm.data.ctaLabel, '提交');
    assert.equal(vm.data.ctaDisabled, true);

    // 再次答错后不点按钮、直接点新选项也能退出错误态并正常重提
    vm.onPick({ currentTarget: { dataset: { i: 0 } } });
    vm.onCta();
    assert.equal(vm.events.length, 2);
    vm.settle(false, { feedback: '不对' });
    vm.onPick({ currentTarget: { dataset: { i: 2 } } });
    assert.deepEqual(vm.data.optionList.map((o) => o.state), ['', '', 'is-on']);
    assert.equal(vm.data.ctaLabel, '提交');
    assert.equal(vm.data.ctaDisabled, false);
    vm.onCta();
    assert.equal(vm.events.length, 3);
    assert.deepEqual(vm.events[2].detail, { mode: 'pick', optionIds: ['c'] });
  } finally {
    vm.restore();
  }
});

// ==================== (c) play-verdict & play-stage ====================
test('(c) play-verdict 与 play-stage: 极简轻点提示、FAIL/TIMEOUT 可点屏退出、st__back 用 catchtap', () => {
  const verdictWxml = read('pages/play/components/play-verdict/index.wxml');
  const verdictWxss = read('pages/play/components/play-verdict/index.wxss');
  const stageWxml = read('pages/playkit/components/play-stage/index.wxml');
  assert.match(verdictWxml, /class="pv__cue"[^>]*>\{\{ctaLabel \? \('轻点' \+ ctaLabel\) : '轻点任意处继续'\}\}<\/view>/);
  assert.doesNotMatch(verdictWxml, /pv__cta/);
  assert.doesNotMatch(verdictWxss, /pv__cta/);
  assert.match(stageWxml, /<view class="st__back"[^>]*catchtap="onBack"/, '返回按钮必须 catchtap 防与赢态点屏双触发');
  assert.match(stageWxml, /<view class="st__cue" wx:if="\{\{doneTap && !verdict\}\}"/);

  const vm = mount('pages/playkit/components/play-stage/index.js', { show: true });
  try {
    // 游玩中点屏无反应
    vm.onStageTap();
    assert.equal(vm.events.length, 0);

    // FAIL 态点屏可退出/继续
    vm.fail(false);
    vm.events.length = 0;
    vm.onStageTap();
    assert.equal(vm.events.length, 1);
    assert.equal(vm.events[0].name, 'verdicttap');
    assert.deepEqual(vm.events[0].detail, { kind: 'fail', timedOut: false });

    // TIMEOUT 态点屏可退出/继续
    vm._done = false;
    vm.fail(true);
    vm.events.length = 0;
    vm.onStageTap();
    assert.equal(vm.events.length, 1);
    assert.deepEqual(vm.events[0].detail, { kind: 'fail', timedOut: true });

    // WIN 态点屏继续
    vm._done = false;
    vm.win('过了');
    vm.events.length = 0;
    vm.onStageTap();
    assert.equal(vm.events.length, 1);
    assert.deepEqual(vm.events[0].detail, { kind: 'win', timedOut: false });

    // doneTap 态点屏继续
    vm.setData({ verdict: '', doneTap: true });
    vm.events.length = 0;
    vm.onStageTap();
    assert.equal(vm.events.length, 1);
    assert.equal(vm.events[0].name, 'verdicttap');
  } finally {
    vm.restore();
  }
});

// ==================== (d) 证据表 #974 ====================
test('(d) 证据表 #974: 极简结构引导、违规规则自动展开、小屏列宽与内嵌去底隙', () => {
  const wxml = read('pages/playkit/components/playkit-qa/index.wxml');
  const wxss = read('pages/playkit/components/playkit-qa/index.wxss');
  assert.match(wxml, /<view class="qa__pick-h">选<\/view>/);
  assert.match(wxml, /class="qa__tb \{\{inline \? 'qa__tb--inline' : ''\}\}"/);
  assert.match(wxml, /scroll-x="\{\{tableCols\.length >= 4\}\}" scroll-y="\{\{!inline\}\}"/);
  assert.match(wxml, /style="--qa-cols:\{\{tableCols\.length\}\}"/);
  assert.match(wxml, /aria-expanded="\{\{item\.open\}\}"/);
  assert.match(wxml, /class="qa__tb-cue"/);
  assert.match(wxss, /\.qa__td \{[^}]*min-width: 160rpx;/);
  assert.match(wxss, /\.qa__grid-in \{[^}]*width: max\(100%, calc\(var\(--qa-cols, 3\) \* 160rpx \+ 88rpx\)\);/);
  assert.doesNotMatch(wxss.split('.qa__tb {')[1], /padding-bottom: 176rpx;/);
  assert.match(wxss, /\.qa__tb--inline \.qa__grid \{ max-height: none; \}/);

  const vm = mount('pages/playkit/components/playkit-qa/index.js', {
    show: true, mode: 'pick', multi: false, judge: true, sessionId: 'S-974', nodeId: 'N-974',
    options: [{ id: 'r1', t: '甲' }, { id: 'r2', t: '乙' }],
    table: { columns: ['姓名', '时间', '地点', '备注'], rows: [{ id: 'r1', cells: ['甲', '14:30', '东门', '无'] }, { id: 'r2', cells: ['乙', '15:00', '西门', '晚归'] }] },
    rules: [{ k: '①', t: '东门下午闭馆' }, { k: '②', t: '西门十四点半后不放行' }],
    lastRule: 0, attempts: 0, passed: false, finished: false,
  });
  try {
    vm._paintTable();
    assert.deepEqual(vm.data.ruleList.map((r) => r.open), [false, false]);
    // 判错命中规则 2 -> 自动展开规则 2
    vm.onPick({ currentTarget: { dataset: { i: 1 } } });
    vm.onCta();
    vm.settle(false, { index: 1, feedback: '西门未放行', lastRule: 2 });
    vm._paintTable();
    assert.deepEqual(vm.data.ruleList.map((r) => r.hot), [false, true]);
    assert.deepEqual(vm.data.ruleList.map((r) => r.open), [false, true], '违规标红规则必须自动展开');
    // 手动再点可收起
    vm.onRule({ currentTarget: { dataset: { i: 1 } } });
    assert.deepEqual(vm.data.ruleList.map((r) => r.open), [false, false]);
    // 故事流命中新规则 1 -> 自动展开规则 1
    vm.setProps({ lastRule: 1 });
    assert.deepEqual(vm.data.ruleList.map((r) => r.open), [true, false]);
  } finally {
    vm.restore();
  }
});

// ==================== (e) 小屏 .g-col 滚动让位 & photoCheck 取景胶囊安全区 ====================
test('(e) 小屏底钮防遮挡(.g-col) + photoCheck 取景层避让微信胶囊', () => {
  const surface = read('pages/playkit/style/play-surface.wxss');
  const col = surface.match(/\.g-col\s*\{[^}]*\}/)[0];
  assert.match(col, /overflow-y:\s*var\(--pk-col-overflow,\s*auto\)/);
  assert.match(col, /calc\(env\(safe-area-inset-bottom\) \+ 200rpx\)/);

  const pcWxml = read('pages/playkit/components/playkit-photocheck/index.wxml');
  const pcWxss = read('pages/playkit/components/playkit-photocheck/index.wxss');
  assert.match(pcWxml, /<view class="pcv" wx:if="\{\{framing\}\}" style="--pcv-top:\{\{viewfinderTop\}\}px">/);
  assert.match(pcWxss, /\.pcv__cancel \{[^}]*top: var\(--pcv-top, 96px\);[^}]*min-height: 88rpx;/);
  assert.match(pcWxss, /\.pcv__tip \{[^}]*top: calc\(var\(--pcv-top, 96px\) \+ 104rpx\);/);
  assert.match(pcWxss, /\.pcv__shutter \{[^}]*bottom: calc\(env\(safe-area-inset-bottom\) \+ var\(--cy-space-5\) \* 2\);/);

  const vm = mount('pages/playkit/components/playkit-photocheck/index.js', {}, {
    getMenuButtonBoundingClientRect: () => ({ top: 48, bottom: 80, height: 32 }),
  });
  try {
    vm.def.lifetimes.attached.call(vm);
    assert.equal(vm.data.viewfinderTop, 88, '退出取景须严格位于微信胶囊下沿之下');
  } finally {
    vm.restore();
  }
});

// ==================== (f) 核心提交类插件防连点锁 + failureSeq 复位 ====================
test('(f) qaText / qaPick(多选) / qaShot 防连点锁与 failureSeq 复位', () => {
  // qaText (键盘)
  const qt = mount('pages/playkit/components/playkit-qa/index.js', {
    show: true, mode: 'type', judge: true, sessionId: 'S-qt', nodeId: 'N1',
    attempts: 0, passed: false, finished: false,
  });
  try {
    qt.onInput({ detail: { value: '外滩' } });
    qt.onCta(); qt.onCta();
    assert.equal(qt.events.filter((e) => e.name === 'submit').length, 1, 'qaText 连点只发一次');
    assert.equal(qt.data.submitted, true);
    qt.setProps({ failureSeq: 1 });
    assert.equal(qt.data.submitted, false);
    assert.equal(qt.data.ctaDisabled, false);
    qt.onCta();
    assert.equal(qt.events.filter((e) => e.name === 'submit').length, 2, 'failureSeq 复位后可重试');
  } finally { qt.restore(); }

  // qaPick (多选)
  const qp = mount('pages/playkit/components/playkit-qa/index.js', {
    show: true, mode: 'pick', multi: true, judge: true, sessionId: 'S-qp', nodeId: 'N2',
    options: [{ id: 'a', t: '甲' }, { id: 'b', t: '乙' }],
    attempts: 0, passed: false, finished: false,
  });
  try {
    qp.onPick({ currentTarget: { dataset: { i: 0 } } });
    qp.onCta(); qp.onCta();
    assert.equal(qp.events.filter((e) => e.name === 'submit').length, 1, 'qaPick 多选连点只发一次');
    qp.setProps({ failureSeq: 1 });
    assert.equal(qp.data.submitted, false);
    assert.equal(qp.data.ctaLabel, '重试');
    qp.onCta();
    assert.equal(qp.events.filter((e) => e.name === 'submit').length, 2);
  } finally { qp.restore(); }

  // qaShot
  let mediaCb = null;
  let chooseCalls = 0;
  const qs = mount('pages/playkit/components/playkit-qa/index.js', {
    show: true, mode: 'shot', judge: true, sessionId: 'S-qs', nodeId: 'N3',
    attempts: 0, passed: false, finished: false,
  }, {
    chooseMedia(opts) { chooseCalls += 1; mediaCb = opts.success; },
  });
  try {
    qs.onCta(); qs.onCta();
    assert.equal(chooseCalls, 1, '选图期间防重复唤起 chooseMedia');
    mediaCb({ tempFiles: [{ tempFilePath: 'wxfile://shot1.jpg', size: 1024 }] });
    assert.equal(qs.data.submitted, true);
    assert.equal(qs.data.ctaLabel, '上传中…');
    qs.onCta();
    assert.equal(chooseCalls, 1, '上传中连点不可重拍');
    qs.setProps({ failureSeq: 1 });
    assert.equal(qs.data.submitted, false);
    assert.equal(qs.data.ctaLabel, '拍一张');
    qs.onCta();
    assert.equal(chooseCalls, 2);
  } finally { qs.restore(); }
});

test('(f) hangman / sort / match / estimate / pricePair / predict / hidden / mixer 防连点锁与 failureSeq 复位', () => {
  // hangman
  const hm = mount('pages/playkit/components/playkit-hangman/index.js', {
    show: true, slots: [{ i: 0, kind: 'BLANK', ch: '' }], solved: false, inputMode: 'keyboard',
  });
  try {
    hm.onInput({ detail: { value: 'A' } });
    hm.onSubmit(); hm.onSubmit();
    assert.equal(hm.events.length, 1);
    assert.equal(hm.data.submitting, true);
    hm.setProps({ failureSeq: 1 });
    assert.equal(hm.data.submitting, false);
    hm.onSubmit();
    assert.equal(hm.events.length, 2);
  } finally { hm.restore(); }

  // sort
  const so = mount('pages/playkit/components/playkit-sort/index.js', {
    show: true, items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  });
  try {
    so.onSubmit(); so.onSubmit();
    assert.equal(so.events.length, 1);
    assert.equal(so.data.submitting, true);
    so.setProps({ failureSeq: 1 });
    assert.equal(so.data.submitting, false);
    so.onSubmit();
    assert.equal(so.events.length, 2);
  } finally { so.restore(); }

  // match
  const ma = mount('pages/playkit/components/playkit-match/index.js', {
    show: true, left: [{ id: 'l1', label: 'L1' }], right: [{ id: 'r1', label: 'R1' }],
  });
  try {
    ma.onTapLeft({ currentTarget: { dataset: { id: 'l1' } } });
    ma.onTapRight({ currentTarget: { dataset: { id: 'r1' } } });
    ma.onSubmit(); ma.onSubmit();
    assert.equal(ma.events.length, 1);
    assert.equal(ma.data.submitting, true);
    ma.setProps({ failureSeq: 1 });
    assert.equal(ma.data.submitting, false);
    ma.onSubmit();
    assert.equal(ma.events.length, 2);
  } finally { ma.restore(); }

  // estimate
  const es = mount('pages/playkit/components/playkit-estimate/index.js', {
    show: true, min: 0, max: 100,
  });
  try {
    es.onSubmit(); es.onSubmit();
    assert.equal(es.events.length, 1);
    assert.equal(es.data.submitting, true);
    es.setProps({ failureSeq: 1 });
    assert.equal(es.data.submitting, false);
    es.onSubmit();
    assert.equal(es.events.length, 2);
  } finally { es.restore(); }

  // pricePair
  const pp = mount('pages/playkit/components/playkit-pricepair/index.js', {
    show: true, items: [{ id: 'p1', name: '一' }, { id: 'p2', name: '二' }],
  });
  try {
    pp.onPick({ currentTarget: { dataset: { i: 0 } } });
    pp.onConfirm(); pp.onConfirm();
    assert.equal(pp.events.length, 1);
    assert.equal(pp.data.submitted, true);
    pp.setProps({ failureSeq: 1 });
    assert.equal(pp.data.submitted, false);
    assert.equal(pp.data.chosen, 0, '失败复位保留当前选中项');
    pp.onConfirm();
    assert.equal(pp.events.length, 2);
  } finally { pp.restore(); }

  // predict
  const pd = mount('pages/playkit/components/playkit-predict/index.js', {
    show: true, options: [{ key: 'k1', label: '甲' }, { key: 'k2', label: '乙' }],
  });
  try {
    pd.onPick({ currentTarget: { dataset: { i: 1 } } });
    pd.onCommit(); pd.onCommit();
    assert.equal(pd.events.length, 1);
    assert.equal(pd.data.committed, true);
    pd.setProps({ failureSeq: 1 });
    assert.equal(pd.data.committed, false, '提交失败须撤回乐观火漆印解锁重提');
    pd.onCommit();
    assert.equal(pd.events.length, 2);
  } finally { pd.restore(); }

  // hidden
  const hd = mount('pages/playkit/components/playkit-hidden/index.js', {
    show: true, targets: [{ id: 't1', label: '猫', found: false }], total: 1,
  });
  try {
    const tap = { touches: [{ clientX: 50, clientY: 50 }] };
    hd.onTapScene(tap); hd.onTapScene(tap);
    assert.equal(hd.events.length, 1, '找东西提交在途防连点');
    assert.equal(hd.data.submitting, true);
    hd.setProps({ failureSeq: 1 });
    assert.equal(hd.data.submitting, false);
    hd.onTapScene(tap);
    assert.equal(hd.events.length, 2);
  } finally { hd.restore(); }

  // mixer
  const mx = mount('pages/playkit/components/playkit-mixer/index.js', {
    show: true, tracks: [{ id: 'drum', label: '鼓', muted: false }, { id: 'voc', label: '人声', muted: true }],
  });
  try {
    mx.onSwitch({ currentTarget: { dataset: { id: 'voc' } } });
    mx.onConfirm(); mx.onConfirm();
    assert.equal(mx.events.length, 1);
    assert.equal(mx.data.submitting, true);
    mx.setProps({ failureSeq: 1 });
    assert.equal(mx.data.submitting, false);
    mx.onConfirm();
    assert.equal(mx.events.length, 2);
  } finally { mx.restore(); }
});

test('(f) 分发器与页面 onAdvancedActionFail 为全部核心提交玩法过桥 failureSeq', () => {
  const dispatcher = read('pages/playkit/components/playkit/index.wxml');
  for (const tag of ['qa', 'hangman', 'sort', 'match', 'estimate', 'pricepair', 'predict', 'hidden', 'mixer']) {
    const m = dispatcher.match(new RegExp('<cy-playkit-' + tag + '[\\s\\S]*?/>'));
    assert.ok(m, 'missing dispatcher tag ' + tag);
    assert.match(m[0], /failure-seq="\{\{kit\.failureSeq\}\}"/, tag + ' 必须绑定 failure-seq');
  }
  const sections = ['qa', 'hangman', 'sort', 'match', 'estimate', 'pricePair', 'predict', 'hiddenObject', 'mixer'];
  for (const section of sections) {
    const kit = pickPlayKit({ sessionId: 10, version: 1, playKit: { [section]: { title: 't', mode: 'TYPE' } } }, new Date());
    assert.equal(kit.failureSeq, 0, section + ' 必须产出初始 failureSeq: 0');
  }

  let pageDef = null;
  const prevPage = global.Page;
  const prevWx = global.wx;
  const prevApp = global.getApp;
  global.getApp = () => ({ globalData: {} });
  global.wx = Object.assign({}, prevWx, { getWindowInfo: () => ({ statusBarHeight: 20 }), getSystemInfoSync: () => ({ statusBarHeight: 20 }) });
  global.Page = (d) => { pageDef = d; };
  try {
    const file = path.join(ROOT, 'pages/play/index.js');
    delete require.cache[require.resolve(file)];
    require(file);
  } finally {
    global.Page = prevPage;
    global.wx = prevWx;
    global.getApp = prevApp;
  }

  const cases = [
    ['SUBMIT_QA', { type: 'qa', judge: true, sessionId: 9, finished: false, passed: false, failureSeq: 0 }],
    ['SUBMIT_HANGMAN', { type: 'hangman', sessionId: 9, solved: false, failureSeq: 0 }],
    ['SUBMIT_SORT', { type: 'sort', sessionId: 9, finished: false, passed: false, failureSeq: 0 }],
    ['SUBMIT_MATCH', { type: 'match', sessionId: 9, passed: false, failureSeq: 0 }],
    ['SUBMIT_ESTIMATE', { type: 'estimate', sessionId: 9, submitted: false, failureSeq: 0 }],
    ['SUBMIT_PRICE_PAIR', { type: 'pricepair', sessionId: 9, finished: false, passed: false, failureSeq: 0 }],
    ['SUBMIT_PREDICT', { type: 'predict', sessionId: 9, myOptionKey: '', skipped: false, failureSeq: 0 }],
    ['SKIP_CLOSED_PREDICT', { type: 'predict', sessionId: 9, myOptionKey: '', skipped: false, failureSeq: 0 }],
    ['SUBMIT_HIDDEN_OBJECT', { type: 'hidden', sessionId: 9, failureSeq: 0 }],
    ['SUBMIT_MIXER', { type: 'mixer', sessionId: 9, finished: false, passed: false, failureSeq: 0 }],
  ];
  for (const [action, kit] of cases) {
    let bumped = 0;
    const page = Object.assign({}, pageDef, {
      data: { playKit: { kit } },
      selectComponent: () => ({ data: { unknown: false } }),
      setData(patch) { if (patch['playKit.kit.failureSeq']) bumped = patch['playKit.kit.failureSeq']; },
    });
    page.onAdvancedActionFail({ detail: { action, sessionId: 9 } });
    assert.equal(bumped, 1, action + ' 确定失败须递增 failureSeq');

    // unknown=true 时不解锁
    let bumpedUnknown = 0;
    const pageUnknown = Object.assign({}, pageDef, {
      data: { playKit: { kit } },
      selectComponent: () => ({ data: { unknown: true } }),
      setData(patch) { if (patch['playKit.kit.failureSeq']) bumpedUnknown = patch['playKit.kit.failureSeq']; },
    });
    pageUnknown.onAdvancedActionFail({ detail: { action, sessionId: 9 } });
    assert.equal(bumpedUnknown, 0, action + ' unknown 态不得递增 failureSeq');
  }
});
