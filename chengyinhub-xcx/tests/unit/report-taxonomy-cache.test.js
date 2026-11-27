'use strict';
// L09-110:同一账号的举报原因字典 10 分钟内只读一次;读失败不缓存,换号另读。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readTaxonomyLabels } = require('../../subpackageMember/report-common/taxonomy.js');

test('cached for the same app, failure not cached, concurrent reads share one request', () => {
  const requests = [];
  const app = { sendRequest: (o) => requests.push(o) };
  const got = [];
  readTaxonomyLabels(app, (l) => got.push(l)); readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 1);
  requests[0].fail();
  assert.deepEqual(got, [null, null]);
  readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 2, '失败不缓存');
  requests[1].success({ code: 200, data: { reasons: [{ code: 'SPAM', label: '广告' }] } });
  readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 2, '成功后命中缓存');
  assert.equal(got.at(-1).SPAM, '广告');
});

test('appeal-mine onShow only re-reads after 30s or an account switch', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { createRequire } = require('node:module');
  const FILE = path.resolve(__dirname, '../../subpackageMember/appeal-mine/index.js');
  let def, uid = '7'; const requests = [];
  const app = { globalData: {}, getUserID: () => uid, getAuthorization: () => 't', sendRequest: (o) => requests.push(o) };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => app, wx: { stopPullDownRefresh() {} }, getCurrentPages: () => [{}],
    require: createRequire(FILE), setTimeout, clearTimeout, console }, { filename: FILE });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); } });
  page.onLoad(); page._loadedOnce = true;
  const n = requests.length;
  page.onShow(); assert.equal(requests.length, n, '刚读过不重读');
  page._loadedAt = Date.now() - 31000; page.onShow(); assert.ok(requests.length > n, '超过 30 秒重读');
  const m = requests.length; uid = '8'; page.onShow(); assert.ok(requests.length > m, '换号重读');
});

test('same account stays fresh, a failed load retries, and an account change reloads', () => {
  const requests = [];
  let uid = '7';
  const app = { getUserID: () => uid, sendRequest: (o) => requests.push(o) };
  const ok = { code: 200, data: { reasons: [{ code: 'SPAM', label: '广告' }] } };
  const got = [];
  readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 1, '第一次读取');
  requests[0].success(ok);
  readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 1, '同一账号不再请求');
  uid = '8';
  readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 2, '换号另读');
  requests[1].fail();
  readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 3, '失败可重试');
  uid = '7';
  readTaxonomyLabels(app, (l) => got.push(l));
  assert.equal(requests.length, 3, '原账号副本仍新鲜');
  assert.equal(got.at(-1).SPAM, '广告');
});

function openPage(rel) {
  const file = require.resolve(path.join(__dirname, '../../', rel));
  let uid = '7';
  const requests = [];
  let def = null;
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => uid,
    getAuthorization: () => 't',
    sendRequest: (o) => requests.push(o),
  };
  const prev = { getApp: global.getApp, Page: global.Page, wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.getApp = () => app;
  global.Page = (d) => { def = d; };
  global.wx = {
    stopPullDownRefresh() {}, navigateTo() {}, navigateBack() {}, redirectTo() {}, switchTab() {}, showToast() {}, showModal() {},
  };
  global.getCurrentPages = () => [{}, {}];
  delete require.cache[file];
  require(file);
  return {
    requests,
    tax: () => requests.filter((r) => String(r.url).endsWith('/taxonomy')),
    setUid(id) { uid = id; },
    make() {
      return Object.assign({}, def, {
        data: JSON.parse(JSON.stringify(def.data)),
        setData(p, cb) { Object.assign(this.data, p); if (cb) cb(); },
      });
    },
    restore() { Object.assign(global, prev); },
  };
}

const LABELS = { code: 200, data: { reasons: [{ code: 'SPAM', label: '广告' }] } };
const LIST_ROW = { id: 1, stage: 'SUBMITTED', reasonCode: 'SPAM', targetType: 'MEMBER' };

test('a later show of the report list or detail does not request a fresh taxonomy again', () => {
  const mine = openPage('subpackageMember/report-mine/index.js');
  try {
    const page = mine.make();
    page.onLoad();
    assert.equal(mine.tax().length, 1, '列表第一次展示读取字典');
    mine.tax()[0].success(LABELS);
    mine.requests.find((r) => r.url.endsWith('/mine')).success({ code: 200, data: [LIST_ROW] });
    assert.equal(page.data.rows[0].reasonText, '广告');
    page.onShow();
    assert.equal(mine.tax().length, 1, '同一账号再展示列表不再请求字典');
    const lists = mine.requests.filter((r) => r.url.endsWith('/mine'));
    assert.equal(lists.length, 2);
    lists[1].success({ code: 200, data: [LIST_ROW] });
    assert.equal(page.data.rows[0].reasonText, '广告');
    mine.setUid('8');
    page.onShow();
    assert.equal(mine.tax().length, 2, '换号后再展示列表重读字典');
  } finally { mine.restore(); }

  const failed = openPage('subpackageMember/report-mine/index.js');
  try {
    const page = failed.make();
    page.onLoad();
    failed.tax()[0].fail();
    failed.requests.find((r) => r.url.endsWith('/mine')).success({ code: 200, data: [LIST_ROW] });
    assert.equal(page.data.state, 'ready');
    page.onShow();
    assert.equal(failed.tax().length, 2, '列表字典读取失败后再次展示可以重试');
  } finally { failed.restore(); }

  const detail = openPage('subpackageMember/report-detail/index.js');
  try {
    const body = { id: 3, stage: 'SUBMITTED', reasonCode: 'SPAM', targetType: 'MEMBER', timeline: [] };
    const first = detail.make();
    first.onLoad({ reportId: '3' });
    assert.equal(detail.tax().length, 1, '详情第一次展示读取字典');
    detail.tax()[0].success(LABELS);
    detail.requests.find((r) => r.url.endsWith('/3')).success({ code: 200, data: body });
    assert.equal(first.data.report.reasonText, '广告');
    const beforeShow = detail.requests.length;
    first.onShow();
    assert.equal(detail.requests.length, beforeShow, '回到详情不再请求字典');
    const second = detail.make();
    second.onLoad({ reportId: '4' });
    assert.equal(detail.tax().length, 1, '同一账号再开详情不再请求字典');
    assert.ok(detail.requests.some((r) => r.url.endsWith('/4')));
    detail.setUid('8');
    detail.make().onLoad({ reportId: '4' });
    assert.equal(detail.tax().length, 2, '换号后再开详情重读字典');
  } finally { detail.restore(); }

  const detailFail = openPage('subpackageMember/report-detail/index.js');
  try {
    const body = { id: 3, stage: 'SUBMITTED', reasonCode: 'SPAM', targetType: 'MEMBER', timeline: [] };
    detailFail.make().onLoad({ reportId: '3' });
    detailFail.tax()[0].fail();
    detailFail.requests.find((r) => r.url.endsWith('/3')).success({ code: 200, data: body });
    detailFail.make().onLoad({ reportId: '3' });
    assert.equal(detailFail.tax().length, 2, '详情字典读取失败后可以重试');
  } finally { detailFail.restore(); }
});
