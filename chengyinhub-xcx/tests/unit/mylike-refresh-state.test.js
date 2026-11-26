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
    getUserID: () => sandbox.member || '',
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
  assert.equal(vm.data.refreshError, '服务暂不可用，请稍后重试');
  assert.equal(sandbox.pullStops, 0);

  sandbox.requests[1].complete();

  assert.equal(vm.data.loading, false);
  assert.deepEqual(vm.data.postList, previous);
  assert.equal(vm.data.refreshError, '服务暂不可用，请稍后重试');
  assert.equal(sandbox.pullStops, 1);
  const view = fs.readFileSync(VIEW_PATH, 'utf8');
  assert.doesNotMatch(view, /<cy-inline-error[^>]*staleError/);
  assert.match(view, /<cy-inline-error wx:if="\{\{refreshError\}\}" kind="data" title="\{\{refreshError\}\}" action="重试" bind:action="refreshData"/);
  assert.match(view, /bind:detail="goPost"/);
  assert.match(view, /bind:more="onPostMore"/);
  assert.match(view, /bind:select="onPostMoreSelect"/);
});

test('L10-045: 同一账号的收藏还新鲜时返回不重置第一页，过期、下拉和换号才重读', () => {
  const vm = loadPage();
  sandbox.member = '11';
  vm.onLoad({});
  sandbox.requests[0].success({ code: '200', data: { rows: [{ id: 11, pics: '' }], hasMore: true } });
  sandbox.requests[0].complete();
  vm.onShow();
  assert.equal(sandbox.requests.length, 1);

  vm.onReachBottom();
  assert.equal(sandbox.requests[1].data.pageNum, 2);
  sandbox.requests[1].success({ code: '200', data: { rows: [{ id: 12, pics: '' }], hasMore: false } });
  sandbox.requests[1].complete();
  assert.deepEqual(vm.data.postList.map(row => row.id), [11, 12]);
  assert.equal(vm.data.pageConfig.pageNum, 2);

  vm.onShow();
  assert.equal(sandbox.requests.length, 2);
  assert.equal(vm.data.pageConfig.pageNum, 2);
  assert.deepEqual(vm.data.postList.map(row => row.id), [11, 12]);

  vm.onPullDownRefresh();
  assert.equal(sandbox.requests.length, 3);
  assert.equal(sandbox.requests[2].data.pageNum, 1);
  assert.equal(sandbox.requests[2].data.favorite_only, 1);
  assert.deepEqual(vm.data.postList.map(row => row.id), [11, 12]);
  sandbox.requests[2].fail({});
  assert.deepEqual(vm.data.postList.map(row => row.id), [11, 12]);
  assert.equal(vm.data.refreshError, '收藏帖文加载失败');
  sandbox.requests[2].complete();
  assert.equal(vm.data.loading, false);
  assert.deepEqual(vm.data.postList.map(row => row.id), [11, 12]);

  vm.refreshData();
  assert.equal(sandbox.requests.length, 4);
  assert.equal(sandbox.requests[3].data.pageNum, 1);
  assert.equal(vm.data.refreshError, '');
  assert.deepEqual(vm.data.postList.map(row => row.id), [11, 12]);
  sandbox.requests[3].success({ code: '200', data: { rows: [{ id: 13, pics: '' }], hasMore: false } });
  sandbox.requests[3].complete();
  assert.deepEqual(vm.data.postList.map(row => row.id), [13]);
  assert.equal(vm.data.refreshError, '');

  vm._favoriteFresh.posts.at = Date.now() - 60001;
  vm.onShow();
  assert.equal(sandbox.requests.length, 5);
  assert.equal(sandbox.requests[4].data.pageNum, 1);
  assert.deepEqual(vm.data.postList.map(row => row.id), [13]);
  sandbox.requests[4].fail({});
  assert.deepEqual(vm.data.postList.map(row => row.id), [13]);
  assert.equal(vm.data.refreshError, '收藏帖文加载失败');
  sandbox.requests[4].complete();

  sandbox.member = '22';
  vm.onShow();
  assert.deepEqual(vm.data.postList, []);
  assert.equal(sandbox.requests.length, 6);
  assert.equal(sandbox.requests[5].data.pageNum, 1);
});

test('主题和据点刷新失败时留着已有卡片并给出重试', () => {
  const topics = loadPage();
  topics.setData({ activeFavoriteTab: 'topics', ztList1: [{ id: 3, name: '原主题' }] });
  topics._hasShown = true;
  topics.onShow();
  assert.equal(sandbox.requests.at(-1).data.pageNum, 1);
  assert.equal(topics.data.ztList1[0].id, 3);
  sandbox.requests.at(-1).fail({});
  assert.equal(topics.data.ztList1[0].id, 3);
  assert.equal(topics.data.refreshError, '喜欢列表加载失败');

  sandbox.requests.length = 0;
  const nodes = loadPage();
  nodes.setData({ activeFavoriteTab: 'nodes', nodeList: [{ id: 9, name: '原据点' }] });
  nodes._hasShown = true;
  nodes.onShow();
  assert.equal(sandbox.requests.at(-1).url, '/api/city/nodes/favorites');
  assert.equal(nodes.data.nodeList[0].id, 9);
  sandbox.requests.at(-1).successStatusAbnormal({ statusCode: 502 });
  assert.equal(nodes.data.nodeList[0].id, 9);
  assert.equal(nodes.data.refreshError, '服务暂不可用，请稍后重试');
  assert.equal(nodes.data.errorMsg, '');
});

test('L10-045: 主题和据点新鲜时返回不重读', () => {
  const topics = loadPage();
  topics.setData({ activeFavoriteTab: 'topics' });
  topics._hasShown = true;
  topics.loadLikeData();
  sandbox.requests.at(-1).success({ code: '200', data: { rows: [{ id: 3, name: '原主题' }] } });
  sandbox.requests.at(-1).complete();
  const topicRequests = sandbox.requests.length;
  topics.onShow();
  assert.equal(sandbox.requests.length, topicRequests);
  assert.equal(topics.data.pageConfig.pageNum, 1);
  assert.equal(topics.data.ztList1[0].id, 3);

  sandbox.requests.length = 0;
  const nodes = loadPage();
  nodes.setData({ activeFavoriteTab: 'nodes' });
  nodes._hasShown = true;
  nodes.loadLikeData();
  sandbox.requests.at(-1).success({ code: '200', data: [{ poiId: 9, name: '原据点' }] });
  sandbox.requests.at(-1).complete();
  nodes.onShow();
  assert.equal(sandbox.requests.length, 1);
  assert.equal(nodes.data.nodeList[0].id, 9);
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
