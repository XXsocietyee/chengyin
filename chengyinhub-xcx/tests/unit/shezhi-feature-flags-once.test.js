'use strict';
// L10-040:设置页 onShow 读已加载的灰度开关,不再每次重拉 /api/config/features。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function mount(app) {
  let def;
  const file = path.resolve(__dirname, '../../pages/shezhi/shezhi.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { Page: (v) => { def = v; }, getApp: () => app,
    wx: { getStorageSync: () => '' }, require: createRequire(file), console, setTimeout, clearTimeout }, { filename: file });
  return Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(v) { Object.assign(this.data, v); } });
}

test('flags already loaded for this account are read, not refetched', () => {
  let loads = 0;
  const app = { globalData: { features: { userInvoice: true } }, getUserID: () => '7', _communityFeatureOwner: '7',
    loadFeatureFlags() { loads += 1; return Promise.resolve(); } };
  const page = mount(app);
  page.syncCommunityEntry();
  assert.equal(loads, 0);
  assert.equal(page.data.invoiceOn, true);
});

test('flags not loaded for the current account are fetched once', () => {
  let loads = 0;
  const app = { globalData: { features: {} }, getUserID: () => '8', _communityFeatureOwner: '7',
    loadFeatureFlags() { loads += 1; return Promise.resolve(); } };
  mount(app).syncCommunityEntry();
  assert.equal(loads, 1);
});

function flagsApp() {
  let user = '7';
  let auth = 'tok-a';
  let posts = 0;
  const app = {
    globalData: { features: { userInvoice: false }, authorization: 'tok-a', role: '', user_type: '' },
    getUserID: () => user,
    getAuthorization: () => auth,
    setUser(id) { user = String(id); },
    setAuth(value) { auth = value; this.globalData.authorization = value; },
    sendRequest() {},
    _communityFeatureOwner: null,
    _communityFeatureAuthorization: null,
    posts: () => posts,
    loadFeatureFlags() {
      posts += 1;
      const owner = String(user || '');
      const authorization = auth;
      this._communityFeatureOwner = null;
      let finish;
      const pending = new Promise((resolve) => { finish = resolve; });
      this._finish = (ok) => {
        if (ok && owner === String(user || '') && authorization === auth) {
          this.globalData.features = Object.assign({}, this.globalData.features, { userInvoice: true });
          this._communityFeatureOwner = owner;
          this._communityFeatureAuthorization = authorization;
        }
        finish();
      };
      return pending;
    },
  };
  return app;
}

async function visit(app, run) {
  const page = mount(app);
  const prevApp = global.getApp;
  const prevWx = global.wx;
  global.getApp = () => app;
  global.wx = {
    getStorageSync: () => '',
    setNavigationBarColor() {},
    setBackgroundColor() {},
    removeStorageSync() {},
    navigateTo() {},
    navigateBack() {},
    reLaunch() {},
    switchTab() {},
  };
  try { await run(page); }
  finally {
    if (prevApp === undefined) delete global.getApp; else global.getApp = prevApp;
    if (prevWx === undefined) delete global.wx; else global.wx = prevWx;
  }
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('L10-040: a later onShow does not post features again in the same visit', async () => {
  const app = flagsApp();
  await visit(app, async (page) => {
    page.onLoad({});
    page.onShow();
    page.onHide();
    page.onShow();
    assert.equal(app.posts(), 1);
    app._finish(true);
    await tick();
    app._communityFeatureOwner = null;
    page.onShow();
    assert.equal(app.posts(), 1);
    assert.equal(page.data.invoiceOn, true);
  });
});

test('L10-040: a failed load is read again on the next onShow', async () => {
  const app = flagsApp();
  await visit(app, async (page) => {
    page.onLoad({});
    page.onShow();
    app._finish(false);
    await tick();
    page.onHide();
    page.onShow();
    assert.equal(app.posts(), 2);
  });
});

test('L10-040: an account change reads flags again', async () => {
  const app = flagsApp();
  await visit(app, async (page) => {
    page.onLoad({});
    app._finish(true);
    await tick();
    page.onShow();
    assert.equal(app.posts(), 1);
    app.setUser('8');
    page.onShow();
    assert.equal(app.posts(), 2);
    app.setAuth('tok-b');
    page.onShow();
    assert.equal(app.posts(), 3);
  });
});
