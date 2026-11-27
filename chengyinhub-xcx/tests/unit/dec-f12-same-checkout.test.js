// DEC-F12 A(业主 2026-11-24「Same checkout as single」):双人票 / 小队票与单人自玩票同一个结算层。
// 行为测试:真实页面沙箱 + 真实纯函数;断言请求体、结算层视图、付款链与到账后的邀请同伴。价格全是测试夹具(FIXTURE)。
const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { checkoutView } = require('../../pages/topic/utils/checkout-view.js');
const po = require('../../utils/commerce/product-order.js');

const ROOT = path.resolve(__dirname, '../..');
const TOPIC_PAGE = path.join(ROOT, 'pages/topic/index/index.js');
const ANALYTICS_PATH = path.join(ROOT, 'utils/analytics.js');
const TOPIC = 77;
const INFO = { id: TOPIC, name: '路线', selfPlay: 1, selfPlayPrice: 29.9 }; // FIXTURE
const TWO = { productId: 11, productName: '双人票', productKind: 1, purchaseRoute: 1, seatCount: 2, cashPrice: 49.9, // FIXTURE
  perPersonCashPrice: 24.95, cashAvailable: true, items: [{ topicId: TOPIC, topicTitle: '路线' }] };
const QUOTE = { productId: 11, quantity: 1, availablePayModes: [1], totalCashAmount: 49.9, quoteSign: 'sig-1', // FIXTURE
  quoteExpiresAt: '2026-11-24 20:00:00', refundableNow: true, refundPercentNow: 100 };

function setByPath(target, key, value) {
  const parts = key.split('.');
  let cur = target;
  parts.slice(0, -1).forEach((p) => { if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; });
  cur[parts[parts.length - 1]] = value;
}

const pages = [];
afterEach(() => { for (const p of pages.splice(0)) p.onUnload && p.onUnload(); });

function topicPage() {
  const requests = []; const navigations = []; const toasts = []; const payments = []; let config = null;
  const prev = { getApp: global.getApp, Page: global.Page };
  const app = { globalData: { statusBarHeight: 20, navBarHeight: 44 }, getUserType: () => 1, getUserID: () => 500,
    tips: (t) => toasts.push(t), sendRequest: (o) => { requests.push(o); }, recordConsent: () => Promise.resolve({ code: 200 }) };
  global.getApp = () => app;
  global.Page = (c) => { config = c; };
  global.wx = {
    showLoading() {}, hideLoading() {}, showToast: (o) => toasts.push(o.title), showModal() {}, requestSubscribeMessage() {},
    requestPayment: (o) => payments.push(o),
    navigateTo: (o) => { navigations.push(o.url); if (o.complete) o.complete(); }, redirectTo: (o) => navigations.push(o.url),
    getSystemInfo() {}, getStorageSync: () => '', setStorageSync() {},
    createSelectorQuery: () => { const q = { in: () => q, select: () => q, selectAll: () => q, boundingClientRect: () => q, scrollOffset: () => q, exec: () => {} }; return q; },
  };
  const realAnalytics = require.cache[ANALYTICS_PATH];
  require.cache[ANALYTICS_PATH] = { id: ANALYTICS_PATH, filename: ANALYTICS_PATH, loaded: true,
    exports: { track: () => true, flush() {}, setSessionContext() {}, sanitizeProperties: (x) => x } };
  delete require.cache[TOPIC_PAGE];
  try { require(TOPIC_PAGE); } finally {
    global.getApp = prev.getApp; global.Page = prev.Page; delete require.cache[TOPIC_PAGE];
    if (realAnalytics) require.cache[ANALYTICS_PATH] = realAnalytics; else delete require.cache[ANALYTICS_PATH];
  }
  const vm = Object.assign({}, config, { setData(patch, cb) { Object.entries(patch).forEach(([k, v]) => setByPath(this.data, k, v)); if (cb) cb(); } });
  vm.data = JSON.parse(JSON.stringify(config.data));
  vm.data.info = Object.assign({}, INFO); vm.data.id = TOPIC;
  vm.lockedTip = () => false;
  vm._initWorkflow();
  pages.push(vm);
  const last = (url) => requests.filter((r) => r.url === url).pop();
  return { vm, requests, navigations, toasts, payments, last };
}

function openTwo(h) {
  h.vm._loadSeatProducts(h.vm.data.info);
  h.last('/api/marketing/product/list').success({ code: 200, data: [TWO] });
  h.vm.selfPlayBuy();
  h.vm.onBuyPick({ currentTarget: { dataset: { i: 1 } } });
  h.vm.onBuyGo();
}

test('结算视图:选中项换成多人票(名称、人数、合计、人均),合计只来自服务端报价', () => {
  const opt = { kind: 'product', productId: 11, name: '双人票', people: 2, price: 49.9, perPersonText: '人均 ¥24.95' };
  const loading = checkoutView({ info: INFO, option: opt, quoteState: 'loading' });
  assert.equal(loading.single.title, '双人票');
  assert.equal(loading.single.line, '人均 ¥25.0');
  assert.equal(loading.peopleText, '2 人');
  assert.equal(loading.loading, true);
  const ready = checkoutView({ info: INFO, option: opt, quoteState: 'ready', quote: Object.assign({}, QUOTE, { totalCashAmount: 52 }) });
  assert.equal(ready.totalText, '¥52.0', '服务端报价优先于目录价');
  assert.equal(ready.payLabel, '支付 ¥52.0');
  assert.deepEqual(ready.bill.map((b) => b.k), ['双人票 × 1']);
  assert.ok(ready.trust.some((t) => t.label === '2 人自玩'));
  assert.equal(ready.productId, 11);
  const noCash = checkoutView({ info: INFO, option: opt, quoteState: 'ready', quote: Object.assign({}, QUOTE, { availablePayModes: [2], cashUnavailableReason: 'CASH_DISABLED' }) });
  assert.equal(noCash.refused, true);
  assert.equal(noCash.refusal, '现金支付暂未开通');
  const single = checkoutView({ info: INFO, quoteState: 'loading' });
  assert.equal(single.peopleText, '1 人');
  assert.equal(single.single.title, '自玩门票', '单人结算层不变');
});

