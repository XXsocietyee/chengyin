// biz/checkout-1122 路线结账一屏完成:姓名 / 手机号在结算层内补齐 + 购买路径埋点。
// 行为测试:把真页面与真工具函数装进沙箱跑,断言发出的请求、渲染数据与埋点,不读 wxml/wxss/js 源码文本。
const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const PAGE_PATH = path.join(ROOT, 'pages/topic/index/index.js');
const ANALYTICS_PATH = path.join(ROOT, 'utils/analytics.js');
const { bindWxPhone, boundPhoneFromResponse } = require('../../pages/topic/utils/wx-phone-bind.js');
const cp = require('../../pages/topic/utils/checkout-profile.js');

const PHONE = '13800001111'; // 测试号段占位,非真实号码

// ---------- wx-phone-bind ----------

function fakeApp() {
  const requests = [];
  return { requests, sendRequest: (o) => requests.push(o) };
}

test('bindWxPhone:用户拒绝授权 / 没有 code ⇒ 不发付费换号请求', () => {
  const app = fakeApp();
  const out = [];
  assert.equal(bindWxPhone(app, { errMsg: 'getPhoneNumber:fail user deny' }, (r) => out.push(r)), false);
  assert.equal(bindWxPhone(app, { errMsg: 'getPhoneNumber:ok' }, (r) => out.push(r)), false);
  assert.equal(bindWxPhone(app, null, (r) => out.push(r)), false);
  assert.equal(app.requests.length, 0);
  assert.deepEqual(out.map((r) => r.ok), [false, false, false]);
  assert.equal(out[0].cancelled, true);
  assert.equal(out[1].msg, '获取手机号失败');
});

test('bindWxPhone:授权后只发一次 POST /api/getwxbindphone,带 code', () => {
  const app = fakeApp();
  const out = [];
  assert.equal(bindWxPhone(app, { errMsg: 'getPhoneNumber:ok', code: 'c-1' }, (r) => out.push(r)), true);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/getwxbindphone');
  assert.equal(app.requests[0].method, 'POST');
  assert.deepEqual(app.requests[0].data, { code: 'c-1' });
  app.requests[0].success({ code: 200, data: { phone: PHONE } });
  assert.deepEqual(out, [{ ok: true, phone: PHONE }]);
});

test('bindWxPhone:200 但回包没有合法号码(空号保护)仍算失败;非 200 / 网络失败各回原因', () => {
  const run = (respond) => {
    const app = fakeApp(); const out = [];
    bindWxPhone(app, { errMsg: 'getPhoneNumber:ok', code: 'c' }, (r) => out.push(r));
    respond(app.requests[0]);
    assert.equal(app.requests.length, 1, '失败不自动重试');
    return out[0];
  };
  assert.deepEqual(run((q) => q.success({ code: 200, data: '' })), { ok: false, msg: '获取手机号失败' });
  assert.deepEqual(run((q) => q.success({ code: 200, data: { phone: '' }, msg: '操作成功' })), { ok: false, msg: '操作成功' });
  assert.deepEqual(run((q) => q.success({ code: 500, msg: '绑定失败' })), { ok: false, msg: '绑定失败' });
  assert.deepEqual(run((q) => q.fail()), { ok: false, msg: '网络错误，请重试' });
});

test('boundPhoneFromResponse:data 字符串 / data.phone / msg 三处取第一个合法号', () => {
  assert.equal(boundPhoneFromResponse({ data: PHONE }), PHONE);
  assert.equal(boundPhoneFromResponse({ data: { phone: PHONE } }), PHONE);
  assert.equal(boundPhoneFromResponse({ data: null, msg: PHONE }), PHONE);
  assert.equal(boundPhoneFromResponse({ data: { phone: '123' } }), '');
  assert.equal(boundPhoneFromResponse(null), '');
});

// ---------- checkout-profile 视图模型 ----------

test('profileView:手机号缺 ⇒ 只补手机号,姓名只读', () => {
  const v = cp.profileView({ realName: '张三', phone: '' }, {});
  assert.equal(v.fill, true); assert.equal(v.needPhone, true); assert.equal(v.needName, false);
  assert.equal(v.name, '张三');
});

