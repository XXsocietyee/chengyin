'use strict';

// §4.2: 1-Second perk-only redemption, Counter-Stand Self-Redeem modal, and 19-route Finish Station card
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const PLAY_JS = path.join(ROOT, 'pages/play/index.js');
const PLAY_WXML = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxml'), 'utf8');
const PLAY_WXSS = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxss'), 'utf8');
const MERCHANT_JS = path.join(ROOT, 'pages/play/merchant/index.js');
const standRedeemUtil = require('../../pages/play/utils/stand-redeem.js');

function applyPatch(target, patch) {
  Object.keys(patch || {}).forEach((key) => {
    const parts = key.split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = patch[key];
  });
}

function createPlayPage(overrides = {}) {
  let definition;
  const requests = [];
  const navigations = [];
  const intervals = [];
  const app = {
    globalData: { user_id: 1001, features: {} },
    getUserID: () => '1001',
    getAuthorization: () => 'token-1001',
    getSession: () => ({ getRevision: () => 0 }),
    sendRequest(opts) { requests.push(opts); },
    getRequestErrorMessage: (r, fallback) => (r && r.msg) || fallback,
  };
  const wxMock = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    nextTick(cb) { if (cb) cb(); },
    navigateTo(opts) { navigations.push(opts.url); if (opts.success) opts.success(); },
    scanCode(opts) { if (wxMock._nextScan) wxMock._nextScan(opts); },
  };
  vm.runInNewContext(fs.readFileSync(PLAY_JS, 'utf8'), {
    require: createRequire(PLAY_JS),
    getApp: () => app,
    Page(def) { definition = def; },
    wx: wxMock,
    console,
    Date,
    setTimeout(fn) { return fn; },
    clearTimeout() {},
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    clearInterval(id) { intervals[id - 1] = null; },
  }, { filename: PLAY_JS });

  const page = Object.assign({}, definition, {
    data: Object.assign(JSON.parse(JSON.stringify(definition.data)), { mode: 2, activityId: '501', topicId: '401', regId: '801' }, overrides.data || {}),
    _playOwner: '1001',
    _playLoginContext: { generation: 0 },
    _playDisposed: false,
    _routeState: { routeMode: 'LINEAR', sessionId: '77', attributes: {} },
    _isPlayAccountCurrent: () => true,
    _boundPlayOwner: () => '1001',
    _sessionKey: () => 'act:501',
    _sessionParams: () => ({ activityId: '501' }),
    setData(patch, cb) { applyPatch(this.data, patch); if (cb) cb(); },
    closeChapStory() {},
    rebuild() {},
    loadData() {},
    _syncStatusBar() {},
    _triggerCelebration() {},
    buildReview() {},
    _startRouteCard() {},
    paintRouteThumb() {},
    _openFinale: () => false,
    _openMedalScreen() {},
    loadEnding() {},
    loadNewLifeOS() {},
    loadMilestone() {},
    loadStageEnd() {},
    loadSessionStats() {},
    loadHudCharacter() {},
    loadFinishRouteRecommendation() {},
    loadFinishResult() {},
    _endTeamTrail() {},
    _endRunSession() {},
    _holdFinishForTrail: () => false,
    _buildBranchPath: () => [],
  });
  return { page, requests, navigations, intervals, wxMock };
}

function createMerchantPage(node) {
  let def;
  const saved = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  global.Page = (o) => { def = o; };
  global.getApp = () => ({ globalData: { features: {} }, isDevEnv: () => false, sendRequest() {}, chooseImage() {} });
  global.wx = { getStorageSync: () => '', setStorageSync() {} };
  delete require.cache[MERCHANT_JS];
  require(MERCHANT_JS);
  Object.assign(global, saved);

  const calls = [];
  const prev = { data: { nodes: [node], regId: 801 }, _sessionParams: () => ({ activityId: 501 }) };
  const page = Object.assign({}, def, {
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch, cb) { applyPatch(this.data, patch); if (cb) cb(); },
    _showVerifyCode() { calls.push('showVerifyCode'); },
    _confirmMerchantConsent() { calls.push('consent'); return Promise.resolve(true); },
    _loadMerchantConsent() { calls.push('loadConsent'); },
  });
  const saved2 = { wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.wx = {
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 700 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 280, right: 367, height: 32, width: 87 }),
  };
  global.getCurrentPages = () => [prev, page];
  try {
    page.onLoad({ nodeId: String(node.nodeId) });
  } finally {
    Object.assign(global, saved2);
  }
  return { page, calls };
}

