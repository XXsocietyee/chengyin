'use strict';
// DEC-F12 B(业主 2026-11-24):席位页按手机号转赠(称呼 + 手机号)、受让人登录 / 打开票夹即自动领取。
// 行为测试:真实纯函数 + 真实页面沙箱;断言请求体、校验红字、脱敏展示、票夹卡与跳转。不读 wxml/js 源码文本。
const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const view = require('../../subpackageJourney/utils/journey-view.js');
const { lobbyView } = require('../../subpackageJourney/utils/lobby-view.js');

const ROOT = path.resolve(__dirname, '../..');
const SEATS_PAGE = path.join(ROOT, 'subpackageJourney/pages/seats/index.js');
const WALLET_PAGE = path.join(ROOT, 'subpackageMember/signup/index.js');

const RAW = { registrationId: 901, ownerType: 1, ownerId: 41, topicId: 41, seatCount: 4, freeSeats: 1, buyerIsCaller: true, readOnly: false,
  seatCancelSupported: true, seatPhoneTransferSupported: true,
  seats: [{ seatNo: 1, state: 'BUYER' },
    { seatNo: 2, state: 'INVITED', invitationId: 7, invitationChannel: 'PHONE', recipientName: '小王', recipientPhoneMasked: '138****8000' },
    { seatNo: 3, state: 'CLAIMED', invitationId: 8, invitationChannel: 'PHONE', recipientName: '小李', recipientPhoneMasked: '139****0001' },
    { seatNo: 4, state: 'AVAILABLE' }] };

// ---------- 纯函数 ----------

test('空闲席位才可转赠,且要服务端声明支持、本人是购票人、非只读;第 1 席永不可转', () => {
  const l = lobbyView(view.seatsView(RAW), RAW, {});
  assert.deepEqual(l.transferable.map((t) => t.no), [4]);
  for (const off of [{ seatPhoneTransferSupported: false }, { readOnly: true }, { buyerIsCaller: false }]) {
    const r = Object.assign({}, RAW, off);
    assert.deepEqual(lobbyView(view.seatsView(r), r, {}).transferable, [], JSON.stringify(off));
  }
  const old = Object.assign({}, RAW); delete old.seatPhoneTransferSupported;
  assert.deepEqual(lobbyView(view.seatsView(old), old, {}).transferable, [], '旧服务端不出转赠');
});

test('待领取 / 已领取的转赠行显示称呼 + 服务端脱敏号;待领取可撤回,已领取不可', () => {
  const l = lobbyView(view.seatsView(RAW), RAW, {});
  const [pending, claimed] = l.invited;
  assert.equal(pending.who, '小王 138****8000');
  assert.equal(pending.label, '等待领取');
  assert.equal(pending.canCancel, true);
  assert.equal(claimed.who, '小李 139****0001');
  assert.equal(claimed.label, '已领取');
  assert.equal(claimed.canCancel, false);
  const link = view.seatsView(Object.assign({}, RAW, { seats: [{ seatNo: 2, state: 'INVITED', invitationId: 9, invitationChannel: 'LINK' }] }));
  assert.equal(link.seats[0].who, '', '分享链接邀请照旧,不出称呼');
});

