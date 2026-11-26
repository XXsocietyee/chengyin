'use strict';
// L10-040:设置页 onShow 读已加载的灰度开关,不再每次重拉 /api/config/features。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function mount(app) {
  let def;
  const file = path.resolve(__dirname, '../../pages/shezhi/shezhi.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: (v) => { def = v; }, getApp: () => app,
    wx: { getStorageSync: () => '' }, require: createRequire(file), console, setTimeout, clearTimeout }, { filename: file });
  return Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(v) { Object.assign(this.data, v); } });
}

test('flags already loaded for this account are read, not refetched', () => {
  let loads = 0;
  const app = { globalData: { features: { userInvoice: true } }, getUserID: () => '7', _communityFeatureOwner: '7',
    loadFeatureFlags() { loads += 1; return Promise.resolve(); } };
  const page = mount(app);
  page.syncCommunityEntry();
  assert.equal(loads, 0);
  assert.equal(page.data.invoiceOn, true);
});

test('flags not loaded for the current account are fetched once', () => {
  let loads = 0;
  const app = { globalData: { features: {} }, getUserID: () => '8', _communityFeatureOwner: '7',
    loadFeatureFlags() { loads += 1; return Promise.resolve(); } };
  mount(app).syncCommunityEntry();
  assert.equal(loads, 1);
});
