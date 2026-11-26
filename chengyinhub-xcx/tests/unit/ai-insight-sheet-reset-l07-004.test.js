'use strict';
// L07-004 / L07-123:推荐主题弹层关到一半就离开页面时,不得留下透明全屏遮罩;量尺寸回调晚到不重开
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mountPage() {
  let def = null;
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  let execCb = null;
  global.Page = (v) => { def = v; };
  global.getApp = () => ({ globalData: {}, getUserID: () => 'm1', sendRequest() {}, getRequestErrorMessage: (r, f) => f });
  global.wx = {
    getSystemInfoSync: () => ({ statusBarHeight: 20 }), setNavigationBarColor() {}, setBackgroundColor() {},
    navigateTo() {}, getStorageSync() {}, setStorageSync() {},
    createSelectorQuery: () => ({ in() { return this; }, select() { return { boundingClientRect() {} }; }, exec(cb) { execCb = cb; } }),
  };
  const file = path.join(__dirname, '../../pages/merchant/marketing/ai-insight/index.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data));
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb(); };
  page.goRecTopic = () => {};
  return { page, exec: (rects) => execCb(rects), restore() { Object.assign(global, prev); } };
}

test('applyTopic then hide leaves no sheet phase (no invisible blocking scrim)', () => {
  const h = mountPage();
  try {
    h.page.data.recTopics = [{ id: 1, name: 'A' }];
    h.page.data.sheetPhase = 'open'; h.page.data.sheetTopic = { id: 1 }; h.page.data.scrimOn = true;
    h.page.applyTopic({ currentTarget: { dataset: { idx: 0 } } });
    h.page.onHide();
    assert.equal(h.page.data.sheetPhase, '');
    assert.equal(h.page.data.scrimOn, false);
  } finally { h.restore(); }
});

test('hiding while the sheet is closing clears the phase', () => {
  const h = mountPage();
  try {
    h.page.data.sheetPhase = 'open'; h.page.data.sheetTopic = { id: 1 };
    h.page.closeTopic();
    assert.equal(h.page.data.sheetPhase, 'closing');
    h.page.onHide();
    assert.equal(h.page.data.sheetPhase, '');
  } finally { h.restore(); }
});

test('late measure callback after the user closed the sheet does not reopen it', () => {
  const h = mountPage();
  try {
    h.page.data.recTopics = [{ id: 1, name: 'A' }];
    h.page.openTopic({ currentTarget: { dataset: { idx: 0 } } });
    h.page.closeTopic();
    h.exec([null, null]);
    assert.notEqual(h.page.data.sheetPhase, 'open');
  } finally { h.restore(); }
});
