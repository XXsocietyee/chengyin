'use strict';
// 以物换物(barter):本地预演 / 撤回 / 不可点卡 / 「留着的东西」提示 / 判错标红只认服务端回执,
// 以及 TYPE_OF、动作表、能力声明、分发器与编辑器透传。样例内容全部虚构。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const plan = require('../../pages/playkit/utils/barter-plan.js');

/* 虚构样例:用回形针一路换到旧钥匙,同时要留住杯垫 */
const CFG = {
  title: '巷口换物',
  items: [
    { id: 'clip', name: '回形针', icon: 'clip' },
    { id: 'tape', name: '胶带', icon: 'tape' },
    { id: 'key', name: '旧钥匙', icon: 'key' },
    { id: 'pad', name: '杯垫', icon: 'coaster' },
    { id: 'pin', name: '徽章' },
  ],
  start: ['clip', 'pad'],
  goals: [
    { id: 'g1', label: '拿到钥匙', need: 'key' },
    { id: 'g2', label: '留住杯垫', keep: 'pad' },
  ],
  offers: [
    { id: 'o1', key: '甲', give: 'clip', get: 'tape' },
    { id: 'o2', key: '乙', give: 'tape', get: 'key' },
    { id: 'o3', key: '丙', give: 'pad', get: 'key' },
    { id: 'o4', key: '丁', give: 'pin', get: 'clip' },
  ],
};

test('预演:按顺序重放背包,目标即时亮起', () => {
  let order = [];
  order = plan.pick(CFG, order, 'o1');
  order = plan.pick(CFG, order, 'o2');
  assert.deepEqual(order, ['o1', 'o2']);
  const v = plan.view(CFG, order, {});
  assert.deepEqual(v.bag.map((b) => b.id), ['key', 'pad']);
  assert.deepEqual(v.goals.map((g) => g.state), ['met', 'met']);
  assert.equal(v.allMet, true);
  assert.equal(v.canSubmit, true);
  const used = v.offers.filter((o) => o.used).map((o) => [o.id, o.step]);
  assert.deepEqual(used, [['o1', 1], ['o2', 2]]);
});

test('背包里没有 give 的卡压暗且点不动;用过的卡不能再点', () => {
  const v0 = plan.view(CFG, [], {});
  const state = Object.fromEntries(v0.offers.map((o) => [o.id, o.state]));
  assert.deepEqual(state, { o1: 'ready', o2: 'off', o3: 'ready', o4: 'off' });
  const order = ['o1'];
  assert.equal(plan.pick(CFG, order, 'o4'), order, '没有徽章,丁换不了 —— 原样返回');
  assert.equal(plan.pick(CFG, order, 'o1'), order, '甲已经用过');
  assert.equal(plan.pick(CFG, order, 'nope'), order);
});

test('撤回上一步', () => {
  assert.deepEqual(plan.undo(['o1', 'o2']), ['o1']);
  const empty = [];
  assert.equal(plan.undo(empty), empty);
  const v = plan.view(CFG, plan.undo(['o1', 'o2']), {});
  assert.deepEqual(v.bag.map((b) => b.id), ['tape', 'pad']);
  assert.equal(v.canUndo, true);
  assert.equal(plan.view(CFG, [], {}).canUndo, false);
});

test('预演弄丢了要留的东西:背包下面一句「杯垫就不在背包里了」', () => {
  const v = plan.view(CFG, ['o3'], {});
  assert.equal(v.lostKeep, '杯垫');
  assert.equal(v.goals.find((g) => g.id === 'g2').state, 'open', '没确认判错前是灰,不是红');
  assert.equal(plan.view(CFG, ['o1'], {}).lostKeep, '');
});

test('判错标红只认服务端回执,且只在回执那份计划仍等于眼前预演时', () => {
  const receipt = { lastOrder: ['o3'], failedGoals: ['g2'], lastFeedback: '', passed: false };
  const v = plan.view(CFG, ['o3'], receipt);
  assert.equal(v.goals.find((g) => g.id === 'g2').state, 'failed');
  assert.equal(v.goals.find((g) => g.id === 'g1').state, 'met');
  assert.equal(v.wrongLine, '还没换到留住杯垫');
  const fb = plan.view(CFG, ['o3'], Object.assign({}, receipt, { lastFeedback: '店主只收杯垫,可你还要用它' }));
  assert.equal(fb.wrongLine, '店主只收杯垫,可你还要用它', '服务端 fb 优先');
  const moved = plan.view(CFG, [], receipt);
  assert.equal(moved.goals.find((g) => g.id === 'g2').state, 'met', '动了计划,红就退了');
  assert.equal(moved.wrongLine, '');
});

