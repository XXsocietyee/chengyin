'use strict';
// L07-008:去缴纳保证金只能回到合作列表;从 IM / 工作台打开详情时不能 navigateBack 回错页
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function mount(stack) {
  let def = null;
  const calls = [];
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx, getCurrentPages: global.getCurrentPages };
  global.Page = (v) => { def = v; };
  global.getApp = () => ({ globalData: {}, getUserID: () => 1, sendRequest() {}, getRequestErrorMessage: (r, f) => f });
  global.getCurrentPages = () => stack.map((route) => ({ route }));
  global.wx = {
    getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), setNavigationBarColor() {}, setBackgroundColor() {},
    getStorageSync() {}, setStorageSync() {},
    navigateBack: (o) => calls.push(['back', o.delta]),
    redirectTo: (o) => calls.push(['redirect', o.url]),
  };
  const file = path.join(__dirname, '../../pages/coop/invite-detail/index.js');
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, def);
  page.data = JSON.parse(JSON.stringify(def.data));
  page._captureContext = () => ({});
  page._isCurrent = () => true;
  return { page, calls, restore() { Object.assign(global, prev); } };
}

test('opened from the coop list: deposit goes back to the list', () => {
  const h = mount(['pages/coop/list/index', 'pages/coop/invite-detail/index']);
  try { h.page.goDeposit(); assert.deepEqual(h.calls, [['back', 1]]); } finally { h.restore(); }
});

for (const from of ['subpackageB/pages/im/list/index', 'pages/merchant/index/index']) {
  test('opened from ' + from + ': deposit redirects to the coop list', () => {
    const h = mount([from, 'pages/coop/invite-detail/index']);
    try {
      h.page.data.box = 'sent';
      h.page.goDeposit();
      assert.deepEqual(h.calls, [['redirect', '/pages/coop/list/index?tab=sent']]);
    } finally { h.restore(); }
  });
}
