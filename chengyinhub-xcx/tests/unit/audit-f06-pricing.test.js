'use strict';
// AUDIT-1122 F06:终价确认成功后不能二次确认 (L06-034);阵容补名本页只读一次 (L06-122);待处理结算带 topicId (L06-133)
// P-01:非平台主题锁价后,后端回「…平台正在办理支付资质…」;定价页要用弹窗让主办方看全,不塞进 toast。
const test = require('node:test');
const assert = require('node:assert/strict');

let config;
let requests;
let modals;
let toasts;
global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest(o) { requests.push(o); },
  getRequestErrorMessage: (_r, f) => f,
});
global.Page = (c) => { config = c; };
global.wx = {
  getStorageSync: () => '', setStorageSync() {}, getSystemInfoSync: () => ({}), getWindowInfo: () => ({}),
  showModal(o) { modals.push(o); },
  showToast(o) { toasts.push(o); },
};

function load() {
  requests = []; modals = []; toasts = [];
  delete require.cache[require.resolve('../../pages/topic/pricing/index.js')];
  require('../../pages/topic/pricing/index.js');
  const page = Object.assign({}, config);
  page.data = JSON.parse(JSON.stringify(config.data));
  page.setData = function (p, cb) { Object.assign(this.data, p); if (cb) cb(); };
  page.data.topicId = 990014;
  page.data.canConfirmPrice = true;
  page.data.subType = 'guided';
  page.data.finalPrice = 69;
  let back = 0;
  page.goBack = () => { back++; };
  page.backCount = () => back;
  return page;
}


test('L06-034 确认成功后等待返回期间再点确认不发第二次', () => {
  const page = load();
  page.confirmPrice();
  requests.find(r => r.url === '/api/topic/pricing/confirm').success({ code: 200, msg: '终价已确认，请等待开售审核' });
  requests.find(r => r.url === '/api/topic/pricing/confirm').complete && requests[0].complete();
  page.confirmPrice();
  assert.equal(requests.filter(r => r.url === '/api/topic/pricing/confirm').length, 1);
});

test('L06-122 阵容名读不到也记住,再次预览不重复请求档案', () => {
  const page = load();
  page.data.lineup = [{ lineupKey: 'club:1', toType: 'club', toId: 1 }];
  page.loadLineupNames();
  requests.find(r => r.url === '/api/club/detail').success({ code: 200, data: {} });
  page.loadLineupNames();
  assert.equal(requests.filter(r => r.url === '/api/club/detail').length, 1);
});

test('L06-133 待处理结算请求带 topicId', () => {
  const page = load();
  page.loadPendingSettlements();
  assert.equal(requests.find(r => r.url === '/api/topic/pricing/settlement-pending').data.topicId, 990014);
});
