const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/mylike/mylike.js');
const VIEW_PATH = path.resolve(__dirname, '../../pages/mylike/mylike.wxml');
let sandbox;

beforeEach(() => {
  sandbox = { config: null, requests: [], pullStops: 0 };
  global.getApp = () => ({
    globalData: {},
    canUseCommunity: () => true, // Current-account server-open fixture (favorites posts tab is gated since F-L5C-06).
    getRequestErrorMessage: (_res, fallback) => fallback,
    sendRequest(options) {
      sandbox.requests.push(options);
      return { abort() {} };
    },
  });
  global.Page = config => { sandbox.config = config; };
  global.wx = {
    stopPullDownRefresh() { sandbox.pullStops += 1; },
    // #810 起 onLoad 会同步一次视图主题;本用例只验刷新态,给个空读即可。
    getStorageSync() { return ''; },
    setNavigationBarColor() {},
    showToast() {},
  };
});

test('帖文收藏刷新 502 保留旧卡片与操作，并在 complete 后停止下拉动画', () => {
  const vm = loadPage();
  const previous = [{ id: 11, name: '原收藏', imgUrl: 'cover.jpg' }];
  vm.onLoad({});
  sandbox.requests[0].success({ code: '200', data: { rows: previous } });
  sandbox.requests[0].complete();

  vm.onPullDownRefresh();

  assert.deepEqual(vm.data.postList, previous);
  assert.equal(vm.data.loading, true);
  assert.equal(vm.data.refreshing, true);
  assert.equal(vm.data.errorMsg, '');
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].successStatusAbnormal({ statusCode: 502 });

  assert.deepEqual(vm.data.postList, previous);
  assert.equal(vm.data.refreshing, false);
  assert.equal(vm.data.errorMsg, '');
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].complete();

  assert.equal(vm.data.loading, false);
  assert.equal(sandbox.pullStops, 1);
  const view = fs.readFileSync(VIEW_PATH, 'utf8');
  assert.doesNotMatch(view, /<cy-inline-error[^>]*staleError/);
  assert.match(view, /bind:detail="goPost"/);
  assert.match(view, /bind:more="onPostMore"/);
  assert.match(view, /bind:select="onPostMoreSelect"/);
});

test('L10-045: 已加载第 2 页后再返回，列表仍含第 2 页，第 1 页消失的条目不留在屏上', () => {
  const vm = loadPage();
  vm.onLoad({});
  vm.onShow();
  sandbox.requests[0].success({
    code: '200',
    data: { rows: [{ id: 1, name: '甲' }, { id: 2, name: '乙' }], hasMore: true },
  });
  sandbox.requests[0].complete();

  vm.onReachBottom();
  sandbox.requests[1].success({
    code: '200',
    data: { rows: [{ id: 3, name: '丙' }], hasMore: false },
  });
  sandbox.requests[1].complete();
  assert.deepEqual(vm.data.postList.map(item => item.id), [1, 2, 3]);

  vm.onShow();
  assert.deepEqual(vm.data.postList.map(item => item.id), [1, 2, 3], '回包前不得把已加载列表清成空');
  assert.equal(sandbox.requests.length, 3);
  assert.equal(sandbox.requests[2].data.pageNum, 1);

  sandbox.requests[2].success({
    code: '200',
    data: { rows: [{ id: 1, name: '甲改' }], hasMore: true },
  });
  sandbox.requests[2].complete();

  assert.deepEqual(vm.data.postList.map(item => item.id), [1, 3]);
  assert.equal(vm.data.postList[0].name, '甲改');
  assert.equal(vm.data.postList.some(item => item.id === 2), false);
  assert.equal(vm.data.pageConfig.pageNum, 2, '下一页仍从已加载页之后继续');
});

test('切到别的页签再切回帖文，已上拉的第 2 页还在，第 1 页消失的条目不留在屏上', () => {
  const vm = loadPage();
  vm.onLoad({});
  vm.onShow();
  sandbox.requests[0].success({
    code: '200',
    data: { rows: [{ id: 1, name: '甲' }, { id: 2, name: '乙' }], hasMore: true },
  });
  sandbox.requests[0].complete();
  vm.onReachBottom();
  sandbox.requests[1].success({
    code: '200',
    data: { rows: [{ id: 3, name: '丙' }], hasMore: false },
  });
  sandbox.requests[1].complete();

  vm.onFavoriteTabChange({ detail: { key: 'topics' } });
  assert.deepEqual(vm.data.postList.map(item => item.id), [1, 2, 3], '切走时不得先清掉帖文后面页');
  sandbox.requests[2].success({ code: '200', data: { rows: [{ id: 9, name: '主题' }] } });
  sandbox.requests[2].complete();

  vm.onFavoriteTabChange({ detail: { key: 'posts' } });
  assert.deepEqual(vm.data.postList.map(item => item.id), [1, 2, 3], '回包前不得把已加载列表换成空的第 1 页');
  assert.equal(sandbox.requests[3].data.pageNum, 1);
  sandbox.requests[3].success({
    code: '200',
    data: { rows: [{ id: 1, name: '甲改' }], hasMore: true },
  });
  sandbox.requests[3].complete();

  assert.deepEqual(vm.data.postList.map(item => item.id), [1, 3]);
  assert.equal(vm.data.postList[0].name, '甲改');
  assert.equal(vm.data.pageConfig.pageNum, 2);
});

function loadPage() {
  delete require.cache[require.resolve(PAGE_PATH)];
  require('../helpers/community-page-seam.js').loadPage(PAGE_PATH);
  const vm = Object.assign({}, sandbox.config);
  vm.data = JSON.parse(JSON.stringify(sandbox.config.data));
  vm.setData = function (patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  return vm;
}

test('并发取消收藏按 ID 删除，顺序或逆序回包均保留未取消项', () => {
  for (const order of [[0, 1], [1, 0]]) {
    const vm = loadPage();
    sandbox.requests.length = 0;
    vm.data.postList = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    vm.postUnlike({ detail: { index: 0 } });
    vm.postUnlike({ detail: { index: 1 } });
    order.forEach(index => sandbox.requests[index].success({ code: '200' }));
    assert.deepEqual(vm.data.postList.map(item => item.id), ['C']);
  }
});

function runTopicUnlikeScenario(responseOrder, items, eventIds) {
  wx.showModal = options => options.success({ confirm: true, cancel: false });
  const vm = loadPage();
  sandbox.requests.length = 0;
  vm.data.ztList1 = items;

  vm.topicUnlike({ currentTarget: { dataset: { index: 0, id: eventIds[0] } } });
  vm.topicUnlike({ currentTarget: { dataset: { index: 1, id: eventIds[1] } } });

  assert.equal(sandbox.requests.length, 2);
  responseOrder.forEach(requestIndex => {
    sandbox.requests[requestIndex].success({ code: '200' });
    sandbox.requests[requestIndex].complete();
  });
  assert.deepEqual(vm.data.ztList1.map(item => item.id), ['C']);
}

test('主题并发取消按发起顺序回包时按 ID 删除，兼容 number/string ID', () => {
  runTopicUnlikeScenario(
    [0, 1],
    [{ id: 101 }, { id: '202' }, { id: 'C' }],
    ['101', 202]
  );
});

test('主题并发取消按逆序回包时按 ID 删除，兼容 number/string ID', () => {
  runTopicUnlikeScenario(
    [1, 0],
    [{ id: '101' }, { id: 202 }, { id: 'C' }],
    [101, '202']
  );
});
