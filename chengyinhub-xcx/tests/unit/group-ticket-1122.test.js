// biz/group-ticket-1122 自玩路线双人票 / 小队票:购买层选项 + 到账后邀请同伴。
// 行为测试:调用真实纯函数与真实页面(沙箱),断言选项、请求与跳转;不读 wxml/wxss/js 源码文本。
// 价格全部是测试夹具(FIXTURE),不是批准价格:单人 29.90 / 双人 49.90(人均 24.95) / 四人 89.90(人均 22.47)。
const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const m = require('../../pages/topic/utils/topic-motion.js');
const pu = require('../../utils/commerce/pass-unlock-view.js');

const ROOT = path.resolve(__dirname, '../..');
const TOPIC_PAGE = path.join(ROOT, 'pages/topic/index/index.js');
const PASS_PAGE = path.join(ROOT, 'subpackageMember/market/pass/index.js');
const ANALYTICS_PATH = path.join(ROOT, 'utils/analytics.js');

const TOPIC = 77;
const INFO = { id: TOPIC, name: '路线', selfPlay: 1, selfPlayPrice: 29.9 }; // FIXTURE

function seatProduct(over) {
  return Object.assign({
    productId: 11, productName: '双人票', purchaseRoute: 1, seatCount: 2, cashPrice: 49.9, // FIXTURE
    perPersonCashPrice: 24.95, cashAvailable: true, items: [{ topicId: TOPIC, topicTitle: '路线' }],
  }, over || {});
}
const FOUR = seatProduct({ productId: 12, productName: '四人小队票', seatCount: 4, cashPrice: 89.9, perPersonCashPrice: 22.47 }); // FIXTURE

// ---------- buyOptions(纯函数) ----------

test('没有服务端商品时购买层与改动前完全一致(只有自玩门票 + 场次票种)', () => {
  const info = Object.assign({}, INFO, { activityList: [{ id: 1 }], omsTicketList: [{ name: '团体票', price: 99, teamSize: 4 }] });
  assert.deepEqual(m.buyOptions(info, []), m.buyOptions(info));
  assert.deepEqual(m.buyOptions(info, undefined), m.buyOptions(info));
  assert.deepEqual(m.buyOptions(info).map((o) => o.key), ['pass', 't-团体票']);
});

test('在售双人票 / 小队票紧跟自玩门票;人数、价格、人均价只取服务端字段', () => {
  const info = Object.assign({}, INFO, { activityList: [{ id: 1 }], omsTicketList: [{ name: '团体票', price: 99, teamSize: 4 }] });
  const opts = m.buyOptions(info, [seatProduct(), FOUR]);
  assert.deepEqual(opts.map((o) => o.key), ['pass', 'p-11', 'p-12', 't-团体票']);
  const two = opts[1];
  assert.equal(two.kind, 'product');
  assert.equal(two.productId, 11);
  assert.equal(two.name, '双人票');
  assert.equal(two.people, 2);
  assert.equal(two.icon, 'two');
  assert.equal(two.priceText, '¥49.9');
  assert.equal(two.perPersonText, '人均 ¥24.95');
  assert.equal(opts[2].people, 4);
  assert.equal(opts[2].icon, 'team');
  assert.equal(opts[2].perPersonText, '人均 ¥22.47');
  assert.equal(opts[0].perPersonText, undefined, '单人门票不出人均价');
});

test('目录按 id 倒序回来(四人票在前)时购买层仍是 单人 → 双人 → 四人,名称/合计/人均原样取服务端', () => {
  const two = seatProduct({ productName: '路线·双人票' });
  const four = Object.assign({}, FOUR, { productName: '路线·四人小队票' });
  const opts = m.buyOptions(INFO, [four, two]);
  assert.deepEqual(opts.map((o) => [o.key, o.name, o.people, o.priceText, o.perPersonText]), [
    ['pass', '自玩门票', 1, '¥29.9', undefined],
    ['p-11', '路线·双人票', 2, '¥49.9', '人均 ¥24.95'],
    ['p-12', '路线·四人小队票', 4, '¥89.9', '人均 ¥22.47'],
  ]);
});

