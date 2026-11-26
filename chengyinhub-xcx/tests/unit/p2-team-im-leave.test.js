'use strict';
// 离开队伍页 / 消息页必须清掉还在走的计时器。轮询在 onHide / onUnload 里本来就会停。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function boot(rel, appExtra) {
  let definition;
  const requests = [];
  const app = Object.assign({
    globalData: { authorization: 'session' },
    getUserID: () => '71',
    getAuthorization: () => 'session',
    getAvatar: () => '',
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
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375 }),
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

test('team detail and join drop the entrance timer when the page leaves', () => {
  const detail = boot('../../pages/team/detail/index.js');
  detail.page.onLoad({ teamId: '12' });
  detail.page.onShow();
  detail.requests[0].success({ code: 200, data: { team: { id: '12', status: 0, title: '夜行' }, members: [], joined: true, leader: false } });
  assert.ok(detail.page._seatInTimer, '入场计时器已经排上');
  detail.page.onHide();
  assert.equal(detail.page._seatInTimer, null);
  assert.equal(detail.page.data.seatIn, 0);
  detail.page.onShow();
  const again = detail.requests.at(-1);
  again.success({ code: 200, data: { team: { id: '12', status: 0, title: '夜行' }, members: [], joined: true, leader: false } });
  assert.equal(detail.page._seatInTimer, null, 'once 入场不会在返回时再排一个计时器');

  const join = boot('../../pages/team/join/index.js');
  join.page.onLoad({ code: 'invite-code' });
  join.requests[0].success({ code: 200, data: { team: { id: '12', status: 0 }, joined: false } });
  assert.ok(join.page._seatInTimer);
  join.page.onUnload();
  assert.equal(join.page._unloaded, true);
  assert.equal(join.page._seatInTimer, null);
});

test('IM list and chat drop motion, scroll, search and poll timers on leave', () => {
  const list = boot('../../subpackageB/pages/im/list/index.js');
  list.page.onLoad();
  list.requests.filter((row) => row.url === '/api/im/conversations').at(-1).success({ code: 200, data: [] });
  assert.ok(list.page._pmListTimer);
  list.page.onUnload();
  assert.equal(list.page._unloaded, true);
  assert.equal(list.page._pmListTimer, null);

  const chat = boot('../../subpackageB/pages/im/chat/index.js', { getUserID: () => 1 });
  chat.page.onLoad({ conversationId: '11', type: '1', name: '%E5%A4%9C%E8%A1%8C' });
  assert.equal(chat.page.data.name, '夜行');
  chat.page.onShow();
  assert.ok(chat.page._poll);
  chat.page.setData({ routePickerOpen: true, loadState: 'ready' });
  chat.page.onRouteSearch({ detail: { value: '外滩' } });
  assert.ok(chat.page._routeTimer);
  chat.page.scrollBottom();
  assert.ok(chat.page._scrollTimer);
  chat.page.onHide();
  assert.equal(chat.page._poll, null);
  assert.equal(chat.page._routeTimer, null);
  assert.equal(chat.page._scrollTimer, null);
  assert.equal(chat.page.data.routePickerOpen, false);
  chat.page.onShow();
  chat.page.scrollBottom();
  assert.ok(chat.page._scrollTimer);
  chat.page.onUnload();
  assert.equal(chat.page._poll, null);
  assert.equal(chat.page._scrollTimer, null);
});
