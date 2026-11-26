'use strict';
// L09-128:冷启动会话恢复回调不因中途 onHide 被丢弃;回来可见后完成同步挂上个人主页。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const FILE = path.resolve(__dirname, '../../pages/member/index/index.js');

test('session restored after a hide/show still mounts the profile', async () => {
  let def; let ready; let id = ''; let token = '';
  const app = { isAppReady: false, globalData: {}, getUserID: () => id, getAuthorization: () => token,
    waitForAppReady: () => new Promise((r) => { ready = r; }) };
  const localRequire = createRequire(FILE);
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => app, wx: { getStorageSync() {}, getSystemInfoSync: () => ({}) },
    require: localRequire, setTimeout, clearTimeout, console, Promise }, { filename: FILE });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); } });
  page.onShow();
  page.onHide(); page.onShow();
  id = '7'; token = 'Bearer t'; app.isAppReady = true; ready();
  await new Promise((r) => setImmediate(r));
  assert.equal(page.data.profileMounts.length, 1);
});
