const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const journeyView = require(path.join(root, 'subpackageJourney/utils/journey-view.js'));
const bountyView = require(path.join(root, 'subpackageA/utils/video-bounty-view.js'));
const earningsView = require(path.join(root, 'subpackageA/utils/earnings-view.js'));

function assignData(data, patch) {
  Object.entries(patch).forEach(([key, value]) => {
    const keys = key.split('.');
    if (keys.length === 2) data[keys[0]][keys[1]] = value;
    else data[key] = value;
  });
}

function loadScript(rel, extras) {
  const file = path.resolve(root, rel);
  const realRequire = createRequire(file);
  let definition;
  const requests = [];
  const app = Object.assign({
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => '7',
    getAuthorization: () => 'token',
    sendRequest: req => requests.push(req),
  }, extras && extras.app);
  const wxApi = Object.assign({
    getStorageSync() { return false; },
    setStorageSync() {},
    stopPullDownRefresh() {},
    navigateTo() {},
    redirectTo() {},
    navigateBack() {},
    switchTab() {},
    getWindowInfo() { return { pixelRatio: 2 }; },
    showToast() {},
  }, extras && extras.wx);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), Object.assign({
    Page: value => { definition = value; },
    Component: value => { definition = value; },
    getApp: () => app,
    getCurrentPages: () => [],
    wx: wxApi,
    require: name => realRequire(name),
    console,
    setTimeout: extras && extras.setTimeout || setTimeout,
    clearTimeout: extras && extras.clearTimeout || clearTimeout,
  }, extras && extras.globals), { filename: file });
  const page = Object.assign({}, definition.methods || definition, {
    data: JSON.parse(JSON.stringify(definition.data || {})),
    properties: JSON.parse(JSON.stringify(definition.properties || {})),
  });
  page.setData = patch => assignData(page.data, patch);
  return { page, definition, app, requests, wx: wxApi };
}

test('a bare percent in a landing token does not throw and is not a link', () => {
  assert.equal(journeyView.landingKind({ k: 'r', t: '%' }), null);
  assert.deepEqual(journeyView.landingKind({ k: 'r', t: 'a%20b' }), { kind: 'referral', token: 'a b' });
});

test('settle, report, reveal and video bounty ignore a broken query percent', () => {
  const settle = loadScript('subpackageJourney/pages/settle/index.js');
  settle.page.onLoad({ topicName: '%' });
  assert.equal(settle.page.data.topicName, '');

  const report = loadScript('subpackageJourney/pages/report/index.js');
  report.page.onLoad({ topicName: '%' });
  assert.equal(report.page._topicName, '');

  const reveal = loadScript('subpackagePass/reveal/index.js');
  assert.equal(reveal.page._paidCopy({ until: '%', count: '3' }).p, '');
  assert.equal(reveal.page._paidCopy({ until: '2026%2D12%2D01' }).p, '到 2026-12-01');

  const bounty = loadScript('subpackageA/pages/video-bounty/index.js');
  bounty.page.onLoad({ campaignKey: '%', topicId: '4' });
  assert.equal(bounty.page.data.campaignKey, '');
  assert.equal(bounty.page.data.topicId, '4');
});

test('seat lobby skips the show that follows onLoad, then reloads and keeps the transfer draft', async () => {
  const h = loadScript('subpackageJourney/pages/seats/index.js');
  const seats = () => h.requests.filter(req => req.url === '/api/play/player-journey/seats');
  h.page.onLoad({ registrationId: '9' });
  assert.equal(seats().length, 1);
  h.page.onShow();
  assert.equal(seats().length, 1, 'the show that follows onLoad must not fetch again');
  seats()[0].success({
    code: 200,
    data: {
      registrationId: '9', seatCount: 4, freeSeats: 3, buyerIsCaller: true, readOnly: false,
      seats: [{ seatNo: 1, state: 'CLAIMED' }, { seatNo: 2, state: 'AVAILABLE' }],
    },
  });
  await Promise.resolve();
  assert.equal(h.page.data.state, 'ready');
  assert.equal(h.page.data.lobby.openCount, 1);
  h.page.setData({ 'transfer.name': '阿兰', 'transfer.phone': '13800138000' });
  h.page.onShow();
  assert.equal(seats().length, 2);
  assert.ok(h.requests.some(req => req.url === '/api/user/info'));
  seats()[1].success({
    code: 200,
    data: {
      registrationId: '9', seatCount: 4, freeSeats: 2, buyerIsCaller: true, readOnly: false,
      seats: [{ seatNo: 1, state: 'CLAIMED' }, { seatNo: 2, state: 'CLAIMED' }],
    },
  });
  await Promise.resolve();
  assert.equal(h.page.data.transfer.name, '阿兰');
  assert.equal(h.page.data.transfer.phone, '13800138000');
  assert.equal(h.page.data.lobby.openCount, 0);
});

test('a seat response that returns after leave does not paint the page', async () => {
  const h = loadScript('subpackageJourney/pages/seats/index.js');
  h.page.onLoad({ registrationId: '9' });
  h.page.onShow();
  h.page.onUnload();
  const req = h.requests.find(item => item.url === '/api/play/player-journey/seats');
  req.success({ code: 200, data: { registrationId: '9', seatCount: 1, freeSeats: 0, seats: [] } });
  await Promise.resolve();
  assert.equal(h.page.data.state, 'loading');
});

