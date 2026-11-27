'use strict';
// UI-B polish & cross-page theme consistency regression tests (feature/cloud-1126-ui-b-polish).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── (1) UI-B1: Confirm order 1-decimal per-person price & participant name no-wrap ──

test('UI-B1: per-person price formats consistently to 1 decimal place in buyOptions and checkoutView', () => {
  const { yuanOneDecimal } = require('../../utils/money-format.js');
  assert.equal(yuanOneDecimal(24.95), '¥25.0');
  assert.equal(yuanOneDecimal(22.47), '¥22.5');
  assert.equal(yuanOneDecimal(29), '¥29.0');
  assert.equal(yuanOneDecimal(29.9), '¥29.9');
  assert.equal(yuanOneDecimal(0), '¥0.0');
  assert.equal(yuanOneDecimal(-12.34), '−¥12.3');
  assert.equal(yuanOneDecimal(null), null);

  const motion = require('../../pages/topic/utils/topic-motion.js');
  const { checkoutView } = require('../../pages/topic/utils/checkout-view.js');
  const info = { id: 77, name: '城市探索', selfPlay: 1, selfPlayPrice: 29.9 };
  const products = [
    { productId: 11, productName: '双人票', purchaseRoute: 1, seatCount: 2, cashPrice: 49.9, perPersonCashPrice: 24.95, cashAvailable: true, items: [{ topicId: 77 }] },
    { productId: 12, productName: '四人小队票', purchaseRoute: 1, seatCount: 4, cashPrice: 89.9, perPersonCashPrice: 22.47, cashAvailable: true, items: [{ topicId: 77 }] },
  ];
  const opts = motion.buyOptions(info, products);
  assert.equal(opts[1].perPersonText, '人均 ¥25.0');
  assert.equal(opts[2].perPersonText, '人均 ¥22.5');

  const viewFromText = checkoutView({ info, option: { kind: 'product', productId: 11, name: '双人票', people: 2, price: 49.9, perPersonText: '人均 ¥24.95' }, quoteState: 'loading' });
  assert.equal(viewFromText.single.line, '人均 ¥25.0');

  const viewFromNum = checkoutView({ info, option: { kind: 'product', productId: 12, name: '四人小队票', people: 4, price: 89.9, perPersonCashPrice: 22.47 }, quoteState: 'loading' });
  assert.equal(viewFromNum.single.line, '人均 ¥22.5');
});

test('UI-B1: confirm order participant row prevents trailing digits from wrapping to a second line', () => {
  const wxss = read('pages/topic/components/cy/self-play-checkout/index.wxss');
  assert.match(wxss, /\.ck__who-main\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(wxss, /\.ck__who-n\s*\{[^}]*white-space:\s*nowrap[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/);
  assert.match(wxss, /\.ck__who-p\s*\{[^}]*flex-shrink:\s*0[^}]*white-space:\s*nowrap/);
  assert.match(wxss, /\.ck__more\s*\{[^}]*flex-shrink:\s*0/);
});

// ── (2) UI-B3: Home / Mine / Theme card dark bottom gradient scrims ──

test('UI-B3: Home, Mine, Search, and Theme cards use strengthened multi-stop dark bottom scrims', () => {
  const home = read('pages/index/index.wxss');
  assert.match(home, /\.v3-nearby-mask\s*\{[^}]*rgba\(0,0,0,0\.62\)\s*64%[^}]*rgba\(0,0,0,0\.92\)\s*100%/);
  assert.match(home, /\.v3-reco-hero-mask\s*\{[^}]*rgba\(2,1,5,0\.72\)\s*64%[^}]*rgba\(2,1,5,0\.96\)\s*100%/);
  assert.match(home, /\.v2-fcard::after\s*\{[^}]*rgba\(0,\s*0,\s*0,\s*\.58\)\s*48%[^}]*rgba\(0,\s*0,\s*0,\s*\.92\)\s*100%/);

  const mine = read('subpackageMember/components/cy/profile/index.wxss');
  assert.match(mine, /\.pc-ord-shade\s*\{[^}]*rgba\(0,0,0,\.74\)\s*64%[^}]*rgba\(0,0,0,\.94\)\s*100%/);
  assert.doesNotMatch(mine, /\.pc-ord-shade\s*\{[^}]*rgba\(48,48,48/);

  const searchRes = read('pages/search2/result/index.wxss');
  assert.match(searchRes, /\.tpl-big__shade\s*\{[^}]*rgba\(0,0,0,\.74\)\s*64%[^}]*rgba\(0,0,0,\.94\)\s*100%/);

  const shelf = read('pages/templatedetail/shelf/index.wxss');
  assert.match(shelf, /\.lc__cap\s*\{[^}]*rgba\(0,\s*0,\s*0,\s*0\.62\)\s*44%[^}]*rgba\(0,\s*0,\s*0,\s*0\.92\)\s*100%/);

  const feedCard = read('components/cy/feed-play-card/index.wxss');
  assert.match(feedCard, /\.feed-play-card__scrim\s*\{[^}]*rgba\(0,\s*0,\s*0,\s*\.68\)\s*60%[^}]*rgba\(0,\s*0,\s*0,\s*\.94\)\s*100%/);
});