test('1a: perk-only heroEnter and openMerchantFromSheet open openEntryQr directly without navigating to merchant/index', () => {
  const { page, navigations } = createPlayPage();
  const opened = [];
  page.openEntryQr = () => { opened.push('entryQr'); };
  const perkNode = page.normNode({ nodeId: 701, merchantId: 3003, hasGame: false, done: false, perk: { name: '手冲美式' } }, 0, 2);
  page.data.nodes = [perkNode];
  page.data.hero = { show: true, node: page._heroView(perkNode) };

  page.heroEnter();
  assert.deepEqual(opened, ['entryQr']);
  assert.deepEqual(navigations, [], 'must not detour through pages/play/merchant/index');

  page.data.sheet = { show: true, node: perkNode };
  page.openMerchantFromSheet();
  assert.deepEqual(opened, ['entryQr', 'entryQr']);
  assert.deepEqual(navigations, [], 'sheet entry for perk-only must also open QR directly');

  // Game shop on sheet still goes to merchant/index
  const gameNode = page.normNode({ nodeId: 702, merchantId: 3004, hasGame: true, done: false }, 1, 2);
  page.data.sheet = { show: true, node: gameNode };
  page.openMerchantFromSheet();
  assert.deepEqual(navigations, ['/pages/play/merchant/index?nodeId=702']);
});

test('1b: perk-only shop on merchant page skips _loadMerchantConsent and _confirmMerchantConsent phone popup; game shop keeps consent', async () => {
  const perkShop = { nodeId: 701, merchantId: 3003, hasGame: false, hasAdvanced: false, arrived: false, done: false, perk: { name: '招牌饮品' } };
  const perk = createMerchantPage(perkShop);
  assert.deepEqual(perk.calls, [], 'perk-only shop does not preload consent');
  await perk.page.openVerifyCode();
  assert.deepEqual(perk.calls, ['showVerifyCode'], 'perk-only shop skips _confirmMerchantConsent popup');

  const gameShop = { nodeId: 702, merchantId: 3004, hasGame: true, hasAdvanced: false, arrived: true, done: false };
  const game = createMerchantPage(gameShop);
  assert.deepEqual(game.calls, ['loadConsent']);
  await game.page.openVerifyCode();
  assert.deepEqual(game.calls, ['loadConsent', 'consent', 'showVerifyCode'], 'game shop preserves per-store consent');
});

