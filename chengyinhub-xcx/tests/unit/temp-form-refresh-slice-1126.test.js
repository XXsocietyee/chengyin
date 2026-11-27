// L04-001: _setFormState 只刷新本次 patch 影响到的派生视图。
// 单字段写入不再 setData 整份 advanced；离开页面时清掉滚动 / 返回拦截定时器。
const test = require('node:test');
const assert = require('node:assert/strict');

const contract = require('../../pages/publish/utils/publish/node-outcome-contract.js');
const app = { globalData: {}, tips() {}, getUserID: () => 9, getAuthorization: () => '', sendRequest() {} };
const clone = (value) => JSON.parse(JSON.stringify(value));
let definition;
function page() {
  global.getApp = () => app;
  global.Page = (value) => { definition = value; };
  global.wx = Object.assign({ getBackgroundAudioManager: () => ({ stop() {} }), showToast() {}, pageScrollTo() {} }, require('../helpers/memory-storage.js')());
  delete require.cache[require.resolve('../../pages/publish/temp/index.js')];
  require('../../pages/publish/temp/index.js');
  const host = Object.assign({}, definition, { data: clone(definition.data) });
  host.setData = function (patch, done) {
    Object.entries(patch).forEach(([key, value]) => {
      const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let at = this.data;
      keys.slice(0, -1).forEach((part) => {
        if (at[part] == null || typeof at[part] !== 'object') at[part] = {};
        at = at[part];
      });
      at[keys.at(-1)] = value;
    });
    if (done) done();
  };
  return host;
}

const REFRESHERS = ['_refreshEffectResources', '_refreshSupportMatrix', '_syncCheckDerived', '_syncQaAnswerError', '_syncQuesto', '_syncSegments', '_syncClueContent', 'refreshPreviewState'];

function watch(host) {
  const calls = [];
  REFRESHERS.forEach((name) => { host[name] = () => { calls.push(name); }; });
  host._refreshOutcomeContract = () => { calls.push('_refreshOutcomeContract'); return { items: [], errors: [] }; };
  return calls;
}

test('标题只刷新预览，不跑玩法矩阵和结果合同', (t) => {
  const host = page();
  const calls = watch(host);
  let extracts = 0;
  const real = contract.extract;
  t.mock.method(contract, 'extract', function () { extracts += 1; return real.apply(this, arguments); });
  host._outcomeSkip = false;
  host.refreshPreviewState = definition.refreshPreviewState;
  host._refreshOutcomeContract = definition._refreshOutcomeContract;
  host._setFormState({ 'formData.title': '钟楼下的信', 'errors.title': '' });
  assert.deepEqual(calls.filter((name) => name !== 'refreshPreviewState'), []);
  assert.equal(extracts, 0);
  assert.equal(host.data.formData.title, '钟楼下的信');
  assert.equal(host.data.dirty, true);
});

test('剧情只同步线索回显；检定修正和参与方式各刷自己的那一段', () => {
  const host = page();
  const calls = watch(host);
  host._setFormState({ storyBeats: [{ id: 1, text: '第一幕', tag: '信', imgs: [] }] });
  assert.deepEqual(calls.slice().sort(), ['refreshPreviewState', '_syncClueContent'].sort());

  calls.length = 0;
  host._setFormState({ 'advanced.qa.title': '题干' });
  assert.ok(calls.includes('_syncQaAnswerError'));
  assert.ok(calls.includes('_syncQuesto'));
  assert.ok(calls.includes('refreshPreviewState'));
  assert.equal(calls.includes('_refreshSupportMatrix'), false);
  assert.equal(calls.includes('_refreshEffectResources'), false);
  assert.equal(calls.includes('_syncCheckDerived'), false);
  assert.equal(calls.includes('_refreshOutcomeContract'), false);

  calls.length = 0;
  host._setFormState({ 'formData.validationMethod': 5 });
  assert.ok(calls.includes('_refreshSupportMatrix'));
  assert.ok(calls.includes('_refreshOutcomeContract'));
  assert.equal(calls.includes('_syncClueContent'), false);
  assert.equal(calls.includes('_syncQuesto'), false);
});

test('单字段写入只 setData 改到的那段，不回传整份 advanced', () => {
  const host = page();
  watch(host);
  const keys = [];
  const set = host.setData;
  host.setData = function (patch, done) { keys.push(...Object.keys(patch)); return set.call(this, patch, done); };
  host.qzHangmanAnswer({ detail: { value: '钟' } });
  assert.ok(keys.includes('advanced.hangman.answer'), keys.join(','));
  assert.equal(keys.includes('advanced'), false);
  host._writeMods([{ label: '幸运', value: 1 }]);
  assert.ok(keys.includes('advanced.check') || keys.includes('advanced.check.mods'));
  assert.equal(host.data.advanced.check.mods[0].label, '幸运');
  assert.equal(host.data.dirty, true);
});

test('离开编辑页时清掉滚动和返回拦截定时器', () => {
  const host = page();
  host.scrollToError('title');
  host._armPageTimer('_backGuardTimer', () => { host.setData({ backGuardOff: false }); }, 50);
  assert.ok(host._scrollTimer);
  assert.ok(host._backGuardTimer);
  host.onUnload();
  assert.equal(host._scrollTimer, null);
  assert.equal(host._backGuardTimer, null);
  assert.equal(host._disposed, true);
});

test('活动页滚动定时器在卸载时清掉', () => {
  global.getApp = () => app;
  global.wx = Object.assign({ pageScrollTo() {}, showToast() {} }, require('../helpers/memory-storage.js')());
  let activity;
  global.Page = (value) => { activity = value; };
  delete require.cache[require.resolve('../../pages/publish/activity/index.js')];
  require('../../pages/publish/activity/index.js');
  const host = Object.assign({}, activity, { data: clone(activity.data) });
  host.setData = function (patch) { Object.assign(this.data, patch); };
  host.scrollToError('name');
  assert.ok(host._scrollTimer);
  host.onUnload();
  assert.equal(host._scrollTimer, null);
  assert.equal(host._unloaded, true);
});
