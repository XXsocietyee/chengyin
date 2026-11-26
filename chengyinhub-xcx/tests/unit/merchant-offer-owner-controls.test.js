const { beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// P1-7:承接方调名额 / 暂停新售;主办方移除一家店(必须填原因)。
const PAGE = '../../pages/topic/merchantinfo/merchantinfo.js';
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
const WXML = read('pages/topic/merchantinfo/merchantinfo.wxml');
const HOST_WXML = read('pages/topic/components/project-host/index.wxml');
const { DANGER_ACTIONS, getDangerAction } = require('../../utils/danger-actions.js');

let pageConfig;
let toasts;
let tips;
let requests;
let modals;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 1,
  sendRequest: (request) => requests.push(request),
  tips: (message) => tips.push(message),
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
});
global.wx = {
  navigateTo: () => {},
  showToast: (options) => toasts.push(options),
  showLoading: () => {},
  hideLoading: () => {},
  navigateBack: () => {},
  openLocation: () => {},
  pageScrollTo: () => {},
  showModal: (options) => modals.push(options),
};
global.Page = (config) => { pageConfig = config; };

beforeEach(() => {
  toasts = [];
  tips = [];
  requests = [];
  modals = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const page = Object.assign({}, pageConfig);
  page.data = JSON.parse(JSON.stringify(pageConfig.data));
  page.setData = (patch) => Object.assign(page.data, patch);
  return page;
}

function merchantPage(rows) {
  const page = makePage();
  page.data.info = { lifecycle: 3 };
  page.data.topicId = 42;
  page.data.myChapterApplications = rows;
  page.refreshMyChapterApplications();
  return page;
}

function hostPage(rows) {
  const page = makePage();
  page.data.topicId = 42;
  page.data.role = 'host';
  page.loadOwnerChapterApplications(true);
  requests.pop().success({ code: '200', data: rows });
  return page;
}

const tap = (offerId) => ({ currentTarget: { dataset: { offerId } } });

test('只有带名额的普通生效供给出现调名额和暂停新售，暂停状态来自服务端回读', () => {
  const page = merchantPage([
    { id: 1, offerId: 11, status: 1, offerActive: true, offerQuotaTotal: 20, offerQuotaUsed: 6 },
    { id: 2, offerId: 12, status: 1, offerActive: true, offerQuotaTotal: 0, offerQuotaUsed: 0 },
    { id: 3, offerId: 13, status: 1, offerActive: true, offerQuotaTotal: 20, circleThemeCode: 'LOCAL' },
    { id: 4, offerId: 14, status: 1, offerActive: false, offerState: 'WITHDRAWN', offerQuotaTotal: 20 },
    { id: 5, offerId: 15, status: 1, offerActive: true, offerQuotaTotal: 9, offerSalePaused: true },
  ]);
  assert.deepEqual(page.data.myChapterApplications.map(row => row.canManageSale), [true, false, false, false, true]);
  assert.deepEqual(page.data.myChapterApplications.map(row => row.salePaused), [false, false, false, false, true]);
  assert.match(WXML, /wx:if="\{\{application\.canManageSale\}\}"[^>]*bindtap="adjustChapterOfferQuota">调名额</);
  assert.match(WXML, /bindtap="toggleChapterOfferSale">\{\{application\.salePaused \? '恢复新售' : '暂停新售'\}\}</);
  assert.match(WXML, /application\.salePaused\}\}"> · 已暂停新售</);
});

test('调名额只收不低于已核销的正整数，取消或非法输入都不写入', () => {
  const page = merchantPage([{ id: 1, offerId: 11, status: 1, offerActive: true, offerQuotaTotal: 20, offerQuotaUsed: 6 }]);
  page.adjustChapterOfferQuota(tap(12));
  assert.equal(modals.length, 0, '不是自己列表里的供给不弹窗');
  page.adjustChapterOfferQuota(tap(11));
  const input = modals[0];
  assert.equal(input.editable, true);
  assert.equal(input.content, '20', '默认带出当前名额');
  input.success({ confirm: true, content: '5' });
  input.success({ confirm: true, content: '0' });
  input.success({ confirm: true, content: '7.5' });
  input.success({ confirm: true, content: 'abc' });
  input.success({ confirm: true, content: '1000000' });
  input.success({ confirm: true, content: '' });
  assert.equal(requests.length, 0);
  assert.ok(modals.length > 1, '非法输入留在输入步骤');
  assert.match(modals[1].placeholderText || modals[1].content, /不能低于已核销的 6 份/);
  input.success({ cancel: true });
  assert.equal(requests.length, 0);
});

