'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function loadComponent(file, wxExtra) {
  let def;
  global.getApp = () => ({ globalData: {} });
  global.wx = Object.assign({ showToast() {}, getStorageSync() {}, setStorageSync() {}, getSystemInfoSync: () => ({}) }, wxExtra || {});
  global.Component = (d) => { def = d; };
  global.Behavior = (b) => b;
  const resolved = require.resolve(file);
  delete require.cache[resolved];
  require(file);
  return def;
}
function vmOf(def, data) {
  const vm = { data: Object.assign({}, def.data, data) };
  Object.entries(def.methods || {}).forEach(([k, fn]) => { vm[k] = fn.bind(vm); });
  vm.setData = (p, cb) => { Object.assign(vm.data, p); if (cb) cb(); };
  return vm;
}

test('L02-018: the chapter gate loads only the first cover and does no face rendering', () => {
  const def = loadComponent('../../pages/play/components/chapter-flip/index.js');
  const faces = [{ cover: 'a.jpg', style: 'engrave', photos: ['p1', 'p2'] }, { cover: 'b.jpg' }, { cover: 'c.jpg' }];
  const srcs = []; let canvases = 0;
  const vm = vmOf(def, { mode: 'gate', faces });
  vm._covers = []; vm._art = []; vm._sprites = [];
  vm._off = () => { canvases += 1; return { createImage: () => { const img = {}; Object.defineProperty(img, 'src', { set(v) { srcs.push(v); } }); return img; } }; };
  vm._loadFaces();
  assert.deepEqual(srcs, ['a.jpg']);
  assert.equal(canvases, 1);
  assert.deepEqual(vm._art, []);
});

test('L02-018: the finale still loads all three faces', () => {
  const def = loadComponent('../../pages/play/components/chapter-flip/index.js');
  const srcs = [];
  const vm = vmOf(def, { mode: 'finale', faces: [{ cover: 'a.jpg' }, { cover: 'b.jpg' }, { cover: 'c.jpg' }] });
  vm._covers = []; vm._art = []; vm._sprites = [];
  vm._off = () => ({ createImage: () => { const img = {}; Object.defineProperty(img, 'src', { set(v) { srcs.push(v); } }); return img; } });
  vm._loadFaces();
  assert.deepEqual(srcs, ['a.jpg', 'b.jpg', 'c.jpg']);
});

test('L02-020: redeem baseline survives a silent re-issue; polls do not stack; hide pauses timers', () => {
  const sent = [];
  let def;
  global.getApp = () => ({ globalData: {}, sendRequest: (o) => sent.push(o) });
  global.wx = { showToast() {}, getStorageSync() {}, setStorageSync() {} };
  global.Component = (d) => { def = d; };
  const file = require.resolve('../../pages/play/components/scene-qr-ticket/index.js');
  delete require.cache[file];
  require(file);
  const vm = vmOf(def, { registrationId: '7', state: 'ready' });
  vm._attached = true;
  vm.triggerEvent = (name) => { vm.events = (vm.events || []).concat(name); };
  const realSetInterval = global.setInterval;
  global.setInterval = () => 1; // keep the test synchronous
  try {
    vm.watchRedeem('7');
    assert.equal(sent.length, 1);
    sent[0].success({ code: 200, data: { done: 0 } });          // baseline
    vm.watchRedeem('7');                                         // silent re-issue restarts the watch
    assert.equal(sent.length, 2);
    sent[1].success({ code: 200, data: { done: 1 } });           // merchant scanned in between
    assert.deepEqual(vm.events, ['redeemed']);
    vm.watchRedeem('7');
    vm.watchRedeem('7');
    assert.equal(sent.length, 3, 'second poll skipped while the first is in flight');
    vm._timer = 5;
    def.pageLifetimes.hide.call(vm);
    assert.equal(vm._timer, null);
    assert.equal(vm._redeemPoll, null);
  } finally { global.setInterval = realSetInterval; }
});

test('L02-131: merchant answer submit reads the normalised vm for choice nodes', async () => {
  let def;
  const sent = [];
  global.getApp = () => ({ globalData: {} });
  global.getCurrentPages = () => [];
  global.wx = { showToast() {}, getStorageSync() {}, setStorageSync() {} };
  global.Page = (d) => { def = d; };
  const file = require.resolve('../../pages/play/merchant/index.js');
  delete require.cache[file];
  require(file);
  const vm = Object.assign({}, def, { data: { node: { nodeId: 3, vm: 3 }, game: { choice: 'B', answer: '' } } });
  vm.setData = (p) => Object.assign(vm.data, p);
  vm._isIntentOwnerCurrent = () => true;
  vm._sendBasicIntent = (k, url, body) => { sent.push(body); return Promise.resolve({ obsolete: true }); };
  await vm.submitGame();
  assert.deepEqual(sent, [{ nodeId: 3, answer: 'B' }]);
});
