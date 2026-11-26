'use strict';
// L09-062:落地页的光圈/光点循环只在 ready 且可见时跑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const FILE = path.resolve(__dirname, '../../subpackageJourney/pages/landing/index.js');

test('loops idle while loading/error, run when ready, stop on hide', () => {
  let def; const requests = []; const timers = [];
  const app = { globalData: {}, getUserID: () => 7, sendRequest: (o) => requests.push(o) };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), { Page: (d) => { def = d; }, getApp: () => app, wx: { getStorageSync() {} }, getCurrentPages: () => [{}],
    require: createRequire(FILE), setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout() {}, console, Promise }, { filename: FILE });
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); } });
  page.data.reduced = false;
  page.onLoad({ k: 'r', t: 'tok' }); page.onShow();
  assert.equal(page.data.state, 'loading');
  assert.equal((page._loopStops || []).length, 0);
  page.setData({ state: 'ready' }); page._syncLoops();
  assert.equal(page._loopStops.length, 5);
  page.onHide();
  assert.equal(page._loopStops.length, 0);
  page.onShow();
  assert.equal(page._loopStops.length, 5);
  page.setData({ seatNo: '3', claimDone: true, headRise: true });
  page.load();
  assert.equal(page._loopStops.length, 0);
  // L09-157:重读清掉上一账号的席位号与领取态
  assert.equal(page.data.seatNo, ''); assert.equal(page.data.claimDone, false); assert.equal(page.data.headRise, false);
});
