const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const { staffErrorText } = require('../../pages/merchant/utils/staff-error.js');
const { safeDecode } = require('../../utils/safe-decode.js');
const { buildActiveSubscriptions } = require('../../pages/merchant/utils/merchant-subscription-view.js');
const { pageContinues } = require('../../pages/merchant/verify-records/view-model.js');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('坏百分号解码不抛，关系链和资料壳都走 safeDecode', () => {
  assert.equal(safeDecode('%E4%B8%BB%E9%A2%98'), '主题');
  assert.doesNotThrow(() => safeDecode('%'));
  assert.equal(safeDecode('%'), '%');
  const relation = read('pages/merchant/relation/index.js');
  assert.match(relation, /safeDecode\(options\.topicName\)/);
  assert.doesNotMatch(relation, /decodeURIComponent\(options\.topicName\)/);
  const profile = read('pages/merchant/profile/index.js');
  assert.match(profile, /function safeDecode\(value\) \{\s*try \{ return decodeURIComponent/);
});

test('店员可见错误挡住异常原文，短业务文案留下', () => {
  assert.equal(staffErrorText(new Error('TypeError: Cannot read properties of undefined'), '加载失败'), '加载失败');
  assert.equal(staffErrorText({ message: 'java.lang.NullPointerException: boom' }, '核销详情加载失败'), '核销详情加载失败');
  assert.equal(staffErrorText({ errMsg: 'request:fail timeout' }, '结算详情加载失败'), '结算详情加载失败');
  assert.equal(staffErrorText({ msg: '语音服务未开通' }, '加载失败'), '语音服务未开通');
  assert.equal(staffErrorText({ message: '请求失败，请重试' }, '加载失败'), '请求失败，请重试');
  assert.doesNotMatch(read('pages/merchant/decor/ai-npc/index.js'), /setData\(\{[^}]*:\s*e\.message\s*\}/);
  assert.doesNotMatch(read('pages/merchant/ledger/order-detail/index.js'), /error\.message/);
  assert.doesNotMatch(read('pages/merchant/ledger/batch-detail/index.js'), /error\.message/);
});

test('未知次数不当成 0，明确的 0 仍然是 0', () => {
  const unknown = buildActiveSubscriptions([
    { id: 8, subscriptionType: 'city_node', endDate: null, maxUsage: 5, usedCount: null, isActive: 1 },
  ], []);
  assert.equal(unknown[0].usage, '');
  const zero = buildActiveSubscriptions([
    { id: 9, subscriptionType: 'city_node', endDate: null, maxUsage: 5, usedCount: 0, isActive: 1 },
  ], []);
  assert.equal(zero[0].usage, '已用 0/5 次');

  assert.equal(pageContinues(50, 50, undefined, 50), true);
  assert.equal(pageContinues(50, 50, null, 50), true);
  assert.equal(pageContinues(50, 50, 0, 50), false);
  assert.equal(pageContinues(50, 50, 120, 50), true);
  assert.equal(pageContinues(12, 12, undefined, 50), false);
});

function loadPage(rel, userIdBox) {
  const requests = [];
  let config = null;
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, merchantWorkbenchStale: false },
    getSession: () => ({ getRevision: () => 0 }),
    getUserID: () => userIdBox.id,
    getAuthorization: () => 'token',
    setUserRole() {},
    setUserType() {},
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest(request) {
      requests.push(request);
      return { abort() {} };
    },
  };
  global.getApp = () => app;
  global.getCurrentPages = () => [{}];
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    removeStorageSync() {},
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    setNavigationBarColor() {},
    setBackgroundColor() {},
    showLoading() {},
    hideLoading() {},
    showToast() {},
    stopPullDownRefresh() {},
    switchTab() {},
    navigateTo() {},
    reLaunch() {},
    redirectTo() {},
    navigateBack() {},
    chooseLocation(options) { requests.push({ url: 'chooseLocation', options }); },
    chooseMedia(options) { requests.push({ url: 'chooseMedia', options }); },
    previewImage() {},
  };
  global.Page = (value) => { config = value; };
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  require(abs);
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function setData(patch, callback) {
    Object.entries(patch || {}).forEach(([key, value]) => {
      const parts = key.split('.');
      let cursor = this.data;
      parts.slice(0, -1).forEach((part) => { cursor = cursor[part] || (cursor[part] = {}); });
      cursor[parts.at(-1)] = value;
    });
    if (callback) callback();
  };
  return { page, requests, app };
}

test('工作台：选择器返回不重读全部数据集，换了登录人仍重读', () => {
  const user = { id: 11 };
  const { page, requests } = loadPage('pages/merchant/index/index.js', user);
  page.data.manualChoice = { show: false, title: '', items: [] };
  page.data.sceneCurrent = null;
  const plainEpoch = page._verificationEpoch || 0;
  page.onHide();
  page.onShow();
  assert.ok((page._verificationEpoch || 0) > plainEpoch, '普通返回仍要推进核销代际');
  assert.ok(requests.some((item) => item.url === '/api/merchant/access/me'));

  const afterPlain = requests.length;
  const epochAfterPlain = page._verificationEpoch;
  page.data.sceneCurrent = { id: 'merchant-chapter-picker' };
  page.onHide();
  page.onShow();
  assert.equal(requests.length, afterPlain, '同一主体从章节选择回来不得再打身份和数据集');
  assert.equal(page._verificationEpoch, epochAfterPlain);

  page.data.sceneCurrent = { id: 'merchant-station-picker' };
  page.onHide();
  user.id = 22;
  page.onShow();
  assert.ok(requests.length > afterPlain, '选择器期间换了登录人必须重走身份链');
  assert.ok((page._verificationEpoch || 0) > epochAfterPlain);
});

