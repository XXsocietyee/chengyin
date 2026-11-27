'use strict';
// 位置分享的迟到回包:离开页面、卸载,或更新的一次读/写抬高代际之后,
// 不得再 setData presenceVisible、不得 toast、不得清掉附近的人。
// onHide / onUnload 负责抬代际并放开 presenceSubmitting,旧回包的 finally 不再写它。
// 读失败同样认代际:玩家已经改了分享或离开后,失败不得把 presenceVisible 打成 false。
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROAM = '../../pages/roam/index.js';

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function harness() {
  const h = { requests: [], toasts: [] };
  const app = {
    globalData: { user_id: 9, features: {} }, getUserID: () => 9, isDevEnv: () => false,
    sendRequest(options) { h.requests.push(options); },
  };
  global.getApp = () => app;
  global.wx = {
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }), getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast: (v) => h.toasts.push(v.title), showModal: () => {},
    showLoading() {}, hideLoading() {},
  };
  delete require.cache[require.resolve(ROAM)];
  let definition;
  global.Page = (value) => { definition = value; };
  require(ROAM);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
  });
  page._syncMarkers = () => {};
  page._reportPresence = () => {};
  page._fetchRunners = () => { h.fetched = true; };
  page._pendingTiles = [];
  h.page = page;
  return h;
}

function arm(h) {
  const page = h.page;
  page._roamSid = 31;
  page.data.presenceVisible = true;
  page._runners = [{ memberId: 7 }];
  page.data.runnerView = { memberId: 7 };
  page.data.multiView = { n: 1 };
  return page;
}

function ok(options, data) {
  options.success({ code: 200, data });
}

test('关掉分享的回包在离开或卸载之后不改开关、不提示、不清附近的人', async () => {
  for (const leave of ['onHide', 'onUnload']) {
    const h = harness();
    const page = arm(h);
    page.togglePresenceSharing();
    assert.equal(page.data.presenceSubmitting, true);
    assert.equal(h.requests.length, 1);
    page[leave]();
    assert.equal(page.data.presenceSubmitting, false, leave + ' 必须放开提交锁');
    const generation = page._presencePrivacyGeneration;
    ok(h.requests[0], false);
    await flush(); await flush();
    assert.equal(page.data.presenceVisible, true);
    assert.equal(page.data.presenceSubmitting, false);
    assert.equal(page._runners.length, 1);
    assert.equal(page.data.runnerView.memberId, 7);
    assert.equal(page.data.multiView.n, 1);
    assert.deepEqual(h.toasts, []);
    assert.equal(page._presencePrivacyGeneration, generation, '迟到回包不得再抬代际');
    assert.equal(h.fetched, undefined);
  }
});

test('更新的一次读或写抬高代际后,迟到的 setSharing 成功或失败都不生效', async () => {
  const read = harness();
  const page = arm(read);
  page.togglePresenceSharing();
  const write = read.requests[0];
  const visibleBefore = page.data.presenceVisible;
  const readResult = page._syncPresencePrivacy();
  assert.equal(page.data.presenceSubmitting, false, '新的读必须放开旧提交锁');
  const get = read.requests.find((r) => r.method === 'GET');
  ok(write, false);
  await flush(); await flush();
  assert.equal(page.data.presenceVisible, visibleBefore);
  assert.equal(page._runners.length, 1);
  assert.equal(page.data.runnerView.memberId, 7);
  assert.deepEqual(read.toasts, []);
  ok(get, true);
  assert.equal(await readResult, true);
  assert.equal(page.data.presenceVisible, true);
  assert.equal(page._runners.length, 1);

  const again = harness();
  const newer = arm(again);
  newer.togglePresenceSharing();
  const first = again.requests[0];
  newer._supersedePresencePrivacy();
  newer.togglePresenceSharing();
  assert.equal(newer.data.presenceSubmitting, true);
  ok(first, false);
  await flush(); await flush();
  assert.equal(newer.data.presenceVisible, true, '旧的关闭回包不得覆盖新的写入');
  assert.equal(newer.data.presenceSubmitting, true, '旧 finally 不得放开新的提交锁');
  assert.equal(newer._runners.length, 1);
  assert.deepEqual(again.toasts, []);

  const dropped = harness();
  const stale = arm(dropped);
  stale.togglePresenceSharing();
  stale._syncPresencePrivacy();
  dropped.requests[0].fail({ errMsg: 'request:fail' });
  await flush(); await flush();
  assert.equal(stale.data.presenceVisible, true);
  assert.equal(stale._runners.length, 1);
  assert.deepEqual(dropped.toasts, [], '更新的读之后,旧的失败回包不得再提示');

  const failed = harness();
  const late = arm(failed);
  late.togglePresenceSharing();
  late.onHide();
  failed.requests[0].fail({ errMsg: 'request:fail' });
  await flush(); await flush();
  assert.equal(late.data.presenceVisible, true);
  assert.equal(late._runners.length, 1);
  assert.deepEqual(failed.toasts, []);
  assert.equal(late.data.presenceSubmitting, false);
});

test('读失败在代际已过期时不把分享打成关闭;代际没变时仍按关闭', async () => {
  const h = harness();
  const page = arm(h);
  const pending = page._syncPresencePrivacy();
  page.togglePresenceSharing();
  const get = h.requests.find((r) => r.method === 'GET');
  get.fail({ errMsg: 'request:fail' });
  assert.equal(await pending, false);
  assert.equal(page.data.presenceVisible, true, '玩家已经改了分享,失败的旧读不得强制关闭');
  assert.equal(page._runners.length, 1);
  assert.equal(page.data.runnerView.memberId, 7);

  const left = harness();
  const gone = arm(left);
  const reading = gone._syncPresencePrivacy();
  gone.onHide();
  left.requests[0].fail({ errMsg: 'request:fail' });
  assert.equal(await reading, false);
  assert.equal(gone.data.presenceVisible, true);
  assert.equal(gone._runners.length, 1);
  assert.equal(gone.data.runnerView.memberId, 7);

  const fresh = harness();
  fresh.page._roamSid = 31;
  fresh.page.data.presenceVisible = true;
  fresh.page._runners = [{ memberId: 1 }];
  const failed = fresh.page._syncPresencePrivacy();
  fresh.requests[0].fail({ errMsg: 'request:fail' });
  assert.equal(await failed, false);
  assert.equal(fresh.page.data.presenceVisible, false);
  assert.deepEqual(fresh.page._runners, []);
});

test('代际没变时,关闭分享仍会关掉开关、清附近的人并提示', async () => {
  const h = harness();
  const page = arm(h);
  page.togglePresenceSharing();
  ok(h.requests[0], false);
  await flush(); await flush();
  assert.equal(page.data.presenceVisible, false);
  assert.equal(page.data.presenceSubmitting, false);
  assert.deepEqual(page._runners, []);
  assert.equal(page.data.runnerView, null);
  assert.deepEqual(h.toasts, ['已关闭附近的人位置分享']);
});