test('profileView:姓名缺 ⇒ 只补姓名,手机号打码只读,输入态与错误随行', () => {
  const v = cp.profileView({ realName: '', phone: PHONE }, { nameDraft: '李', nameError: '请输入姓名', phoneBusy: true });
  assert.equal(v.fill, true); assert.equal(v.needName, true); assert.equal(v.needPhone, false);
  assert.equal(v.phoneMasked, '138****1111');
  assert.equal(v.nameDraft, '李'); assert.equal(v.nameError, '请输入姓名');
  assert.equal(v.phoneBusy, false, '不缺手机号就没有手机号忙态');
});

test('profileView:两样都有 ⇒ 不进补全态(原只读行 + 编辑入口);没取回之前也不进补全态', () => {
  const both = cp.profileView({ realName: '张三', phone: PHONE }, { nameError: '请输入姓名', phoneAlert: true });
  assert.equal(both.fill, false); assert.equal(both.nameError, ''); assert.equal(both.phoneAlert, false);
  assert.equal(cp.profileView(null, {}).fill, false);
});

test('validateName / missingMarks / participantPayload 与参与人表单同口径', () => {
  assert.equal(cp.validateName('  '), '请输入姓名');
  assert.equal(cp.validateName(' 王五 '), '');
  assert.deepEqual(cp.missingMarks({ realName: '', phone: '' }, ''), { nameError: '请输入姓名', phoneAlert: true });
  assert.deepEqual(cp.missingMarks({ realName: '张三', phone: PHONE }, ''), { nameError: '', phoneAlert: false });
  assert.deepEqual(cp.participantPayload(' 王五 ', PHONE, 'r1'), { fullName: '王五', mobilePhone: PHONE, isDefault: 1, requestId: 'r1' });
});

// ---------- 页面:结算层内补全 + 埋点 ----------

function setByPath(target, key, value) {
  const parts = key.split('.');
  let cur = target;
  parts.slice(0, -1).forEach((p) => { if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; });
  cur[parts[parts.length - 1]] = value;
}

const pages = [];
afterEach(() => { for (const p of pages.splice(0)) p.onUnload && p.onUnload(); });

function loadPage() {
  const requests = []; const toasts = []; const navigations = []; const tracked = []; const payments = []; const storage = {};
  let config = null;
  const previous = { getApp: global.getApp, Page: global.Page };
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserType: () => 1, getUserID: () => 500,
    tips: (m) => toasts.push(m),
    sendRequest: (o) => { requests.push(o); },
    recordConsent: () => Promise.resolve({ code: 200 }),
  });
  global.Page = (c) => { config = c; };
  global.wx = {
    showLoading() {}, hideLoading() {}, showToast: (o) => toasts.push(o.title), showModal() {},
    requestPayment: (o) => payments.push(o), requestSubscribeMessage() {},
    navigateTo: (o) => navigations.push(o.url), redirectTo: (o) => navigations.push(o.url),
    getSystemInfo() {}, getStorageSync: (k) => storage[k] || '', setStorageSync: (k, v) => { storage[k] = v; },
    createSelectorQuery: () => { const q = { in: () => q, select: () => q, selectAll: () => q, boundingClientRect: () => q, scrollOffset: () => q, exec: () => {} }; return q; },
  };
  const realAnalytics = require.cache[ANALYTICS_PATH];
  require.cache[ANALYTICS_PATH] = { id: ANALYTICS_PATH, filename: ANALYTICS_PATH, loaded: true,
    exports: { track: (name, payload) => { tracked.push({ name, payload }); return true; }, flush() {}, setSessionContext() {}, sanitizeProperties: (x) => x } };
  delete require.cache[PAGE_PATH];
  try { require(PAGE_PATH); } finally {
    global.getApp = previous.getApp; global.Page = previous.Page;
    delete require.cache[PAGE_PATH];
    if (realAnalytics) require.cache[ANALYTICS_PATH] = realAnalytics; else delete require.cache[ANALYTICS_PATH];
  }
  const vm = Object.assign({}, config, {
    setData(patch, cb) { Object.entries(patch).forEach(([k, v]) => setByPath(this.data, k, v)); if (cb) cb(); },
  });
  vm.data = JSON.parse(JSON.stringify(config.data));
  vm.data.info = { id: 77, name: '路线', endDate: '' };
  vm.data.id = 77;
  vm.lockedTip = () => false;
  vm._initWorkflow();
  pages.push(vm);
  return { vm, requests, toasts, navigations, tracked, payments, storage };
}

