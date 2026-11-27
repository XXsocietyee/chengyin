'use strict';
// L07-049 / L07-050:售后列表只认最后一次请求;只有详情页真的提交过意见才在返回时静默刷新
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mount() {
  let def = null;
  const requests = [];
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  global.Page = (v) => { def = v; };
  global.getApp = () => ({ globalData: {}, getUserID: () => 1, sendRequest: (o) => requests.push(o), getRequestErrorMessage: (r, f) => f });
  global.wx = { getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), setNavigationBarColor() {}, setBackgroundColor() {}, navigateTo() {}, showToast() {} };
  const file = path.join(__dirname, '../../pages/merchant/aftercare/index.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  page._merchantAccess = { canReadAftercare: true };
  return { page, requests, restore() { Object.assign(global, prev); } };
}
const pageOf = (bucket, items, hasMore) => ({ code: 200, data: { bucket, pageNum: 1, pageSize: 20, total: items.length + (hasMore ? 1 : 0), hasMore: !!hasMore, items } });
const pageAt = (bucket, pageNum, items, hasMore) => {
  const through = (pageNum - 1) * 20 + items.length;
  return { code: 200, data: { bucket, pageNum, pageSize: 20, total: through + (hasMore ? 1 : 0), hasMore: !!hasMore, items } };
};
const row = (id, bucket) => ({ refundId: id, bucket, processing: 'WAITING_PLATFORM_REVIEW', merchantOpinion: 'PENDING', canRespond: true, refunded: false, createTime: '2026-11-20 10:00:00' });

test('late response of the previous bucket is dropped', () => {
  const h = mount();
  try {
    h.page.loadList(true);
    const old = h.requests[0];
    h.page.switchBucket({ detail: { key: 'COMPLETED' } });
    const bucket = h.page.data.bucket;
    h.requests[1].success(pageOf(bucket, []));
    old.success(pageOf('PENDING', [row(5, 'PENDING')]));
    assert.equal(h.page.data.itemCount, 0);
  } finally { h.restore(); }
});

test('returning from detail without a response does not reload; after a response it refreshes silently', () => {
  const h = mount();
  try {
    h.page.loadList(true);
    h.requests[0].success(pageOf(h.page.data.bucket, [row(5, h.page.data.bucket)]));
    h.page.openDetail({ currentTarget: { dataset: { refundid: 5, recordtype: 'REFUND' } } });
    h.page.onShow();
    assert.equal(h.requests.length, 1);
    h.page._refreshAfterDetail = true;
    h.page.onShow();
    assert.equal(h.requests.length, 2);
    assert.equal(h.page.data.pageState, 'ready', '静默刷新不打回骨架');
  } finally { h.restore(); }
});

test('静默刷新重读已加载的后面页，中途失败不把列表收成第一页', () => {
  const h = mount();
  try {
    const bucket = h.page.data.bucket;
    h.page.loadList(true);
    h.requests[0].success(pageAt(bucket, 1, [row(5, bucket)], true));
    h.page.loadMore();
    h.requests[1].success(pageAt(bucket, 2, [row(6, bucket)], false));
    assert.equal(h.page.data.itemCount, 2);
    assert.equal(h.page.data.pageNum, 2);

    h.page._refreshAfterDetail = true;
    h.page.onShow();
    assert.match(h.requests[2].url, /pageNum=1/);
    h.requests[2].success(pageAt(bucket, 1, [row(5, bucket)], true));
    assert.match(h.requests[3].url, /pageNum=2/);
    h.requests[3].fail();
    assert.equal(h.page.data.itemCount, 2, '第二页失败时已加载的行还在');
    assert.equal(h.page.data.pageState, 'ready');
    assert.equal(h.page._items[1].refundId, 6);

    h.page._refreshAfterDetail = true;
    h.page.onShow();
    h.requests[4].success(pageAt(bucket, 1, [row(7, bucket)], true));
    h.requests[5].success(pageAt(bucket, 2, [row(8, bucket)], false));
    assert.equal(h.page.data.itemCount, 2);
    assert.equal(h.page.data.pageNum, 2);
    assert.equal(h.page._items[0].refundId, 7);
    assert.equal(h.page._items[1].refundId, 8);
  } finally { h.restore(); }
});

// L07-052:列表只下发分组后的行和条数;搜索只重算分组,不再整表下发原始行
test('售后列表原始行不进页面数据，搜索范围文案读 itemCount', () => {
  const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../pages/merchant/aftercare/index.js'), 'utf8')
  assert.doesNotMatch(src, /\n    items: \[\],/)
  assert.doesNotMatch(src, /this\.data\.items/)
  assert.match(src, /itemCount: items\.length/)
})
