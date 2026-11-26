'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE = path.resolve(__dirname, '../../pages/play/index.js');
const ROUTE_STATE = path.resolve(__dirname, '../../pages/play/utils/play-route-state.js');

function applyPatch(data, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = data;
    for (const part of parts.slice(0, -1)) target = target[part] ?? (target[part] = {});
    target[parts.at(-1)] = value;
  }
}

function loadPlayPage(sessionId) {
  const requests = [];
  global.getApp = () => ({
    globalData: { user_id: 9 },
    getUserID: () => 9,
    isDevEnv: () => false,
    _loginEpoch: 0,
    sendRequest(options) { requests.push(options); },
    getUploadClient: () => ({ uploadAll: () => ({ destroy() {} }) }),
  });
  const store = new Map();
  global.wx = {
    getStorageSync: (key) => store.get(key),
    setStorageSync(key, value) { store.set(key, JSON.parse(JSON.stringify(value))); },
    removeStorageSync(key) { store.delete(key); },
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375 }),
    nextTick(fn) { if (typeof fn === 'function') fn(); },
    showToast() {},
    showLoading() {},
    hideLoading() {},
    vibrateShort() {},
  };
  let config;
  global.Page = (value) => { config = value; };
  delete require.cache[ROUTE_STATE];
  delete require.cache[PAGE];
  require(PAGE);
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = (patch, callback) => {
    applyPatch(page.data, patch);
    if (callback) callback.call(page);
  };
  page._playOwner = '9';
  page._playLoginContext = { generation: '0' };
  page._routeState = { routeMode: 'LINEAR', status: 'ACTIVE', thoughts: [], sessionId, version: 4, nodeStates: {} };
  page.data.activityId = 5;
  page.data.mode = 1;
  page.data.nodes = [{ nodeId: 7, lat: 31.2, lng: 121.4, name: '甲' }, { nodeId: 8, lat: 31.21, lng: 121.41, name: '乙' }];
  page.rebuild = () => {};
  page.requests = requests;
  return page;
}

async function bindOriginal(page) {
  const pending = page.requests.find((row) => row.url === '/api/play/action-context' && !row._bound);
  assert.ok(pending, '应先读取原局');
  pending._bound = true;
  pending.success({ code: 200, data: { routeSessionId: page._routeState.sessionId, expectedRouteVersion: 4 } });
  await Promise.resolve();
  const post = page.requests.filter((row) => row.method === 'POST' && !row._used).at(-1);
  assert.ok(post, '原局绑定后应发出完成请求');
  post._used = true;
  return post;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('L01-022 未落账的回包在成功分支里抛错,仍提示失败并且可以重试', async () => {
  const page = loadPlayPage('run-uncommitted');
  let calls = 0;
  let stillCurrent = false;
  page.recordArrivalNetworkFailure = function () {
    calls += 1;
    if (calls === 1) throw new Error('failure ui');
    stillCurrent = this._arrivalWriteIntent != null && this._arrivalWriteInFlight === true;
  };
  page.arrive(7, 'tap');
  const post = await bindOriginal(page);
  const actionId = post.data.routeActionId;
  post.fail({ errMsg: 'request:fail ERR_INTERNET_DISCONNECTED' });
  await settle();
  assert.equal(calls, 2);
  assert.equal(stillCurrent, true);
  assert.equal(page._arrivalWriteInFlight, false);
  assert.equal(page._arrivalWriteIntent, null);
  assert.notEqual(page._arrivalWriteUnknown, true);

  page.arrive(7, 'retry');
  const retry = await bindOriginal(page);
  assert.equal(retry.data.routeActionId, actionId);
});

test('L01-022 已经落账的写入抛错后仍算落账,不改画成没送达', async () => {
  const page = loadPlayPage('run-committed');
  const failures = [];
  page.recordArrivalNetworkFailure = (...args) => { failures.push(args); };
  page.onComplete = function () { this._kept = true; throw new Error('after commit'); };
  page.arrive(7, 'tap');
  const post = await bindOriginal(page);
  const actionId = post.data.routeActionId;
  post.success({ code: 200, intentTerminal: true, data: { nodeId: 7, firstTime: true, done: 1 } });
  await settle();
  assert.deepEqual(failures, []);
  assert.equal(page._kept, true);
  assert.equal(page._arrivalWriteInFlight, false);
  const next = page._routeWritePayload('arrive', 7, { nodeId: 7 });
  assert.notEqual(next.routeActionId, actionId);
});

test('L01-022 更早的到达回包不能盖住后一次写入', async () => {
  const page = loadPlayPage('run-stale');
  const paints = [];
  page.onComplete = (id) => { paints.push(id); };
  page.recordArrivalNetworkFailure = () => { paints.push('fail'); };
  page.arrive(7, 'old');
  const oldPost = await bindOriginal(page);
  page._arrivalWriteInFlight = false;
  page.arrive(8, 'new');
  const newer = page._arrivalWriteIntent;
  oldPost.success({ code: 200, intentTerminal: true, data: { nodeId: 7, firstTime: true, done: 1 } });
  await settle();
  assert.deepEqual(paints, []);
  assert.equal(page._arrivalWriteIntent, newer);
  assert.equal(page._arrivalWriteInFlight, true);
});

test('L01-022 照片上传没落账时,成功分支抛错仍留下可重试的失败', async () => {
  const page = loadPlayPage('run-photo');
  page.data.game = { nodeId: 7, vm: 2 };
  page.data.screen = 'gamePlay';
  let calls = 0;
  page.recordGameNetworkFailure = function () {
    calls += 1;
    if (calls === 1) throw new Error('photo ui');
  };
  page.submitPhoto(7, '/tmp/photo.jpg');
  const post = await bindOriginal(page);
  const actionId = post.data.routeActionId;
  post.fail({ errMsg: 'request:fail ERR_INTERNET_DISCONNECTED' });
  await settle();
  assert.equal(calls, 2);
  assert.equal(page._gameWriteInFlight, false);
  assert.equal(page._gameWriteUnknown, undefined);
  page.submitPhoto(7, '/tmp/photo.jpg');
  const retry = await bindOriginal(page);
  assert.equal(retry.data.routeActionId, actionId);
});

test('L01-024 显示米数没变不写剩余距离,公里和用时没变不再写一遍导航摘要', () => {
  const page = loadPlayPage('run-nav');
  page.data.nav = { active: true, targetNodeId: 7, targetName: '甲', remainM: 1000, totalM: 100000, hit50: true, hit90: true };
  page.data.nodes = [{ nodeId: 7, lat: 31.2, lng: 121.4 }];
  const loc = { latitude: 31.23, longitude: 121.47 };
  const writes = [];
  const setData = page.setData;
  page.setData = (patch, callback) => {
    writes.push(patch);
    setData(patch, callback);
  };
  page.haversine = () => 1000.4;
  page._updateNav(loc);
  assert.deepEqual(writes, []);

  page.haversine = () => 1001;
  page._updateNav(loc);
  const settled = JSON.stringify(page.data.navMeta);
  writes.length = 0;
  page.haversine = () => 1002;
  page._updateNav(loc);
  assert.deepEqual(writes.filter((patch) => Object.prototype.hasOwnProperty.call(patch, 'nav.remainM')), [{ 'nav.remainM': 1002 }]);
  for (const patch of writes) {
    if (Object.prototype.hasOwnProperty.call(patch, 'navMeta')) {
      assert.notEqual(JSON.stringify(patch.navMeta), settled);
    }
  }
  writes.length = 0;
  page.haversine = () => 1002.4;
  page._updateNav(loc);
  assert.deepEqual(writes, []);
});
