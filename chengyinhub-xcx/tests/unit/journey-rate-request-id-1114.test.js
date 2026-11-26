'use strict';
// E-B13:评价提交带 request_id,网络失败后重试复用同一个,成功后下一次换新。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../../subpackageJourney/utils/journey-api.js');

test('api.rate 把 request_id 随表单参数发出去', async () => {
  const sent = [];
  const app = { sendRequest(o) { sent.push(o.data); o.success({ code: 200 }); } };
  await api.rate(app, 1, 9, 5, '好玩', 'req_1700000000000_abcdefgh');
  assert.equal(sent[0].request_id, 'req_1700000000000_abcdefgh');
  assert.equal(sent[0].owner_id, 9);
});

test('评价页:一次意图复用同一个 request_id,成功后清掉', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../subpackageJourney/pages/settle/index.js'), 'utf8');
  assert.match(src, /if \(!this\._rateReqId\) this\._rateReqId = 'req_'/);
  assert.match(src, /api\.rate\(app, ownerType, ownerId, this\.data\.stars, text, this\._rateReqId\)/);
  assert.match(src, /if \(api\.ok\(res\)\) \{ this\._rateReqId = '';/);
});

// L09-059:真实页面行为 —— 受理后不再发第二条;失败后改内容换新 request_id。
function mountSettle(replies) {
  const vm = require('node:vm');
  const { createRequire } = require('node:module');
  const file = path.join(__dirname, '../../subpackageJourney/pages/settle/index.js');
  const sent = [];
  const app = { globalData: {}, getUserID: () => 7, sendRequest(o) { sent.push(o.data); const r = replies.shift(); if (r === 'net') o.fail && o.fail({ errMsg: 'x' }); else o.success(r); if (o.complete) o.complete(); } };
  let def;
  const wx = { vibrateShort() {}, getStorageSync() {}, setStorageSync() {}, nextTick(f) { f(); } };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: (d) => { def = d; }, getApp: () => app, wx, getCurrentPages: () => [{}],
    require: createRequire(file), setTimeout, clearTimeout, console, Promise }, { filename: file });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb(); } });
  page.data.report = { topicId: 9 }; page.data.stars = 4; page.data.review = '好玩';
  return { page, sent };
}
const settleTick = () => new Promise((r) => setImmediate(r));

test('L09-059 评价受理后回到评价步再提交不发第二条', async () => {
  const h = mountSettle([{ code: 200 }]);
  h.page.submitRate(); await settleTick();
  assert.equal(h.sent.length, 1); assert.equal(h.page.data.thanks, true);
  h.page.setData({ thanks: false });
  h.page.submitRate(); await settleTick();
  assert.equal(h.sent.length, 1); assert.equal(h.page.data.thanks, true);
});

test('L09-059 失败后改了内容换新 request_id,没改则复用', async () => {
  const h = mountSettle(['net', 'net', { code: 200 }]);
  h.page.submitRate(); await settleTick();
  h.page.submitRate(); await settleTick();
  assert.equal(h.sent[0].request_id, h.sent[1].request_id);
  h.page.onReview({ detail: { value: '改过的' } });
  h.page.submitRate(); await settleTick();
  assert.notEqual(h.sent[2].request_id, h.sent[1].request_id);
});

test('L09-156 战报未到时菜单分享:回首页,不签发推广凭据', () => {
  const h = mountSettle([]);
  h.page.data.report = {};
  const share = h.page.onShareAppMessage();
  assert.equal(share.path, '/pages/index/index');
  assert.equal(share.promise, undefined);
  assert.equal(h.sent.length, 0);
});
