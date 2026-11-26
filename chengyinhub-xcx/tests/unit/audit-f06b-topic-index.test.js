// AUDIT-1122 F06 pass 2 (topic/index). Harness copied from audit-f06-topic-index.
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
afterEach(() => { pages.length = 0; });

test('L06-073 点探索场次行打开选场次弹层并预选这一张', () => {
  const { vm } = loadTopicPage();
  vm.lockedTip = () => false;
  vm.data.info = { activityList: [{ id: 1 }], omsTicketList: [{ id: 7, name: ' 夜场 ' }, { id: 8, name: '早场' }] };
  vm.bmClick({ currentTarget: { dataset: { id: 7 } } });
  assert.equal(vm.data.sessionPicker.show, true);
  assert.equal(vm.data.sessionPreferName, '夜场');
  vm.closeSessionPicker();
  // 购买半屏带来的票名不被无 id 的入口冲掉
  vm.data.sessionPreferName = '早场';
  vm.bmClick({ currentTarget: { dataset: {} } });
  assert.equal(vm.data.sessionPreferName, '早场');
});

test('L06-107 抽屉/叠层所有实例只量一次胶囊坐标,created 写初始数据不再 setData', () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const nav = require('../../utils/nav-safe-area.js')
  for (const file of ['project-drawer', 'project-layer']) {
    let definition
    let measures = 0
    const capsule = { left: 278, top: 59, bottom: 91 }
    const sandbox = {
      Component(value) { definition = value },
      wx: { getWindowInfo: () => { measures += 1; return { windowWidth: 375, statusBarHeight: 47 } }, getMenuButtonBoundingClientRect: () => capsule },
      require: (request) => (request.endsWith('nav-safe-area.js') ? nav : {}),
    }
    const full = path.resolve(__dirname, '../../pages/topic/components', file, 'index.js')
    vm.runInNewContext(fs.readFileSync(full, 'utf8'), sandbox)
    let setDataCalls = 0
    for (let i = 0; i < 6; i += 1) {
      const instance = { data: Object.assign({}, definition.data), setData(p) { setDataCalls += 1; Object.assign(this.data, p) } }
      definition.lifetimes.created.call(instance)
      definition.lifetimes.attached.call(instance)
      assert.equal(instance.data.panelTop, 96, file)
    }
    assert.equal(measures, 1, file + ' 只量一次')
    assert.equal(setDataCalls, 0, file + ' 不再逐个 setData')
  }
})

test('L06-134 选章节层不把整章原始对象放进 setData,确认时仍交回原章节', () => {
  let def
  const prev = { getApp: global.getApp, Component: global.Component }
  global.getApp = () => ({ globalData: {}, sendRequest() {}, getRequestErrorMessage: (r, f) => f })
  global.Component = (v) => { def = v }
  const file = require.resolve('../../pages/topic/components/cy/chapter-target-picker/index.js')
  delete require.cache[file]
  try { require(file) } finally { global.getApp = prev.getApp; global.Component = prev.Component }
  const events = []
  const c = Object.assign({}, def.methods, {
    data: Object.assign(JSON.parse(JSON.stringify(def.data)), { show: true }),
    setData(p) { Object.assign(this.data, p) },
    triggerEvent(name, detail) { events.push({ name, detail }) },
  })
  c.loadTemplates = () => {}
  const chapter = { id: 4, name: '第二章', roleNeedShops: '2 家', extra: { deep: true } }
  def.observers['show, chapters, chaptersState'].call(c, true, [chapter], 'ready')
  assert.equal(c.data.rows.length, 1)
  assert.equal(c.data.rows[0].raw, undefined)
  c.data.templatesState = 'ready'
  c.onNext()
  const confirm = events.find((e) => e.name === 'confirm')
  assert.ok(confirm, '应发出确认')
  assert.equal(confirm.detail.chapter, chapter)
  assert.equal(confirm.detail.chapterId, 4)
})

