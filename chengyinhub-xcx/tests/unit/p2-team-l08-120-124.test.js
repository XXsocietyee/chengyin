'use strict';
// L08-120 首屏在离开期间回来仍要显示消息。
// L08-122 空位呼吸离开即停,没有空位不起。
// L08-124 不能收到合作邀请的玩家不请求 /api/coop/list;能收到的同一次打开不重复请求,下拉才再读。
const test = require('node:test');
const assert = require('node:assert/strict');

function boot(rel, appExtra) {
  let definition;
  const requests = [];
  const app = Object.assign({
    globalData: { authorization: 'session', statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '71',
    getAuthorization: () => 'session',
    getAvatar: () => '',
    getUserRole: () => '',
    getUserType: () => 1,
    tips() {},
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    sendRequest: (row) => requests.push(row),
  }, appExtra || {});
  global.getApp = () => app;
  global.wx = {
    getStorageSync() { return false; },
    setStorageSync() {},
    removeStorageSync() {},
    navigateBack() {},
    redirectTo() {},
    stopPullDownRefresh() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) }),
  };
  global.Page = (page) => { definition = page; };
  const file = require.resolve(rel);
  delete require.cache[file];
  require(file);
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data));
  page.setData = function (patch) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.');
      let target = this.data;
      while (parts.length > 1) {
        const part = parts.shift();
        target = target[part] = target[part] || {};
      }
      target[parts[0]] = value;
    }
  };
  return { page, requests };
}

const messageBody = {
  code: 200,
  data: { list: [{ id: 5, senderId: 8, content: '外滩夜行', createTime: '2026-11-22 10:00:00' }], hasMore: false },
};

test('L08-120 首屏读取在离开期间回来后仍显示消息', () => {
  const chat = boot('../../subpackageB/pages/im/chat/index.js', { getUserID: () => 9 });
  chat.page.onLoad({ conversationId: '11', type: '1' });
  chat.page.onShow();
  const first = chat.requests.find((row) => row.url === '/api/im/messages');
  chat.page.onHide();
  chat.page.onShow();
  first.success(messageBody);
  assert.equal(chat.page.data.loadState, 'ready');
  assert.equal(chat.page.data.msgs[0].content, '外滩夜行');
  chat.page.onUnload();
});

test('L08-120 首屏回包在后台到达,回到页面时线程不是空的', () => {
  const chat = boot('../../subpackageB/pages/im/chat/index.js', { getUserID: () => 9 });
  chat.page.onLoad({ conversationId: '11', type: '1' });
  chat.page.onShow();
  const first = chat.requests.find((row) => row.url === '/api/im/messages');
  chat.page.onHide();
  first.success(messageBody);
  assert.equal(chat.page.data.msgs[0].content, '外滩夜行');
  chat.page.onShow();
  assert.equal(chat.page.data.loadState, 'ready');
  assert.equal(chat.page.data.msgs[0].content, '外滩夜行');
  chat.page.onUnload();
});

test('L08-120 新的读取已经开始后,原来的回包不再画上', () => {
  const chat = boot('../../subpackageB/pages/im/chat/index.js', { getUserID: () => 9 });
  chat.page.onLoad({ conversationId: '11', type: '1' });
  chat.page.onShow();
  const first = chat.requests.find((row) => row.url === '/api/im/messages');
  chat.page.retryLoad();
  first.success(messageBody);
  assert.equal(chat.page.data.loadState, 'loading');
  assert.equal(chat.page.data.msgs.length, 0);
  chat.page.onUnload();
});

test('L08-120 已经离开的会话,回包不再画上', () => {
  const chat = boot('../../subpackageB/pages/im/chat/index.js', { getUserID: () => 9 });
  chat.page.onLoad({ conversationId: '11', type: '1' });
  chat.page.onShow();
  const first = chat.requests.find((row) => row.url === '/api/im/messages');
  chat.page.setData({ conversationId: 99 });
  first.success(messageBody);
  assert.equal(chat.page.data.loadState, 'loading');
  assert.equal(chat.page.data.msgs.length, 0);
  chat.page.onUnload();
});

test('L08-120 首屏失败后再回来可以重新读取', () => {
  const chat = boot('../../subpackageB/pages/im/chat/index.js', { getUserID: () => 9 });
  chat.page.onLoad({ conversationId: '11', type: '1' });
  chat.page.onShow();
  const first = chat.requests.find((row) => row.url === '/api/im/messages');
  chat.page.onHide();
  first.fail({ errMsg: 'timeout' });
  const before = chat.requests.filter((row) => row.url === '/api/im/messages').length;
  chat.page.onShow();
  assert.ok(chat.requests.filter((row) => row.url === '/api/im/messages').length > before);
  chat.page.onUnload();
});

test('L08-122 没有空位不呼吸,离开页面呼吸停止', () => {
  const detail = boot('../../pages/team/detail/index.js');
  detail.page.onLoad({ teamId: '12' });
  detail.page.onShow();
  assert.equal(detail.page._breath, undefined);
  detail.page.setData({ openSeats: [0] });
  detail.page._syncSeatBreath();
  assert.equal(typeof detail.page._breath, 'function');
  assert.ok(detail.page._seatBreathBeat);
  detail.page.onHide();
  assert.equal(detail.page._breath, null);
  assert.equal(detail.page._seatBreathBeat, null);
  detail.page.setData({ openSeats: [] });
  detail.page.onShow();
  assert.equal(detail.page._breath, null);
  detail.page.onUnload();
});

function coopCount(pageBox) {
  return pageBox.requests.filter((row) => row.url === '/api/coop/list').length;
}

test('L08-124 普通玩家打开消息页和下拉都不请求合作邀请', () => {
  const list = boot('../../subpackageB/pages/im/list/index.js');
  list.page.onLoad();
  list.page.onShow();
  list.page.onHide();
  list.page.onShow();
  list.page.onPullDownRefresh();
  assert.equal(coopCount(list), 0);
  list.page.onUnload();
});

test('L08-124 能收到邀请的账号只在进入和下拉时读取', () => {
  const list = boot('../../subpackageB/pages/im/list/index.js', { getUserRole: () => 'club' });
  list.page.onLoad();
  assert.equal(coopCount(list), 1);
  list.page.onShow();
  list.page.onHide();
  list.page.onShow();
  assert.equal(coopCount(list), 1);
  list.page.onPullDownRefresh();
  assert.equal(coopCount(list), 2);
  list.page.onUnload();
});

test('L08-124 商家账号即使当前角色字段为空也读取邀请', () => {
  const list = boot('../../subpackageB/pages/im/list/index.js', { getUserType: () => 2 });
  list.page.onLoad();
  assert.equal(coopCount(list), 1);
  list.page.onShow();
  assert.equal(coopCount(list), 1);
  list.page.onUnload();
});
