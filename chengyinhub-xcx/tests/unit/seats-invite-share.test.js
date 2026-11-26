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

function mount(seatState) {
  let def; const requests = [];
  const app = { globalData: {}, getUserID: () => 7, getImgUrl: (x) => x, sendRequest: (o) => requests.push(o) };
  const localRequire = createRequire(FILE);
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => app, wx: { navigateTo() {} }, getCurrentPages: () => [{}],
    require: (id) => id.endsWith('/modal.js') ? { show() {} } : localRequire(id), setTimeout, clearTimeout, console, Promise }, { filename: FILE });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); } });
  page._registrationId = '5'; page._extrasRead = true;
  page._invite = { invitationId: '31', token: 'tok-31' }; page._inviteToken = 'tok-31';
  page.load();
  requests.find((r) => r.url === '/api/play/player-journey/seats').success({ code: 200, data: { registrationId: 5, topicId: 9, ownerType: 1, seatCount: 2, freeSeats: 0,
    buyerIsCaller: true, readOnly: false, seats: [{ seatNo: 1, state: 'BUYER' }, { seatNo: 2, state: seatState, invitationId: 31 }] } });
  return page;
}

test('seat still invited ⇒ share keeps the invite token', async () => {
  const page = mount('INVITED'); await tick();
  assert.match(page.onShareAppMessage().path, /k=s&t=tok-31/);
});
test('seat claimed ⇒ stale token dropped and share falls back to the topic page', async () => {
  const page = mount('CLAIMED'); await tick();
  assert.equal(page._inviteToken, '');
  assert.equal(page.onShareAppMessage().path, '/pages/topic/index/index?id=9');
});
