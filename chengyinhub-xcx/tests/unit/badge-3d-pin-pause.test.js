'use strict';
// L09-143:徽章详情 onHide 时 pin-spin 的 RAF 与翻面计时器一并停掉。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const FILE = path.resolve(__dirname, '../../subpackageP3/pages/badge-3d/index.js');

test('onHide pauses the pin-spin component', () => {
  let def; let paused = 0;
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => ({ globalData: {}, getUserID: () => 7 }),
    wx: { getStorageSync() {}, getSystemInfoSync: () => ({}) }, require: createRequire(FILE), setTimeout, clearTimeout, console }, { filename: FILE });
  const page = Object.assign({}, def, { data: Object.assign({}, def.data, { style: 'pin' }), setData(p) { Object.assign(this.data, p); },
    selectComponent: (sel) => sel === '#pinSpin' ? { pause: () => { paused++; } } : null });
  page.onHide();
  assert.equal(paused, 1);
});
