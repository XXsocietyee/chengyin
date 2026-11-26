'use strict';
// L09-110:举报原因字典同一进程 10 分钟内只读一次;读失败不缓存。
const test = require('node:test');
const assert = require('node:assert/strict');
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
