const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');

const PAGE_PATH = '../../pages/merchant/index/index.js';

let app;
let pageConfig;
let requests;
let userId;
let loadingVisible;
let abortCount;

beforeEach(() => {
  requests = [];
  userId = 11;
  loadingVisible = false;
  abortCount = 0;
  pageConfig = null;
  app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getSession: () => ({ getRevision: () => 0 }),
    getUserID: () => userId,
    setUserRole() {},
    setUserType() {},
    getRequestErrorMessage: (response, fallback) => (response && response.msg) || fallback,
    sendRequest(request) {
      requests.push(request);
      return { abort() { abortCount += 1; } };
    },
  };
  global.getApp = () => app;
  global.getCurrentPages = () => [];
  const persisted = {};
  global.wx = {
    getStorageSync: key => persisted[key],
    setStorageSync(key, value) { persisted[key] = JSON.parse(JSON.stringify(value)); },
    removeStorageSync(key) { delete persisted[key]; },
    scanCode({ success }) {
      success({ result: JSON.stringify({ type: 'topic', code: 'OLD-TICKET' }) });
    },
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'release' } }),
    setNavigationBarColor() {},
    setBackgroundColor() {},
    showLoading() { loadingVisible = true; },
    hideLoading() { loadingVisible = false; },
    showToast() {},
    switchTab() {},
    navigateTo() {},
    reLaunch() {},
  };
  global.Page = (config) => { pageConfig = config; };
  delete require.cache[require.resolve(PAGE_PATH)];
  require(PAGE_PATH);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = function setData(patch, callback) {
    Object.assign(this.data, patch);
    if (callback) callback();
  };
  page._dataEpoch = 1;
  page._merchantScopeKey = '11:101';
  page.data.chapterSheet = { show: true, code: 'OLD-TICKET', items: [{ id: 7, name: '旧商家章节' }] };
  page.data.stationSheet = {
    show: true,
    code: 'OLD-TICKET',
    items: [{ registrationMerchantId: 9, name: '旧商家节点' }],
  };
  page.data.verificationResult = { show: true, state: 'success', title: '旧回执', message: '旧商家核销成功' };
  return page;
}

function startVerificationThenSwitchMerchant(page) {
  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  assert.ok(verificationRequest, '扫码后必须发起核销请求');

  userId = 22;
  page.onShow();
  const identityRequest = requests.find((request) => request.url === '/api/merchant/access/me');
  assert.ok(identityRequest, '切换账号后必须重新确认商家身份');
  identityRequest.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 202, name: '新店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage'],
    },
  });
  assert.equal(page._merchantScopeKey, '22:202');
  assert.equal(page.data.sceneCurrent, null, '切换主体时先清空旧场景');
  assert.equal(loadingVisible, false, '旧核销作废时必须收起全局 loading');
  return verificationRequest;
}

test('切换商家后，旧核销响应不得打开上一商家的选章或结果场景', () => {
  const lateResponses = [
    {
      code: 500,
      msg: '请选择要核销的章节',
      data: { needChapterChoice: true, chapters: [{ id: 7, name: '旧商家章节' }] },
    },
    { code: 200, msg: '旧商家核销成功', data: {} },
  ];

  for (const [index, response] of lateResponses.entries()) {
    wx.scanCode = ({ success }) => success({ result: JSON.stringify({ type: 'topic', code: 'synthetic-case-' + index }) });
    requests = [];
    userId = 11;
    const page = makePage();
    const verificationRequest = startVerificationThenSwitchMerchant(page);

    verificationRequest.success(response);

    assert.equal(page.data.sceneCurrent, null, '迟到回调不能在新账号上打开场景');
    assert.deepEqual(page.data.chapterSheet.items, [], '不得泄漏上一商家的候选章节');
    assert.deepEqual(page.data.stationSheet.items, [], '不得泄漏上一商家的候选节点');
    assert.equal(page.data.verificationResult.show, false, '不得显示上一商家的核销回执');
  }
});

test('同一商家开始新一轮页面数据后，上一轮核销回调也必须失效', () => {
  const page = makePage();
  page.data.chapterSheet = { show: false, code: '', items: [] };
  page.data.stationSheet = { show: false, code: '', items: [] };
  page.data.verificationResult = { show: false, state: '', title: '', message: '' };

  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  assert.ok(verificationRequest);

  page.onShow();
  const identityRequest = requests.find((request) => request.url === '/api/merchant/access/me');
  identityRequest.success({
    code: 200,
    data: {
      active: true,
      merchant: { id: 101, name: '原店' },
      roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage'],
    },
  });
  assert.equal(page._merchantScopeKey, '11:101');

  verificationRequest.success({ code: 200, msg: '上一轮核销成功', data: {} });

  assert.equal(page.data.sceneCurrent, null, '旧 epoch 的回调不能覆盖新一轮页面状态');
  assert.equal(page.data.verificationResult.show, false);
});