test('leaving the pass reveal clears the ending timer', () => {
  const pending = new Set();
  let n = 0;
  const reveal = loadScript('subpackagePass/reveal/index.js', {
    setTimeout(fn) { const id = ++n; pending.add(id); return id; },
    clearTimeout(id) { pending.delete(id); },
  });
  reveal.page.data.reduced = true;
  reveal.page._end();
  assert.equal(pending.size, 1);
  reveal.page.onUnload();
  assert.equal(pending.size, 0);
  assert.equal(reveal.page._endT, 0);
});

test('detaching the pin and the frame player clears their timers', () => {
  const pending = new Map();
  let n = 0;
  const timers = {
    setTimeout(fn) { const id = ++n; pending.set(id, fn); return id; },
    clearTimeout(id) { pending.delete(id); },
  };
  const pin = loadScript('subpackageP3/components/pin-spin/index.js', timers);
  pin.page.data = { reduced: true, glyph: 'A', track: 0 };
  pin.page._theta = 0;
  pin.page._draw = () => {};
  pin.page._stop = () => {};
  pin.page._spinTo(1);
  const flip = [...pending.values()][0];
  assert.equal(pending.size, 1);
  pin.definition.lifetimes.detached.call(pin.page);
  assert.equal(pending.size, 0);
  assert.equal(pin.page._dead, true);
  flip();
  assert.equal(pin.page._theta, Math.PI);

  const frames = loadScript('subpackagePass/components/cy-frames/index.js', timers);
  frames.page.properties = {
    sheets: [{ src: 'a.webp', n: 2 }], cols: 6, fw: 112, fh: 112, w: 224, h: 224,
    fps: 12, mode: 'loop', loopFrom: 0, still: -1, delay: 0, reducedMotion: false,
  };
  frames.page._reset();
  frames.page._start();
  const enter = [...pending.values()][0];
  frames.definition.lifetimes.detached.call(frames.page);
  assert.equal(frames.page._gone, true);
  assert.equal(pending.size, 0);
  enter();
  assert.equal(frames.page.data.on, false);
});

test('a missing bounty amount is not zero, and a real zero still formats', () => {
  assert.equal(bountyView.accrualRow({ id: 9, payoutState: 0 }).amount, '—');
  assert.equal(bountyView.accrualRow({ id: 9, payableAmount: 0, payoutState: 0 }).amount, '¥0.0');
});

test('wallet rows stay unknown when the server has not priced them, and a real zero stays zero', () => {
  const unknown = earningsView.assetRows({
    amountsKnown: false, withdrawable: '0.00', pending: '', complaintPeriod: [], disputed: '',
  });
  assert.deepEqual(unknown.map(row => row.unknown), [true, true]);
  assert.equal(unknown.some(row => row.amount === '0.00'), false);

  const zero = earningsView.assetRows({
    amountsKnown: true, withdrawable: '0.00', pending: '', complaintPeriod: [], disputed: '',
  });
  assert.equal(zero[0].amount, '0.00');
  assert.equal(zero[0].unknown, false);
  assert.equal(zero[1].amount, '0.00');

  const wxml = fs.readFileSync(path.join(root, 'subpackageA/components/earnings-overview/index.wxml'), 'utf8');
  assert.match(wxml, /item\.unknown \? '金额待确认'/);
});

function mountProjects() {
  const file = path.resolve(root, 'subpackageA/pages/myproject/index.js');
  const realRequire = createRequire(file);
  let definition;
  const requests = [];
  const store = {};
  let owner = '7';
  let token = 'token';
  let picked = null;
  const app = {
    globalData: {},
    getUserID: () => owner,
    getAuthorization: () => token,
    sendRequest: req => requests.push(req),
    chooseImage: cb => { picked = cb; },
  };
  const roles = { role: () => 'club', load: () => {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: value => { definition = value; },
    getApp: () => app,
    wx: {
      navigateTo() {},
      setStorageSync(key, value) { store[key] = value; },
      getStorageSync(key) { return store[key]; },
      showToast() {},
    },
    require: name => name.endsWith('/roleGuard.js') ? roles
      : name.endsWith('/merchant-theme.js') ? { merchantPageShow() {}, merchantPageRestore() {} }
        : realRequire(name),
  }, { filename: file });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = patch => assignData(page.data, patch);
  return {
    page, requests, store,
    session(id, auth) { owner = id; token = auth; },
    takeImage: () => picked,
    mine: () => requests.filter(req => req.url === '/api/project/my').length,
  };
}

test('picking one appeal image does not reload the whole project list', () => {
  const h = mountProjects();
  h.page.onLoad({});
  h.page.onShow();
  assert.equal(h.mine(), 1);
  h.page.setData({
    auditSheet: {
      show: true, canAppeal: true, attachments: [], pending: false, confirmed: false,
      bizType: 'topic', bizId: '3',
    },
  });
  h.page.addAuditAttachment();
  h.page.onShow();
  assert.equal(h.mine(), 1);
  h.takeImage()(['https://cdn.example/a.png']);
  assert.deepEqual(h.page.data.auditSheet.attachments, ['https://cdn.example/a.png']);
  h.page.onShow();
  assert.equal(h.mine(), 2);
});

test('switching account during the image picker still reloads', () => {
  const h = mountProjects();
  h.page.onLoad({});
  h.page.onShow();
  h.page.setData({
    auditSheet: { show: true, canAppeal: true, attachments: [], pending: false, confirmed: false, bizType: 'topic', bizId: '3' },
  });
  h.page.addAuditAttachment();
  h.session('8', 'other');
  h.page.onShow();
  assert.equal(h.mine(), 2);
  assert.equal(h.page._imageFlowOpen, false);
});