test('调名额提交整数名额，重复确认不重发，失败原样提示，成功回读本人申请', () => {
  const page = merchantPage([{ id: 1, offerId: 11, status: 1, offerActive: true, offerQuotaTotal: 20, offerQuotaUsed: 6 }]);
  page.adjustChapterOfferQuota(tap(11));
  modals[0].success({ confirm: true, content: ' 6 ' });
  modals[0].success({ confirm: true, content: '30' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/coop/offer/quota');
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].data), { offerId: 11, quotaTotal: 6 });
  requests[0].success({ code: '500', msg: '已售出的份数超过新额度' });
  assert.equal(tips.at(-1), '已售出的份数超过新额度');
  assert.equal(requests.length, 1, '失败不回读也不重发');
  requests[0].complete();
  page.adjustChapterOfferQuota(tap(11));
  modals.at(-1).success({ confirm: true, content: '30' });
  assert.deepEqual(JSON.parse(requests[1].data), { offerId: 11, quotaTotal: 30 });
  requests[1].success({ code: '200', msg: '名额已更新' });
  assert.ok(requests.some(request => request.url === '/api/merchant/chapter-application/mine'));
  requests[1].complete();
  assert.equal(page._chapterOfferSaleWriting, false);
});

test('暂停与恢复新售按当前回读状态取反，写入中不重复提交', () => {
  const page = merchantPage([
    { id: 1, offerId: 11, status: 1, offerActive: true, offerQuotaTotal: 20, offerQuotaUsed: 6 },
    { id: 5, offerId: 15, status: 1, offerActive: true, offerQuotaTotal: 9, offerSalePaused: 1 },
    { id: 2, offerId: 12, status: 1, offerActive: true, offerQuotaTotal: 0 },
  ]);
  page.toggleChapterOfferSale(tap(12));
  assert.equal(requests.length, 0, '非权益档没有暂停新售');
  page.toggleChapterOfferSale(tap(11));
  page.toggleChapterOfferSale(tap(11));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/coop/offer/sale-pause');
  assert.deepEqual(JSON.parse(requests[0].data), { offerId: 11, paused: true });
  assert.equal(modals.length, 0, '暂停可恢复，不弹确认');
  requests[0].success({ code: '500', msg: '供给已变化，请刷新后重试' });
  assert.equal(tips.at(-1), '供给已变化，请刷新后重试');
  requests[0].complete();
  page.toggleChapterOfferSale(tap(15));
  assert.deepEqual(JSON.parse(requests[1].data), { offerId: 15, paused: false });
  requests[1].success({ code: '200', msg: '已恢复新售' });
  assert.equal(toasts.length, 0, '结果由回读后的行呈现，不弹成功提示');
  assert.ok(requests.some(request => request.url === '/api/merchant/chapter-application/mine'));
});

test('主办方列表只给已通过且供给生效的普通承接「移除」，已退出的行只读并写明原因', () => {
  const page = hostPage([
    { id: 1, status: 1, source: 0, offerId: 11, offerActive: true, offerState: 'ACTIVE', merchantName: '花店' },
    { id: 2, status: 1, source: 0, offerId: null, offerActive: false, offerState: 'NONE' },
    { id: 3, status: 0, source: 0 },
    { id: 4, status: 0, source: 1 },
    { id: 5, status: 1, source: 0, offerId: 15, offerActive: false, offerState: 'WITHDRAWN', offerWithdrawReason: '主办方移除：多次爽约' },
    { id: 6, status: 1, source: 0, offerId: 16, offerActive: true, offerState: 'ACTIVE', circleThemeCode: 'LOCAL' },
    { id: 7, status: 0, source: 1, offerId: 17, offerActive: false, offerState: 'WITHDRAWN', offerWithdrawReason: '暂停营业' },
  ]);
  const rows = page.data.ownerChapterApplications;
  assert.deepEqual(rows.map(row => row.removableOffer), [true, false, false, false, false, false, false]);
  assert.deepEqual(rows.map(row => row.actionable), [false, false, true, false, false, false, false]);
  assert.deepEqual(rows.map(row => row.revocableInvite), [false, false, false, true, false, false, true]);
  assert.equal(rows[4].statusLabel, '已退出供给');
  assert.equal(rows[6].statusLabel, '待商家接受', '退出后重新邀请的行仍按邀请处理');
  assert.match(HOST_WXML, /wx:if="\{\{item\.removableOffer\}\}"/);
  assert.match(HOST_WXML, /data-act="removeChapterOffer" data-offer-id="\{\{item\.offerId\}\}"[^>]*>移除</);
  assert.match(HOST_WXML, /item\.offerWithdrawn && item\.offerWithdrawReason/);
});

