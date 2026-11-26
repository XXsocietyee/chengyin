'use strict';
// L09-058:席位邀请令牌被领走后不再拿去分享;没有令牌时分享主题页。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const FILE = path.resolve(__dirname, '../../subpackageJourney/pages/seats/index.js');
const tick = () => new Promise((r) => setImmediate(r));

function mount(seatState, extra) {
  let def; const requests = [];
  const app = { globalData: {}, getUserID: () => 7, getImgUrl: (x) => x, sendRequest: (o) => requests.push(o) };
  const localRequire = createRequire(FILE);
  const store = {};
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => app, wx: {
    navigateTo() {}, getStorageSync: (k) => store[k] || '', setStorageSync: (k, v) => { store[k] = v; }, removeStorageSync: (k) => { delete store[k]; } },
    getCurrentPages: () => [{}],
    require: (id) => id.endsWith('/modal.js') ? { show() {} } : localRequire(id), setTimeout, clearTimeout, console, Promise,
    Date, Math, encodeURIComponent }, { filename: FILE });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); }, _requests: requests });
  page._registrationId = '5'; page._extrasRead = true;
  page._invite = { invitationId: '31', token: 'tok-31' }; page._inviteToken = 'tok-31';
  const seats = (extra && extra.seats) || [{ seatNo: 1, state: 'BUYER' }, { seatNo: 2, state: seatState, invitationId: 31 }];
  page.load();
  requests.find((r) => r.url === '/api/play/player-journey/seats').success({ code: 200, data: {
    registrationId: 5, topicId: 9, ownerType: 1, seatCount: extra && extra.seatCount || 2,
    freeSeats: extra && extra.freeSeats != null ? extra.freeSeats : 0,
    buyerIsCaller: true, readOnly: false, seats } });
  return page;
}

const FOUR = {
  seatCount: 4, freeSeats: 2,
  seats: [
    { seatNo: 1, state: 'BUYER' },
    { seatNo: 2, state: 'INVITED', invitationId: 31 },
    { seatNo: 3, state: 'AVAILABLE' },
    { seatNo: 4, state: 'AVAILABLE' }
  ]
};

test('seat still invited ⇒ share keeps the invite token', async () => {
  const page = mount('INVITED'); await tick();
  assert.match(page.onShareAppMessage().path, /k=s&t=tok-31/);
});
test('seat claimed ⇒ stale token dropped and share falls back to the topic page', async () => {
  const page = mount('CLAIMED'); await tick();
  assert.equal(page._inviteToken, '');
  assert.equal(page.onShareAppMessage().path, '/pages/topic/index/index?id=9');
});

test('onShow refreshes seats', async () => {
  const page = mount('INVITED'); await tick();
  const before = page._requests.filter((r) => r.url === '/api/play/player-journey/seats').length;
  page.onShow();
  assert.equal(page._requests.filter((r) => r.url === '/api/play/player-journey/seats').length, before + 1);
});

test('four-seat buyer: each share of an empty seat gets its own invitation', async () => {
  const page = mount('INVITED', FOUR); await tick();
  assert.match(page.onShareAppMessage().path, /k=s&t=tok-31/);
  // 半屏没开(右上角菜单):下一席还没回来时仍分享主题页(L09-058),且不再带出刚才那枚码
  const again = page.onShareAppMessage().path;
  assert.equal(again, '/pages/topic/index/index?id=9');
  assert.equal(again.includes('tok-31'), false);
  const invite = page._requests.filter((r) => r.url === '/api/play/seat-invitations/invite');
  assert.equal(invite.length, 1);
  assert.equal(String(invite[0].data.registrationId), '5');
  assert.ok(invite[0].data.requestId);
  invite[0].success({ code: 200, data: { invitationId: 32, token: 'tok-32', seatNo: 3 } });
  await tick();
  const seats = page._requests.filter((r) => r.url === '/api/play/player-journey/seats');
  seats[seats.length - 1].success({ code: 200, data: {
    registrationId: 5, topicId: 9, ownerType: 1, seatCount: 4, freeSeats: 1,
    buyerIsCaller: true, readOnly: false, seats: [
      { seatNo: 1, state: 'BUYER' },
      { seatNo: 2, state: 'INVITED', invitationId: 31 },
      { seatNo: 3, state: 'INVITED', invitationId: 32 },
      { seatNo: 4, state: 'AVAILABLE' }
    ] } });
  await tick();
  assert.match(page.onShareAppMessage().path, /k=s&t=tok-32/);
  const fourth = page.onShareAppMessage().path;
  assert.equal(fourth.includes('tok-31') || fourth.includes('tok-32'), false);
});

test('invite sheet open: a second share before the next invite returns does not hand out the topic page', async () => {
  const page = mount('INVITED', FOUR); await tick();
  page.onOpenInvite();
  assert.equal(page.data.inviteShow, true);
  assert.equal(page.data.inviteShareReady, true);
  const first = page.onShareAppMessage();
  assert.match(first.path, /\/subpackageJourney\/pages\/landing\/index\?k=s&t=tok-31/);
  assert.equal(page._inviteToken, '');
  assert.equal(page.data.inviteShareReady, false);
  const second = page.onShareAppMessage();
  assert.equal(String(second && second.path || '').includes('/pages/topic/'), false);
  assert.equal(String(second && second.path || '').includes('tok-31'), false);
  const invite = page._requests.filter((r) => r.url === '/api/play/seat-invitations/invite');
  assert.equal(invite.length, 1);
  invite[0].success({ code: 200, data: { invitationId: 32, token: 'tok-32', seatNo: 3 } });
  await tick();
  assert.equal(page.data.inviteShareReady, true);
  const seats = page._requests.filter((r) => r.url === '/api/play/player-journey/seats');
  seats[seats.length - 1].success({ code: 200, data: {
    registrationId: 5, topicId: 9, ownerType: 1, seatCount: 4, freeSeats: 1,
    buyerIsCaller: true, readOnly: false, seats: [
      { seatNo: 1, state: 'BUYER' },
      { seatNo: 2, state: 'INVITED', invitationId: 31 },
      { seatNo: 3, state: 'INVITED', invitationId: 32 },
      { seatNo: 4, state: 'AVAILABLE' }
    ] } });
  await tick();
  assert.equal(page.data.inviteShareReady, true);
  assert.match(page.onShareAppMessage().path, /k=s&t=tok-32/);
});
