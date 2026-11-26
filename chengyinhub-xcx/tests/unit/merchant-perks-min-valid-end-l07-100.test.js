'use strict';
// L07-100:权益表单每次打开都重算「最早明天」,页面开过午夜也不放行今天
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('openForm recomputes minValidEnd', () => {
  let def = null;
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx };
  global.Page = (v) => { def = v; };
  global.getApp = () => ({ globalData: {}, getUserID: () => 1, sendRequest() {}, getRequestErrorMessage: (r, f) => f });
  global.wx = { getSystemInfoSync: () => ({}), getWindowInfo: () => ({}), setNavigationBarColor() {}, setBackgroundColor() {} };
  try {
    const file = path.join(__dirname, '../../pages/merchant/decor/perks/index.js');
    delete require.cache[require.resolve(file)];
    require(file);
    const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) });
    page.setData = function (patch) { Object.assign(this.data, patch); };
    page.data.minValidEnd = '2000-01-01';
    page.openForm();
    assert.ok(page.data.minValidEnd > '2000-01-01');
    assert.match(page.data.minValidEnd, /^\d{4}-\d{2}-\d{2}$/);
  } finally { Object.assign(global, prev); }
});