// _loadSignupProfile 一次发两路:/api/user/info(手机号)+ /api/user/address/list(姓名)
function answerProfile(requests, { phone, name }) {
  const info = requests.filter((r) => r.url === '/api/user/info').pop();
  const list = requests.filter((r) => r.url === '/api/user/address/list').pop();
  info.success({ code: '200', data: { phone: phone || '' } });
  list.success({ code: '200', data: { rows: name ? [{ id: 9, fullName: name, isDefault: 1 }] : [] } });
}

function openWith(h, parts) {
  h.vm._signupParts = parts;
  h.vm._signupProfile = parts.realName && parts.phone ? parts : null;
  h.vm.onSelfPlayGoCheckout();
}

test('打开结算层:缺手机号 ⇒ 补全态只要手机号;记 checkout_open(bizType=topic,bizId=主题 id)', () => {
  const h = loadPage();
  openWith(h, { realName: '张三', phone: '' });
  const v = h.vm.data.checkout.profile;
  assert.equal(v.fill, true); assert.equal(v.needPhone, true); assert.equal(v.needName, false);
  const open = h.tracked.find((t) => t.name === 'checkout_open');
  assert.ok(open); assert.equal(open.payload.bizType, 'topic'); assert.equal(open.payload.bizId, 77);
  assert.equal(h.navigations.length, 0);
});

test('绑定手机号:一次点击一次 /api/getwxbindphone;成功后重读同一真源,行变成只读', () => {
  const h = loadPage();
  openWith(h, { realName: '张三', phone: '' });
  h.vm.onCheckoutPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'pc' } });
  h.vm.onCheckoutPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'pc' } }); // 在途连点
  const binds = h.requests.filter((r) => r.url === '/api/getwxbindphone');
  assert.equal(binds.length, 1);
  assert.equal(h.vm.data.checkout.profile.phoneBusy, true);
  binds[0].success({ code: 200, data: { phone: PHONE } });
  answerProfile(h.requests, { phone: PHONE, name: '张三' });
  const v = h.vm.data.checkout.profile;
  assert.equal(v.fill, false);
  assert.equal(h.vm.data.checkout.profilePhone, '138****1111');
  assert.equal(h.navigations.length, 0, '不再跳资料页');
});

test('绑定手机号:拒绝授权不发请求、只提示', () => {
  const h = loadPage();
  openWith(h, { realName: '张三', phone: '' });
  h.vm.onCheckoutPhone({ detail: { errMsg: 'getPhoneNumber:fail user deny' } });
  assert.equal(h.requests.filter((r) => r.url === '/api/getwxbindphone').length, 0);
  assert.equal(h.vm.data.checkout.profile.phoneBusy, false);
  assert.deepEqual(h.toasts, ['您已取消授权']);
});

test('缺姓名:输入后离开即存成默认参与人(用已绑手机号),成功后重读资料', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  assert.equal(h.vm.data.checkout.profile.needName, true);
  h.vm.onCheckoutNameSave({ detail: { value: '   ' } });
  assert.equal(h.requests.filter((r) => r.url === '/api/user/address/action').length, 0, '空着离开不发请求');
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  const saves = h.requests.filter((r) => r.url === '/api/user/address/action');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].data.fullName, '王五'); assert.equal(saves[0].data.mobilePhone, PHONE); assert.equal(saves[0].data.isDefault, 1);
  assert.ok(saves[0].data.requestId);
  saves[0].success({ code: '200', data: { id: 31 } });
  assert.equal(h.storage.selectedAddressId_v1_500, 31);
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  assert.equal(h.vm.data.checkout.profile.fill, false);
  assert.equal(h.vm.data.checkout.profileName, '王五');
});

