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

test('L02-013: the backpack poll does not setData thought rows that did not change', async () => {
  const vm = page(() => Promise.resolve({}));
  const same = [{ key: 'a', name: '窗', desc: '光', progress: 1, need: 10, done: false }];
  vm._routeState = { thoughts: same };
  vm.data.chapterParas = [{ kind: 'thought', name: '窗' }];
  vm.data.chapStory = { lines: [{ thoughtKey: 'a', title: '窗' }] };
  vm.data.themeBag = Object.assign({}, vm.data.themeBag, { sessionId: 1, status: 'ACTIVE', stepEggs: true });
  const paints = [];
  const later = [];
  const base = vm.setData;
  vm.setData = (patch, cb) => { paints.push(JSON.parse(JSON.stringify(patch))); base(patch); if (typeof cb === 'function') later.push(cb); };
  let syncs = 0;
  vm._syncThoughts = () => {
    syncs += 1;
    vm._routeState = { thoughts: same.map((row) => ({ ...row })) };
    vm.setData({ nodes: [{ nodeId: 1 }] }, () => {
      vm.setData({ 'chapStory.lines': [{ thoughtKey: 'a', title: '窗' }] });
      vm.setData({ chapterParas: [{ kind: 'thought', name: '窗' }] });
    });
    return Promise.resolve(true);
  };
  vm.refreshThemeBackpack = () => Promise.resolve(false);
  let tick;
  const realSet = global.setInterval;
  const realClear = global.clearInterval;
  global.setInterval = (fn) => { tick = fn; return 42; };
  global.clearInterval = () => {};
  try {
    vm._startThemePoll();
    await tick();
    await tick();
    later.splice(0).forEach((cb) => cb());
  } finally {
    global.setInterval = realSet;
    global.clearInterval = realClear;
  }
  assert.equal(syncs, 1);
  assert.equal(vm.data.nodes[0].nodeId, 1);
  assert.deepEqual(paints.filter((patch) => patch.chapterParas || patch['chapStory.lines']), []);
  assert.equal(vm.data.chapterParas[0].name, '窗');
  assert.equal(vm.data.chapterParas[0].done, undefined);

  later.length = 0;
  vm._syncThoughts = () => {
    vm._routeState = { thoughts: [{ key: 'a', name: '窗', desc: '光', progress: 10, need: 10, done: true }] };
    vm.setData({ nodes: [{ nodeId: 1 }] }, () => {
      vm.setData({ chapterParas: [{ kind: 'thought', name: '窗', done: true }] });
      vm.setData({ 'chapStory.lines': [{ thoughtKey: 'a', title: '窗', meta: '伏笔 · 已应验' }] });
    });
    return Promise.resolve(true);
  };
  await vm._syncPolledThoughts();
  later.splice(0).forEach((cb) => cb());
  assert.equal(vm.data.chapterParas[0].done, true);
  assert.equal(vm.data['chapStory.lines'][0].meta, '伏笔 · 已应验');
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

test('L02-014: setData themeBag keeps template fields and leaves the raw server view off the payload', () => {
  const vm = page(() => Promise.resolve({}));
  vm._applyZeroHpView = () => {};
  vm._stopThemePoll = () => {};
  vm._startThemePoll = () => {};
  const sent = [];
  const base = vm.setData;
  vm.setData = (patch, cb) => { sent.push(JSON.parse(JSON.stringify(patch))); return base.call(vm, patch, cb); };
  const view = {
    sessionId: 1, version: 4, status: 'ACTIVE', used: 1, capacity: 6, scope: 'PLAYER',
    contents: [{ id: 'a', kind: 'ITEM', name: '钥匙', quantity: 1 }],
    events: [{ id: 'e', name: '窗' }],
    world: { round: 1, itemCatalog: [{ id: 'a', name: '钥匙' }] },
    quests: [{ questKey: 'q', nodeId: 1 }],
    pending: {},
    attributes: [{ key: 'counter.x', label: '能量', value: 1, max: 3 }],
    secret: 'leak',
    hpEnabled: true, hp: 2, hpMax: 5,
  };
  vm._applyThemeView(view);
  const bag = sent.map((patch) => patch.themeBag).find(Boolean);
  assert.equal(bag.used, 1);
  assert.equal(bag.capacity, 6);
  assert.equal(bag.sessionId, 1);
  assert.equal(bag.hp, 2);
  assert.equal(bag.items[0].name, '钥匙');
  assert.equal(bag.valueRows.some((row) => row.key === 'counter.x'), true);
  assert.equal(bag.result, null);
  assert.equal(bag.replayAllowed, null);
  assert.equal(Object.hasOwn(bag, 'result'), true);
  for (const key of ['secret', 'contents', 'events', 'world', 'quests', 'pending', 'attributes', 'version', 'status']) assert.equal(bag[key], undefined);
  assert.equal(vm.data.themeBag.world.itemCatalog[0].id, 'a');
  assert.equal(vm.data.themeBag.version, 4);
  assert.equal(vm.data.themeBag.quests[0].questKey, 'q');
  assert.equal(vm._themeView.secret, 'leak');
  assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(vm.data.themeBag))).filter((key) => key === 'world' || key === 'contents' || key === 'secret'), []);
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
