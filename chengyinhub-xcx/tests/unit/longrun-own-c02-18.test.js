// NOT_RUN: local verification deferred by user.
// Real Page methods, deferred request callbacks and local storage exercise lost-write responses.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const PAGE = '../../pages/publish/fabu/index.js';

let sent = [];
let storage = {};
let navigations = [];
let toasts = [];
let modals = [];
let memberId = 42;

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  sendRequest: (p) => { sent.push(p); },
  tips: (m) => { toasts.push(m); },
  getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
  chooseImage: () => {},
  getUserID: () => memberId,
  getUserInfo: () => null,
  getToken: () => '',
});
global.wx = {
  getStorageSync: (k) => storage[k],
  setStorageSync: (k, v) => { storage[k] = v; },
  removeStorageSync: (k) => { delete storage[k]; },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: (o) => { toasts.push(o && o.title); },
  showLoading: () => {}, hideLoading: () => {},
  showModal: (options) => { modals.push(options); if (options.success) options.success({ confirm: true }); },
  navigateTo: (options) => { navigations.push(options.url); },
  redirectTo: (options) => { navigations.push(options.url); },
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {}, nextTick: (f) => f(),
};

let pageConfig = null;
global.Page = (cfg) => { pageConfig = cfg; };

beforeEach(() => {
  memberId = 42;
  sent = [];
  storage = {};
  navigations = [];
  toasts = [];
  modals = [];
  pageConfig = null;
  delete require.cache[require.resolve(PAGE)];
  require(PAGE);
});

function makePage() {
  const inst = Object.assign({}, pageConfig);
  inst.data = JSON.parse(JSON.stringify(pageConfig.data));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach((k) => {
      const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
      let o = inst.data;
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
      o[parts[parts.length - 1]] = patch[k];
    });
    if (cb) cb();
  };
  return inst;
}

// L03-171 业主默认 A(2026-11-24):库存 < 1 的票不准保存。零库存仍原样读进抽屉(不被悄悄改成 100),
// 保存被拦下并说明原因,已存的那张票不变;改成 1 张以上才放行。
test('zero total stock is shown as-is in the real ticket drawer, saving is blocked until stock >= 1', () => {
  const page = makePage();
  page.data.formData.productType = 2;
  page.data.formData.tickets = [{ id:9, name:'zero stock', totalStock:0, mode:2, startTime:'2030-01-01', endTime:'2030-01-02', saleStartTime:'2029-12-01', saleEndTime:'2029-12-31' }];
  page.openTicketEditor({ currentTarget:{ dataset:{ index:0 } } });
  assert.equal(page.data.editingTicket.totalStock, 0);
  assert.equal(page.data.canSaveTicket, false);
  assert.equal(page._ticketSaveBlockReason(), '库存至少 1 张');
  page.saveTicket();
  assert.equal(page.data.formData.tickets[0].totalStock, 0);
  assert.equal(page.data.formData.tickets[0].id, 9);
  page.onEditTicketChange({ currentTarget:{ dataset:{ field:'totalStock' } }, detail:{ value:'5' } });
  assert.equal(page.data.canSaveTicket, true);
  page.saveTicket();
  assert.equal(page.data.formData.tickets[0].totalStock, 5);
  assert.equal(page.data.formData.tickets[0].id, 9);
});