test('表单校验:称呼必填 ≤20 字;只认大陆手机号(可带 +86 / 空格 / 横线)', () => {
  assert.deepEqual(view.transferErrors('小王', '138 0013 8000'), { name: '', phone: '' });
  assert.equal(view.normalizePhone('+86-138-0013-8000'), '13800138000');
  assert.equal(view.transferErrors('', '13800138000').name, '请填写称呼');
  assert.equal(view.transferErrors('一二三四五六七八九十一二三四五六七八九十一', '13800138000').name, '最多 20 个字');
  for (const bad of ['', '1380013800', '12800138000', '02012345678', 'abc']) assert.equal(view.transferErrors('小王', bad).phone, '手机号格式不对', bad);
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

function sandbox(pagePath, opts) {
  const requests = []; const navigations = []; let config = null; const storage = {};
  const prev = { getApp: global.getApp, Page: global.Page };
  const app = Object.assign({ globalData: { statusBarHeight: 20, navBarHeight: 44 }, getUserID: () => 500, getAuthorization: () => 'Bearer t',
    getPageSize: () => 10, getTotalPage: () => 1, getRequestErrorMessage: (r, f) => f, getImgUrl: (p) => p,
    sendRequest: (o) => { requests.push(o); } }, (opts && opts.app) || {});
  global.getApp = () => app;
  global.Page = (c) => { config = c; };
  global.wx = {
    showToast() {}, showModal() {}, hideLoading() {}, showLoading() {}, vibrateShort() {},
    navigateTo: (o) => { navigations.push(o.url); if (o.complete) o.complete(); }, redirectTo: (o) => navigations.push(o.url),
    getStorageSync: (k) => storage[k] || '', setStorageSync: (k, v) => { storage[k] = v; }, removeStorageSync: (k) => { delete storage[k]; },
    getSystemInfoSync: () => ({ windowWidth: 390, windowHeight: 844 }), getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
    getMenuButtonBoundingClientRect: () => ({ top: 48, bottom: 80, height: 32 }), getAppBaseInfo: () => ({}), getDeviceInfo: () => ({}),
    createSelectorQuery: () => { const q = { in: () => q, select: () => q, selectAll: () => q, boundingClientRect: () => q, scrollOffset: () => q, exec: () => {} }; return q; },
  };
  delete require.cache[pagePath];
  try { require(pagePath); } finally { global.getApp = prev.getApp; global.Page = prev.Page; delete require.cache[pagePath]; }
  const vm = Object.assign({}, config, { setData(patch, cb) { Object.entries(patch).forEach(([k, v]) => setByPath(this.data, k, v)); if (cb) cb(); } });
  vm.data = JSON.parse(JSON.stringify(config.data));
  pages.push(vm);
  return { vm, requests, navigations, last: (url) => requests.filter((r) => r.url === url).pop() };
}

const tick = () => new Promise((r) => setImmediate(r));

async function seatsPage() {
  const h = sandbox(SEATS_PAGE);
  h.vm.onLoad({ registrationId: '901' });
  h.last('/api/play/player-journey/seats').success({ code: 200, data: RAW });
  await tick();
  return h;
}

test('席位页:空闲席位「转赠给同伴」→ 半屏;格式不对在字段下红字,不发请求', async () => {
  const h = await seatsPage();
  assert.deepEqual(h.vm.data.lobby.transferable.map((t) => t.no), [4]);
  h.vm.onOpenTransfer({ currentTarget: { dataset: { no: 4 } } });
  assert.equal(h.vm.data.transfer.show, true);
  assert.equal(h.vm.data.transfer.no, 4);
  h.vm.onOpenTransfer({ currentTarget: { dataset: { no: 2 } } });
  assert.equal(h.vm.data.transfer.no, 4, '非空闲席位不开转赠');
  h.vm.onTransferPhone({ detail: { value: '123' } });
  h.vm.onTransferConfirm();
  assert.equal(h.vm.data.transfer.nameError, '请填写称呼');
  assert.equal(h.vm.data.transfer.phoneError, '手机号格式不对');
  assert.equal(h.requests.filter((r) => r.url.endsWith('/transfer-phone')).length, 0);
  h.vm.onTransferName({ detail: { value: '小张' } });
  assert.equal(h.vm.data.transfer.nameError, '', '改字段即清红字');
});

test('席位页:确认转赠只带原单 id + 席位号 + 称呼 + 规范号;网络未知重点沿用同一 requestId;成功收起并重读', async () => {
  const h = await seatsPage();
  h.vm.onOpenTransfer({ currentTarget: { dataset: { no: 4 } } });
  h.vm.onTransferName({ detail: { value: ' 小张 ' } });
  h.vm.onTransferPhone({ detail: { value: '138 0013 8002' } });
  h.vm.onTransferConfirm();
  const first = h.last('/api/play/seat-invitations/transfer-phone');
  assert.equal(first.method, 'POST');
  assert.equal(first.data.registrationId, 901);
  assert.equal(first.data.seatNo, 4);
  assert.equal(first.data.name, '小张');
  assert.equal(first.data.phone, '13800138002');
  assert.ok(first.data.requestId);
  assert.equal(h.vm.data.transfer.busy, true);
  first.fail();
  await tick();
  assert.equal(h.vm.data.transfer.busy, false);
  assert.equal(h.vm.data.transfer.error, '结果还没确认，请再点一次');
  h.vm.onTransferConfirm();
  const second = h.last('/api/play/seat-invitations/transfer-phone');
  assert.notEqual(first, second);
  assert.equal(second.data.requestId, first.data.requestId, '同一次填写沿用同一 requestId');
  const reads = h.requests.filter((r) => r.url === '/api/play/player-journey/seats').length;
  second.success({ code: 200, data: { invitationId: 12, seatNo: 4, statusLabel: 'PENDING', recipientPhoneMasked: '138****8002' } });
  await tick();
  assert.equal(h.vm.data.transfer.show, false);
  assert.equal(h.vm.data.transfer.phone, '', '收起后不留手机号');
  assert.equal(h.requests.filter((r) => r.url === '/api/play/player-journey/seats').length, reads + 1);
});

test('席位页:服务端拒绝(如同号已占一席)原话留在半屏', async () => {
  const h = await seatsPage();
  h.vm.onOpenTransfer({ currentTarget: { dataset: { no: 4 } } });
  h.vm.onTransferName({ detail: { value: '小张' } });
  h.vm.onTransferPhone({ detail: { value: '13800138000' } });
  h.vm.onTransferConfirm();
  h.last('/api/play/seat-invitations/transfer-phone').success({ code: 409, msg: '这个手机号已有本单的席位' });
  await tick();
  assert.equal(h.vm.data.transfer.show, true);
  assert.equal(h.vm.data.transfer.error, '这个手机号已有本单的席位');
});

test('席位页:分享链接邀请照旧(邀请接口与参数不变)', async () => {
  const h = await seatsPage();
  h.vm.onInvite();
  const inv = h.last('/api/play/seat-invitations/invite');
  assert.equal(inv.data.registrationId, '901');
  assert.ok(inv.data.requestId);
  assert.equal('phone' in inv.data, false);
});

test('票夹:先按已验证手机号静默领取,再读本人已领席位;卡进同一副牌,点开始游戏不带购票人的原单号', () => {
  const h = sandbox(WALLET_PAGE);
  h.vm.onLoad({});
  const claim = h.last('/api/play/seat-invitations/claim-phone');
  assert.ok(claim, '打开票夹即领取');
  assert.equal(claim.method, 'POST');
  assert.equal(h.last('/api/play/seat-invitations/mine'), undefined, '领取结束后才读');
  claim.success({ code: 200, data: [] });
  const mine = h.last('/api/play/seat-invitations/mine');
  h.requests.filter((r) => r.url === '/api/registration/list').forEach((r) => r.success({ code: 200, data: { rows: [], total: 0 } }));
  mine.success({ code: 200, data: [{ invitationId: 12, seatNo: 2, ownerType: 1, ownerId: 41, topicId: 41, topicName: '老城夜游', topicCover: 'c.jpg', usableUntil: '2099-01-01 00:00:00' }] });
  assert.equal(h.vm.data.walletState, 'ready');
  const card = h.vm.data.ticketList.find((t) => t.wKey === 'seat-12');
  assert.ok(card, '同伴席位进票夹');
  assert.equal(card.wTitle, '老城夜游');
  const target = h.vm._ticketTarget(card, 'topic');
  assert.equal(target.url, '/pages/play/index?topicId=41&entry=ticket&topicName=' + encodeURIComponent('老城夜游'));
  assert.ok(!/registrationId/.test(target.url));
});

test('票夹:没有待领取 / 服务端失败 —— 不加卡、不提示', () => {
  const h = sandbox(WALLET_PAGE);
  h.vm.onLoad({});
  h.last('/api/play/seat-invitations/claim-phone').fail({ code: 500 }, 500);
  h.requests.filter((r) => r.url === '/api/registration/list').forEach((r) => r.success({ code: 200, data: { rows: [], total: 0 } }));
  h.last('/api/play/seat-invitations/mine').fail({ code: 500, msg: 'x' }, 500);
  assert.equal(h.vm.data.walletState, 'empty');
});

test('票夹:换账号回来,上一账号的同伴席位不留在新账号的票夹里(新账号读席位失败或已退出也不留)', () => {
  let uid = 500;
  const h = sandbox(WALLET_PAGE, { app: { getUserID: () => uid } });
  h.vm.onLoad({});
  h.last('/api/play/seat-invitations/claim-phone').success({ code: 200, data: [] });
  h.requests.filter((r) => r.url === '/api/registration/list').forEach((r) => r.success({ code: 200, data: { rows: [], total: 0 } }));
  h.last('/api/play/seat-invitations/mine').success({ code: 200, data: [{ invitationId: 12, seatNo: 2, ownerType: 1, ownerId: 41, topicId: 41, topicName: '老城夜游', usableUntil: '2099-01-01 00:00:00' }] });
  assert.ok(h.vm.data.ticketList.some((t) => t.wKey === 'seat-12'), '账号 A 看得到自己的同伴席位');
  // 账号 B:席位读取失败
  h.vm.onHide(); uid = 501; const before = h.requests.length; h.vm.onShow();
  const fresh = h.requests.slice(before);
  fresh.filter((r) => r.url === '/api/play/seat-invitations/claim-phone').forEach((r) => r.fail({ errMsg: 'x' }));
  h.requests.slice(before).filter((r) => r.url === '/api/play/seat-invitations/mine').forEach((r) => r.fail({ errMsg: 'x' }));
  fresh.filter((r) => r.url === '/api/registration/list').forEach((r) => r.success({ code: 200, data: { rows: [], total: 0 } }));
  assert.equal(h.vm.data.ticketList.some((t) => t.wKey === 'seat-12'), false, '账号 B 不该看到 A 的同伴席位');
  // 退出登录:不发席位请求,也不留旧卡
  h.vm.onHide(); uid = 0; const before2 = h.requests.length; h.vm.onShow();
  h.requests.slice(before2).filter((r) => r.url === '/api/registration/list').forEach((r) => r.success({ code: 200, data: { rows: [], total: 0 } }));
  assert.equal(h.requests.slice(before2).some((r) => /seat-invitations/.test(r.url)), false);
  assert.equal(h.vm.data.ticketList.some((t) => t.wKey === 'seat-12'), false);
});