test('仅刷新经营读数据不得静默丢弃在途核销回执', () => {
  const page = makePage();
  page.data.verificationResult = { show: false, state: '', title: '', message: '' };

  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  page._reloadAll();
  verificationRequest.success({ code: 200, msg: '核销成功' });

  assert.equal(page.data.sceneCurrent.id, 'merchant-verification-result');
  assert.equal(page.data.verificationResult.state, 'success');
});

test('当前商家当前数据轮次的核销回执仍可正常打开', () => {
  const page = makePage();
  page.data.verificationResult = { show: false, state: '', title: '', message: '' };

  page.goScanQR();
  const verificationRequest = requests.find((request) => request.url === '/api/registration/scan_qr_code');
  verificationRequest.success({ code: 200, msg: '核销成功' });

  assert.equal(page.data.sceneCurrent.id, 'merchant-verification-result');
  assert.equal(page.data.verificationResult.state, 'success');
});

test('核销请求在途时离页必须中止请求并收掉全局 loading', () => {
  const page = makePage();
  page.goScanQR();
  assert.equal(loadingVisible, true);

  page.onUnload();

  assert.equal(abortCount, 1, '离页必须中止在途核销请求');
  assert.equal(loadingVisible, false, 'destroy 后回调不会再执行，页面必须主动 hideLoading');
});

// #20 / F-RM-1:节点码在这颗扫码口必须被挡下,但挡下以后要给出能点过去的指路。
test('节点码在首页扫码口:不发任何核销请求，但弹窗指路且真的跳得过去', () => {
  const page = makePage();
  const modals = [];
  const jumps = [];
  global.wx.scanCode = ({ success }) => success({ result: 'v1.900.citynode_55.1999999999999.7.signature' });
  global.wx.showModal = (opts) => { modals.push(opts); };
  global.wx.navigateTo = (opts) => { jumps.push(opts.url); };

  page.goScanQR();

  assert.equal(requests.length, 0, '节点码不得被送进首页这张共享核销路由表');
  assert.equal(modals.length, 1, '护栏不能是哑巴 —— 要弹窗指路，不是 2 秒就消失的 toast');
  assert.match(modals[0].content, /城市节点/);
  assert.equal(modals[0].confirmText, '去节点页');

  modals[0].success({ confirm: true, cancel: false });
  assert.deepEqual(jumps, ['/pages/merchant/citynode/index']);
});

// L07-002:真机打开系统相机会触发 onHide/onShow;两种先后顺序下扫码都必须照常核销并打开结果
for (const order of ['show-before-success', 'success-before-show']) {
  test('相机往返(' + order + ')不作废扫码,也不重跑整页读取', () => {
    let camera = null;
    const modals = [];
    wx.scanCode = (options) => { camera = options; };
    wx.showModal = (options) => { modals.push(options); };
    const page = makePage();
    page.data.verificationResult = { show: false, state: '', title: '', message: '' };
    page.goScanQR();
    page.onHide();
    const finishCamera = () => {
      camera.success({ result: JSON.stringify({ type: 'topic', code: 'CAMERA-TICKET' }) });
      if (camera.complete) camera.complete();
    };
    if (order === 'show-before-success') { page.onShow(); finishCamera(); } else { finishCamera(); page.onShow(); }
    assert.equal(requests.filter((r) => r.url === '/api/merchant/access/me').length, 0, '扫码往返不重读身份链');
    const verificationRequest = requests.find((r) => r.url === '/api/registration/scan_qr_code');
    assert.deepEqual(modals.map((m) => m.title), [], '扫码结果不应被当成错误码');
    assert.ok(verificationRequest, '扫码结果必须提交核销');
    verificationRequest.success({ code: 200, msg: '验票成功', data: {} });
    assert.equal(page.data.verificationResult.show, true, '核销结果面板必须打开');
  });
}