test('1c: /api/play/nodes response auto-populates regId so openEntryQr works without entering from ticket wallet', async () => {
  const { page, requests } = createPlayPage({ data: { regId: '' } });
  const scenes = [];
  page.openScene = (id, params) => { scenes.push({ id, params }); };
  page.loadData = Object.getPrototypeOf ? undefined : undefined;
  // Re-bind real loadData from definition by creating a fresh page without stubbing loadData
  const fresh = createPlayPage({ data: { regId: '' } });
  fresh.page.openScene = (id, params) => { scenes.push({ id, params }); };
  // Invoke real loadData via VM definition directly
  let realDef;
  const reqs = [];
  vm.runInNewContext(fs.readFileSync(PLAY_JS, 'utf8'), {
    require: createRequire(PLAY_JS),
    getApp: () => ({
      globalData: { user_id: 1001, features: {} },
      getUserID: () => '1001',
      getAuthorization: () => 'token-1001',
      getSession: () => ({ getRevision: () => 0 }),
      sendRequest(opts) { reqs.push(opts); },
    }),
    Page(d) { realDef = d; },
    wx: { getStorageSync: () => '', setStorageSync() {}, nextTick(cb) { if (cb) cb(); } },
    console, Date, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
  }, { filename: PLAY_JS });

  const inst = Object.assign({}, fresh.page, {
    loadData: realDef.loadData,
    _applyStoryVars() {}, _applyLook() {}, _probeCasebook() {}, _applyCast() {},
    _noteStationImageContext() {}, _acceptRouteStateProjection: () => true,
    _nodesForRoute: (c) => c, _currentCompletedHistory: () => null, _discardCompletedHistory() {},
    _routeStateVersionKnown: () => false, _fillStationPhotos() {}, _routeNoticeForState: () => '',
    _loadCompletedHistory() {}, _ensureSessionClock() {}, _syncIdleStats() {}, _syncRunState() {},
    _openStory() {}, _restoreRunSession() {}, loadTeamProgress() {}, _loadPlayerGameModule() {},
    _consumePendingStart() {}, _consumeVisitOpen() {}, _saveFeStoryCache() {}, _startThemeBgm() {},
  });
  inst.loadData(true);
  assert.equal(reqs[0].url, '/api/play/nodes');
  reqs[0].success({
    code: 200,
    data: {
      topicId: 401,
      topicName: '静安咖啡路线',
      mode: 2,
      productType: 2,
      registered: true,
      regId: 9001,
      nodes: [{ nodeId: 701, merchantId: 3003, name: '白日梦咖啡', hasGame: false }],
      chapters: [],
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(inst.data.regId, '9001', 'regId auto-resolved from /api/play/nodes');
  inst.openEntryQr();
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].id, 'qr-ticket');
  assert.equal(scenes[0].params.registrationId, '9001');
});

test('2: counter-stand self-redeem modal shows live animated green stamp, ticking clock seconds, bold perk title, and daily serial number', async () => {
  const clock = standRedeemUtil.formatClockParts(Date.UTC(2026, 10, 26, 6, 32, 7));
  assert.equal(clock.dateText, '2026-11-26');
  assert.equal(clock.clockText, '14:32:07');

  const view = standRedeemUtil.buildStandRedeemView(
    { shopName: '白日梦咖啡', perkTitle: '招牌手冲美式 1 杯', dailySerialNo: 8, playerName: '林*', replayed: false },
    null,
    Date.UTC(2026, 10, 26, 6, 32, 7)
  );
  assert.equal(view.show, true);
  assert.equal(view.perkTitle, '招牌手冲美式 1 杯');
  assert.equal(view.serialCode, 'NO.008');
  assert.equal(view.serialLabel, '今日第 008 号');
  assert.equal(view.playerName, '林*');
  assert.equal(view.clockText, '14:32:07');
  assert.equal('phone' in view, false);

  const { page, requests, intervals, wxMock } = createPlayPage();
  const perkNode = page.normNode({ nodeId: 701, merchantId: 3003, name: '白日梦咖啡', hasGame: false, done: false, perk: { name: '招牌手冲美式 1 杯' } }, 0, 2);
  page.data.nodes = [perkNode];
  wxMock._nextScan = (opts) => opts.success({ result: 'STAND-CAFE-701' });

  page.scanStandRedeem({ currentTarget: { dataset: { id: 701 } } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/play/self-redeem');
  assert.equal(requests[0].data.code, 'STAND-CAFE-701');
  requests[0].success({
    code: 200,
    data: {
      redemptionId: 999,
      replayed: false,
      nodeId: 701,
      shopName: '白日梦咖啡',
      perkTitle: '招牌手冲美式 1 杯',
      playerName: '林*',
      dailySerialNo: 15,
      redeemedAt: Date.now(),
    },
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(page.data.standRedeem.show, true);
  assert.equal(page.data.standRedeem.serialCode, 'NO.015');
  assert.equal(page.data.standRedeem.serialLabel, '今日第 015 号');
  assert.equal(page.data.standRedeem.perkTitle, '招牌手冲美式 1 杯');
  assert.equal(page.data.nodes[0].done, true);
  assert.equal(intervals.filter(Boolean).length, 1, 'live 1s clock timer running');

  page.closeStandRedeem();
  assert.equal(page.data.standRedeem.show, false);
  assert.equal(intervals.filter(Boolean).length, 0, 'clock timer cleared on close');

  // Verify WXML & WXSS contain live animated green verified stamp + ticking clock + bold perk + serial
  assert.match(PLAY_WXML, /class="stand-redeem[\s\S]*stand-redeem__pulse[\s\S]*stand-redeem__stamp[\s\S]*已核销/);
  assert.match(PLAY_WXML, /standRedeem\.serialCode/);
  assert.match(PLAY_WXML, /standRedeem\.perkTitle/);
  assert.match(PLAY_WXML, /standRedeem\.clockText/);
  assert.match(PLAY_WXSS, /@keyframes standStampPulse/);
  assert.match(PLAY_WXSS, /@keyframes standStampPop/);
});

test('3: 19-route Finish Station card renders below finish recap when finishCoupon configured and links to 1-sec redeem/QR', async () => {
  const { page, requests } = createPlayPage({ data: { mode: 1, allDone: true } });
  const scenes = [];
  let voucherOpened = 0;
  page.openScene = (id, params) => { scenes.push({ id, params }); };
  page.openVoucher = () => { voucherOpened += 1; };
  page._themeReward = {
    finishCoupon: { id: 777, name: '完赛美式一杯', amount: 18, endTime: '2026-12-31' },
    finishStation: { shopName: '终点驿站咖啡', shopAddress: '安福路 108 号' },
  };
  page._lifeEndingShown = true;
  page._lifeEndingShownScope = JSON.stringify(['1001', 'act:501', '77']);

  page.openFinish();
  assert.ok(page.data.finishStation, 'finishStation populated from finishCoupon');
  assert.equal(page.data.finishStation.eyebrow, '终点完赛驿站');
  assert.equal(page.data.finishStation.perkName, '完赛美式一杯');
  assert.equal(page.data.finishStation.shopName, '终点驿站咖啡');
  assert.equal(page.data.finishStation.shopAddress, '安福路 108 号');

  // Before myrecvlist returns, tapping falls back to _syncVoucherView + openVoucher
  page.openFinishStationRedeem();
  assert.equal(voucherOpened, 1);

  // Sync from ApiCouponController /api/coupon/myrecvlist resolves exact couponHistoryId
  const couponReq = requests.find((r) => r.url === '/api/coupon/myrecvlist');
  assert.ok(couponReq, 'queries /api/coupon/myrecvlist');
  couponReq.success({
    code: 200,
    data: [{ id: 8888, couponId: 777, couponName: '完赛美式一杯', useStatus: 0, shopName: '终点驿站咖啡', shopAddress: '安福路 108 号' }],
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(page.data.finishStation.couponHistoryId, '8888');

  page.openFinishStationRedeem();
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].id, 'qr-coupon');
  assert.equal(scenes[0].params.couponHistoryId, '8888');

  // Without finishCoupon, finishStation is null
  page._themeReward = null;
  page.openFinish();
  assert.equal(page.data.finishStation, null);

  // WXML placement: Finish Station card sits inside finish recap above finish-route-recommendation
  const finIdx = PLAY_WXML.indexOf('class="finsheet');
  const stationIdx = PLAY_WXML.indexOf('class="finish-station');
  const recIdx = PLAY_WXML.indexOf('class="finish-route-recommendation"');
  assert.ok(finIdx > 0 && stationIdx > finIdx && stationIdx < recIdx, '终点完赛驿站 card appears below finish recap');
});
