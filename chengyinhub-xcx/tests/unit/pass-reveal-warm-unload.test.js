'use strict';
// L09-148:开通揭晓页卸载后,帧预热队列不再继续 getImageInfo。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const FILE = path.resolve(__dirname, '../../subpackagePass/reveal/index.js');

test('warm-up stops after unload', () => {
  let def; const infos = [];
  const wx = { getImageInfo: (o) => infos.push(o), getStorageSync() {}, setStorageSync() {}, getSystemInfoSync: () => ({}) };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => ({ globalData: {}, getUserID: () => 7 }), wx,
    require: createRequire(FILE), setTimeout, clearTimeout, console }, { filename: FILE });
  const page = Object.assign({}, def, { data: def.data, setData() {} });
  page._warm(false);
  assert.equal(infos.length, 2);
  page.onUnload();
  infos[0].complete(); infos[1].complete();
  assert.equal(infos.length, 2);
});
