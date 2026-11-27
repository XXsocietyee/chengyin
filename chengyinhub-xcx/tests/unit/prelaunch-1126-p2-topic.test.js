'use strict';

// 2026-11-26 上线前:主题评价不再整页重拉,选图/选点回来不重读,卸页后的定时器不再 setData,
// 模板详情不再写入页面不读的难度字母。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function loadPage(rel) {
  let definition;
  const requests = [];
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: { left: 300 } },
    sendRequest(options) { requests.push(options); return {}; },
    getRequestErrorMessage(_res, fallback) { return fallback; },
    getUserID() { return 7; },
    getUserRole() { return 'player'; },
    getUserType() { return 1; },
    getPageSize() { return 10; },
    getTotalPage() { return 1; },
    setUserRole() {},
    getImgUrl(value) { return value || ''; },
    tips() {},
    chooseImage(cb) { if (cb) cb(['https://example.com/a.jpg']); },
  };
  global.getApp = () => app;
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    getAccountInfoSync() { return { miniProgram: { envVersion: 'release' } }; },
    showToast() {}, showLoading() {}, hideLoading() {},
    stopPullDownRefresh() {}, pageScrollTo() {},
    getWindowInfo() { return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20 }; },
    getSystemInfoSync() { return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20 }; },
    chooseLocation() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(cb) { cb([]); } }; },
  };
  global.Page = (value) => { definition = value; };
  global.Component = (value) => { definition = value; };
  global.Behavior = (value) => value;
  const file = path.join(ROOT, rel);
  delete require.cache[require.resolve(file)];
  require(file);
  const page = Object.assign({}, definition);
  page.data = JSON.parse(JSON.stringify(definition.data || {}));
  page.setData = function (patch) { Object.assign(this.data, patch); };
  return { page, requests };
}

test('评价成功只补评论列表,不重拉主题详情', () => {
  const { page, requests } = loadPage('pages/topic/index/index.js');
  let detailReads = 0;
  page.getData = () => { detailReads += 1; };
  page.voteClose = () => { page.data.answer = -1; page.data.plnr = ''; };
  Object.assign(page.data, {
    id: 11, answer: 1, plnr: '  夜航很好  ', uploadImages: [], canSubmitComment: true,
    info: { commentCount: 2, averageRating: 4, commentList: [{ id: 9, memberNickname: '已有', contents: '旧', rating: 4 }] },
  });
  page.submitComment();
  const add = requests.find((r) => r.url === '/api/comment/add');
  add.success({ code: '200' });
  assert.equal(detailReads, 0);
  assert.equal(requests.some((r) => r.url === '/api/topic/info-to-user'), false);
  const list = requests.find((r) => r.url === '/api/comment/list');
  assert.equal(list.method, 'POST');
  assert.deepEqual(list.data, { owner_type: 1, owner_id: 11, pageNum: 1, pageSize: 5 });
  assert.equal(page.data.info.commentCount, 3);
  assert.equal(page.data.info.averageRating, 3.3);
  assert.equal(page.data.info.commentList[0].memberNickname, '');
  assert.equal(page.data.info.commentList[0].contents, '夜航很好');
  assert.equal(page.data.info.commentList[0].rating, 2);
  assert.equal(page.data.ratingStars.length, 3);
  list.success({ code: 200, data: { rows: [{ id: 21, memberNickname: '阿兰', contents: '夜航很好', rating: 2 }], total: 9 } });
  assert.equal(page.data.info.commentCount, 9);
  assert.equal(page.data.info.averageRating, 3.3);
  assert.equal(page.data.info.commentList[0].memberNickname, '阿兰');
  assert.equal(detailReads, 0);
});

test('主题页卸掉之后,量高度的定时器不再 setData', () => {
  const queued = [];
  const origSet = global.setTimeout;
  const origClear = global.clearTimeout;
  global.setTimeout = (fn) => {
    const handle = { fn, cleared: false };
    queued.push(handle);
    return handle;
  };
  global.clearTimeout = (handle) => { if (handle) handle.cleared = true; };
  try {
    const { page } = loadPage('pages/topic/index/index.js');
    page._windowSize = () => ({ w: 375, h: 667 });
    page.calculateScreenHeights();
    assert.equal(queued.length, 1);
    page.onUnload();
    assert.equal(queued[0].cleared, true);
    let writes = 0;
    page.setData = () => { writes += 1; };
    queued[0].fn();
    assert.equal(writes, 0);
    page._verifySeatOrder('ORDER-1', 0);
    assert.equal(queued.length, 1);
  } finally {
    global.setTimeout = origSet;
    global.clearTimeout = origClear;
  }
});