test('四人票到账:同行一步写 4 人,邀请带服务端原单 id', () => {
  const product = { productId: 12, productName: '路线·四人小队票', productKind: 1, seatCount: 4, items: [{ topicTitle: '路线' }] };
  const seats = pu.unlockSteps(product, { statusLabel: 'PAID', fulfillmentKind: 1, primaryRegistrationId: 9002 }).find((s) => s.key === 'seats');
  assert.equal(seats.title, '4 人可用');
  assert.equal(seats.links.length, 4);
  assert.equal(seats.inviteRegistrationId, 9002);
});

test('服务端没给人均价就不显示人均价(端上不自己除)', () => {
  const [, two] = m.buyOptions(INFO, [seatProduct({ perPersonCashPrice: null })]);
  assert.equal(two.perPersonText, '');
});

test('只列可现金购买、自玩路线、每份 >1 席、只覆盖本主题的商品', () => {
  const rejected = [
    seatProduct({ productId: 21, cashAvailable: false }),              // marketing.product.cash-enabled 关
    seatProduct({ productId: 22, cashAvailable: undefined }),          // 旧服务端没有该字段 ⇒ 不出
    seatProduct({ productId: 23, purchaseRoute: 2 }),                  // 团体报名路线
    seatProduct({ productId: 24, seatCount: 1 }),                      // 单席
    seatProduct({ productId: 25, items: [{ topicId: 999 }] }),         // 别的主题
    seatProduct({ productId: 26, items: [{ topicId: TOPIC }, { topicId: 78 }] }), // 城市包
    seatProduct({ productId: 27, cashPrice: null }),
    seatProduct({ productId: 28, productName: '' }),
  ];
  assert.deepEqual(m.buyOptions(INFO, rejected).map((o) => o.key), ['pass']);
});

test('主题不卖自玩门票时也不出多人票', () => {
  assert.deepEqual(m.buyOptions(Object.assign({}, INFO, { selfPlay: 0 }), [seatProduct()]), []);
});

// ---------- 到账分步:邀请同伴 ----------

test('自用多席订单到账:同行一步带上已付原单 id,可直接去邀请同伴', () => {
  const product = { productId: 11, productName: '双人票', productKind: 1, seatCount: 2, items: [{ topicTitle: '路线' }] };
  const steps = pu.unlockSteps(product, { statusLabel: 'PAID', fulfillmentKind: 1, primaryRegistrationId: 9001 });
  const seats = steps.find((s) => s.key === 'seats');
  assert.equal(seats.title, '2 人可用');
  assert.equal(seats.inviteRegistrationId, 9001);
  const noRow = pu.unlockSteps(product, { statusLabel: 'PAID', fulfillmentKind: 1, primaryRegistrationId: null });
  assert.equal(noRow.find((s) => s.key === 'seats').inviteRegistrationId, 0, '没有服务端原单 id 就不出邀请');
  assert.deepEqual(pu.unlockSteps(product, { statusLabel: 'PAID', fulfillmentKind: 2, primaryRegistrationId: 9001 }), [], '礼品不出到账分步');
  assert.equal(pu.unlockSteps(Object.assign({}, product, { seatCount: 1 }), { statusLabel: 'PAID', fulfillmentKind: 1, primaryRegistrationId: 9001 })
    .find((s) => s.key === 'seats'), undefined);
});

// ---------- 页面沙箱 ----------

function setByPath(target, key, value) {
  const parts = key.split('.');
  let cur = target;
  parts.slice(0, -1).forEach((p) => { if (!cur[p] || typeof cur[p] !== 'object') cur[p] = {}; cur = cur[p]; });
  cur[parts[parts.length - 1]] = value;
}

const pages = [];
afterEach(() => { for (const p of pages.splice(0)) p.onUnload && p.onUnload(); });

