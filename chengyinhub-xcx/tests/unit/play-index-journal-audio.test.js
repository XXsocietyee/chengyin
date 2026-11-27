'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const playFile = 'pages/play/index.js';
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function method(file, name, locals = {}) {
  const lines = read(file).split('\n');
  const re = new RegExp('^(\\s*)' + name + '(?:\\(|:\\s*function\\s*\\()');
  const start = lines.findIndex(line => re.test(line));
  assert.ok(start >= 0, name);
  const indent = re.exec(lines[start])[1];
  for (let end = start + 1; end < lines.length; end++) {
    if (!lines[end].startsWith(indent + '}')) continue;
    try { return vm.runInNewContext('({' + lines.slice(start, end + 1).join('\n') + '\n})', locals)[name]; }
    catch (error) { if (error.name !== 'SyntaxError') throw error; }
  }
  throw Error('Cannot parse complete method ' + name);
}

function applyPatch(data, patch) {
  for (const [key, value] of Object.entries(patch || {})) {
    const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
    let target = data;
    for (const part of parts.slice(0, -1)) target = target[part] ?? (target[part] = {});
    target[parts.at(-1)] = value;
  }
}

test('L01-031 音乐角进度只在显示秒变化时写,时长没变不跟着 setData', () => {
  let update, canplay;
  const audio = {
    duration: 12.4, currentTime: 3.2, src: '',
    onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {},
    onCanplay: cb => { canplay = cb; }, onTimeUpdate: cb => { update = cb; },
    play() {}, pause() {},
  };
  const kit = { audioUrl: '/audio.mp3' };
  const page = {
    data: { playKit: { kit } },
    writes: [],
    _kit() { return this.data.playKit.kit; },
    _isPlayAccountCurrent: () => true,
    setData(patch) {
      this.writes.push(patch);
      applyPatch(this.data, patch);
    },
  };
  method(playFile, '_togglePlayKitAudio', {
    audioSession: { register: () => audio, keepAwake() {} },
    wx: { createInnerAudioContext: () => audio },
    secureOwnMedia: value => value,
    cyToast() {},
  }).call(page, true);
  const plain = value => JSON.parse(JSON.stringify(value));
  page.writes = [];
  canplay();
  assert.deepEqual(plain(page.writes), [{ 'playKit.kit.audioSeconds': 13 }]);
  update();
  assert.deepEqual(plain(page.writes.at(-1)), { 'playKit.kit.position': 3, 'playKit.kit.duration': 12 });
  const settled = page.writes.length;
  audio.currentTime = 3.8;
  update();
  audio.duration = 12.9;
  update();
  assert.equal(page.writes.length, settled, '同一显示秒、时长取整没变时不 setData');
  audio.currentTime = 4.01;
  update();
  assert.deepEqual(plain(page.writes.at(-1)), { 'playKit.kit.position': 4 });
  audio.duration = 20.2;
  audio.currentTime = 4.4;
  update();
  assert.deepEqual(plain(page.writes.at(-1)), {
    'playKit.kit.duration': 20,
    'playKit.kit.audioSeconds': 21,
  });
  page.data.playKit.kit = { audioUrl: '/other.mp3' };
  const frozen = page.writes.length;
  audio.currentTime = 9;
  update();
  assert.equal(page.writes.length, frozen, '旧播放器回调不改新曲目');
  assert.equal(page.data.playKit.kit.audioSeconds, undefined);
});

function loadPlayPage() {
  global.getApp = () => ({
    globalData: { user_id: 9 },
    getUserID: () => 9,
    isDevEnv: () => false,
    _loginEpoch: 0,
    sendRequest() {},
    getUploadClient: () => ({ uploadAll: () => ({ destroy() {} }) }),
  });
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375 }),
    nextTick(fn) { if (typeof fn === 'function') fn(); },
    showToast() {},
    showLoading() {},
    hideLoading() {},
  };
  let config;
  global.Page = value => { config = value; };
  delete require.cache[require.resolve('../../pages/play/index.js')];
  require('../../pages/play/index.js');
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = (patch, callback) => {
    applyPatch(page.data, patch);
    if (callback) callback.call(page);
  };
  page._playOwner = '9';
  page._playLoginContext = { generation: '0' };
  page._routeState = { routeMode: 'LINEAR', status: 'ACTIVE', thoughts: [], sessionId: 'run-1', nodeStates: {} };
  page._refreshNavRim = () => {};
  page._measureDeal = () => {};
  page._canContinueMerchantGames = () => false;
  page.computeNext = nodes => {
    const next = (nodes || []).find(node => node && !node.done);
    return next ? { nodeId: next.nodeId, name: next.name } : null;
  };
  return page;
}

test('L01-030 手记关着时不重写,打开和路线变化才重算', () => {
  const page = loadPlayPage();
  page.data.mode = 1;
  page.data.isPreview = false;
  page.data.nodes = [
    { nodeId: 1, num: 1, sortId: 1, name: '甲', description: '甲的正文', done: false, chapterId: 1 },
    { nodeId: 2, num: 2, sortId: 2, name: '乙', description: '乙的秘密', done: false, chapterId: 1 },
  ];
  page.data.showJournal = false;
  page.data.journalCards = [{ key: 'kept', nodeId: 9, kvT: '上次的手记' }];
  const journalWrites = [];
  const setData = page.setData;
  page.setData = (patch, callback) => {
    if (patch && Object.prototype.hasOwnProperty.call(patch, 'journalCards')) journalWrites.push(patch.journalCards);
    setData(patch, callback);
  };
  let built = 0;
  const buildJournal = page.buildJournal;
  page.buildJournal = function () { built += 1; return buildJournal.call(this); };

  page.rebuild();
  page.rebuild();
  assert.equal(built, 0);
  assert.equal(journalWrites.length, 0);
  assert.equal(page.data.journalCards[0].kvT, '上次的手记');

  page.openJournal();
  assert.equal(page.data.showJournal, true);
  assert.equal(built, 1);
  assert.deepEqual(page.data.journalCards.map(card => card.nodeId), [1, 2]);
  assert.equal(page.data.journalCards[0].label, '此刻');

  page.data.nodes = page.data.nodes.map(node => node.nodeId === 1 ? Object.assign({}, node, { done: true }) : node);
  page.rebuild();
  assert.equal(built, 2);
  assert.equal(page.data.journalCards.find(card => card.nodeId === 1).label, '第 1 站 · 已抵达');
  assert.equal(page.data.journalCards.find(card => card.nodeId === 2).label, '此刻');

  page.data.showJournal = false;
  const kept = JSON.stringify(page.data.journalCards);
  const builtAtClose = built;
  const writesAtClose = journalWrites.length;
  page.rebuild();
  assert.equal(built, builtAtClose);
  assert.equal(journalWrites.length, writesAtClose);
  assert.equal(JSON.stringify(page.data.journalCards), kept);
});
