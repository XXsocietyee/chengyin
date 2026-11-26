'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { load, post } = require('../helpers/community-square-vm');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function unguardedDecode(rel) {
  const hits = [];
  for (const file of walk(path.join(root, rel), [])) {
    if (!/\.(js|wxml|json)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const re = /decodeURIComponent\s*\(/g;
    let match;
    while ((match = re.exec(text))) {
      const before = text.slice(Math.max(0, match.index - 600), match.index);
      const tryAt = before.lastIndexOf('try');
      const catchAt = Math.max(before.lastIndexOf('catch'), before.lastIndexOf('finally'));
      if (tryAt < 0 || catchAt > tryAt) hits.push(path.relative(root, file) + ':' + match.index);
    }
  }
  return hits;
}

function mount(rel) {
  const file = path.join(root, rel);
  let definition;
  const requests = [];
  const tips = [];
  const modals = [];
  const app = {
    globalData: { user_id: 9 },
    getUserID: () => 9,
    getAuthorization: () => 'token',
    getToken: () => 'token',
    isDevEnv: () => false,
    canUseCommunity: () => true,
    getPageSize: () => 10,
    getAvatar: () => '',
    getNickname: () => '',
    tips: (message) => tips.push(message),
    goBack() {},
    recordConsent: () => Promise.resolve(),
    getRequestErrorMessage: (res, fallback) => (res && (res.msg || res.message)) || fallback,
    sendRequest(options) { requests.push(options); return { abort() {} }; },
  };
  const wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    navigateTo() {},
    navigateBack() {},
    showToast() {},
    showModal() {},
    showLoading() {},
    hideLoading() {},
  };
  const req = createRequire(file);
  vm.runInNewContext(read(rel), {
    Page: (value) => { definition = value; },
    Component: (value) => { definition = value; },
    getApp: () => app,
    wx,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    require: (id) => {
      if (id.endsWith('/utils/modal.js') || id.endsWith('/modal.js')) return { show: (options) => modals.push(options) };
      return req(id);
    },
  });
  const data = JSON.parse(JSON.stringify(definition.data || {}));
  const page = Object.assign({}, definition.methods || definition, {
    data,
    setData(patch) {
      for (const [key, value] of Object.entries(patch)) {
        const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
        let node = this.data;
        while (parts.length > 1) {
          const part = parts.shift();
          const next = parts[0];
          if (node[part] == null) node[part] = /^\d+$/.test(next) ? [] : {};
          node = node[part];
        }
        node[parts[0]] = value;
      }
    },
    triggerEvent() {},
    selectComponent: () => null,
  });
  return { page, requests, tips, modals, definition, app };
}

test('own comment appends one row and returning does not reload the post or comments', async () => {
  const h = load('detail');
  await h.ready(post(77, 1, { commentCount: 2 }), []);
  const gets = () => h.requests.filter((item) => item.method === 'GET' && item.url.endsWith('/comments')).length;
  const beforeGets = gets();
  h.page.setData({ commentContent: '刚写的一条', canComment: true });
  h.page.addComment();
  const command = h.asked('/api/v1/community/posts/77/comments').at(-1);
  command.success({ code: 200, data: { approvalState: 'VISIBLE', lifecycle: 'PUBLISHED', post: {} } });
  command.complete();
  await tick();
  assert.equal(h.page.data.list.length, 1);
  assert.equal(h.page.data.list[0].contents, '刚写的一条');
  assert.equal(h.page.data.list[0].pendingLocal, true);
  assert.equal(h.page.data.info.commentCount, 2);
  assert.equal(gets(), beforeGets);
  assert.equal(h.app.globalData.squareListDirtyVersion, undefined);
  assert.equal(h.app.globalData.squareListDirty, undefined);
  const count = h.requests.length;
  h.page.onShow();
  assert.equal(h.requests.length, count);
});

test('own like is local and returning does not reload the feed', async () => {
  const h = load('detail');
  await h.ready();
  h.page.lickClick({ currentTarget: { dataset: { type: 1 } } });
  const action = h.requests.filter((item) => item.url === '/api/v1/community/posts/77/actions').at(-1);
  assert.ok(action);
  action.success({ code: 200, data: post(77, 1, { viewerLiked: 1, likeCount: 4 }) });
  action.complete();
  await tick();
  assert.equal(h.page.data.info.isLiked, 1);
  assert.equal(h.app.globalData.squareListDirtyVersion, undefined);
  assert.equal(h.app.globalData.squareListDirty, undefined);
  const count = h.requests.length;
  h.page.onShow();
  assert.equal(h.requests.length, count);
});