function sandbox(pagePath, stubAnalytics) {
  const requests = []; const navigations = []; const toasts = []; const storage = {};
  let config = null;
  const previous = { getApp: global.getApp, Page: global.Page, wx: global.wx };
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserType: () => 1, getUserID: () => 500, tips: (t) => toasts.push(t),
    sendRequest: (o) => { requests.push(o); },
    recordConsent: () => Promise.resolve({ code: 200 }),
  };
  global.getApp = () => app;
  global.Page = (c) => { config = c; };
  global.wx = {
    showLoading() {}, hideLoading() {}, showToast: (o) => toasts.push(o.title), showModal() {},
    requestPayment() {}, requestSubscribeMessage() {},
    navigateTo: (o) => { navigations.push(o.url); if (o.complete) o.complete(); },
    redirectTo: (o) => navigations.push(o.url),
    getSystemInfo() {}, getStorageSync: (k) => storage[k] || '', setStorageSync: (k, v) => { storage[k] = v; },
    createSelectorQuery: () => { const q = { in: () => q, select: () => q, selectAll: () => q, boundingClientRect: () => q, scrollOffset: () => q, exec: () => {} }; return q; },
  };
  const realAnalytics = require.cache[ANALYTICS_PATH];
  if (stubAnalytics) {
    require.cache[ANALYTICS_PATH] = { id: ANALYTICS_PATH, filename: ANALYTICS_PATH, loaded: true,
      exports: { track: () => true, flush() {}, setSessionContext() {}, sanitizeProperties: (x) => x } };
  }
  delete require.cache[pagePath];
  try { require(pagePath); } finally {
    global.getApp = previous.getApp; global.Page = previous.Page;
    delete require.cache[pagePath];
    if (stubAnalytics) { if (realAnalytics) require.cache[ANALYTICS_PATH] = realAnalytics; else delete require.cache[ANALYTICS_PATH]; }
  }
  const vm = Object.assign({}, config, {
    setData(patch, cb) { Object.entries(patch).forEach(([k, v]) => setByPath(this.data, k, v)); if (cb) cb(); },
  });
  vm.data = JSON.parse(JSON.stringify(config.data));
  pages.push(vm);
  return { vm, requests, navigations, toasts };
}

function topicPage() {
  const h = sandbox(TOPIC_PAGE, true);
  h.vm.data.info = Object.assign({}, INFO);
  h.vm.data.id = TOPIC;
  h.vm.lockedTip = () => false;
  h.vm._initWorkflow();
  return h;
}

function answerList(h, data) {
  const list = h.requests.filter((r) => r.url === '/api/marketing/product/list').pop();
  assert.ok(list, '应读在售商品目录');
  list.success({ code: 200, data });
  return list;
}

test('主题页:按 topicId 读在售目录;打开购买层后双人票排在自玩门票旁边', () => {
  const h = topicPage();
  h.vm._loadSeatProducts(h.vm.data.info);
  const list = answerList(h, [seatProduct()]);
  assert.deepEqual(list.data, { topicId: TOPIC, limit: 20 });
  assert.equal(list.method, 'GET');

  h.vm.selfPlayBuy();
  assert.deepEqual(h.vm.data.buyOpts.map((o) => o.key), ['pass', 'p-11']);
  assert.equal(h.vm.data.buySel, 0, '默认仍选单人自玩门票');
});

test('购买层已打开时目录才回来:补上多人票并保住当前选中项', () => {
  const h = topicPage();
  h.vm.selfPlayBuy();
  assert.deepEqual(h.vm.data.buyOpts.map((o) => o.key), ['pass']);
  h.vm._loadSeatProducts(h.vm.data.info);
  answerList(h, [seatProduct(), FOUR]);
  assert.deepEqual(h.vm.data.buyOpts.map((o) => o.key), ['pass', 'p-11', 'p-12']);
  assert.equal(h.vm.data.buyOpts[h.vm.data.buySel].key, 'pass');
});