// L07-010:同一账号 60s 内回到工作台只重读待办/看板/消息;下拉刷新仍走整条读取链
test('工作台 60s 内返回只重读易变数据,下拉刷新走整链', () => {
  wx.showModal = () => {};
  const page = makePage();
  const access = {
    code: 200,
    data: {
      active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage', 'merchant:finance:read', 'merchant:verify:record:read', 'merchant:coop:manage'],
    },
  };
  const confirm = () => requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access);
  const urlsAfter = (n) => requests.slice(n).map((r) => r.url);
  page.onShow(); confirm();
  assert.ok(urlsAfter(0).includes('/api/project/my'), '首次进入走整链');
  // 项目三路回齐后离开(在途或失败时返回仍走整链,见下方复审用例)
  requests.forEach((r) => {
    if (r.url === '/api/project/my') r.success({ code: 200, data: { rows: [], activeTotal: 0 } });
    else if (r.url === '/api/registration/merchant/list') r.success({ code: 200, data: { rows: [] } });
    else if (r.url === '/api/merchant/chapter-application/mine') r.success({ code: 200, data: [] });
  });
  let mark = requests.length;
  page.onHide(); page.onShow(); confirm();
  const light = urlsAfter(mark);
  assert.ok(light.includes('/api/merchant/todo-summary'));
  assert.ok(light.includes('/api/merchant/dashboard'));
  assert.ok(!light.includes('/api/project/my'), '60s 内返回不重读项目列表');
  assert.ok(!light.includes('/api/user/info'));
  mark = requests.length;
  page.onShow({ preserveVerification: true }); confirm();
  assert.ok(urlsAfter(mark).includes('/api/project/my'), '下拉刷新仍走整链');
});

// L07-010(业主 2026-11-24 选「回来就刷新」):接受合作邀约 / 发布活动后 60s 内回到工作台,项目列表立刻重读;
// 普通返回仍走 60s 轻量回读。旧代码只看 60s,这条会红。
test('工作台:接受邀约或发布活动后返回立刻重读项目列表,普通返回仍走缓存', () => {
  wx.showModal = () => {};
  const page = makePage();
  const access = { code: 200, data: { active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_OWNER',
    permissions: ['merchant:basic:read', 'merchant:project:manage', 'merchant:finance:read', 'merchant:verify:record:read', 'merchant:coop:manage'] } };
  const confirm = () => requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access);
  const settleProjects = () => requests.forEach((r) => {
    if (r.url === '/api/project/my') r.success({ code: 200, data: { rows: [], activeTotal: 0 } });
    else if (r.url === '/api/registration/merchant/list') r.success({ code: 200, data: { rows: [] } });
    else if (r.url === '/api/merchant/chapter-application/mine') r.success({ code: 200, data: [] });
  });
  const projectReadsAfter = (n) => requests.slice(n).filter((r) => r.url === '/api/project/my').length;
  page.onShow(); confirm(); settleProjects();
  let mark = requests.length;
  page.onHide(); page.onShow(); confirm(); settleProjects();
  assert.equal(projectReadsAfter(mark), 0, '普通返回仍走 60s 缓存');
  // 接受合作邀约(coop/list、coop/invite-detail、topic/merchantinfo 写同一标记)
  page.onHide(); app.globalData.merchantWorkbenchStale = true;
  mark = requests.length;
  page.onShow(); confirm(); settleProjects();
  assert.ok(projectReadsAfter(mark) > 0, '接受邀约后返回立刻重读项目列表');
  assert.equal(app.globalData.merchantWorkbenchStale, false, '标记只用一次');
  mark = requests.length;
  page.onHide(); page.onShow(); confirm(); settleProjects();
  assert.equal(projectReadsAfter(mark), 0, '之后的普通返回回到缓存');
  // 发布活动(publish/activity 成功回调写同一标记)
  page.onHide(); app.globalData.merchantWorkbenchStale = true;
  mark = requests.length;
  page.onShow(); confirm();
  assert.ok(projectReadsAfter(mark) > 0, '发布活动后返回立刻重读项目列表');
});

// L07-010 复审:轻量回读开了「我的消息」三路等待,经营动态这一路也必须重读,否则合并永远不落定、新消息不上屏
test('工作台 60s 内返回:我的消息各路都重读,新会话能上屏', () => {
  wx.showModal = () => {};
  const page = makePage();
  const access = { code: 200, data: { active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_OWNER',
    permissions: ['merchant:basic:read', 'merchant:finance:read', 'merchant:verify:record:read'] } };
  const confirm = () => requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access);
  const settleInbox = (from, conversations) => requests.slice(from).forEach((r) => {
    if (r.url === '/api/im/conversations') r.success({ code: 200, data: conversations });
    else if (r.url === '/api/merchant/events') r.success({ code: 200, data: [] });
  });
  page.onShow(); confirm(); settleInbox(0, []);
  assert.equal(page.data.inboxLoaded, true);
  assert.deepEqual(page.data.inboxItems, []);
  const mark = requests.length;
  page.onHide(); page.onShow(); confirm();
  assert.ok(!requests.slice(mark).some((r) => r.url === '/api/project/my'), '仍是轻量回读');
  settleInbox(mark, [{ conversationId: 5, type: 1, lastMsgText: '新消息', lastMsgAt: new Date().toISOString(), unread: 1, counterparty: { nickname: '玩家' } }]);
  assert.deepEqual(page.data.inboxItems.map((item) => item.key), ['conv-5'], '返回后新会话要上屏');
});