test('姓名保存失败:原因红字留在字段下,输入不丢;重试复用同一 requestId', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  const first = h.requests.filter((r) => r.url === '/api/user/address/action')[0];
  first.fail();
  const v = h.vm.data.checkout.profile;
  assert.equal(v.nameError, '网络没连上，请检查后重试'); assert.equal(v.nameDraft, '王五'); assert.equal(v.nameBusy, false);
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  const saves = h.requests.filter((r) => r.url === '/api/user/address/action');
  assert.equal(saves.length, 2);
  assert.equal(saves[1].data.requestId, saves[0].data.requestId);
});

test('资料重读失败 ⇒ 保留屏上已有资料,不刷成空', () => {
  const h = loadPage();
  openWith(h, { realName: '张三', phone: PHONE });
  const before = JSON.stringify(h.vm.data.checkout.profile);
  h.vm._fillCheckoutProfile();
  h.requests.filter((r) => r.url === '/api/user/info').pop().fail();
  h.requests.filter((r) => r.url === '/api/user/address/list').pop().success({ code: '200', data: { rows: [] } });
  assert.equal(JSON.stringify(h.vm.data.checkout.profile), before);
  assert.equal(h.vm.data.checkout.profileName, '张三');
});

test('付款时仍缺:不建单、不跳页,姓名红字 + 手机号行标红', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: '' });
  h.vm._createSelfPlayOrder(77);
  answerProfile(h.requests, { phone: '', name: '' });
  assert.equal(h.requests.filter((r) => r.url === '/api/registration/create').length, 0);
  assert.equal(h.navigations.length, 0);
  const v = h.vm.data.checkout.profile;
  assert.equal(v.nameError, '请输入姓名'); assert.equal(v.phoneAlert, true);
  assert.equal(h.tracked.filter((t) => t.name === 'checkout_profile_done').length, 0);
});

test('上次姓名保存失败后点支付:用同一 requestId 重存一次;存不上原因留着、不建单,存上了接着建单', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  const saves = () => h.requests.filter((r) => r.url === '/api/user/address/action');
  saves()[0].success({ code: '500', msg: '请输入姓名' });
  h.vm._createSelfPlayOrder(77);
  answerProfile(h.requests, { phone: PHONE, name: '' });
  assert.equal(saves().length, 2, '点支付把填好的姓名再存一次');
  assert.equal(saves()[1].data.requestId, saves()[0].data.requestId, '同一 requestId,不会多建参与人');
  saves()[1].success({ code: '500', msg: '请输入姓名' });
  assert.equal(h.requests.filter((r) => r.url === '/api/registration/create').length, 0);
  assert.equal(h.vm.data.checkout.profile.nameError, '请输入姓名');
  assert.equal(h.vm.data.checkout.profile.phoneAlert, false);
  h.vm._createSelfPlayOrder(77);
  answerProfile(h.requests, { phone: PHONE, name: '' });
  saves()[2].success({ code: '200', data: { id: 33 } });
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  const create = h.requests.filter((r) => r.url === '/api/registration/create');
  assert.equal(create.length, 1);
  assert.equal(JSON.parse(create[0].data).realName, '王五');
});

test('层内补全姓名后付款:建单带新姓名;记 checkout_profile_done how=filled_in_sheet', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  h.requests.filter((r) => r.url === '/api/user/address/action')[0].success({ code: '200', data: { id: 32 } });
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  h.vm._createSelfPlayOrder(77);
  const create = h.requests.filter((r) => r.url === '/api/registration/create');
  assert.equal(create.length, 1);
  const body = JSON.parse(create[0].data);
  assert.equal(body.realName, '王五'); assert.equal(body.phone, PHONE);
  const done = h.tracked.filter((t) => t.name === 'checkout_profile_done');
  assert.equal(done.length, 1); assert.deepEqual(done[0].payload.properties, { how: 'filled_in_sheet' });
});

