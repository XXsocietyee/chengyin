'use strict';
// L07-027 / L07-028:结算失败后重读待答列表;200 但 data 不是数组不卡骨架
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mount() {
  let def = null;
  const requests = [];
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  global.Page = (v) => { def = v; };
  global.getApp = () => ({ globalData: {}, getUserID: () => 5, sendRequest: (o) => requests.push(o), getRequestErrorMessage: (r, f) => (r && r.msg) || f, getSession: () => ({ getRevision: () => 0 }) });
  global.wx = { getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), showToast() {}, setNavigationBarColor() {}, setBackgroundColor() {}, getStorageSync() {}, setStorageSync() {} };
  const file = path.join(__dirname, '../../pages/merchant/predict/index.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data));
  page.setData = function (patch) { for (const k of Object.keys(patch)) { if (k.includes('.')) { const [a, b] = k.split('.'); this.data[a] = Object.assign({}, this.data[a], { [b]: patch[k] }); } else this.data[k] = patch[k]; } };
  page._accessEpoch = 1;
  page._access = { canManageProjects: true };
  return { page, requests, restore() { Object.assign(global, prev); } };
}

test('non-array data on 200 shows the read error instead of throwing', () => {
  const h = mount();
  try {
    h.page.loadInbox();
    assert.doesNotThrow(() => h.requests[0].success({ code: 200, data: { rows: [] } }));
    assert.equal(h.page.data.pageState === 'loading', false);
  } finally { h.restore(); }
});

test('settle network failure and settle rejection both re-read the inbox', () => {
  const h = mount();
  try {
    h.page.data.items = [{ rid: 'r1', nodeId: 1, playDay: '2026-11-23', options: [] }];
    h.page.data.confirm = { show: true, rid: 'r1', key: 'A' };
    h.page.onConfirmSettle();
    h.requests.at(-1).fail();
    assert.equal(h.requests.at(-1).url, '/api/merchant/predict/inbox');
    h.page.onConfirmSettle();
    h.requests.filter((r) => r.url === '/api/merchant/predict/settle').at(-1).success({ code: 500, msg: '本轮已结算' });
    assert.equal(h.requests.at(-1).url, '/api/merchant/predict/inbox');
  } finally { h.restore(); }
});

// L07-127:缺 daysLeft 不显示红色「今天不给就作废」
test('missing daysLeft gives no deadline badge text; 0 still warns', () => {
  const h = mount();
  try {
    h.page.loadInbox();
    h.requests[0].success({ code: 200, data: [{ nodeId: 1, playDay: 'd1', options: [] }, { nodeId: 2, playDay: 'd2', options: [], daysLeft: 0 }] });
    assert.equal(h.page.data.items[0].deadlineText, '');
    assert.equal(h.page.data.items[1].deadlineText, '今天不给就作废');
  } finally { h.restore(); }
});