test('权益模板从选图或地图回来不重拉,只有标记过期才拉', () => {
  let config;
  const requests = [];
  global.getApp = () => ({ getUserID: () => 1, sendRequest: (r) => requests.push(r), tips() {} });
  global.Component = (value) => { config = value; };
  global.wx = { navigateTo() {}, showModal() {}, chooseLocation() {}, showToast() {} };
  const file = require.resolve('../../pages/topic/components/cy/chapter-node-form/index.js');
  delete require.cache[file];
  require(file);
  const component = Object.assign({
    data: { show: true, formMode: 'offer', termsMode: 'PERK', perkTemplatesLoading: false },
  }, config.methods);
  component.setData = (patch) => Object.assign(component.data, patch);
  config.pageLifetimes.show.call(component);
  assert.equal(requests.filter((r) => r.url === '/api/coop/perk-template/list').length, 0);
  component._perkTemplatesStale = true;
  config.pageLifetimes.show.call(component);
  assert.equal(requests.filter((r) => r.url === '/api/coop/perk-template/list').length, 1);
});

test('报名页选地点回来不把在途读取作废,也不整页重拉', () => {
  const { page } = loadPage('pages/topic/merchantapply/index.js');
  page._loadEpoch = 3;
  page._shopEpoch = 4;
  page._registrationLoading = true;
  page.choosePoiForNode();
  page.onHide();
  assert.notEqual(page._hidden, true);
  assert.equal(page._loadEpoch, 3);
  assert.equal(page._shopEpoch, 4);
  assert.notEqual(page._resumePrivateRead, true);
  let retries = 0;
  page.retryLoadRegistration = () => { retries += 1; };
  page._resumePrivateRead = true;
  page.onShow();
  assert.equal(retries, 0);
  page.onLoad({ topicId: '8', nodeId: '9', topicName: '%', chapterName: '%E5%A4%96' });
  assert.equal(page.data.topicName, '');
  assert.equal(page.data.chapterName, '外');
});

test('商家项目页从浮层或后台回来不整页重读', () => {
  const requests = [];
  const timers = [];
  let config = null;
  const dir = path.join(ROOT, 'pages/topic/merchantinfo');
  const context = {
    console,
    getApp: () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      sendRequest: (options) => requests.push(options),
      getRequestErrorMessage: (_res, fallback) => fallback,
      tips() {},
      getUserID: () => 7,
    }),
    getCurrentPages: () => [{}, {}],
    Page: (value) => { config = value; },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout() {},
    require: (id) => {
      const full = id.startsWith('.') ? path.resolve(dir, id) : id;
      if (full.endsWith(path.join('utils', 'modal.js'))) return { show(opts) { if (opts && opts.success) opts.success({ confirm: true }); } };
      if (full.endsWith(path.join('utils', 'toast.js'))) return Object.assign(() => {}, { success() {}, fail() {} });
      if (full.endsWith(path.join('utils', 'merchant-theme.js'))) return { merchantPageShow() {}, merchantPageRestore() {} };
      return require(full);
    },
    module: { exports: {} },
    exports: {},
    wx: {
      getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
      showToast() {}, showLoading() {}, hideLoading() {}, showModal() {},
      navigateBack() {}, navigateTo() {}, redirectTo() {}, reLaunch() {}, switchTab() {}, pageScrollTo() {},
      getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    },
  };
  vm.runInContext(fs.readFileSync(path.join(dir, 'merchantinfo.js'), 'utf8'), vm.createContext(context), { filename: path.join(dir, 'merchantinfo.js') });
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = (patch) => Object.assign(page.data, patch);
  let reloads = 0;
  page.reloadProjectPrivate = () => { reloads += 1; };
  page._resumeCategoryReturn = () => {};
  page.onHide();
  page._hiddenAt = Date.now() - 120000;
  page.onShow();
  assert.equal(reloads, 0);
  page.onHide();
  page._navigating = true;
  page.onShow();
  assert.equal(reloads, 1);
});

test('喜欢标记在详情上就直接用;没有标记不拉收藏列表,也不把心改成未喜欢', () => {
  const liked = loadPage('pages/topic/index/index.js');
  liked.page._loadFav(11, { id: 11, isLike: 1 });
  assert.equal(liked.page.data.faved, true);
  assert.equal(liked.requests.some((r) => r.url === '/api/topic/like_list'), false);

  const byName = loadPage('pages/topic/index/index.js');
  byName.page._loadFav(11, { id: 11, isLiked: 1 });
  assert.equal(byName.page.data.faved, true);
  byName.page._loadFav(11, { id: 11, liked: true });
  assert.equal(byName.page.data.faved, true);
  assert.equal(byName.requests.some((r) => r.url === '/api/topic/like_list'), false);

  const off = loadPage('pages/topic/index/index.js');
  off.page.data.faved = true;
  off.page._loadFav(11, { id: 11, isLike: 0 });
  assert.equal(off.page.data.faved, false);
  off.page.data.faved = true;
  off.page._loadFav(11, { id: 11, isLiked: 0 });
  assert.equal(off.page.data.faved, false);
  off.page.data.faved = true;
  off.page._loadFav(11, { id: 11, liked: false });
  assert.equal(off.page.data.faved, false);
  assert.equal(off.requests.some((r) => r.url === '/api/topic/like_list'), false);

  const plain = loadPage('pages/topic/index/index.js');
  plain.page.data.faved = true;
  const patches = [];
  plain.page.setData = (patch) => { patches.push(patch); Object.assign(plain.page.data, patch); };
  plain.page._loadFav(11, { id: 11, name: '夜航' });
  assert.equal(plain.requests.some((r) => r.url === '/api/topic/like_list'), false);
  assert.equal(patches.length, 0);
  assert.equal(plain.page.data.faved, true);

  const tapped = loadPage('pages/topic/index/index.js');
  tapped.page.data.id = 11;
  tapped.page.data.info = { id: 11 };
  tapped.page._favReadAt = 0;
  tapped.page.toggleFav();
  tapped.requests.find((r) => r.url === '/api/topic/like').success({ code: '200' });
  assert.equal(tapped.page._favBusy, false);
  assert.equal(tapped.page.data.faved, true);
  tapped.page._loadFav(11, { id: 11, isLike: 0 });
  tapped.page._loadFav(11, { id: 11, name: '夜航' });
  assert.equal(tapped.page.data.faved, true);
  assert.equal(tapped.requests.some((r) => r.url === '/api/topic/like_list'), false);

  const sameRead = loadPage('pages/topic/index/index.js');
  sameRead.page.data.faved = true;
  sameRead.page._favReadAt = 0;
  sameRead.page._loadFav(11, { id: 11, isLike: 0 });
  assert.equal(sameRead.page.data.faved, false);
});

