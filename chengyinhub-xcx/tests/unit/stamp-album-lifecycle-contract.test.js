'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createRequestClient } = require('../../utils/transport/request-client.js');

const PAGE_PATH = path.resolve(__dirname, '../../subpackageP3/pages/stamp-album/index/index.js');
const { collageLayout } = require('../../subpackageP3/pages/stamp-album/index/layout.js');
const pageRequire = createRequire(PAGE_PATH);
const requests = [];
const client = createRequestClient({
  wxRequest(options) {
    requests.push(options);
    return { abort() {} };
  },
  getBaseUrl() { return ''; },
  getAuthorization() { return ''; },
  hideToast() {},
  showToast() {},
});

let definition;
vm.runInNewContext(fs.readFileSync(PAGE_PATH, 'utf8'), {
  getApp: () => ({ getUserID: () => 7, sendRequest: options => client.send(options) }),
  Page: config => { definition = config; },
  require: id => pageRequire(id),
  wx: {
    getWindowInfo: () => ({ windowWidth: 390 }),
    getSystemInfoSync: () => ({ windowWidth: 390 }),
    navigateTo() {},
  },
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// 微信 setData 的 items[i] 会写进数组并只带新下标过桥;Object.assign 会把路径键当成普通字段。
function applySetData(data, patch) {
  Object.keys(patch).forEach((key) => {
    const parts = String(key).replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = data;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = parts[i + 1];
      if (target[parts[i]] == null || typeof target[parts[i]] !== 'object') {
        target[parts[i]] = /^\d+$/.test(next) ? [] : {};
      }
      target = target[parts[i]];
    }
    target[parts[parts.length - 1]] = patch[key];
  });
}

function mount() {
  const trace = { retired: false, writesAfterRetire: 0 };
  const page = {
    data: plain(definition.data),
    setData(patch, callback) {
      if (trace.retired) trace.writesAfterRetire += 1;
      applySetData(this.data, patch);
      if (callback) callback.call(this);
    },
  };
  for (const [name, value] of Object.entries(definition)) {
    if (typeof value === 'function') page[name] = value.bind(page);
  }
  page.onLoad();
  return {
    page,
    trace,
    retire() {
      trace.retired = true;
      if (typeof page.onUnload === 'function') page.onUnload();
    },
  };
}

function stamp(id) {
  return { id, picUrl: `https://unit.invalid/stamp-${id}.jpg` };
}

function succeed(request, rows, total) {
  request.success({ statusCode: 200, data: { code: 200, data: { list: rows, total } } });
  request.complete({ statusCode: 200, data: { code: 200 } });
}

function fail(request) {
  request.fail({ errMsg: 'request:fail timeout' });
  request.complete({ errMsg: 'request:fail timeout' });
}

function abnormal(request) {
  request.success({ statusCode: 500, data: { code: 500, msg: 'gateway error' } });
  request.complete({ statusCode: 500, data: { code: 500 } });
}

function state(page) {
  return {
    ids: Array.from(page.data.items || [], item => item.id),
    pics: Array.from(page.data.items || [], item => item.picUrl),
    total: page.data.total,
    pageNum: page.data.pageNum,
    loading: page.data.loading,
    loaded: page.data.loaded,
    error: page.data.error,
    noMore: page.data.noMore,
  };
}

test('集邮册卸载后拒绝旧 success/fail/abnormal；当前续页失败按同游标重试', () => {
  const retiredSuccess = mount();
  const oldSuccess = requests[0];
  retiredSuccess.retire();
  const retiredFail = mount();
  const oldFail = requests[1];
  retiredFail.retire();
  const retiredAbnormal = mount();
  const oldAbnormal = requests[2];
  retiredAbnormal.retire();

  const current = mount();
  succeed(requests[3], [stamp(100)], 3);
  assert.deepEqual(state(current.page), {
    ids: [100],
    pics: ['https://unit.invalid/stamp-100.jpg'],
    total: 3,
    pageNum: 2,
    loading: false,
    loaded: true,
    error: false,
    noMore: false,
  });

  current.page.onReachBottom();
  const continuation = requests[4];
  assert.deepEqual(plain(continuation.data), { pageNum: 2, pageSize: 50 });
  const confirmed = plain(current.page.data.items);
  fail(continuation);
  assert.deepEqual(plain(current.page.data.items), confirmed);
  assert.equal(current.page.data.pageNum, 2);
  assert.equal(current.page.data.loading, false);
  assert.equal(current.page.data.error, true);

  current.page.retryLoad();
  const retry = requests[5];
  assert.deepEqual(plain(retry.data), { pageNum: 2, pageSize: 50 });
  assert.deepEqual(plain(current.page.data.items), confirmed);
  assert.equal(current.page.data.loading, true);
  succeed(retry, [stamp(200), stamp(201)], 3);
  const currentFinal = state(current.page);
  assert.deepEqual(currentFinal, {
    ids: [100, 200, 201],
    pics: [
      'https://unit.invalid/stamp-100.jpg',
      'https://unit.invalid/stamp-200.jpg',
      'https://unit.invalid/stamp-201.jpg',
    ],
    total: 3,
    pageNum: 3,
    loading: false,
    loaded: true,
    error: false,
    noMore: true,
  });

  succeed(oldSuccess, [stamp(1)], 1);
  fail(oldFail);
  abnormal(oldAbnormal);
  assert.deepEqual(state(current.page), currentFinal, '旧页回调不得污染新 Page');
  assert.deepEqual([
    retiredSuccess.trace.writesAfterRetire,
    retiredFail.trace.writesAfterRetire,
    retiredAbnormal.trace.writesAfterRetire,
  ], [0, 0, 0], '退役 Page 不得接收任何 success/fail/abnormal setData');
});

test('L09-052 续页只写入新下标；失败或过期回包不追加', () => {
  const current = mount();
  const page = current.page;
  const patches = [];
  const original = page.setData;
  page.setData = function (patch, callback) {
    patches.push(patch);
    return original.call(this, patch, callback);
  };
  succeed(requests[requests.length - 1], [stamp(100)], 4);
  const firstPatch = patches.filter((patch) => Object.prototype.hasOwnProperty.call(patch, 'items')).pop();
  assert.ok(firstPatch && Array.isArray(firstPatch.items), '第一页仍整表落地');
  assert.equal(firstPatch.items.length, 1);
  const kept = page.data.items[0];
  const keptPose = { x: kept.x, y: kept.y, rot: kept.rot, z: kept.z };

  page.onReachBottom();
  patches.length = 0;
  succeed(requests[requests.length - 1], [stamp(200), stamp(201)], 4);
  const append = patches.filter((patch) => patch.pageNum === 3).pop();
  assert.ok(append, '续页必须落地');
  assert.equal(Object.prototype.hasOwnProperty.call(append, 'items'), false, '续页不得重发整表 items');
  assert.deepEqual(Object.keys(append).sort(), [
    'error', 'items[1]', 'items[2]', 'loaded', 'loading', 'noMore', 'pageNum', 'stageH', 'total',
  ].sort());
  const pos = collageLayout(3, { cols: 4, cellW: page._cellW, cellH: page._cellH, jitter: 16, maxRot: 12 });
  assert.equal(page.data.items[0], kept, '已在屏上的邮票对象保持原样');
  assert.deepEqual(keptPose, { x: pos[0].x, y: pos[0].y, rot: pos[0].rot, z: pos[0].z });
  assert.deepEqual(plain(append['items[1]']), {
    id: 200,
    picUrl: 'https://unit.invalid/stamp-200.jpg',
    x: pos[1].x, y: pos[1].y, rot: pos[1].rot, z: pos[1].z,
  });
  assert.deepEqual(plain(append['items[2]']), {
    id: 201,
    picUrl: 'https://unit.invalid/stamp-201.jpg',
    x: pos[2].x, y: pos[2].y, rot: pos[2].rot, z: pos[2].z,
  });
  assert.equal(page.data.items[1], append['items[1]']);
  assert.equal(page.data.items[2], append['items[2]']);
  assert.equal(page.data.stageH, Math.ceil(3 / 4) * page._cellH + 60);
  assert.equal(page.data.total, 4);
  assert.equal(page.data.noMore, false);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.loaded, true);
  assert.equal(page.data.error, false);

  const frozen = plain(page.data.items);
  const pageNum = page.data.pageNum;
  page.onReachBottom();
  fail(requests[requests.length - 1]);
  assert.deepEqual(plain(page.data.items), frozen);
  assert.equal(page.data.items[0], kept);
  assert.equal(page.data.pageNum, pageNum);
  assert.equal(page.data.error, true);
  assert.equal(page.data.loading, false);

  page.retryLoad();
  const malformed = requests[requests.length - 1];
  malformed.success({ statusCode: 200, data: { code: 200, data: { list: [{ id: 300 }], total: 4 } } });
  malformed.complete({ statusCode: 200, data: { code: 200 } });
  assert.deepEqual(plain(page.data.items), frozen);
  assert.equal(page.data.items[0], kept);
  assert.equal(page.data.pageNum, pageNum);
  assert.equal(page.data.error, true);

  page.retryLoad();
  const stale = requests[requests.length - 1];
  page._loadSeq += 1;
  succeed(stale, [stamp(400)], 4);
  assert.deepEqual(plain(page.data.items), frozen);
  assert.equal(page.data.items[0], kept);
  assert.equal(page.data.pageNum, pageNum);
  assert.equal(page.data.items.some((item) => item.id === 400), false);
});
