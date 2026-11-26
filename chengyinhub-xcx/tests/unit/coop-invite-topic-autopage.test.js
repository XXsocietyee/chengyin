'use strict';
// L09-101:整页主题都被过滤时自动翻页封顶 3 页,之后由「更多」按需翻。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const FILE = path.resolve(__dirname, '../../subpackageMember/components/cy/coop-invite-sheet/index.js');

test('auto paging over fully-filtered pages stops after 3 pages', () => {
  let def; const requests = [];
  const app = { globalData: {}, getUserID: () => 7, getImgUrl: (x) => x, sendRequest: (o) => requests.push(o) };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Component: (d) => { def = d; }, getApp: () => app, wx: {}, require: createRequire(FILE), setTimeout, clearTimeout, console }, { filename: FILE });
  const c = Object.assign({}, def.methods, { data: Object.assign(JSON.parse(JSON.stringify(def.data)), { topics: [], loading: false }),
    setData(p) { Object.assign(this.data, p); }, triggerEvent() {} });
  c._epoch = 1; c._page = 0; c.current = () => true;
  c.loadTopics();
  const expired = { id: 1, status: 0, endTime: '2000-01-01' };
  for (let i = 0; i < 10 && requests[i]; i++) requests[i].success({ code: 200, data: { rows: [Object.assign({}, expired, { id: i + 1 })], total: 1000 } });
  assert.equal(requests.length, 3);
  c.moreTopics();
  assert.equal(requests.length, 4);
});