test('多人票付款:同意 → 商品下单(只回传报价签名,不带金额)→ 预下单 → 微信支付 → 按单号回查 → 到账分步可邀请同伴', async () => {
  const h = topicPage();
  openTwo(h);
  h.last('/api/marketing/product/quote').success({ code: 200, data: QUOTE });
  assert.equal(h.vm.data.checkout.view.totalText, '¥49.9');
  h.vm.data.selfPlayConsentChecked = true;
  h.vm.onSelfPlayConfirm();
  await new Promise((r) => setImmediate(r));
  const order = h.last('/api/marketing/product/order');
  assert.ok(order, '走商品下单');
  const body = JSON.parse(order.data);
  assert.equal(body.productId, 11);
  assert.equal(body.payMode, 1);
  assert.equal(body.fulfillmentKind, 1);
  assert.equal(body.quoteSign, 'sig-1');
  assert.ok(/^mkp_/.test(body.requestId));
  assert.equal('amount' in body || 'totalCashAmount' in body || 'price' in body, false, '不提交金额');
  assert.equal(h.requests.filter((r) => r.url === '/api/registration/create').length, 0);
  order.success({ code: 200, data: { orderNo: 'MO1', statusLabel: 'PENDING_CASH' } });
  h.last('/api/marketing/product/orders/MO1/pay').success({ code: 200, data: { payParams: { timeStamp: '1', package: 'p' } } });
  assert.equal(h.payments.length, 1);
  h.payments[0].success();
  h.last('/api/marketing/product/orders/MO1').success({ code: 200, data: { orderNo: 'MO1', statusLabel: 'PAID', fulfillmentKind: 1, primaryRegistrationId: 9001 } });
  assert.equal(h.vm.data.selfPlayCheckoutShow, false);
  assert.equal(h.vm.data.seatUnlock.show, true);
  const seats = h.vm.data.seatUnlock.steps.find((s) => s.key === 'seats');
  assert.equal(seats.inviteRegistrationId, 9001);
  h.vm.onSeatUnlockInvite({ detail: { registrationId: 9001 } });
  assert.deepEqual(h.navigations, ['/subpackageJourney/pages/seats/index?registrationId=9001']);
});

test('结果未知重点「支付」复用同一 requestId;报价过期自动重新报价', async () => {
  const h = topicPage();
  openTwo(h);
  h.last('/api/marketing/product/quote').success({ code: 200, data: QUOTE });
  h.vm.data.selfPlayConsentChecked = true;
  h.vm.onSelfPlayConfirm();
  await new Promise((r) => setImmediate(r));
  const first = h.last('/api/marketing/product/order');
  first.fail();
  assert.equal(h.vm.data.selfPlayConfirmLoading, false);
  h.vm.onSelfPlayConfirm();
  const second = h.last('/api/marketing/product/order');
  assert.notEqual(first, second);
  assert.equal(JSON.parse(second.data).requestId, JSON.parse(first.data).requestId);
  const quotes = h.requests.filter((r) => r.url === '/api/marketing/product/quote').length;
  second.success({ code: 409, reasonCode: 'QUOTE_EXPIRED' });
  assert.equal(h.vm.data.checkoutError, '报价已过期，请重新确认');
  assert.equal(h.requests.filter((r) => r.url === '/api/marketing/product/quote').length, quotes + 1);
});

test('报价被拒:付款按钮不可点,原因按码说;不下单', () => {
  const h = topicPage();
  openTwo(h);
  h.last('/api/marketing/product/quote').success({ code: 409, reasonCode: 'SALE_ENDED' });
  assert.equal(h.vm.data.checkout.view.refused, true);
  assert.equal(h.vm.data.checkout.view.refusal, '商品已停售');
  h.vm.data.selfPlayConsentChecked = true;
  h.vm.onSelfPlayConfirm();
  assert.equal(h.requests.filter((r) => r.url === '/api/marketing/product/order').length, 0);
});

test('单人自玩门票仍走原报价;从多人票回到单人时选项被清掉', () => {
  const h = topicPage();
  openTwo(h);
  h.vm.onCheckoutBack();
  h.vm.onSelfPlayGoCheckout({ type: 'tap', currentTarget: {} });
  const reg = h.last('/api/registration/quote');
  assert.deepEqual(reg.data, { ownerType: 1, ownerId: TOPIC });
  assert.equal(h.vm.data.checkout.view.single.title, '自玩门票');
  assert.equal(h.vm.data.checkout.view.peopleText, '1 人');
});

test('城市通票入口仍进原通行证详情页(其他入口不变)', () => {
  const h = topicPage();
  h.vm.onCheckoutPass({ detail: { id: '31' } });
  assert.deepEqual(h.navigations, ['/subpackageMember/market/pass/index?id=31']);
});

test('下单请求体口径共用:通行证详情页 market-view 与主题页同一个 orderRequest', () => {
  const mv = require('../../subpackageMember/utils/market-view.js');
  assert.equal(mv.orderRequest, po.orderRequest);
  assert.equal(mv.reasonText, po.reasonText);
});