function loadComponent(rel) {
  let def
  const prev = { Component: global.Component, getApp: global.getApp }
  global.Component = (v) => { def = v }
  global.getApp = () => ({ globalData: {} })
  const file = require.resolve('../../pages/topic/components/cy/' + rel + '/index.js')
  delete require.cache[file]
  try { require(file) } finally { global.Component = prev.Component; global.getApp = prev.getApp }
  return def
}

test('L06-128 扇形卡:滚动回调与点卡各只 setData 一次,卸载清掉入场定时器', () => {
  const def = loadComponent('story-fan')
  let cb = null
  let calls = 0
  const c = Object.assign({}, def.methods, {
    data: Object.assign(JSON.parse(JSON.stringify(def.data)), { items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }], navHeight: 88, reducedMotion: true, focus: 1, caption: 'B' }),
    setData(p) { calls += 1; Object.assign(this.data, p) },
    triggerEvent() {},
    createIntersectionObserver: () => ({ relativeToViewport() { return this }, observe(sel, fn) { cb = fn }, disconnect() {} }),
  })
  def.lifetimes.ready.call(c)
  cb({ boundingClientRect: { top: 0 }, intersectionRatio: 0.2 })
  assert.equal(calls, 1, '一次回调一次 setData')
  assert.equal(c.data.focus, -1)
  assert.equal(c.data.poses.length, 3)
  calls = 0
  c.onCard({ currentTarget: { dataset: { i: 2 } } })
  assert.equal(calls, 1)
  assert.equal(c.data.focus, 2)
  let cleared = false
  const realClear = global.clearTimeout
  c._enterTimer = 42
  global.clearTimeout = (id) => { if (id === 42) cleared = true }
  try { def.lifetimes.detached.call(c) } finally { global.clearTimeout = realClear }
  assert.equal(cleared, true)
})

test('L06-008 未报名不拉开局准备;NPC 进故事标签才拉一次', () => {
  const { vm, requests } = loadTopicPage()
  vm._later = () => {}
  vm.data.is_join = 0
  const data = { id: 9, name: '夜行', productType: 1, chaptersList: [{ nodes: [{ id: 3, name: '老店', registrationMerchantList: [{ id: 1 }] }] }] }
  vm._applyMotionData(data)
  assert.equal(requests.filter((r) => r.url === '/api/play/setup').length, 0, '未报名不拉 play/setup')
  assert.equal(requests.filter((r) => r.url === '/api/ai/npc/profile').length, 0, '不在故事标签不拉 NPC')
  vm.switchTab({ detail: { key: '1' } })
  vm.switchTab({ detail: { key: '0' } })
  vm.switchTab({ detail: { key: '1' } })
  assert.equal(requests.filter((r) => r.url === '/api/ai/npc/profile').length, 1, '进故事标签只拉一次')
  vm.data.is_join = 1
  vm._applyMotionData(data)
  assert.equal(requests.filter((r) => r.url === '/api/play/setup').length, 1, '已报名才拉开局准备')
})

test('L06-028 封面/章节图认 JSON 数组串并滤掉 media-asset 引用', () => {
  const motion = require('../../pages/topic/utils/topic-motion.js')
  const cards = require('../../pages/topic/utils/chapter-cards.js')
  assert.equal(motion.buildCoverImages({ imgArr: '["a.jpg","media-asset:9","b.jpg"]' }).join('|'), 'a.jpg|b.jpg')
  assert.equal(motion.buildCoverImages({ imgArr: 'a.jpg,b.jpg' }).join('|'), 'a.jpg|b.jpg')
  assert.equal(cards.firstImage('["media-asset:1",{"url":"c.jpg"}]'), 'c.jpg')
  assert.equal(cards.firstImage('media-asset:2'), '')
  const picked = motion.pickChapterImages([{ imgArr: '["x.jpg"]', nodes: [] }], 'cover.jpg')
  assert.equal(picked[0], 'x.jpg')
})