test('refreshing comments that are already on screen keeps an inline error', async () => {
  const h = load('detail');
  await h.ready();
  h.page.getList(1, true);
  const refresh = h.asked('/api/v1/community/posts/77/comments').at(-1);
  refresh.fail({ errMsg: 'timeout' });
  await tick();
  assert.match(h.page.data.commentRefreshError, /网络/);
  assert.equal(h.page.data.commentsState, 'ready');
  assert.match(read('pages/square/detail/index.wxml'), /commentRefreshError/);
});

test('leaving the detail, template and activity list clears pending timers', () => {
  const detail = load('detail');
  detail.page._reportLeaveTimer = 41;
  detail.page._likeBurstTimer = 42;
  detail.page.onHide();
  assert.equal(detail.page._reportLeaveTimer, null);
  assert.equal(detail.page._likeBurstTimer, null);

  const template = mount('pages/template/index.js');
  template.page._scrollStopTimer = 7;
  const previousGetApp = global.getApp;
  const previousWx = global.wx;
  global.getApp = () => template.app;
  global.wx = { setNavigationBarColor() {}, setBackgroundColor() {} };
  try { template.page.onHide(); }
  finally {
    if (previousGetApp) global.getApp = previousGetApp; else delete global.getApp;
    if (previousWx) global.wx = previousWx; else delete global.wx;
  }
  assert.equal(template.page._scrollStopTimer, null);

  const list = mount('pages/activity/list/index.js');
  list.page._searchTimer = 8;
  list.page.onHide();
  assert.equal(list.page._searchTimer, null);
  assert.equal(list.page._hidden, true);
});

test('decodeURIComponent in the activity, square and template pages stays inside try', () => {
  assert.deepEqual(unguardedDecode('pages/activity'), []);
  assert.deepEqual(unguardedDecode('pages/square'), []);
  assert.deepEqual(unguardedDecode('pages/template'), []);
});

test('profile load failure stays on the signup page and keeps a chosen participant', () => {
  const h = mount('pages/activity/baoming/baoming.js');
  h.page.setData({
    pageState: 'ready',
    selectedAddress: { id: 7, fullName: '林一', mobilePhone: '13800138000' },
    userInfo: { realName: '林一', phone: '13800138000', email: '', point: 0 },
  });
  h.page.getUserInfo();
  h.requests.at(-1).fail();
  assert.match(h.page.data.profileError, /个人资料没加载出来/);
  assert.equal(h.page.data.userInfo.realName, '林一');
  assert.match(read('pages/activity/baoming/baoming.wxml'), /profileError/);
  assert.match(read('pages/activity/baoming/baoming.js'), /未扣款，可重试/);
  assert.match(read('pages/activity/baoming/baoming.js'), /支付结果待确认/);
});

test('a refused broadcast recovery stays on the card', () => {
  const h = mount('pages/activity/official-mine/index.js');
  h.page.data.broadcasts = [{ id: '9007199254740993', _canRecover: true }];
  h.page.recoverBroadcast({ currentTarget: { dataset: { index: 0 } } });
  h.modals[0].success({ confirm: true });
  h.requests[0].success({ code: 409, msg: '不会重发' });
  assert.equal(h.page.data.recoverError, '不会重发');
  assert.equal(h.page.data.recoverErrorIndex, 0);
  assert.ok(h.tips.includes('不会重发'));
  assert.match(h.requests[1].url, /\/stats$/);
  assert.match(read('pages/activity/official-mine/index.wxml'), /recoverError/);
});

test('one failed activity source keeps the rows that did load', () => {
  const h = mount('pages/square/components/cy/post-compose/index.js');
  h.page.loadActivityOptions();
  const joined = h.requests.find((item) => item.url === '/api/registration/list');
  const hosted = h.requests.find((item) => item.url === '/api/activity/list');
  joined.success({ code: 200, data: { rows: [{ ownerType: 2, cmsActivity: { id: 8, name: '夜跑' } }] } });
  hosted.fail();
  assert.equal(h.page.data.activityError, true);
  assert.equal(h.page.data.activityList.length, 1);
  assert.equal(h.page.data.activityList[0].name, '夜跑');
  assert.match(read('pages/square/components/cy/post-compose/index.wxml'), /有一部分活动没加载出来/);
});