test('选中双人票去结算(DEC-F12 A):打开与单人同一个结算层,按商品 id 向商品报价;不跳商品页、不走单人建单', () => {
  const h = topicPage();
  h.vm._loadSeatProducts(h.vm.data.info);
  answerList(h, [seatProduct(), FOUR]);
  h.vm.selfPlayBuy();
  h.vm.onBuyPick({ currentTarget: { dataset: { i: 2 } } });
  h.vm.onBuyGo();
  assert.equal(h.vm.data.selfPlayConfirmShow, false);
  assert.equal(h.vm.data.selfPlayCheckoutShow, true, '同一结算层');
  assert.deepEqual(h.navigations, []);
  const q = h.requests.filter((r) => r.url === '/api/marketing/product/quote');
  assert.equal(q.length, 1);
  assert.deepEqual(JSON.parse(q[0].data), { productId: 12, quantity: 1, fulfillmentKind: 1 });
  assert.equal(h.requests.filter((r) => r.url === '/api/registration/quote' || r.url === '/api/registration/create').length, 0);
  assert.equal(h.vm.data.checkout.view.single.title, '四人小队票');
  assert.equal(h.vm.data.checkout.view.peopleText, '4 人');
});

test('现金未开(cashAvailable=false)或主题不卖自玩:购买层只有原来的选项,单人仍进原结算层', () => {
  const h = topicPage();
  h.vm._loadSeatProducts(h.vm.data.info);
  answerList(h, [seatProduct({ cashAvailable: false })]);
  h.vm.selfPlayBuy();
  assert.deepEqual(h.vm.data.buyOpts.map((o) => o.key), ['pass']);
  h.vm.onBuyGo();
  assert.equal(h.vm.data.selfPlayCheckoutShow, true);
  assert.equal(h.navigations.length, 0);

  const closed = topicPage();
  closed.vm._loadSeatProducts(Object.assign({}, INFO, { selfPlay: 0 }));
  assert.equal(closed.requests.filter((r) => r.url === '/api/marketing/product/list').length, 0, '不卖自玩的主题不读目录');
});

test('目录读取失败 / 非 200:什么都不加', () => {
  const h = topicPage();
  h.vm._loadSeatProducts(h.vm.data.info);
  const list = h.requests.filter((r) => r.url === '/api/marketing/product/list').pop();
  list.success({ code: 500, msg: 'x' });
  h.vm.selfPlayBuy();
  assert.deepEqual(h.vm.data.buyOpts.map((o) => o.key), ['pass']);
});

test('商品页到账动效里点「邀请同伴」:去票内席位页,只带服务端已付原单 id', () => {
  const h = sandbox(PASS_PAGE, false);
  h.vm.onUnlockInvite({ detail: { registrationId: 9001 } });
  assert.deepEqual(h.navigations, ['/subpackageJourney/pages/seats/index?registrationId=9001']);
  assert.equal(h.vm.data.unlock.show, false);
  h.vm.onUnlockInvite({ detail: { registrationId: 0 } });
  h.vm.onUnlockInvite({ detail: {} });
  assert.equal(h.navigations.length, 1, '没有原单 id 不跳');
});

test('业主 2026-11-24:购买层分段只写「双人票 / 四人小队票」,票面与合计仍用服务端全名', () => {
  const two = seatProduct({ productName: '中环隐咒·双人票' });
  const four = Object.assign({}, FOUR, { productName: '中环隐咒·四人小队票' });
  const opts = m.buyOptions(INFO, [two, four]);
  assert.deepEqual(opts.slice(1).map((o) => [o.name, o.short]), [['中环隐咒·双人票', '双人票'], ['中环隐咒·四人小队票', '四人小队票']]);
  assert.deepEqual(m.buyOptions(INFO, [seatProduct()]).slice(1).map((o) => o.short), ['双人票'], '没有前缀时原样');
  const wxml = require('node:fs').readFileSync(path.join(ROOT, 'pages/topic/index/index.wxml'), 'utf8');
  assert.match(wxml, /<text class="bseg__t">\{\{item\.short \|\| item\.name\}\}<\/text>/);
});
