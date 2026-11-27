'use strict';
// FIXA item 2(2026-11-25 业主):纯权益店(没配玩法的商家节点)在商家页先给权益卡与核销码,
// 没有拍照这一步,到店成功后自动打开核销码;有玩法的店流程不变。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const FILE = require.resolve('../../pages/play/merchant/index.js');
const WXML = fs.readFileSync(path.join(ROOT, 'pages/play/merchant/index.wxml'), 'utf8');

let def;
(function capture() {
  const saved = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  global.Page = (o) => { def = o; };
  global.getApp = () => ({ globalData: { features: {} }, isDevEnv: () => false, sendRequest() {}, chooseImage() {} });
  global.wx = { getStorageSync: () => '', setStorageSync() {} };
  delete require.cache[FILE];
  require(FILE);
  Object.assign(global, saved);
})();

function applyData(target, update) {
  Object.keys(update).forEach((key) => {
    const parts = key.split('.');
    let cur = target;
    for (let i = 0; i < parts.length - 1; i += 1) { if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {}; cur = cur[parts[i]]; }
    cur[parts[parts.length - 1]] = update[key];
  });
}

function load(node, query) {
  const calls = [];
  const prev = { data: { nodes: [node], regId: 5 }, _sessionParams: () => ({ activityId: 1 }) };
  const page = Object.assign({}, def, {
    data: JSON.parse(JSON.stringify(def.data)),
    setData(u, cb) { applyData(this.data, u); if (cb) cb(); },
    openVerifyCode() { calls.push('verify'); },
    openTaskCard() { calls.push('task'); },
    openGame() { calls.push('game'); },
    openAdvancedGame() { calls.push('advanced'); },
    openPreferenceGame() { calls.push('preference'); },
    _loadMerchantConsent() {},
  });
  const saved = { wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.wx = { getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 700 }), getMenuButtonBoundingClientRect: () => ({ top: 24, bottom: 56, left: 280, right: 367, height: 32, width: 87 }) };
  global.getCurrentPages = () => [prev, page];
  try { page.onLoad(Object.assign({ nodeId: String(node.nodeId) }, query || {})); } finally { Object.assign(global, saved); }
  page.calls = calls;
  return page;
}

const PERK_SHOP = { nodeId: 3, merchantId: 88, hasGame: false, hasAdvanced: false, arrived: false, done: false, perk: { name: '招牌饮品一杯' } };
const GAME_SHOP = { nodeId: 4, merchantId: 89, hasGame: true, question: '几楼?', options: { A: '1', B: '2' }, arrived: false, done: false, perk: { name: '小食' } };

test('perk-only shop is detected on load; game shop is not', () => {
  assert.equal(load(PERK_SHOP).data.perkOnly, true);
  assert.equal(load(GAME_SHOP).data.perkOnly, false);
  assert.equal(load(Object.assign({}, GAME_SHOP, { hasGame: false, hasAdvanced: true })).data.perkOnly, false);
});

test('after arrival a perk-only shop opens the redemption code, not the photo task card', () => {
  const page = load(Object.assign({}, PERK_SHOP, { arrived: true }));
  page._maybeAutoPopup();
  assert.deepEqual(page.calls, ['verify']);
});

test('game shop after arrival is unchanged (opens its game)', () => {
  const page = load(Object.assign({}, GAME_SHOP, { arrived: true }));
  page._maybeAutoPopup();
  assert.deepEqual(page.calls, ['game']);
  const plain = load(Object.assign({}, GAME_SHOP, { arrived: true, question: '' }));
  plain._maybeAutoPopup();
  assert.deepEqual(plain.calls, ['task']);
});

test('「我已到店」on a perk-only shop asks for the auto popup so the code opens right after arrival', () => {
  const page = load(PERK_SHOP);
  let opts = null;
  page._submitProof = (kind, payload, msg, o) => { opts = o; };
  const saved = global.wx;
  global.wx = { getLocation: (o) => o.success({ latitude: 1, longitude: 2, accuracy: 10 }) };
  try { page._locateAndArrive(); } finally { global.wx = saved; }
  assert.deepEqual(opts, { autoPopup: true });
});

test('perk code card: §4.2 opens the code directly without GPS prompt, after redemption nothing', () => {
  const before = load(PERK_SHOP);
  let arrived = 0;
  before.arriveHere = () => { arrived += 1; };
  before.perkCodeTap();
  assert.equal(arrived, 0, '§4.2 perk-only shop skips pre-redemption GPS prompt');
  assert.deepEqual(before.calls, ['verify']);
  const at = load(Object.assign({}, PERK_SHOP, { arrived: true }));
  at.perkCodeTap();
  assert.deepEqual(at.calls, ['verify']);
  const done = load(Object.assign({}, PERK_SHOP, { arrived: true, done: true }));
  done.perkCodeTap();
  assert.deepEqual(done.calls, []);
});

test('wxml: perk card + 核销码 lead the page, no photo step and no photo entry for perk-only shops', () => {
  const perkSec = WXML.indexOf('<view class="mp-sec" wx:if="{{perkOnly}}">');
  const proofSec = WXML.indexOf('<view class="mp-sec__h">现场记录</view>');
  assert.ok(perkSec > 0 && perkSec < proofSec, 'perk section comes before 现场记录');
  assert.match(WXML.slice(perkSec, proofSec), /mp-perk--code[\s\S]*bindtap="perkCodeTap"[\s\S]*核销码/);
  assert.match(WXML, /mp-proof__row \{\{node\.selfReported \? 'is-done' : ''\}\}" wx:if="\{\{!perkOnly\}\}"/);
  assert.match(WXML, /wx:if="\{\{!perkOnly && node\.arrived && !node\.selfReported\}\}" bindtap="morePhoto"/);
  assert.match(WXML, /wx:if="\{\{!perkOnly && node\.perk && node\.perk\.name\}\}"/, 'old perk section only for game shops (no duplicate)');
});

test('perk code card on a shop under supply adjustment never starts 我已到店 or opens code (P1-9)', () => {
  const page = load(Object.assign({}, PERK_SHOP, { supplyState: 'EXITED' }));
  let arrived = 0;
  page.arriveHere = () => { arrived += 1; };
  page.perkCodeTap();
  assert.equal(arrived, 0, 'supply-adjusting shop must not request location / write an arrival from the code card');
  assert.deepEqual(page.calls, [], 'supply-adjusting shop must not open verification code');
});