test('移除走三段式：原因必填 → 不可撤销确认 → 提交；任一步取消都不写入', () => {
  const page = hostPage([{ id: 1, status: 1, source: 0, offerId: 11, offerActive: true, merchantName: '花店' }]);
  page.onJoinAct({ detail: { act: 'removeChapterOffer', dataset: { offerId: 99 } } });
  assert.equal(modals.length, 0, '不在列表里的供给不弹窗');
  page.onJoinAct({ detail: { act: 'removeChapterOffer', dataset: { offerId: 11 } } });
  assert.equal(modals[0].editable, true);
  assert.equal(modals[0].content, '', '原因不带默认值');
  modals[0].success({ confirm: true, content: '   ' });
  assert.equal(requests.length, 0);
  assert.equal(modals.length, 2, '空原因留在输入步骤');
  modals[1].success({ cancel: true });
  page.removeChapterOffer(tap(11));
  modals[2].success({ confirm: true, content: ' 多次爽约 ' });
  const confirm = modals[3];
  assert.equal(confirm.dangerKey, 'merchant.chapterOffer.organizerRemove');
  assert.deepEqual(confirm.dangerParams, { name: '花店', reason: '多次爽约' });
  assert.equal(confirm.danger, true);
  confirm.success({ cancel: true });
  assert.equal(requests.length, 0);
});

test('确认移除提交供给、原因和当前身份口径，重复确认不重发，成功后重读申请列表', () => {
  const page = hostPage([{ id: 1, status: 1, source: 0, offerId: 11, offerActive: true, merchantName: '花店' }]);
  page.data.operationScope = 'MERCHANT';
  page.removeChapterOffer(tap(11));
  modals[0].success({ confirm: true, content: '多次爽约' });
  modals[1].success({ confirm: true });
  modals[1].success({ confirm: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/merchant/chapter-application/offer/remove');
  assert.deepEqual(JSON.parse(requests[0].data), { offerId: 11, reason: '多次爽约', scope: 'MERCHANT' });
  requests[0].success({ code: '500', msg: '仅主题发布者可以移除商家供给' });
  assert.equal(tips.at(-1), '仅主题发布者可以移除商家供给');
  assert.equal(page.data.ownerChapterApplications[0].removableOffer, true, '失败保留入口');
  requests[0].complete();
  page.removeChapterOffer(tap(11));
  modals[2].success({ confirm: true, content: '多次爽约' });
  modals[3].success({ confirm: true });
  requests[1].success({ code: '200', msg: '已移除供给' });
  const reload = requests.at(-1);
  assert.equal(reload.url, '/api/merchant/chapter-application/owner-list');
  reload.success({ code: '200', data: [{ id: 1, status: 1, source: 0, offerId: 11, offerActive: false,
    offerState: 'WITHDRAWN', offerWithdrawReason: '主办方移除：多次爽约', merchantName: '花店' }] });
  assert.equal(page.data.ownerChapterApplications[0].removableOffer, false);
  assert.equal(page.data.ownerChapterApplications[0].statusLabel, '已退出供给');
  requests[1].complete();
  assert.equal(page._chapterOfferRemoving, false);
});

test('移除的确认文案登记为不可撤销，并写明原因', () => {
  assert.equal(DANGER_ACTIONS['merchant.chapterOffer.organizerRemove'].irreversible, true);
  const action = getDangerAction('merchant.chapterOffer.organizerRemove', { name: '花店', reason: '多次爽约' });
  assert.equal(action.title, '确认移除「花店」？');
  assert.equal(action.content, '移除原因：多次爽约');
  assert.ok(action.consequences.some(item => item.text.includes('此操作不可撤销')));
});