// ── (3) UI-B5: Game library bottom clearance above floating + button ──

test('UI-B5: pages/template/index reserves full non-shrinking bottom clearance above the floating + button', () => {
  const wxss = read('pages/template/index.wxss');
  const rule = wxss.match(/\.tpl-bottom-safe\s*\{([^}]*)\}/);
  assert.ok(rule, 'missing .tpl-bottom-safe');
  assert.match(rule[1], /flex-shrink:\s*0/);
  assert.match(rule[1], /var\(--cy-tabbar-h\)/);
  assert.match(rule[1], /var\(--cy-comp-publish-trigger\)/);
  assert.match(rule[1], /var\(--cy-space-6\)/);
  assert.doesNotMatch(rule[1], /\b84rpx\b/, 'must not underestimate floating + button height as 84rpx');
});

// ── (4) UI-B7: My participation contradictory badges resolved ──

function loadMycanyu() {
  const pagePath = path.resolve(ROOT, 'subpackageMember/mycanyu/mycanyu.js');
  let config = null;
  const prev = { getApp: global.getApp, Page: global.Page, wx: global.wx };
  global.getApp = () => ({ globalData: {}, getUserID: () => '7', sendRequest() {} });
  global.Page = (c) => { config = c; };
  global.wx = {};
  delete require.cache[require.resolve(pagePath)];
  try { require(pagePath); } finally {
    global.getApp = prev.getApp; global.Page = prev.Page; global.wx = prev.wx;
    delete require.cache[require.resolve(pagePath)];
  }
  const vmObj = Object.assign({}, config);
  vmObj.data = JSON.parse(JSON.stringify(config.data));
  return vmObj;
}

test('UI-B7: completed mycanyu card never shows simultaneous 已完成 + 时间待定 + 未核销', () => {
  const page = loadMycanyu();

  // Completed via firstSuccessfulScanAt with no startDate/endDate and verificationStatus=0
  const completedWithScan = page.normalize({
    id: 101, ownerType: 1, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0,
    firstSuccessfulScanAt: '2026-10-01 10:00:00',
    cmsTopic: { name: '城市线索' },
  });
  assert.equal(completedWithScan.stateText, '已完成');
  assert.equal(completedWithScan.dateText, '10.01');
  assert.notEqual(completedWithScan.dateText, '时间待定');
  assert.equal(completedWithScan.verificationText, '未核销');
  assert.equal(completedWithScan.showVerificationBadge, false);

  // Completed with no dates at all -> dateText omitted (empty string), no 未核销 badge
  const completedNoDates = page.normalize({
    id: 102, ownerType: 1, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0,
    topicCompleted: true,
    cmsTopic: { name: '已完成路线' },
  });
  assert.equal(completedNoDates.stateText, '已完成');
  assert.equal(completedNoDates.dateText, '');
  assert.equal(completedNoDates.showVerificationBadge, false);

  // Self-play pass with expiresAt -> shows validity instead of 时间待定, no verification badge
  const selfPlayPass = page.normalize({
    id: 103, ownerType: 1, purchaseKind: 2, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0,
    expiresAt: '2099-12-31 23:59:59',
    cmsTopic: { name: '自玩路线' },
  });
  assert.match(selfPlayPass.dateText, /^可玩至 /);
  assert.equal(selfPlayPass.showVerificationBadge, false);

  // Active upcoming offline activity with verificationStatus=0 still shows 未核销 badge
  const upcomingOffline = page.normalize({
    id: 104, ownerType: 2, registrationStatus: 2, paymentStatus: 2, verificationStatus: 0,
    cmsActivity: { name: '线下活动', startDate: '2099-05-01', endDate: '2099-05-02' },
  });
  assert.equal(upcomingOffline.stateText, '未开始');
  assert.equal(upcomingOffline.dateText, '05.01 - 05.02');
  assert.equal(upcomingOffline.showVerificationBadge, true);

  const wxml = read('subpackageMember/mycanyu/mycanyu.wxml');
  assert.match(wxml, /class="canyubox_li_right_time"\s+wx:if="\{\{item\.dateText\}\}"/);
  assert.match(wxml, /<cy-badge\s+wx:if="\{\{item\.showVerificationBadge\}\}"[^>]*label="\{\{item\.verificationText\}\}"/);
});

