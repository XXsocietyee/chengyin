'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function page(req) {
  global.wx = { showToast() {}, getStorageSync() {}, setStorageSync() {} };
  const bp = require('../../pages/play/utils/theme-backpack.js');
  const vm = Object.assign({ data: JSON.parse(JSON.stringify(bp.data)) }, bp.methods(req));
  Object.assign(vm.data, { topicId: 9, nodes: [] });
  vm.setData = (p) => Object.assign(vm.data, p);
  vm.refreshRouteState = () => Promise.resolve(true);
  vm._sessionParams = () => ({});
  return vm;
}

test('L02-013: the WeRun step sync runs at most every three minutes', () => {
  const vm = page(() => Promise.resolve({}));
  const t0 = 1_000_000;
  assert.equal(vm._themeStepSyncDue(t0), true);
  assert.equal(vm._themeStepSyncDue(t0 + 30_000), false);
  assert.equal(vm._themeStepSyncDue(t0 + 179_000), false);
  assert.equal(vm._themeStepSyncDue(t0 + 180_000), true);
});

test('L02-015: a fresh action view is not followed by a second GET theme/state', async () => {
  const urls = [];
  const view = { sessionId: 1, version: 3, status: 'DONE', contents: [], events: [] };
  const vm = page((url) => { urls.push(url); return Promise.resolve({ code: 200, data: Object.assign({}, view, { version: 4 }) }); });
  vm.data.themeBag = Object.assign({}, vm.data.themeBag, view);
  await vm._themeCommand('USE', 'c1');
  assert.deepEqual(urls, ['/api/play/theme/action']);
});

test('L02-015: a replayed (not newer) action view still re-reads the state', async () => {
  const urls = [];
  const view = { sessionId: 1, version: 3, status: 'DONE', contents: [], events: [] };
  const vm = page((url) => { urls.push(url); return Promise.resolve({ code: 200, data: Object.assign({}, view) }); });
  vm.data.themeBag = Object.assign({}, vm.data.themeBag, view);
  await vm._themeCommand('USE', 'c1');
  assert.deepEqual(urls, ['/api/play/theme/action', '/api/play/theme/state']);
});

test('L02-017: occurredAt is China time regardless of the phone time zone; expiry shows HH:mm:ss', () => {
  const ops = require('../../pages/play/utils/theme-player-ops.js');
  assert.equal(ops.occurredAt('2026-11-22 10:00:00'), Date.parse('2026-11-22T10:00:00+08:00'));
  assert.throws(() => ops.occurredAt('2026-02-30 10:00:00'), /无效/);
  assert.throws(() => ops.occurredAt('2026-11-22 10:00'), /格式/);
  assert.equal(ops.clockText('2026-11-22T02:05:09Z'), '10:05:09');
  assert.equal(ops.clockText(Date.parse('2026-11-22T23:59:01+08:00')), '23:59:01');
  assert.equal(ops.clockText('garbage'), '');
});

test('L02-094: receipt lines from a previous run are cleared when the session changes', () => {
  const vm = page(() => Promise.resolve({}));
  vm._applyZeroHpView = () => {}; vm._stopThemePoll = () => {}; vm._startThemePoll = () => {};
  vm.data.themeBag = Object.assign({}, vm.data.themeBag, { sessionId: 1, events: [] });
  vm.setData({ themeRecoveryText: '恢复 1 点', themeQuestReceiptText: '任务完成' });
  vm._applyThemeView({ sessionId: 2, version: 1, status: 'ACTIVE', contents: [], events: [] });
  assert.equal(vm.data.themeRecoveryText, '');
  assert.equal(vm.data.themeQuestReceiptText, '');
});

test('L02-097: a double tap on recover resolves the unknown check once', async () => {
  const r5 = require('../../pages/play/utils/r5-player-runtime.js');
  let resolves = 0; let release;
  const game = { data: { unknown: true, state: { sessionId: 's1' } }, resolveUnknown: () => { resolves += 1; return new Promise((r) => { release = r; }); } };
  const kit = { sessionId: 's1' };
  const vm = Object.assign({ data: { journeyCheck: kit }, setData() {}, selectComponent: () => game,
    _boundPlayOwner: () => 'o', _sessionKey: () => 'k', _isPlayAccountCurrent: () => true }, r5.methods());
  vm._r5CheckAction('recover');
  vm._r5CheckAction('recover');
  assert.equal(resolves, 1);
  release(); await new Promise((r) => setImmediate(r));
  vm._r5CheckAction('recover');
  assert.equal(resolves, 2);
});
