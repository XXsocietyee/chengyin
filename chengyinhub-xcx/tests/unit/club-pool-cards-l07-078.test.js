'use strict';
// L07-078:业务失败也显示可重试的错误;连点只跳一次
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('non-200 shows poolError and double taps navigate once', () => {
  let def = null;
  const requests = [];
  const navs = [];
  const prev = { Component: global.Component, getApp: global.getApp, wx: global.wx };
  global.Component = (v) => { def = v; };
  global.getApp = () => ({ globalData: {}, getUserID: () => 9, sendRequest: (o) => requests.push(o) });
  global.wx = { navigateTo: (o) => navs.push(o), getStorageSync() {} };
  try {
    const file = path.join(__dirname, '../../pages/merchant/components/cy/club-pool-cards/index.js');
    delete require.cache[require.resolve(file)];
    require(file);
    const c = Object.assign({ data: JSON.parse(JSON.stringify(def.data || {})) }, def.methods);
    c.setData = function (p) { Object.assign(this.data, p); };
    c.load();
    requests[0].success({ code: 500, msg: '忙' });
    assert.equal(c.data.poolError, true);
    c.openAll(); c.openAll();
    assert.equal(navs.length, 1);
  } finally { Object.assign(global, prev); }
});
