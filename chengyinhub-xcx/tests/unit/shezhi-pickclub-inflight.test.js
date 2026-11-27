'use strict';

// 成为俱乐部主理人:请求在途、以及跳转还没完成时,再点不得再发 /api/club/my。
// 人已经离开设置页之后,迟到的成功回包不得再把人拉进俱乐部页。

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PAGE_PATH = path.resolve(__dirname, '../../pages/shezhi/shezhi.js');

function loadPage() {
  const requests = [];
  const navigations = [];
  let definition = null;
  global.getApp = () => ({
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    getUserID: () => 7,
    setUserRole() {},
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest(options) { requests.push(options); return { abort() {} }; },
  });
  global.Page = (config) => { definition = config; };
  global.wx = {
    getStorageSync: () => '',
    setNavigationBarColor() {},
    setBackgroundColor() {},
    showLoading() {},
    hideLoading() {},
    showToast() {},
    navigateTo(options) { navigations.push(options); },
  };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
  });
  page.setData = function (patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  return { page, requests, navigations };
}

test('在途和跳转完成前再点,只发一次俱乐部查询', () => {
  const { page, requests, navigations } = loadPage();
  page.pickClub();
  page.pickClub();
  assert.equal(requests.length, 1);
  requests[0].success({ code: '200', data: { owned: [{ id: 9 }] } });
  requests[0].complete();
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, '/pages/club/detail/index?owner=1&tab=manage');
  page.pickClub();
  assert.equal(requests.length, 1, '跳转还没完成不得再查一次');
  navigations[0].complete();
  page.pickClub();
  assert.equal(requests.length, 2, '跳转结束后可以再点');
});

test('离开设置页后的成功回包不再跳进俱乐部', () => {
  const { page, requests, navigations } = loadPage();
  page.pickClub();
  page.onUnload();
  requests[0].success({ code: '200', data: { owned: [] } });
  requests[0].complete();
  assert.equal(navigations.length, 0);
});