test('资料原本就齐:直接建单,how=had;拉起支付前记 pay_start,取消记 pay_cancel(只有原因码)', () => {
  const h = loadPage();
  openWith(h, { realName: '张三', phone: PHONE });
  h.vm._createSelfPlayOrder(77);
  const done = h.tracked.find((t) => t.name === 'checkout_profile_done');
  assert.deepEqual(done.payload.properties, { how: 'had' });
  const create = h.requests.filter((r) => r.url === '/api/registration/create')[0];
  create.success({ code: '200', data: { registrationId: 1001, payableAmount: 100,
    payParams: { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' } } });
  const start = h.tracked.find((t) => t.name === 'pay_start');
  assert.ok(start); assert.deepEqual(start.payload.properties, { channel: 'wxpay' });
  assert.equal(h.payments.length, 1);
  h.payments[0].fail({ errMsg: 'requestPayment:fail cancel' });
  const cancel = h.tracked.find((t) => t.name === 'pay_cancel');
  assert.deepEqual(cancel.payload.properties, { reason: 'user_cancel' });
});

test('支付失败记 pay_fail(reason=sdk_fail,不带原文)', () => {
  const h = loadPage();
  openWith(h, { realName: '张三', phone: PHONE });
  h.vm._createSelfPlayOrder(77);
  h.requests.filter((r) => r.url === '/api/registration/create')[0].success({ code: '200', data: { registrationId: 1001, payableAmount: 100,
    payParams: { timeStamp: '1', nonceStr: 'n', package: 'prepay_id=x', signType: 'RSA', paySign: 's' } } });
  h.payments[0].fail({ errMsg: 'requestPayment:fail something' });
  const fail = h.tracked.find((t) => t.name === 'pay_fail');
  assert.deepEqual(fail.payload.properties, { reason: 'sdk_fail' });
});

test('服务端确认已付 ⇒ solo_ticket_purchase,eventKey 按订单号去重;无订单号不记', () => {
  const h = loadPage();
  h.vm._onSelfPlayPaid(77, { registrationId: 1001 });
  h.vm._onSelfPlayPaid(77, {});
  const buys = h.tracked.filter((t) => t.name === 'solo_ticket_purchase');
  assert.equal(buys.length, 1);
  assert.equal(buys[0].payload.eventKey, 'solo_ticket_purchase_1001');
  assert.equal(buys[0].payload.bizType, 'topic'); assert.equal(buys[0].payload.bizId, 77);
});

test('content_view 只在详情首次读成功时记一次', () => {
  const h = loadPage();
  h.vm.data.id = 77;
  h.vm._applyMotionData = () => {}; h.vm.buildRouteMap = () => {};
  for (let i = 0; i < 2; i++) {
    h.vm.getData();
    const req = h.requests.filter((r) => r.url === '/api/topic/info-to-user').pop();
    try { req.success({ code: '200', data: { id: 77, name: '路线', chaptersList: [], omsTicketList: [] } }); } catch (e) { /* 详情映射里与本用例无关的分支 */ }
  }
  assert.equal(h.tracked.filter((t) => t.name === 'content_view').length, 1);
});

test('两样都缺:先填姓名(号未绑不存),绑完手机号后才把姓名存成参与人', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: '' });
  const v0 = h.vm.data.checkout.profile;
  assert.equal(v0.needName, true); assert.equal(v0.needPhone, true);
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  assert.equal(h.requests.filter((r) => r.url === '/api/user/address/action').length, 0);
  h.vm.onCheckoutPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'pc' } });
  h.requests.filter((r) => r.url === '/api/getwxbindphone')[0].success({ code: 200, data: PHONE });
  answerProfile(h.requests, { phone: PHONE, name: '' });
  const saves = h.requests.filter((r) => r.url === '/api/user/address/action');
  assert.equal(saves.length, 1);
  assert.equal(saves[0].data.fullName, '王五'); assert.equal(saves[0].data.mobilePhone, PHONE);
});

// ---------- 刚输完姓名就点「支付」:一下点完,不许点了没反应或把结算层锁死 ----------

function readyToPay(h) { h.vm.data.selfPlayConsentChecked = true; h.vm._hostShareConsentReady = true; }
const urlCount = (h, url) => h.requests.filter((r) => r.url === url).length;
const lastOf = (h, url) => h.requests.filter((r) => r.url === url).pop();

