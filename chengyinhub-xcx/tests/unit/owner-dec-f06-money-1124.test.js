'use strict';
// 业主决策 2026-11-24(F06 默认项)—— 钱的两项:
// L06-132 A:票价最多两位小数,超过即在那张票下提示;提交前按分取整,服务费也按取整后的价算。
// L06-116 A:分润条的平台比例一律按小数换算成百分数,并限制在 0–100(1 即 100%)。
// 服务端照旧按自己的费率与逐张价重算,这里只改页面能提交 / 显示的数。
const test = require('node:test');
const assert = require('node:assert/strict');

let config;
let requests;
global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest(o) { requests.push(o); },
  getRequestErrorMessage: (_r, f) => f,
});
global.Page = (c) => { config = c; };
global.getCurrentPages = () => [{}];
global.wx = { getStorageSync: () => '', setStorageSync() {}, getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), navigateBack() {} };

function load() {
  requests = [];
  delete require.cache[require.resolve('../../pages/topic/pricing/index.js')];
  require('../../pages/topic/pricing/index.js');
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function (p, cb) { Object.assign(this.data, p); if (cb) cb(); };
  page.loadLineupNames = () => {};
  page.data.topicId = 990021;
  page.data.subType = 'guided';
  page.data.teamSize = '4';
  return page;
}

function preview(page, data) {
  page.preview();
  requests[requests.length - 1].success({ code: 200, data: Object.assign({ priceMin: 40, canConfirm: true, platformRate: 0.1 }, data) });
}

const TWO = [{ ticketId: 931, name: '日场', price: 69 }, { ticketId: 932, name: '夜场', price: 99 }];
const input = (page, idx, value) => page.onTicketPriceInput({ currentTarget: { dataset: { idx } }, detail: { value } });

test('L06-132:票价填三位小数在那张票下提示「最多两位小数」,确认按钮置灰,不发确认请求', () => {
  const page = load();
  preview(page, { tickets: TWO });
  input(page, 0, '49.999');
  assert.equal(page.data.tickets[0].error, '最多两位小数');
  assert.equal(page.data.canConfirmPrice, false);
  const before = requests.length;
  page.confirmPrice();
  assert.equal(requests.length, before, '不合法的价不提交');
});

test('L06-132:两位、一位小数与输入中的「49.」不误报', () => {
  const page = load();
  preview(page, { tickets: TWO });
  for (const v of ['49.99', '49.9', '49.', '49']) {
    input(page, 0, v);
    assert.equal(page.data.tickets[0].error, '', v);
  }
});

test('L06-132:服务费按取整到分的价算,提交的逐张价是分', () => {
  const page = load();
  preview(page, { tickets: TWO, platformRate: 0.1, priceMin: 10 });
  input(page, 0, '49.99');
  assert.equal(page.data.tickets[0].feeText, '¥5.0（10%）');
  assert.equal(page.data.tickets[0].takeHomeText, '¥44.99');
  input(page, 1, '19.99');
  page.confirmPrice();
  const req = requests[requests.length - 1];
  assert.equal(req.url, '/api/topic/pricing/confirm');
  const body = JSON.parse(req.data);
  assert.deepEqual(body.ticketPrices, [{ ticketId: 931, price: 49.99 }, { ticketId: 932, price: 19.99 }]);
  assert.equal(body.guidedPrice, 19.99);
  for (const r of body.ticketPrices) assert.equal(String(r.price).split('.')[1].length <= 2, true);
});

const profitSplit = require('../../pages/topic/utils/profit-split.js');
const platformRate = (split) => (split.parts.find((p) => p.key === 'platform') || { rate: 0 }).rate;

test('L06-116:平台比例按小数换算 —— 后端 PricingResult 的 0.1 是 10%,1 是 100%(不是 1%)', () => {
  // 真实链路:goFinance 把 /api/topic/pricing/preview 的 platformRate(小数)原样交给 buildSplit
  const lineup = [{ toType: 'merchant', toId: 7, shareMode: 1, shareRate: 20, name: '甲店' }];
  const ten = profitSplit.buildSplit(lineup, 0.1);
  assert.equal(platformRate(ten), 10);
  assert.equal(ten.parts.find((p) => p.key === 'host').rate, 70);
  assert.equal(platformRate(profitSplit.buildSplit([], 1)), 100);
  assert.equal(profitSplit.buildSplit([], 1).parts.find((p) => p.key === 'platform').rateText, '100%');
  assert.equal(profitSplit.buildSplit([], 1).parts.some((p) => p.key === 'host'), false);
});

test('L06-116:限制在 0–100 之间,非数字不画条', () => {
  assert.equal(platformRate(profitSplit.buildSplit([], 1.5)), 100);
  assert.equal(platformRate(profitSplit.buildSplit([], 0)), 0);
  assert.equal(profitSplit.buildSplit([], 0).parts.find((p) => p.key === 'host').rate, 100);
  assert.equal(platformRate(profitSplit.buildSplit([], -0.2)), 0);
  assert.equal(profitSplit.buildSplit([], null), null);
  assert.equal(profitSplit.buildSplit([], 'x'), null);
});