test('主办总数未知时保持空，明确 0 仍是 0', () => {
  const user = { id: 11 };
  const { page, requests } = loadPage('pages/merchant/index/index.js', user);
  page._dataEpoch = 1;
  page.data.joinLoading = false;
  page.data.joinError = false;
  page.data.merchantAccess = { canManageProjects: true };
  page.loadHostProjects(1);
  const host = requests.find((item) => item.url === '/api/project/my');
  host.success({ code: 200, data: { rows: [], activeTotal: null } });
  assert.equal(page.data.hostProjectTotal, null);
  assert.equal(page.data.projectTotalKnown, false);

  page.loadHostProjects(1);
  const again = requests.filter((item) => item.url === '/api/project/my').at(-1);
  again.success({ code: 200, data: { rows: [], activeTotal: 0 } });
  assert.equal(page.data.hostProjectTotal, 0);
  assert.equal(page.data.projectTotalKnown, true);
  assert.match(read('pages/merchant/index/index.wxml'), /\{\{joinTotal \+ hostProjectTotal\}\}/);
});

test('竞猜人数未知不写成还没有人，0 仍写还没有人', () => {
  const user = { id: 11 };
  const { page, requests } = loadPage('pages/merchant/predict/index.js', user);
  page._accessEpoch = 1;
  page.loadInbox();
  const inbox = requests.find((item) => item.url === '/api/merchant/predict/inbox');
  inbox.success({
    code: 200,
    data: [
      { nodeId: 1, playDay: '2026-11-26', betCount: null, daysLeft: 2, options: [{ key: 'a' }] },
      { nodeId: 2, playDay: '2026-11-26', betCount: 0, daysLeft: 2, options: [{ key: 'a' }] },
      { nodeId: 3, playDay: '2026-11-26', betCount: 4, daysLeft: 2, options: [{ key: 'a' }] },
    ],
  });
  assert.equal(page.data.items[0].betText, '');
  assert.equal(page.data.items[0].betCount, null);
  assert.equal(page.data.items[1].betText, '这一轮还没有人选');
  assert.equal(page.data.items[2].betText, '4 个人选了这一轮');
});

test('离开页面时清掉还在走的计时器', async () => {
  const user = { id: 11 };
  const relation = loadPage('pages/merchant/relation/index.js', user);
  let relationFired = false;
  relation.page._feedSlowTimer = setTimeout(() => { relationFired = true; }, 40);
  relation.page.onHide();
  const customer = loadPage('pages/merchant/customer/index.js', user);
  let customerFired = false;
  customer.page._debounce = setTimeout(() => { customerFired = true; }, 40);
  customer.page._dirty = false;
  customer.page.onHide();
  assert.equal(customer.page._dirty, true);
  const workbench = loadPage('pages/merchant/index/index.js', user);
  let revenueFired = false;
  workbench.page._revHoldTimer = setTimeout(() => { revenueFired = true; }, 40);
  workbench.page.data.sceneCurrent = null;
  workbench.page.data.manualChoice = { show: false };
  workbench.page.onHide();
  const decor = loadPage('pages/merchant/decor/index.js', user);
  let decorFired = false;
  decor.page._categoryLoadingTimer = setTimeout(() => { decorFired = true; }, 40);
  decor.page._backGuardTimer = setTimeout(() => { decorFired = true; }, 40);
  decor.page.onUnload();
  const perks = loadPage('pages/merchant/decor/perks/index.js', user);
  let perksFired = false;
  perks.page._backGuardTimer = setTimeout(() => { perksFired = true; }, 40);
  perks.page.onUnload();
  await delay(70);
  assert.equal(relationFired, false);
  assert.equal(customerFired, false);
  assert.equal(revenueFired, false);
  assert.equal(decorFired, false);
  assert.equal(perksFired, false);
});

test('选点返回不重拉资料，换了登录人仍重拉', () => {
  const user = { id: 11 };
  const { page, requests } = loadPage('pages/merchant/decor/index.js', user);
  page._loadedOnce = true;
  page.data.view = 'home';
  page.data.merchantAccess = { canWriteProfile: true };
  page.data.chipSheet = { show: false };
  page.data.hoursOpen = false;
  page.data.fieldSheet = { show: false };
  page._pickerMember = '11';
  page._systemPickerOpen = true;
  page.onHide();
  page.onShow();
  assert.equal(requests.length, 0, '同一主体从地图选点回来不得重拉资料');

  page._pickerMember = '11';
  page._systemPickerOpen = true;
  page.onHide();
  user.id = 22;
  page.onShow();
  assert.ok(requests.length > 0, '选点期间换了登录人必须重拉');
});
