'use strict';
// L09-074:举报队伍缺 teamId 时给失败回执,不发请求。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const FILE = path.resolve(__dirname, '../../subpackageMember/components/cy/team-report-sheet/index.js');

test('missing teamId shows a fail receipt instead of doing nothing', () => {
  let def; const requests = [];
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Component: (d) => { def = d; }, getApp: () => ({ sendRequest: (o) => requests.push(o) }),
    require: createRequire(FILE) }, { filename: FILE });
  const c = Object.assign({}, def.methods, { properties: { show: true, teamId: '' }, data: JSON.parse(JSON.stringify(def.data)),
    setData(p) { Object.assign(this.data, p); }, triggerEvent() {} });
  c.onSelect({ detail: { index: 0 } });
  assert.equal(requests.length, 0);
  assert.equal(c.data.stage, 'fail');
  assert.match(c.data.failedText, /队伍信息缺失/);
});
