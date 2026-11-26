'use strict';
// L09-123:视频悬赏申诉/取消在弹窗打开或请求在途时不再受理第二次。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const FILE = path.resolve(__dirname, '../../subpackageA/pages/video-bounty/index.js');

test('appeal: second tap while the modal/request is pending is ignored', async () => {
  let def; const requests = []; const modals = [];
  const localRequire = createRequire(FILE);
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => ({ globalData: {}, getUserID: () => 7, sendRequest: (o) => requests.push(o) }),
    getCurrentPages: () => [{}], wx: {}, setTimeout, clearTimeout, console, Promise,
    require: (id) => id.endsWith('/modal.js') ? { show: (o) => modals.push(o) } : id.endsWith('/toast.js') ? Object.assign(() => {}, { success() {} }) : localRequire(id) }, { filename: FILE });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); }, load() {} });
  const tap = { currentTarget: { dataset: { id: 9 } } };
  page.appeal(tap); page.appeal(tap);
  assert.equal(modals.length, 1);
  modals[0].success({ confirm: true, content: '理由' });
  page.appeal(tap);
  assert.equal(modals.length, 1, '请求在途');
  requests[0].success({ code: 200 });
  await new Promise((r) => setImmediate(r));
  page.appeal(tap);
  assert.equal(modals.length, 2, '请求结束后可再次申诉');
});