test('图标:只认契约里的十二个名字,其余落回名字首字', () => {
  assert.equal(plan.ICONS.length, 12);
  const row = plan.bagRow({ pin: 1, clip: 2 }, CFG.items);
  assert.deepEqual(row.map((r) => [r.id, r.icon, r.glyph]), [['clip', 'clip', '回'], ['clip', 'clip', '回'], ['pin', '', '徽']]);
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit-barter/index.wxss'), 'utf8');
  plan.ICONS.forEach((name) => assert.ok(wxss.includes('.bt-ic--' + name + ' {'), name));
});

function mount(file) {
  let def;
  global.getApp = () => ({ globalData: {} });
  global.wx = { vibrateShort() {}, getStorageSync() {}, setStorageSync() {}, getSystemInfoSync: () => ({}) };
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
  vm.setData = (patch) => { Object.assign(vm.data, patch); };
  vm.setProps = (patch) => {
    Object.assign(vm.data, patch);
    const keys = Object.keys(patch);
    observers.forEach(([spec, fn]) => {
      const fields = spec.split(',').map((s) => s.trim());
      if (fields.some((f) => keys.includes(f))) fn.apply(vm, fields.map((f) => vm.data[f]));
    });
  };
  return vm;
}

const tap = (id) => ({ currentTarget: { dataset: { id } } });

test('组件:预演 → 撤回 → 交整串;判错保留预演、软红一下;判对走 stage.win', () => {
  const calls = [];
  const stage = { begin() { calls.push('begin'); }, win(t) { calls.push('win:' + t); }, nudge() { calls.push('nudge'); } };
  const vm = mount('../../pages/playkit/components/playkit-barter/index.js');
  vm.selectComponent = () => stage;
  vm.setProps({ show: true, title: CFG.title, items: CFG.items, start: CFG.start, goals: CFG.goals, offers: CFG.offers });
  assert.deepEqual(calls, ['begin']);
  vm.onSubmit();
  assert.equal(vm.triggered.length, 0, '空计划不能交');
  vm.onPick(tap('o2'));
  assert.deepEqual(vm._order, [], '乙给的胶带不在背包里,点了没反应');
  vm.onPick(tap('o3'));
  assert.equal(vm.data.v.lostKeep, '杯垫');
  vm.onUndo();
  assert.deepEqual(vm._order, []);
  vm.onPick(tap('o3'));
  vm.onSubmit();
  assert.deepEqual(vm.triggered, [['submit', { order: ['o3'] }]]);
  vm.setProps({ attempts: 1, passed: false, lastOrder: ['o3'], failedGoals: ['g2'], lastFeedback: '' });
  assert.deepEqual(vm._order, ['o3'], '判错保留预演');
  assert.equal(vm.data.v.goals.find((g) => g.id === 'g2').state, 'failed');
  assert.equal(vm.data.v.wrongLine, '还没换到留住杯垫');
  assert.equal(calls[calls.length - 1], 'nudge');
  vm._submittedAt = 0;   // 越过刚交出去的那 1.5 秒
  vm.onUndo();
  assert.equal(vm.data.v.wrongLine, '', '改了计划,红线退场');
  vm.onPick(tap('o1'));
  vm.onPick(tap('o2'));
  vm.onSubmit();
  vm.setProps({ attempts: 2, passed: true, finished: true, lastCorrect: true, lastOrder: ['o1', 'o2'], failedGoals: [] });
  assert.equal(calls[calls.length - 1], 'win:');
  vm.onUndo();
  assert.deepEqual(vm._order, ['o1', 'o2'], '通过后锁住');
});