// L07-010 复审:整链里项目列表还在途时离开、60s 内回来,epoch 前移会丢掉它的回包;回来必须重读,不能一直停在骨架
test('工作台整链未回齐就离开,60s 内回来仍重读项目列表', () => {
  wx.showModal = () => {};
  const page = makePage();
  const access = { code: 200, data: { active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_OWNER',
    permissions: ['merchant:basic:read', 'merchant:project:manage', 'merchant:finance:read', 'merchant:verify:record:read'] } };
  const confirm = () => requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access);
  page.onShow(); confirm();
  assert.equal(page.data.hostLoading, true);
  page.onHide(); page.onShow(); confirm();
  requests.filter((r) => r.url === '/api/project/my').forEach((r) => r.success({ code: 200, data: { rows: [], activeTotal: 0 } }));
  assert.equal(page.data.hostLoading, false, '项目列表不能一直停在加载中');
});

// 复审:60s 内回来但岗位权限变了(资金读权被收回),不能沿用轻量回读留着旧的累计收入
test('工作台 60s 内返回但资金读权被收回:走整链,累计收入不再上屏', () => {
  wx.showModal = () => {};
  const page = makePage();
  const withFinance = { code: 200, data: { active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_OWNER',
    permissions: ['merchant:basic:read', 'merchant:finance:read', 'merchant:verify:record:read'] } };
  const withoutFinance = { code: 200, data: { active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_CHECKIN',
    permissions: ['merchant:basic:read', 'merchant:verify:record:read'] } };
  const confirm = (access) => requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access);
  page.onShow(); confirm(withFinance);
  requests.filter((r) => r.url === '/api/merchant/dashboard').forEach((r) => r.success({ code: 200, data: { revenue: 88 } }));
  assert.equal(page.data.dashboardData.revenue, '88.00');
  page.onHide(); page.onShow(); confirm(withoutFinance);
  assert.equal(page.data.merchantAccess.canReadFinance, false);
  assert.equal(page.data.dashboardData.revenue, null, '收回资金读权后累计收入不能留在屏上');
});

// L07-070:下拉刷新在看板与待办都回来后才收起,不是固定 800ms
test('下拉刷新等看板与待办都回来才收起', () => {
  wx.showModal = () => {};
  const timers = [];
  const st = global.setTimeout, ct = global.clearTimeout;
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  global.clearTimeout = () => {};
  try {
    const page = makePage();
    const access = { code: 200, data: { active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_OWNER',
      permissions: ['merchant:basic:read', 'merchant:project:manage', 'merchant:finance:read', 'merchant:verify:record:read'] } };
    page.onRefresh();
    assert.equal(page.data.refreshing, true);
    assert.ok(timers.some((t) => t.ms === 5000), '5s 兜底');
    assert.ok(!timers.some((t) => t.ms === 800), '不再固定 800ms 收起');
    requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access);
    requests.filter((r) => r.url === '/api/merchant/dashboard').at(-1).success({ code: 200, data: { revenue: 1 } });
    assert.equal(page.data.refreshing, true, '待办还没回来');
    requests.filter((r) => r.url === '/api/merchant/todo-summary').at(-1).fail({});
    assert.equal(page.data.refreshing, false);
  } finally { global.setTimeout = st; global.clearTimeout = ct; }
});

// L07-015(业主默认 A):同一账号页面打开期间只查一次用户信息同步角色;换账号后再查
test('工作台同一账号只查一次用户信息，换账号才再查', () => {
  wx.showModal = () => {};
  const page = makePage();
  const access = { code: 200, data: { active: true, merchant: { id: 101, name: '店' }, roleCode: 'MERCHANT_OWNER',
    permissions: ['merchant:basic:read', 'merchant:profile:write', 'merchant:project:manage'] } };
  const confirm = () => requests.filter((r) => r.url === '/api/merchant/access/me').at(-1).success(access);
  const infoCalls = () => requests.filter((r) => r.url === '/api/user/info');
  page.onShow(); confirm();
  assert.equal(infoCalls().length, 1)
  infoCalls()[0].success({ code: 200, data: { role: 'merchant' } })
  page.onShow({ preserveVerification: true }); confirm();
  assert.equal(infoCalls().length, 1, '整链重读也不再查')
  userId = 22
  page.onShow({ preserveVerification: true }); confirm();
  assert.equal(infoCalls().length, 2, '换账号后再查一次')
});