test('资料读取被后一次读取顶掉:先来的调用也收到回话(用最新结果),不会石沉大海', () => {
  const h = loadPage();
  const got = [];
  h.vm._loadSignupProfile((profile, failed) => got.push(['first', !!profile, failed]));
  h.vm._loadSignupProfile((profile, failed) => got.push(['second', !!profile, failed]));
  answerProfile(h.requests, { phone: PHONE, name: '张三' });
  assert.deepEqual(got, [['first', true, false], ['second', true, false]]);
});

test('输完姓名直接点支付(保存先回、读取后回):只建一张单,支付与返回都不被锁死', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  readyToPay(h);
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } }); // 点支付时输入框失焦:姓名保存在途
  h.vm.onSelfPlayConfirm();                               // 支付:资料读取在途
  const info1 = lastOf(h, '/api/user/info'); const list1 = lastOf(h, '/api/user/address/list');
  lastOf(h, '/api/user/address/action').success({ code: '200', data: { id: 31 } }); // 保存先回 ⇒ 又一次读取
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  info1.success({ code: '200', data: { phone: PHONE } });  // 先发的那次读取晚到
  list1.success({ code: '200', data: { rows: [{ id: 31, fullName: '王五', isDefault: 1 }] } });
  const create = h.requests.filter((r) => r.url === '/api/registration/create');
  assert.equal(create.length, 1, '一次点击建一张单');
  assert.equal(JSON.parse(create[0].data).realName, '王五');
  assert.equal(urlCount(h, '/api/user/address/action'), 1, '姓名只存一次');
  assert.equal(h.vm.data.checkout.profile.fill, false);
});

test('输完姓名直接点支付(读取先回、保存后回):保存落地后接着建单,不用再点一次', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  readyToPay(h);
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  h.vm.onSelfPlayConfirm();
  answerProfile(h.requests, { phone: PHONE, name: '' });   // 读取先回:姓名还没存上
  assert.equal(urlCount(h, '/api/registration/create'), 0);
  assert.equal(urlCount(h, '/api/user/address/action'), 1, '保存在途时不重复发');
  lastOf(h, '/api/user/address/action').success({ code: '200', data: { id: 31 } });
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  const create = h.requests.filter((r) => r.url === '/api/registration/create');
  assert.equal(create.length, 1);
  assert.equal(JSON.parse(create[0].data).realName, '王五');
});

test('输入框没失焦就点了支付:这一下把姓名存上再建单', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  readyToPay(h);
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } }); // 只有输入,没有失焦 / 完成
  h.vm.onSelfPlayConfirm();
  answerProfile(h.requests, { phone: PHONE, name: '' });
  assert.equal(urlCount(h, '/api/user/address/action'), 1);
  lastOf(h, '/api/user/address/action').success({ code: '200', data: { id: 31 } });
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  assert.equal(urlCount(h, '/api/registration/create'), 1);
});

test('两样都缺:填姓名、绑手机号后马上点支付 ⇒ 姓名照样存上,存好接着建单', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: '' });
  readyToPay(h);
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });  // 号未绑:先留在输入框里
  h.vm.onCheckoutPhone({ detail: { errMsg: 'getPhoneNumber:ok', code: 'pc' } });
  lastOf(h, '/api/getwxbindphone').success({ code: 200, data: { phone: PHONE } }); // ⇒ 重读资料(回调里接着存姓名)
  h.vm.onSelfPlayConfirm();                                // 心急:重读还没回就点支付
  answerProfile(h.requests, { phone: PHONE, name: '' });
  assert.equal(urlCount(h, '/api/user/address/action'), 1, '绑号后的姓名保存没有被顶掉');
  assert.equal(urlCount(h, '/api/registration/create'), 0);
  lastOf(h, '/api/user/address/action').success({ code: '200', data: { id: 31 } });
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  const create = h.requests.filter((r) => r.url === '/api/registration/create');
  assert.equal(create.length, 1);
  assert.equal(JSON.parse(create[0].data).phone, PHONE);
});

