'use strict';
// L07-023:一个未知系统标签 / 坏颜色 / 新时间线类型不再让客户详情整页报错
const test = require('node:test');
const assert = require('node:assert/strict');
const { shapeCustomerDetail } = require('../../pages/merchant/customer/detail/view-model.js');

const base = () => ({
  summary: { customerMemberId: 9, arrivedCount: 1, pendingCount: 0, refundedCount: 0, paidAmount: null },
  systemTags: [{ code: 'ARRIVED', label: '已到店' }, { code: 'NEW_CODE', label: '新' }],
  merchantTags: [{ id: 1, tagName: '常客', tagColor: '#ff0000' }, { id: 2, tagName: '旧色', tagColor: 'red' }],
  timeline: [{ key: 'a', type: 'ARRIVED' }, { key: 'b', type: 'FUTURE_TYPE', title: '' }],
});

test('bad rows are skipped or downgraded instead of failing the page', () => {
  const d = shapeCustomerDetail(base(), 9);
  assert.ok(d);
  assert.deepEqual(d.systemTags.map((t) => t.code), ['ARRIVED']);
  assert.deepEqual(d.merchantTags.map((t) => t.tagColor), ['#FF0000', '']);
  assert.equal(d.timeline.find((r) => r.key === 'b').typeText, '记录');
});

test('identity mismatch still fails closed', () => {
  assert.equal(shapeCustomerDetail(base(), 10), null);
});

// L07-022:弹窗里写完后的静默刷新断网只提示,不把整页翻成错误态
test('silent reload network failure keeps the page state', () => {
  let def = null;
  const requests = [];
  const toasts = [];
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.Page = (v) => { def = v; };
  global.getApp = () => ({ globalData: {}, getUserID: () => 1, sendRequest: (o) => requests.push(o), getRequestErrorMessage: (r, f) => f });
  global.getCurrentPages = () => [];
  global.wx = { getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), showToast: (o) => toasts.push(o.title), setNavigationBarColor() {}, setBackgroundColor() {} };
  try {
    const path = require('node:path');
    const file = path.join(__dirname, '../../pages/merchant/customer/detail/index.js');
    delete require.cache[require.resolve(file)];
    require(file);
    const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
    page.setData = function (p) { Object.assign(this.data, p); };
    page._merchantAccess = { canReadCrm: true };
    page._customerMemberId = 9;
    page.data.pageState = 'ready';
    page.loadDetail(true);
    requests.at(-1).fail();
    assert.equal(page.data.pageState, 'ready');
  } finally { Object.assign(global, prev); }
});