test('更早发出的详情回包不盖过已经点过的心', () => {
  function open() {
    const loaded = loadPage('pages/topic/index/index.js');
    loaded.page.data.id = 11;
    loaded.page.getData();
    return loaded;
  }
  const topic = () => ({ id: 11, name: '夜航', chaptersList: [], isLike: 0 });
  const kept = open();
  kept.page.toggleFav();
  kept.requests.find((r) => r.url === '/api/topic/like').success({ code: '200' });
  kept.requests.find((r) => r.url === '/api/topic/info-to-user').success({ code: '200', data: topic() });
  assert.equal(kept.page.data.faved, true);
  assert.equal(kept.requests.some((r) => r.url === '/api/topic/like_list'), false);

  const fresh = open();
  fresh.requests.find((r) => r.url === '/api/topic/info-to-user').success({ code: '200', data: topic() });
  assert.equal(fresh.page.data.faved, false);
  assert.equal(fresh.requests.some((r) => r.url === '/api/topic/like_list'), false);
});

test('滚动只读一次窗口高度', () => {
  const { page } = loadPage('pages/topic/index/index.js');
  let reads = 0;
  global.wx.getWindowInfo = () => {
    reads += 1;
    return { windowWidth: 390, windowHeight: 800, screenHeight: 844, safeArea: { bottom: 810 } };
  };
  global.wx.getSystemInfoSync = () => { reads += 1; return { windowWidth: 390, windowHeight: 800 }; };
  page.data.screen2Top = 700;
  for (let i = 0; i < 8; i++) page.onPageScroll({ scrollTop: 1200 + i });
  assert.equal(reads, 1);
  page.onPageScroll({ scrollTop: 20 });
  assert.equal(reads, 1);
});

test('模板详情不再 setData 页面不读的难度字母', () => {
  const source = fs.readFileSync(path.join(ROOT, 'pages/templatedetail/templatedetail.js'), 'utf8');
  assert.equal(source.includes('difficultyLetter'), false);
  assert.equal(source.includes('difficultyLabel'), false);
  const { page } = loadPage('pages/templatedetail/templatedetail.js');
  let patch = null;
  page.setData = (next) => { patch = next; Object.assign(page.data, next); };
  page.applyDetailPayload({ difficulty: '中', title: '夜航', ruleInstructions: '' });
  assert.equal(patch.difficultyLetter, undefined);
  assert.equal(patch.difficultyLabel, undefined);
  assert.equal(patch.info.difficulty, '中');
});

test('主题模板预览重排时清掉上一轮定时器,卸页后不再 setData', () => {
  const queued = [];
  const origSet = global.setTimeout;
  const origClear = global.clearTimeout;
  global.setTimeout = (fn) => {
    const handle = { fn, cleared: false };
    queued.push(handle);
    return handle;
  };
  global.clearTimeout = (handle) => { if (handle) handle.cleared = true; };
  try {
    const { page } = loadPage('pages/templatedetail/topic-preview/index.js');
    page.data.reducedMotion = false;
    const cards = [{ title: '封面' }, { title: '第一关' }];
    page.layout(cards, true);
    page.layout(cards, true);
    assert.equal(queued[0].cleared, true);
    assert.equal(queued[1].cleared, true);
    page.onUnload();
    assert.equal(queued[2].cleared, true);
    assert.equal(queued[3].cleared, true);
    let writes = 0;
    page.setData = () => { writes += 1; };
    queued[2].fn();
    queued[3].fn();
    assert.equal(writes, 0);
  } finally {
    global.setTimeout = origSet;
    global.clearTimeout = origClear;
  }
});