test('点了支付又关掉结算层:在途的姓名保存回来后不再建单', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: PHONE });
  readyToPay(h);
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } });
  h.vm.onCheckoutNameSave({ detail: { value: '王五' } });
  h.vm.onSelfPlayConfirm();
  answerProfile(h.requests, { phone: PHONE, name: '' });
  h.vm.onCheckoutBack();
  assert.equal(h.vm.data.selfPlayCheckoutShow, false, '等姓名保存时仍可关层');
  lastOf(h, '/api/user/address/action').success({ code: '200', data: { id: 31 } });
  answerProfile(h.requests, { phone: PHONE, name: '王五' });
  assert.equal(urlCount(h, '/api/registration/create'), 0);
});

test('付款时手机号还没绑:即使姓名填好了也不代存、不建单,只把手机号行标红', () => {
  const h = loadPage();
  openWith(h, { realName: '', phone: '' });
  readyToPay(h);
  h.vm.onCheckoutNameInput({ detail: { value: '王五' } });
  h.vm.onSelfPlayConfirm();
  answerProfile(h.requests, { phone: '', name: '' });
  assert.equal(urlCount(h, '/api/user/address/action'), 0);
  assert.equal(urlCount(h, '/api/registration/create'), 0);
  assert.equal(h.vm.data.checkout.profile.phoneAlert, true);
  assert.equal(h.vm.data.checkout.profile.nameError, '');
});

// AUDIT-1122 L06-001(第二批集成复核,2026-11-23):进页不再预取报名资料,打开结算层才读 ——
// 这是现在每一次结算的主路径,原有用例都是先把资料塞好再开层,没有走到这里。
test('没预取过资料就打开结算层:自己读一次;读回前不进补全态,读回后只读行出现姓名与打码手机号', () => {
  const h = loadPage();
  assert.equal(urlCount(h, '/api/user/info'), 0);
  h.vm.onSelfPlayGoCheckout();
  assert.equal(urlCount(h, '/api/user/info'), 1, '打开结算层发一次资料读取');
  assert.equal(urlCount(h, '/api/user/address/list'), 1);
  assert.equal(h.vm.data.checkout.profile.fill, false, '读回之前不能把资料齐全的人显示成要补');
  answerProfile(h.requests, { phone: PHONE, name: '张三' });
  assert.equal(h.vm.data.checkout.profileName, '张三');
  assert.equal(h.vm.data.checkout.profilePhone, PHONE.slice(0, 3) + '****' + PHONE.slice(-4));
  assert.equal(h.vm.data.checkout.profile.fill, false);
  assert.equal(h.navigations.length, 0);
});

test('没预取过资料、读回来缺手机号:结算层转成补全态,只要手机号', () => {
  const h = loadPage();
  h.vm.onSelfPlayGoCheckout();
  answerProfile(h.requests, { phone: '', name: '张三' });
  const v = h.vm.data.checkout.profile;
  assert.equal(v.fill, true); assert.equal(v.needPhone, true); assert.equal(v.needName, false);
});

test('资料还在路上就点支付:读回后只建一张单,不弹「还差姓名和手机号」也不跳页;先发的那次读取晚到也不再建单', () => {
  const h = loadPage();
  h.vm.onSelfPlayGoCheckout();                 // 打开结算层:资料读取在途
  const info1 = lastOf(h, '/api/user/info'); const list1 = lastOf(h, '/api/user/address/list');
  readyToPay(h);
  h.vm.onSelfPlayConfirm();                    // 用户手快:支付
  answerProfile(h.requests, { phone: PHONE, name: '张三' });
  info1.success({ code: '200', data: { phone: PHONE } });
  list1.success({ code: '200', data: { rows: [{ id: 9, fullName: '张三', isDefault: 1 }] } });
  const create = h.requests.filter((r) => r.url === '/api/registration/create');
  assert.equal(create.length, 1, '一次点击建一张单');
  assert.equal(JSON.parse(create[0].data).realName, '张三');
  assert.equal(h.navigations.length, 0);
  assert.equal(h.vm.data.checkout.profile.fill, false);
});
