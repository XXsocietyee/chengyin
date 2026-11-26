'use strict';

// 2026-11-26 预发：发现 / 注销 / 资料 / 收藏这四页里仍然成立的返回重载、计时器、未知计数和异常原文。
const { describe, test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { safeUserMessage } = require('../../utils/transport/safe-user-message.js');

function setPath(target, dotted, value) {
  const parts = dotted.split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}); });
  cursor[parts.at(-1)] = value;
}

function later() { return new Promise((resolve) => setImmediate(resolve)); }

function walkJs(dir, out) {
  fs.readdirSync(dir).forEach((name) => {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walkJs(full, out);
    else if (name.endsWith('.js')) out.push(full);
  });
  return out;
}

describe('发现、注销、资料、收藏的返回与失败文案', { concurrency: 1 }, () => {
  test('这四页里的 decodeURIComponent 都必须包在 try 里', () => {
    const files = ['pages/deregister', 'pages/talent', 'pages/mylike', 'pages/gerenziliao']
      .reduce((out, rel) => walkJs(path.join(ROOT, rel), out), []);
    files.forEach((file) => {
      const text = fs.readFileSync(file, 'utf8');
      const pattern = /decodeURIComponent\s*\(/g;
      let match;
      while ((match = pattern.exec(text))) {
        const before = text.slice(Math.max(0, match.index - 400), match.index);
        assert.match(before, /try\s*\{/, path.relative(ROOT, file));
      }
    });
  });

  test('发现页 30 秒内回来不重拉俱乐部和未读，未知未读不写成 0', () => {
    const requests = [];
    let uid = 7;
    const app = {
      globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
      sendRequest(options) { requests.push(options); },
      getRequestErrorMessage(res, fallback) { return safeUserMessage(res, fallback); },
      getUserID() { return uid; },
      getUserRole() { return 'player'; },
      getUserType() { return 1; },
      getImgUrl(value) { return value || ''; },
    };
    global.getApp = () => app;
    global.Page = (page) => { global.__talentPage = page; };
    global.wx = {
      getStorageSync() { return ''; },
      getAppBaseInfo() { return { fontSizeSetting: 16 }; },
      setNavigationBarColor() {},
      setBackgroundColor() {},
      showToast() {},
      showModal() {},
      navigateTo() {},
      stopPullDownRefresh() {},
    };
    const modulePath = path.join(ROOT, 'pages/talent/list/index.js');
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
    const page = Object.assign({}, global.__talentPage, {
      data: JSON.parse(JSON.stringify(global.__talentPage.data)),
      setData(patch, callback) {
        Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
        if (callback) callback.call(this);
      },
    });
    const home = () => requests.filter((item) => item.url === '/api/club/home');
    const unread = () => requests.filter((item) => item.url === '/api/im/unread-total');

    page.onLoad({});
    assert.equal(home().length, 1);
    home()[0].success({
      code: '200',
      data: {
        owned: [{ id: 1, name: '夜行俱乐部' }],
        joined: [],
        nearby: [],
        leaderStatus: { isClubLeader: true, canCreate: true, ownedCount: 1, maxOwned: 3 },
      },
    });
    page.onShow();
    assert.equal(home().length, 1, '首次展示不再重拉刚读完的俱乐部首页');
    assert.equal(unread().length, 1);
    unread()[0].success({ code: 200, data: 4 });
    assert.equal(page.data.imUnread, 4);

    const beforeReturn = requests.length;
    page.onShow();
    assert.equal(requests.length, beforeReturn, '30 秒内返回不重拉俱乐部、未读和通票卡');

    page.onPullDownRefresh();
    assert.equal(home().length, 2, '下拉刷新不受 30 秒窗口限制');
    home().at(-1).success({
      code: '200',
      data: {
        owned: [{ id: 1, name: '夜行俱乐部' }],
        joined: [],
        nearby: [],
        leaderStatus: { isClubLeader: true, canCreate: true, ownedCount: 1, maxOwned: 3 },
      },
    });

    page.loadImUnread();
    unread().at(-1).success({ code: 200, data: null });
    assert.equal(page.data.imUnread, 4, 'null 不是 0');
    page.loadImUnread();
    unread().at(-1).success({ code: 200, data: { foo: 1 } });
    assert.equal(page.data.imUnread, 4, '没有 total/unread 的对象不是 0');
    page.loadImUnread();
    unread().at(-1).success({ code: 200, data: { total: 3 } });
    assert.equal(page.data.imUnread, 3);
    page.loadImUnread();
    unread().at(-1).success({ code: 200, data: 0 });
    assert.equal(page.data.imUnread, 0, '明确的 0 仍然清掉红点');

    page._clubHomeLoadedAt = Date.now() - 31000;
    page._imUnreadAt = Date.now() - 31000;
    page.onShow();
    assert.equal(home().length, 3);
    assert.ok(unread().length > 1);
    page.onShow();
    assert.equal(home().length, 3, '同一账号加载中不另起一轮');

    uid = 9;
    page.onShow();
    assert.equal(home().length, 4, '换账号必须重拉');
  });

  test('发现页游客目录在途时再进页面不会再发一次', () => {
    const requests = [];
    const app = {
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      sendRequest(options) { requests.push(options); },
      getRequestErrorMessage(res, fallback) { return safeUserMessage(res, fallback); },
      getUserID() { return ''; },
      getUserRole() { return ''; },
      getUserType() { return 0; },
      getImgUrl(value) { return value || ''; },
    };
    global.getApp = () => app;
    global.Page = (page) => { global.__talentGuest = page; };
    global.wx = {
      getStorageSync() { return ''; },
      getAppBaseInfo() { return {}; },
      setNavigationBarColor() {},
      setBackgroundColor() {},
      showToast() {},
      stopPullDownRefresh() {},
    };
    const modulePath = path.join(ROOT, 'pages/talent/list/index.js');
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
    const page = Object.assign({}, global.__talentGuest, {
      data: JSON.parse(JSON.stringify(global.__talentGuest.data)),
      setData(patch, callback) {
        Object.entries(patch).forEach(([key, value]) => setPath(this.data, key, value));
        if (callback) callback.call(this);
      },
    });
    page.onLoad({});
    page.onShow();
    page.onShow();
    const lists = requests.filter((item) => item.url === '/api/club/list');
    assert.equal(lists.length, 1);
    assert.equal(requests.some((item) => item.url === '/api/club/home'), false);
    assert.equal(requests.some((item) => item.url === '/api/im/unread-total'), false);
  });

  test('注销页离开再回来保留验证码，阻断仍然不能申请，异常原文不展示', async () => {
    const COMPONENT = path.join(ROOT, 'pages/deregister/components/scene-settings-deregister/index.js');
    const FLOW = path.join(ROOT, 'pages/deregister/deregister-flow.js');
    const requests = [];
    let actor = 7;
    let consentResult = () => Promise.resolve();
    global.getApp = () => ({
      globalData: {},
      getUserID: () => actor,
      recordConsent: () => consentResult(),
      sendRequest: (request) => { requests.push(request); },
    });
    global.wx = { showToast() {}, navigateTo() {}, showModal(options) { options.success({ confirm: true }); }, login() {} };
    global.Component = (config) => { global.__deregisterComponent = config; };
    delete require.cache[require.resolve(COMPONENT)];
    delete require.cache[require.resolve(FLOW)];
    require(COMPONENT);
    const component = global.__deregisterComponent;

    function makePage(extra) {
      const page = Object.assign({}, component.methods, {
        data: JSON.parse(JSON.stringify(component.data)),
      });
      Object.assign(page.data, { status: 'ELIGIBLE', verificationMethod: 'SMS' }, extra || {});
      page.setData = (patch, callback) => { Object.assign(page.data, patch); if (callback) callback(); };
      return page;
    }

    const kept = makePage();
    kept._statusMemberId = '7';
    kept._applyRequestId = 'same-fill';
    kept.sendSms();
    requests.find((item) => item.url === '/api/user/info').success({ code: 200, data: { phone: '13800138000' } });
    requests.find((item) => item.url === '/api/sms/send').success({ code: 200 });
    kept.setData({ smscode: '654321', confirmed: true });
    component.pageLifetimes.hide.call(kept);
    component.pageLifetimes.show.call(kept);
    assert.equal(kept.data.smsSent, true);
    assert.equal(kept.data.phoneMasked, '8000');
    assert.equal(kept.data.smscode, '654321');
    assert.equal(kept.data.confirmed, true);
    assert.equal(kept.data.status, 'ELIGIBLE');
    assert.equal(kept._applyRequestId, 'same-fill', '安静回读不另开一次填写');
    const status = requests.filter((item) => item.url === '/api/user/deregister/status').at(-1);
    status.success({ code: 200, data: { status: 'NORMAL' } });
    requests.filter((item) => item.url === '/api/user/deregister/precheck').at(-1).success({
      code: 200,
      data: { status: 'ELIGIBLE', blockers: [], verificationMethod: 'SMS' },
    });
    assert.equal(kept.data.smscode, '654321');
    assert.equal(kept.data.phoneMasked, '8000');
    assert.equal(kept.data.canApply, true);

    const blocked = makePage({ phone: '13800138000', phoneMasked: '8000', smscode: '654321', confirmed: true, canApply: true });
    blocked._statusMemberId = '7';
    component.pageLifetimes.hide.call(blocked);
    component.pageLifetimes.show.call(blocked);
    requests.filter((item) => item.url === '/api/user/deregister/status').at(-1).success({ code: 200, data: { status: 'NORMAL' } });
    requests.filter((item) => item.url === '/api/user/deregister/precheck').at(-1).success({
      code: 200,
      data: { status: 'BLOCKED', blockers: ['还有未完成的订单'], verificationMethod: 'SMS' },
    });
    assert.equal(blocked.data.status, 'BLOCKED');
    assert.deepEqual(blocked.data.blockers, ['还有未完成的订单']);
    assert.equal(blocked.data.canApply, false);
    const applyCount = requests.filter((item) => item.url === '/api/user/deregister/apply').length;
    blocked.apply();
    await later();
    assert.equal(requests.filter((item) => item.url === '/api/user/deregister/apply').length, applyCount);

    const malformed = makePage({ blockers: ['还有未完成的订单'], status: 'BLOCKED' });
    malformed._statusMemberId = '7';
    malformed.loadStatus({ quiet: true });
    requests.filter((item) => item.url === '/api/user/deregister/status').at(-1).success({ code: 200, data: { status: 'NORMAL' } });
    requests.filter((item) => item.url === '/api/user/deregister/precheck').at(-1).success({
      code: 200,
      data: { status: 'BLOCKED', blockers: [] },
    });
    assert.equal(malformed.data.status, 'BLOCKED');
    assert.deepEqual(malformed.data.blockers, ['还有未完成的订单'], '坏的阻断列表不能把已阻断的人放成可注销');

    const strict = makePage();
    strict.loadStatus();
    requests.filter((item) => item.url === '/api/user/deregister/status').at(-1).success({ code: 200, data: { status: 'NORMAL' } });
    requests.filter((item) => item.url === '/api/user/deregister/precheck').at(-1).success({
      code: 200,
      data: { status: 'BLOCKED', blockers: [] },
    });
    assert.equal(strict.data.status, 'ERROR');
    assert.equal(strict.data.canApply, false);

    const exploded = makePage();
    exploded.loadStatus();
    requests.filter((item) => item.url === '/api/user/deregister/status').at(-1).success({
      code: 500,
      msg: 'java.lang.IllegalStateException: boom at com.foo.Bar.baz(Bar.java:1)',
    });
    assert.equal(exploded.data.status, 'ERROR');
    assert.doesNotMatch(exploded.data.statusError, /IllegalState|java\.lang|boom|Bar\.java/);
    assert.match(exploded.data.statusError, /开小差|重试|读取/);

    const smsPage = makePage();
    smsPage.sendSms();
    requests.filter((item) => item.url === '/api/user/info').at(-1).success({ code: 200, data: { phone: '13800138000' } });
    requests.filter((item) => item.url === '/api/sms/send').at(-1).success({
      code: 500,
      msg: 'java.lang.IllegalStateException: sms boom',
    });
    assert.doesNotMatch(smsPage.data.smsError, /IllegalState|java\.lang|boom/);

    const wechat = makePage({ verificationMethod: 'WECHAT', confirmed: true });
    const originalTimeout = global.setTimeout;
    global.setTimeout = (fn) => { global.__wechatFire = fn; return 42; };
    try {
      wechat.apply();
      await later();
      assert.equal(wechat._wechatConfirmTimer, 42);
      component.pageLifetimes.hide.call(wechat);
      assert.equal(wechat._wechatConfirmTimer, null);
      global.__wechatFire();
      await later();
      assert.equal(wechat.data.applyError, '');
      assert.equal(requests.filter((item) => item.url === '/api/user/deregister/apply').includes(undefined), false);
    } finally {
      global.setTimeout = originalTimeout;
    }
  });

  test('资料页选图返回不重拉，离开清掉计时器，异常原文不进错误区', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const requests = [];
      const navigations = [];
      global.getApp = () => ({
        globalData: {},
        getUserID: () => 7,
        tips() {},
        setNickname() {},
        setAvatar() {},
        getImgUrl(value) { return value || ''; },
        sendRequest(options) { requests.push(options); return { abort() {} }; },
      });
      global.Page = (config) => { global.__profilePage = config; };
      global.getCurrentPages = () => [{}, {}];
      global.wx = {
        getStorageSync() { return ''; },
        showToast() {},
        hideToast() {},
        navigateBack() { navigations.push('back'); },
        switchTab() {},
        hideLoading() {},
        showLoading() {},
      };
      const modulePath = path.join(ROOT, 'pages/gerenziliao/gerenziliao.js');
      delete require.cache[require.resolve(modulePath)];
      require(modulePath);
      const page = Object.assign({}, global.__profilePage, {
        data: JSON.parse(JSON.stringify(global.__profilePage.data)),
        selectComponent() { return null; },
        setData(patch, callback) {
          Object.keys(patch).forEach((key) => setPath(this.data, key, valueOf(patch, key)));
          if (callback) callback.call(this);
        },
      });
      function valueOf(patch, key) { return patch[key]; }

      page.onLoad({});
      requests.find((item) => item.url === '/api/user/info').success({
        code: '200',
        data: { name: '甲', introduction: '原来', phone: '' },
      });
      page.setData({ tempIntroduction: '草稿没提交' });
      const infoCount = requests.filter((item) => item.url === '/api/user/info').length;
      page.onHide();
      page.onShow();
      assert.equal(requests.filter((item) => item.url === '/api/user/info').length, infoCount);
      assert.equal(page.data.tempIntroduction, '草稿没提交');
      assert.equal(page.data.userInfo.name, '甲');

      page.openPop4();
      page.onInputChange({ currentTarget: { dataset: { field: 'name' } }, detail: { value: '新名字' } });
      assert.equal(page.data.nicknameState, 'checking');
      page.onHide();
      assert.equal(page._nicknameTimer, null);
      mock.timers.tick(400);
      assert.equal(requests.filter((item) => item.url === '/api/user/nickname/check').length, 0);
      page.onShow();

      page.setData({ saveSucceeded: true, loaded: true });
      page.scheduleProfileReturn();
      assert.ok(page._profileReturnTimer);
      page.onHide();
      assert.equal(page._profileReturnTimer, null);
      mock.timers.tick(2000);
      assert.equal(navigations.length, 0);

      const broken = Object.assign({}, global.__profilePage, {
        data: JSON.parse(JSON.stringify(global.__profilePage.data)),
        selectComponent() { return null; },
        setData(patch, callback) {
          Object.keys(patch).forEach((key) => setPath(this.data, key, patch[key]));
          if (callback) callback.call(this);
        },
      });
      broken.onLoad({});
      requests.filter((item) => item.url === '/api/user/info').at(-1).success({
        code: 500,
        msg: 'java.lang.IllegalStateException: boom at com.foo.Bar.baz(Bar.java:1)',
      });
      assert.doesNotMatch(broken.data.loadErrorSub, /IllegalState|java\.lang|boom|Bar\.java/);
      assert.match(broken.data.loadErrorSub, /开小差|重新加载|重试/);

      broken.data.loaded = true;
      broken.data.canSave = true;
      broken.data.userInfo.name = '甲';
      broken._loadedProfileName = '甲';
      broken._hidden = false;
      broken.saveInfo();
      requests.filter((item) => item.url === '/api/user/update').at(-1).success({
        code: 500,
        msg: 'java.lang.IllegalStateException: save boom',
        errorCode: 'OTHER',
      });
      assert.doesNotMatch(broken.data.saveError, /IllegalState|java\.lang|boom/);

      broken.data.canSave = true;
      broken.data.saving = false;
      broken.data.saveSucceeded = false;
      broken.saveInfo();
      requests.filter((item) => item.url === '/api/user/update').at(-1).success({
        code: 409,
        msg: '昵称已被占用，请选择建议昵称',
        errorCode: 'NICKNAME_TAKEN',
      });
      assert.equal(broken.data.saveError, '昵称已被占用，请选择建议昵称');
    } finally {
      mock.timers.reset();
    }
  });

  test('收藏取消失败不把异常原文弹给用户', () => {
    const requests = [];
    const toasts = [];
    global.getApp = () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      getUserID: () => '7',
      getRequestErrorMessage(res, fallback) { return safeUserMessage(res, fallback); },
      sendRequest(options) { requests.push(options); },
    });
    global.Page = (config) => { global.__mylikePage = config; };
    global.wx = {
      getStorageSync() { return ''; },
      setNavigationBarColor() {},
      setBackgroundColor() {},
      showToast(options) { toasts.push(options.title); },
      showModal(options) { options.success({ confirm: true }); },
    };
    const modulePath = path.join(ROOT, 'pages/mylike/mylike.js');
    delete require.cache[require.resolve(modulePath)];
    require(modulePath);
    const page = Object.assign({}, global.__mylikePage, {
      data: JSON.parse(JSON.stringify(global.__mylikePage.data)),
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
    });
    page.setData({ ztList1: [{ id: 11 }] });
    page.topicUnlike({ currentTarget: { dataset: { id: 11 } } });
    requests.find((item) => item.url === '/api/topic/like').success({
      code: 500,
      msg: 'java.lang.NullPointerException: x',
    });
    assert.equal(toasts.length, 1);
    assert.doesNotMatch(toasts[0], /NullPointer|java\.lang/);
    assert.match(toasts[0], /开小差|操作失败|重试/);
  });
});