test('组件:重进页面时按服务端 lastOrder 摆回,不把旧回执当成刚判完', () => {
  const calls = [];
  const vm = mount('../../pages/playkit/components/playkit-barter/index.js');
  vm.selectComponent = () => ({ begin() { calls.push('begin'); }, win() { calls.push('win'); }, nudge() { calls.push('nudge'); } });
  vm.setProps({ attempts: 1, lastOrder: ['o3'], failedGoals: ['g2'] });
  vm.setProps({ show: true, items: CFG.items, start: CFG.start, goals: CFG.goals, offers: CFG.offers });
  assert.deepEqual(vm._order, ['o3']);
  assert.equal(vm.data.v.goals.find((g) => g.id === 'g2').state, 'failed');
  assert.deepEqual(calls, ['begin']);
});

test('接线:TYPE_OF / 动作 / payload / 完成判据 / 能力声明 / 分发器', () => {
  const view = require('../../pages/play/utils/playkit-view.js');
  assert.equal(view.TYPE_OF.barter, 'barter');
  assert.ok(view.KIT_PRIORITY.includes('barter'));
  assert.equal(view.serverAction('barter', 'submit'), 'SUBMIT_BARTER');
  assert.deepEqual(view.serverPayload('barter', 'submit', { order: ['o1'] }), { order: ['o1'] });
  const seg = Object.assign({}, CFG, { maxTries: 3, attempts: 1, finished: false, passed: false, lastOrder: ['o3'], lastFeedback: 'x', failedGoals: ['g2'] });
  const kit = view.pickPlayKit({ sessionId: 1, version: 2, status: 'RUNNING', playKit: { barter: seg } }, new Date());
  assert.equal(kit.type, 'barter');
  assert.deepEqual(kit.failedGoals, ['g2']);
  assert.equal(kit.lastFeedback, 'x');
  assert.equal(kit.maxTries, 3);
  assert.ok(kit.offers.every((o) => !('fb' in o)), '客户端从不拿到 fb');
  const caps = require('../../pages/play/utils/client-capabilities.js');
  assert.ok(caps.keys().includes('game.barter'));
  const dispatcherJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit/index.json'), 'utf8'));
  assert.equal(dispatcherJson.usingComponents['cy-playkit-barter'], '/pages/playkit/components/playkit-barter/index');
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit/index.wxml'), 'utf8');
  assert.ok(wxml.includes("kit.type === 'barter'"));
  const app = fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8');
  assert.ok(!app.includes('barter'), '不新增页面');
});

test('组件规矩:每个可点处都有 aria-label 与 hover-class;不新增 @keyframes;文案中文', () => {
  const dir = path.join(ROOT, 'pages/playkit/components/playkit-barter');
  const wxml = fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8');
  const taps = wxml.match(/<view[^>]*bindtap[^>]*>/g) || [];
  assert.equal(taps.length, 3);
  taps.forEach((tag) => { assert.ok(/aria-label="/.test(tag), tag); assert.ok(/hover-class="/.test(tag), tag); });
  assert.ok(wxml.includes('撤回上一步') && wxml.includes('就这样换') && wxml.includes('就不在背包里了'));
  assert.ok(!/@keyframes/.test(fs.readFileSync(path.join(dir, 'index.wxss'), 'utf8')));
});

/* 2026-11-25:作者端目录与表单补齐后,barter 是选得到、配得出的玩法段(原先只是未知段透传)。 */
test('编辑器:带 barter 段的模板读进来、存回去原样保留,并被认成以物换物', () => {
  const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js');
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js');
  const preview = require('../../pages/publish/utils/publish/advanced-game-preview.js');
  const barter = Object.assign({ enabled: true, maxTries: 0, xp: 5 }, JSON.parse(JSON.stringify(CFG)));
  barter.offers[0].fb = '甲摊主今天不收回形针';
  const raw = JSON.stringify({ schemaVersion: 1, barter });
  const parsed = cfg.parse(raw);
  assert.equal(parsed.error, '');
  assert.equal(cfg.validate(parsed.value), '');
  assert.deepEqual(JSON.parse(cfg.serialize(parsed.value)).barter, barter);
  assert.equal(cfg.serializeChanges(parsed.value, raw), raw);
  assert.equal(catalog.detectGame(parsed.value), 'barter');
  // 先看再选 / 按真配置试玩都演这一屏;每条换物的 fb 仍一个字不带(答错之后才由服务端回)
  const kit = preview.buildPreviewKit(parsed.value);
  assert.equal(kit.type, 'barter');
  assert.deepEqual(kit.start, barter.start);
  assert.ok(kit.offers.every((offer) => !('fb' in offer)));
});
