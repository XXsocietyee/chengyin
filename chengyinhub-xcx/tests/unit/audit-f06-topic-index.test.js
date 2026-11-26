// AUDIT-1122 F06:场次时间按中国时区格式化且缺时分不抛 (L06-010);手势起点不过桥 (L06-006)
const { afterEach, test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const PAGE_PATH = path.resolve(__dirname, '../../pages/topic/index/index.js');
const pages = [];

function loadTopicPage() {
  const requests = [];
  const toasts = [];
  const navigations = [];
  const payments = [];
  const subscriptions = [];
  let pageConfig = null;

  // wx 在方法调用时才查全局，所以它必须留到测试跑完；getApp/Page 只在 require 期间需要。
  const previous = {
    getApp: global.getApp,
    Page: global.Page
  };

  const consents = [];
  const modals = [];
  const modalControl = { confirm: true };
  const consentControl = { reject: false };
  global.getApp = () => ({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserType: () => 1,
    getUserID: () => 500,
    tips: message => toasts.push(message),
    sendRequest: options => { requests.push(options); },
    recordConsent: input => {
      consents.push(input);
      return consentControl.reject ? Promise.reject(new Error('consent down')) : Promise.resolve({ code: 200 });
    }
  });
  global.Page = config => { pageConfig = config; };
  global.wx = {
    showLoading: () => {},
    hideLoading: () => {},
    showToast: options => toasts.push(options.title),
    showModal: options => {
      modals.push(options);
      if (options.success) options.success({ confirm: modalControl.confirm });
    },
    requestPayment: options => { payments.push(options); },
    requestSubscribeMessage: options => { subscriptions.push(options); },
    navigateTo: options => { navigations.push(options.url); },
    redirectTo: options => { navigations.push(options.url); },
    getSystemInfo: () => {},
    getStorageSync: () => '',
    setStorageSync: () => {},
    createSelectorQuery: () => { const q = { in: () => q, select: () => q, selectAll: () => q, boundingClientRect: () => q, scrollOffset: () => q, exec: () => {} }; return q; }
  };

  delete require.cache[PAGE_PATH];
  try {
    require(PAGE_PATH);
  } finally {
    global.getApp = previous.getApp;
    global.Page = previous.Page;
  }

  const vm = Object.assign({}, pageConfig.data, pageConfig.methods || {}, pageConfig, {
    setData(patch) { Object.assign(this.data, patch); }
  });
  vm.data = Object.assign({}, pageConfig.data);
  pages.push(vm);
  return { vm, requests, toasts, navigations, payments, consents, consentControl, modals, modalControl, subscriptions };
}

// 确保每个 page 加载后 workflow 已初始化，否则 _createSelfPlayOrder 里的 workflow.submit 会报错

test('L06-010 场次时间:缺时分/ISO 不抛错,按中国时区显示', () => {
  process.env.TZ = 'UTC';
  const { vm } = loadTopicPage();
  const list = vm.processTopicDate.call(vm, [
    { startTime: '2026-12-01', endTime: '2026-12-01T20:30:00+08:00' },
    { startTime: '2026-12-02 09:05:00', endTime: '2026-12-02 11:00:00' },
  ]);
  assert.equal(list[0].monthDayTime, '12-01 00:00');
  assert.equal(list[0].endMonthDayTime, '12-01 20:30');
  assert.equal(list[1].sessionTimeText, '12-02 09:05–11:00');
});

test('L06-006 触摸起点存实例,不 setData', () => {
  const { vm } = loadTopicPage();
  let calls = 0;
  const orig = vm.setData; vm.setData = function (p, cb) { calls += 1; return orig.call(this, p, cb); };
  vm.touchStart.call(vm, { touches: [{ clientY: 300 }] });
  assert.equal(calls, 0);
  assert.equal(vm._touchY, 300);
});

test('L06-074 删除评价图换新数组,不就地修改 data', () => {
  const { vm } = loadTopicPage();
  vm.data.uploadImages = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const before = vm.data.uploadImages;
  vm.deleteImage.call(vm, { currentTarget: { dataset: { index: 0 } } });
  assert.notEqual(vm.data.uploadImages, before, '删除要换新数组');
  assert.equal(before.length, 7, '原数组不被就地修改');
});

test('L06-075 核对一直不收尾时轮询有上限', () => {
  const { vm } = loadTopicPage();
  const scheduled = [];
  vm._later = (ms, fn) => scheduled.push(fn);
  vm._workflow = { getState: () => 'verifying', recheck() {} };
  vm._pollPayment.call(vm, 0);
  let guard = 0;
  while (scheduled.length && guard < 50) { scheduled.shift()(); guard += 1; }
  assert.ok(guard <= 13, '最多 12 次左右就停');
});