// ── (5) UI-B12: Official activity list & stamp album redundant 0-item copy removed ──

test('UI-B12: official activity list and roam task list omit 0-item summary copy when empty', () => {
  // pages/activity/list
  const listPath = path.resolve(ROOT, 'pages/activity/list/index.js');
  let pageCfg;
  vm.runInNewContext(fs.readFileSync(listPath, 'utf8'), {
    require: createRequire(listPath),
    getApp: () => ({ globalData: { statusBarHeight: 20, navBarHeight: 44 }, getUserID: () => '1', getAuthorization: () => 't', sendRequest() {} }),
    Page: (c) => { pageCfg = c; },
    wx: { pageScrollTo() {} },
    setTimeout, clearTimeout, Date, console,
  }, { filename: listPath });
  const listPage = Object.assign({}, pageCfg, {
    data: JSON.parse(JSON.stringify(pageCfg.data)),
    _all: [], _mine: [], _loadError: false, _publicLoading: false, _mineError: false, _mineLoading: false,
    setData(patch) { Object.assign(this.data, patch); },
  });
  listPage.applyFilter();
  assert.equal(listPage.data.events.length, 0);
  assert.equal(listPage.data.summary, '', 'empty activity list must not render redundant 0-item summary');
  assert.equal(listPage.data.emptyTitle, '暂无进行中的活动');

  listPage._all = [{ id: 1, title: '城市徒步', _live: true, status: 2 }];
  listPage.applyFilter();
  assert.equal(listPage.data.summary, '进行中 · 共 1 个活动');

  // subpackageRoam/components/cy/scene-roam-task-list
  const taskPath = path.resolve(ROOT, 'subpackageRoam/components/cy/scene-roam-task-list/index.js');
  let compCfg;
  vm.runInNewContext(fs.readFileSync(taskPath, 'utf8'), {
    require: createRequire(taskPath),
    getApp: () => ({ globalData: {}, getUserID: () => '1', sendRequest() {} }),
    Component: (c) => { compCfg = c; },
    setTimeout, clearTimeout, Date, console,
  }, { filename: taskPath });
  const taskComp = Object.assign({}, compCfg.methods, {
    data: JSON.parse(JSON.stringify(compCfg.data)),
    setData(patch) { Object.assign(this.data, patch); },
  });
  taskComp._filter();
  assert.equal(taskComp.data.events.length, 0);
  assert.equal(taskComp.data.summary, '');
  assert.match(read('subpackageRoam/components/cy/scene-roam-task-list/index.wxml'), /class="task-summary"\s+wx:if="\{\{summary\}\}"/);

  // Stamp albums hide 0-count headers when empty
  assert.match(read('subpackageP3/pages/stamp-album/index/index.wxml'), /class="al-hd"\s+wx:if="\{\{loaded && total > 0\}\}"/);
  assert.match(read('subpackageRoam/components/cy/scene-roam-stamp-album/index.wxml'), /class="album-sub"\s+wx:if="\{\{loaded && total > 0\}\}"/);
});

// ── (6) UI-B15 & UI-B17: Invoice gating & preview-nodata search bar bleed prevention ──

