'use strict';
// L10-064 / L10-068:onLaunch 不在无页面时设导航栏色;启动时藏一次 tab 位(2026-11-24 复核恢复,冷启动直达任一 tab 页不留空条);窗口/胶囊读失败也照样建好 globalData。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '../..');

function launch(wxPatch) {
  const calls = [];
  const storage = new Map();
  const wx = Object.assign({
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release', version: '1.0.0' } }),
    getExtConfigSync: () => ({}),
    getStorageSync: (k) => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: (k) => storage.delete(k),
    getWindowInfo: () => ({ statusBarHeight: 30, windowWidth: 375 }),
    getMenuButtonBoundingClientRect: () => ({ width: 87, height: 32, top: 34, right: 360, bottom: 66, left: 273 }),
    hideTabBar: () => calls.push('hideTabBar'),
    setNavigationBarColor: () => calls.push('setNavigationBarColor'),
    getUpdateManager: () => ({ onCheckForUpdate() {}, onUpdateReady() {}, onUpdateFailed() {} }),
    onNetworkStatusChange() {}, getNetworkType() {}, onMemoryWarning() {},
    showToast() {}, hideToast() {},
  }, wxPatch);
  let config;
  const ctx = { App: (c) => { config = c; }, getApp: () => config, getCurrentPages: () => [], wx, Promise, setTimeout, clearTimeout, console,
    require: (r) => (r.startsWith('.') ? require(path.join(ROOT, r)) : require(r)) };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
  config.appInitial = () => Promise.resolve();
  config.initPrivacyAuthorization = () => {};
  config.getSession = () => ({ restore() {}, clearSession() {}, getAuthorization: () => '', getUserID: () => '' });
  config.onLaunch({ query: {} });
  return { app: config, calls };
}

test('onLaunch 藏一次 tab 位(冷启动直达漫游 / 达人 / 我的也不留空条),不在没有页面时设原生导航栏色', () => {
  const { calls } = launch();
  assert.equal(calls.filter((c) => c === 'hideTabBar').length, 1);
  assert.deepEqual(calls.filter((c) => c === 'setNavigationBarColor'), []);
});

test('窗口信息与胶囊读取抛错时,globalData 仍然完整建立', () => {
  const { app } = launch({ getWindowInfo: () => { throw new Error('pc'); }, getMenuButtonBoundingClientRect: () => null });
  assert.ok(app.globalData.siteBaseUrl, '没有 siteBaseUrl 所有请求都会失败');
  assert.equal(app.globalData.statusBarHeight, 20);
  assert.equal(app.globalData.menuButtonInfo.height, 32);
});