test('UI-B15: invoice entries default off, reset on session clear, and block navigation/reads when unlaunched', () => {
  const appSrc = read('app.js');
  assert.match(appSrc, /features:\s*\{[^}]*userInvoice:\s*false/);
  assert.match(appSrc, /communityPostWrite:\s*false,\s*userInvoice:\s*false/);
  assert.match(appSrc, /userInvoice:\s*res\.data\.userInvoice === true/);

  // Settings goInvoice blocks navigation when features.userInvoice !== true
  const shezhiPath = path.resolve(ROOT, 'pages/shezhi/shezhi.js');
  const calls = [];
  let shezhi;
  vm.runInNewContext(fs.readFileSync(shezhiPath, 'utf8'), {
    require: () => ({}),
    getApp: () => ({ globalData: { features: { userInvoice: false } } }),
    Page: (c) => { shezhi = c; },
    wx: { navigateTo: (o) => calls.push(o.url) },
  }, { filename: shezhiPath });
  shezhi.goInvoice();
  assert.deepEqual(calls, []);

  // Direct invoice page short-circuits to unavailable when userInvoice === false
  const baseSrc = read('subpackageMember/invoice/base.js');
  assert.match(baseSrc, /features\.userInvoice === false/);

  // Order detail skips invoice eligibility request when userInvoice === false
  const orderDetailPath = path.resolve(ROOT, 'subpackageMember/components/cy/scene-member-order-detail/index.js');
  let odDef; const odReqs = [];
  vm.runInNewContext(fs.readFileSync(orderDetailPath, 'utf8'), {
    Component: (d) => { odDef = d; },
    getApp: () => ({ globalData: { features: { userInvoice: false } }, getUserID: () => 7, sendRequest: (o) => odReqs.push(o) }),
    wx: {}, require: createRequire(orderDetailPath), setTimeout, clearTimeout, console,
  }, { filename: orderDetailPath });
  const od = Object.assign({}, odDef.methods, { data: JSON.parse(JSON.stringify(odDef.data)), setData(p) { Object.assign(this.data, p); } });
  od._attached = true; od._orderId = '5'; od._orderGeneration = 1;
  od.loadInvoice({ id: 5, paymentStatus: 2, isFreeOrder: false });
  assert.equal(od.data.invoiceRow.show, false);
  assert.equal(odReqs.length, 0);
});

test('UI-B17: map-address-search does not render in dark play mode with empty places/coords so preview-nodata has no search bleed', () => {
  const wxml = read('components/cy/map-address-search/index.wxml');
  assert.match(wxml, /<view\s+wx:if="\{\{!dark \|\| open \|\| \(places && places\.length\) \|\| \(lat && lng\)\}\}"\s+class="mas/);
});

// ── (7) Cross-page theme consistency: pages/merchant/reviews & pages/coop/finance ──

test('Cross-page theme: pages/merchant/reviews and pages/coop/finance align to merchant light theme', () => {
  const lint = require('../../scripts/ui-theme-unit-lint.js');
  for (const route of ['pages/merchant/reviews/index', 'pages/coop/finance/index']) {
    assert.equal(lint.classifyPageDomain(route), 'merchant', `${route} must belong to merchant domain`);
    const wxml = read(`${route}.wxml`);
    assert.match(wxml, /\btheme-merchant\b/, `${route} root must declare theme-merchant`);
    assert.doesNotMatch(wxml, /\btheme-dark\b/, `${route} must not declare theme-dark`);
    const wxss = read(`${route}.wxss`);
    assert.match(wxss, /@import\s+['"]\.\.\/\.\.\/\.\.\/style\/merchant-light\.wxss['"];/, `${route} must import merchant-light.wxss`);
    const json = JSON.parse(read(`${route}.json`));
    assert.equal(json.navigationBarTextStyle, 'black', `${route} status bar text must be black`);
    assert.equal(json.backgroundColor, '#F3F4F4', `${route} background must be merchant light #F3F4F4`);
    assert.equal(json.backgroundColorTop, '#F3F4F4');
    assert.equal(json.backgroundColorBottom, '#F3F4F4');
    const js = read(`${route}.js`);
    assert.match(js, /onShow\(\)\s*\{[\s\S]*?merchantTheme\.merchantPageShow\(\);/);
  }
  assert.deepEqual(lint.findThemeErrors(ROOT), []);
});
