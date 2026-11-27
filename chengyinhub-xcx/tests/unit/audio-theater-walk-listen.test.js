'use strict';
// §3.1 Audio Theater & Walk-Listen 完整单测:
//  (1a) text/cap/line 块配音(含 XA01 line voiceover)
//  (1b) item.narrationUrl 与 Cast 布尔 item.voice 解耦 + 可点击重听喇叭按钮
//  (2)  chapter.audioUrl 走 AMBIENT(遵守静音键), story-narration / playkit-mixer / advanced-game
//       接入 audioSession + _duckBgm() 300ms(6x50ms) 平滑淡入淡出 + playkit-mixer 答题中实时试听切换
//  (3)  walk-audio.js 单实例 BackgroundAudioManager(cover/title/epname + onEnded 自动切下一段),
//       onHide 在边走边听激活时不强杀 _storyNarration, 前景 autoAdvance + 当前朗读段落高亮
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const { createAudioSession, AMBIENT, VOICE } = require('../../pages/play/utils/audio-session.js');
const { createStoryNarration, hasStoryVoice } = require('../../pages/play/utils/story-narration.js');
const walkAudioMod = require('../../pages/play/utils/walk-audio.js');

function fakeInnerAudio() {
  const handlers = {};
  const ctx = {
    src: '', loop: false, volume: 1, paused: true, obeyMuteSwitch: undefined,
    plays: 0, pauses: 0, stops: 0, destroyed: false, currentTime: 0, duration: 0,
    play() { this.plays += 1; this.paused = false; (handlers.play || []).forEach((f) => f()); },
    pause() { this.pauses += 1; this.paused = true; (handlers.pause || []).forEach((f) => f()); },
    stop() { this.stops += 1; this.paused = true; (handlers.stop || []).forEach((f) => f()); },
    seek() {},
    destroy() { this.destroyed = true; },
    emit(name) { (handlers[name] || []).forEach((f) => f()); },
    end() { this.paused = true; (handlers.ended || []).forEach((f) => f()); },
  };
  ['Play', 'Pause', 'Stop', 'Ended', 'Error', 'Waiting', 'Canplay', 'TimeUpdate'].forEach((n) => {
    ctx['on' + n] = (f) => { (handlers[n.toLowerCase()] = handlers[n.toLowerCase()] || []).push(f); };
  });
  return ctx;
}

function fakeBgAudioManager() {
  const handlers = {};
  const history = [];
  const mgr = {
    title: '', epname: '', singer: '', coverImgUrl: '', _src: '',
    pauses: 0, stops: 0, history,
    get src() { return this._src; },
    set src(v) {
      this._src = v;
      history.push({ title: this.title, epname: this.epname, singer: this.singer, coverImgUrl: this.coverImgUrl, src: v });
    },
    pause() { this.pauses += 1; (handlers.pause || []).forEach((f) => f()); },
    stop() { this.stops += 1; (handlers.stop || []).forEach((f) => f()); },
    emit(name) { (handlers[name] || []).forEach((f) => f()); },
  };
  ['Play', 'Pause', 'Stop', 'Ended', 'Error', 'Next', 'Prev'].forEach((n) => {
    mgr['on' + n] = (f) => { (handlers[n.toLowerCase()] = handlers[n.toLowerCase()] || []).push(f); };
  });
  return mgr;
}

function loadPlayHost(bgMgr) {
  const audios = [];
  const appObj = {
    globalData: { user_id: 9, statusBarHeight: 20, navBarHeight: 44, features: {} },
    isDevEnv: () => false,
    getUserID: () => 9,
    getAvatar: () => '',
    sendRequest() {},
  };
  global.getApp = () => appObj;
  const storage = new Map();
  global.wx = {
    getStorageSync: (k) => (storage.has(k) ? storage.get(k) : ''),
    setStorageSync: (k, v) => { storage.set(k, v); },
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getSystemInfoSync: () => ({ statusBarHeight: 20, windowWidth: 375, screenHeight: 812, safeArea: { bottom: 800 } }),
    getMenuButtonBoundingClientRect: () => ({ left: 300 }),
    showLoading() {}, hideLoading() {}, showToast() {}, setKeepScreenOn() {},
    createInnerAudioContext: () => { const c = fakeInnerAudio(); audios.push(c); return c; },
    getBackgroundAudioManager: () => bgMgr,
    createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, selectAll() { return this; }, boundingClientRect() { return this; }, exec() {} }),
  };
  let config = null;
  global.Page = (cfg) => { config = cfg; };
  const abs = path.join(ROOT, 'pages/play/index.js');
  const src = fs.readFileSync(abs, 'utf8');
  const dir = path.dirname(abs);
  const localRequire = (id) => require(id.startsWith('.') ? path.resolve(dir, id) : id);
  new Function('Page', 'getApp', 'wx', 'require', 'module', 'exports', src)(
    global.Page, global.getApp, global.wx, localRequire, { exports: {} }, {},
  );
  const page = Object.assign({}, config, { data: JSON.parse(JSON.stringify(config.data)) });
  page.setData = (patch, cb) => {
    Object.keys(patch || {}).forEach((key) => {
      const parts = key.split('.');
      let o = page.data;
      for (let i = 0; i < parts.length - 1; i += 1) { o[parts[i]] = o[parts[i]] || {}; o = o[parts[i]]; }
      o[parts[parts.length - 1]] = patch[key];
    });
    if (cb) cb();
  };
  return { page, audios, appObj };
}

/* ==================== (1a) & (1b) 旁白配音解耦与重听喇叭 ==================== */
test('(1a) hasStoryVoice 支持 text / cap / line 三种块类型', () => {
  assert.equal(hasStoryVoice([{ blocks: [{ type: 'text', voice: 'https://cdn.example.cn/1.m4a' }] }]), true);
  assert.equal(hasStoryVoice([{ blocks: [{ type: 'cap', cap: 'open', voice: 'https://cdn.example.cn/2.m4a' }] }]), true);
  assert.equal(hasStoryVoice([{ blocks: [{ type: 'line', speaker: 'c1', voice: 'https://cdn.example.cn/3.m4a' }] }]), true);
  assert.equal(hasStoryVoice([{ blocks: [{ type: 'image', voice: 'https://cdn.example.cn/4.m4a' }] }]), false);
});

test('(1b) item.narrationUrl 与 Cast 布尔 item.voice 解耦:正文段不出死按钮,重听喇叭可点且驱动高亮', () => {
  const { page, audios } = loadPlayHost(fakeBgAudioManager());
  page.showChapterGate = () => {};
  page.measureChapter = () => {};
  page.playChapterVideo = () => false;
  page.playChapterAudio = () => {};
  page._enterThemeChapter = () => {};
  page._resumeStory = () => {};
  page._cast = {
    enabled: true,
    cast: [{ id: 'c1', name: '林晚', voice: { mode: 'none' } }],
  };
  page.data.chapter = {
    id: 11,
    name: '长安夜雨',
    blocks: [
      { type: 'cap', cap: 'open', key: 'cap1', content: '开场白。', voice: 'https://cdn.example.cn/cap1.m4a' },
      { type: 'text', key: 't1', content: '第一段正文。', voice: 'https://cdn.example.cn/t1.m4a' },
      { type: 'line', key: 'l1', speaker: 'c1', content: '你终于来了。', voice: 'https://cdn.example.cn/l1.m4a' },
    ],
  };
  page.openChapterFull();
  const paras = page.data.chapterParas;
  assert.equal(paras.length, 3);
  // 正文段与开场白:只挂 narrationUrl,绝不碰 Cast 布尔 voice
  assert.equal(paras[0].narrationUrl, 'https://cdn.example.cn/cap1.m4a');
  assert.equal(paras[0].voice, undefined);
  assert.equal(paras[1].narrationUrl, 'https://cdn.example.cn/t1.m4a');
  assert.equal(paras[1].voice, undefined);
  // line 块:同时保留 Cast 布尔 voice=false(未开 preset)与 narrationUrl
  assert.equal(paras[2].narrationUrl, 'https://cdn.example.cn/l1.m4a');
  assert.equal(paras[2].voice, false);
  // 点击重听喇叭:立刻播放并高亮当前段落,再点一下停止
  page.replayNarrationLine({ currentTarget: { dataset: { i: 1 } } });
  assert.equal(audios.length, 1);
  assert.equal(audios[0].src, 'https://cdn.example.cn/t1.m4a');
  assert.equal(page.data.activeNarrationKey, paras[1].voiceKey);
  page.replayNarrationLine({ currentTarget: { dataset: { i: 1 } } });
  assert.equal(page.data.activeNarrationKey, '');
  // WXML 契约:Cast 按钮要求 item.voice && item.lineKey,重听喇叭绑 replayNarrationLine
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/play/index.wxml'), 'utf8');
  assert.match(wxml, /wx:if="\{\{item\.voice && item\.lineKey\}\}"[^>]*catchtap="playCastLine"/);
  assert.match(wxml, /wx:if="\{\{item\.narrationUrl\}\}"[^>]*catchtap="replayNarrationLine"/);
  assert.match(wxml, /activeNarrationKey && item\.voiceKey === activeNarrationKey \? 'is-narrating' : ''/);
});

/* ==================== (2) 统一混音与静音合规 ==================== */
test('(2) chapter.audioUrl 走 AMBIENT(遵守静音键),站点人声切回 VOICE;audioSession.setKind 生效', () => {
  const session = createAudioSession({});
  const ctx = fakeInnerAudio();
  session.register(ctx, { kind: VOICE });
  assert.equal(ctx.obeyMuteSwitch, false);
  assert.equal(session.getKind(ctx), VOICE);
  session.setKind(ctx, AMBIENT);
  assert.equal(ctx.obeyMuteSwitch, true);
  assert.equal(session.getKind(ctx), AMBIENT);

  const { page, audios } = loadPlayHost(fakeBgAudioManager());
  page.data.chapter = { id: 1, audioUrl: 'https://cdn.example.cn/music.mp3' };
  page.playChapterAudio(true);
  assert.equal(audios[0].obeyMuteSwitch, true, 'chapter.audioUrl 必须走 AMBIENT 遵守 iPhone 静音键');

  page._autoStationVoice({ nodeId: 9, audio: 'https://cdn.example.cn/guide.mp3', done: false });
  assert.equal(audios[0].obeyMuteSwitch, false, '站点语音讲解必须切回 VOICE');

  // 自由探索章节音乐也走 AMBIENT
  page.data.chapStory = Object.assign({}, page.data.chapStory, { audio: 'https://cdn.example.cn/fe-chap.mp3', playing: false });
  page.toggleChapAudio();
  assert.equal(page._chapAudio.obeyMuteSwitch, true);
  page._stopChapAudio();
});

test('(2) _duckBgm 使用 300ms(6x50ms) 平滑淡入淡出', () => {
  const intervals = [];
  const realSetInterval = global.setInterval;
  const realClearInterval = global.clearInterval;
  global.setInterval = (fn, ms) => {
    const id = { fn, ms, cleared: false };
    intervals.push(id);
    return id;
  };
  global.clearInterval = (id) => { if (id) id.cleared = true; };
  try {
    const { page, audios } = loadPlayHost(fakeBgAudioManager());
    page._topicAudioUrl = 'https://cdn.example.cn/theme.mp3';
    page._startThemeBgm();
    const theme = audios[0];
    assert.equal(theme.volume, 0.25);
    page._duckBgm('storyVoice', true);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].ms, 50, '每步 50ms');
    const vols = [];
    for (let i = 0; i < 6; i += 1) {
      intervals[0].fn();
      vols.push(theme.volume);
    }
    assert.equal(intervals[0].cleared, true, '6 步(300ms)后自动清定时器');
    assert.equal(vols.length, 6);
    assert.ok(vols[0] < 0.25 && vols[0] > 0.1, '第 1 步在中间值,不是跳变');
    assert.equal(vols[5], 0.1, '第 6 步精确到达压低目标');
    // 抬回同样 6x50ms
    page._duckBgm('storyVoice', false);
    assert.equal(intervals.length, 2);
    assert.equal(intervals[1].ms, 50);
    for (let i = 0; i < 6; i += 1) intervals[1].fn();
    assert.equal(intervals[1].cleared, true);
    assert.equal(theme.volume, 0.25);
  } finally {
    global.setInterval = realSetInterval;
    global.clearInterval = realClearInterval;
  }
});

test('(2) story-narration 注册进 audioSession 并在 destroy 时注销', () => {
  const session = createAudioSession({});
  const ctx = fakeInnerAudio();
  const n = createStoryNarration({
    audioSession: session,
    createAudio: () => ctx,
  });
  n.reveal([{ key: 'k1', url: 'https://cdn.example.cn/1.m4a' }]);
  assert.equal(session._size(), 1);
  assert.equal(ctx.obeyMuteSwitch, false);
  n.destroy();
  assert.equal(session._size(), 0);
});

test('(2) playkit-mixer 接入 audioSession + 压低 BGM + 答题中实时 audioBefore/audioAfter 试听切换', () => {
  const session = createAudioSession({});
  const ducks = [];
  session.setDuckHandler((src, on) => ducks.push([src, on]));
  const audios = [];
  global.getApp = () => ({ _audioSession: session });
  global.wx = { createInnerAudioContext: () => { const c = fakeInnerAudio(); audios.push(c); return c; }, vibrateShort() {} };
  let def;
  global.Component = (d) => { def = d; };
  global.Behavior = (b) => b;
  const file = require.resolve('../../pages/playkit/components/playkit-mixer/index.js');
  delete require.cache[file];
  require(file);

  const stage = { begin() {}, win() {}, nudge() {} };
  const data = { reducedMotion: true };
  Object.keys(def.properties).forEach((k) => { data[k] = def.properties[k].value; });
  Object.assign(data, def.data);
  const inst = { data, setData(p) { Object.assign(this.data, p); }, selectComponent: () => stage, triggerEvent() {} };
  Object.keys(def.methods).forEach((k) => { inst[k] = def.methods[k].bind(inst); });
  def.observers['show, tracks'].call(inst, true, [
    { id: 'drum', label: '鼓', muted: false },
    { id: 'voc', label: '人声', muted: true },
  ]);
  inst.data.audioBefore = 'https://cdn.example.cn/before.mp3';
  inst.data.audioAfter = 'https://cdn.example.cn/after.mp3';
  assert.equal(inst.data.phase, 'play');

  // 答题中实时试听原音
  inst.onPreviewToggle({ currentTarget: { dataset: { seg: 'before' } } });
  assert.equal(audios.length, 1);
  assert.equal(session._size(), 1, 'playkit-mixer 播放器已登记进 audioSession');
  assert.equal(audios[0].src, 'https://cdn.example.cn/before.mp3');
  assert.equal(inst.data.playing, true);
  assert.deepEqual(ducks[ducks.length - 1], ['mixer', true]);

  // 实时切换到复原音
  inst.onPreviewToggle({ currentTarget: { dataset: { seg: 'after' } } });
  assert.equal(audios[0].src, 'https://cdn.example.cn/after.mp3');
  assert.equal(inst.data.seg, 'after');
  assert.equal(inst.data.playing, true);

  // 再点当前段停止并释放压低
  inst.onPreviewToggle({ currentTarget: { dataset: { seg: 'after' } } });
  assert.equal(inst.data.playing, false);
  assert.deepEqual(ducks[ducks.length - 1], ['mixer', false]);

  // 卸载时从 audioSession 注销
  def.lifetimes.detached.call(inst);
  assert.equal(session._size(), 0);
});

test('(2) advanced-game 节奏音频登记进 audioSession 并在播/停/销毁时触发 _duckBgm', () => {
  const sharedSession = require('../../pages/play/utils/audio-session.js');
  const ducks = [];
  sharedSession.setDuckHandler((src, on) => ducks.push([src, on]));
  const audio = fakeInnerAudio();
  const componentPath = require.resolve('../../pages/play/components/advanced-game/index.js');
  delete require.cache[componentPath];
  let def;
  global.getApp = () => ({ sendRequest() {}, _audioSession: sharedSession });
  global.wx = { createInnerAudioContext: () => audio, showToast() {} };
  global.Component = (v) => { def = v; };
  require(componentPath);

  const inst = { data: { playingDrawId: '' }, setData(p) { Object.assign(this.data, p); } };
  Object.keys(def.methods).forEach((k) => { inst[k] = def.methods[k].bind(inst); });

  const beforeSize = sharedSession._size();
  inst.toggleDrawAudio({ currentTarget: { dataset: { id: 'b1', url: '/pages/play/audio/merchant-games/rhythm-one.mp3' } } });
  assert.equal(sharedSession._size(), beforeSize + 1);
  assert.equal(audio.obeyMuteSwitch, false);
  assert.ok(ducks.some(([s, on]) => s === 'drawAudio' && on === true));

  audio.end();
  assert.deepEqual(ducks[ducks.length - 1], ['drawAudio', false]);

  inst.destroyDrawAudio();
  assert.equal(sharedSession._size(), beforeSize);
  sharedSession.clearDuckHandler();
});

/* ==================== (3) 边走边听后台音频与前景 autoAdvance ==================== */
test('(3) walk-audio.js 单实例 BackgroundAudioManager:带 cover/title/epname 且 onEnded 自动切下一段', () => {
  walkAudioMod._resetSharedForTest();
  let getCount = 0;
  const mgr = fakeBgAudioManager();
  const changes = [];
  let completed = 0;
  const wa = walkAudioMod.createWalkAudio({
    getManager: () => { getCount += 1; return mgr; },
    onChange: (st) => changes.push({ active: st.active, playing: st.playing, key: st.key }),
    onComplete: () => { completed += 1; },
  });
  const ok = wa.start([
    { key: 'c1|p1', url: 'https://cdn.example.cn/p1.m4a' },
    { key: 'c1|p2', url: 'https://cdn.example.cn/p2.m4a' },
  ], {
    title: '第一章 · 城墙',
    epname: '长安暗线',
    coverImgUrl: 'https://cdn.example.cn/cover.jpg',
  });
  assert.equal(ok, true);
  assert.equal(getCount, 1, '单实例获取一次');
  assert.equal(wa.isActive(), true);
  assert.equal(wa.playingKey(), 'c1|p1');
  assert.deepEqual(mgr.history[0], {
    title: '第一章 · 城墙',
    epname: '长安暗线',
    singer: '城瘾',
    coverImgUrl: 'https://cdn.example.cn/cover.jpg',
    src: 'https://cdn.example.cn/p1.m4a',
  });

  // onEnded 自动切下一段
  mgr.emit('ended');
  assert.equal(getCount, 1, '切段不重复获取 manager');
  assert.equal(wa.playingKey(), 'c1|p2');
  assert.equal(mgr.src, 'https://cdn.example.cn/p2.m4a');

  // 末段结束自动收尾
  mgr.emit('ended');
  assert.equal(wa.isActive(), false);
  assert.equal(wa.playingKey(), '');
  assert.equal(completed, 1);
  assert.ok(changes.length >= 3);
});

test('(3) pages/play/index.js onHide 在边走边听激活时不强杀 _storyNarration 并交接给 walk-audio', () => {
  walkAudioMod._resetSharedForTest();
  const bgMgr = fakeBgAudioManager();
  const { page, audios } = loadPlayHost(bgMgr);
  for (const name of ['_flushAnswerRight', 'suspendOrientLifecycle', '_stopTopbar', '_stopThemePoll', '_stopZeroHpTimer', '_stopStoryDust', '_clearPackTimers', '_stopShopNpcVoice', '_stopLeadPoll', '_pauseSessionClock', '_persistRunSession']) {
    page[name] = () => {};
  }
  page.data.chapter = { id: 3, name: '钟楼之下', cover: 'https://cdn.example.cn/ch3.jpg' };
  page.data.topicName = '长安夜行';
  page._syncNarrationPlaylist([
    { i: 0, voiceKey: '3|a', narrationUrl: 'https://cdn.example.cn/a.m4a' },
    { i: 1, voiceKey: '3|b', narrationUrl: 'https://cdn.example.cn/b.m4a' },
  ]);
  const n = page._narration();
  n.reveal([{ key: '3|a', url: 'https://cdn.example.cn/a.m4a', index: 0 }]);
  assert.equal(page.data.activeNarrationKey, '3|a');
  const fgCtx = audios[0];

  // 局内锁屏 / 切后台:不强杀 _storyNarration,同时把队列交接给 BackgroundAudioManager
  page._runStarted = true;
  page.onHide();
  assert.equal(fgCtx.pauses, 0, '后台边走边听激活时不得强杀 _storyNarration');
  assert.equal(page._walkAudio.isActive(), true);
  assert.equal(bgMgr.title, '钟楼之下');
  assert.equal(bgMgr.epname, '长安夜行');
  assert.equal(bgMgr.coverImgUrl, 'https://cdn.example.cn/ch3.jpg');
  assert.equal(bgMgr.src, 'https://cdn.example.cn/a.m4a');

  // 后台播完第一段自动推进第二段并同步高亮 key
  bgMgr.emit('ended');
  assert.equal(bgMgr.src, 'https://cdn.example.cn/b.m4a');
  assert.equal(page.data.activeNarrationKey, '3|b');

  // 未开局 / 离页切后台:正常暂停 _storyNarration 并停掉后台音频
  page._runStarted = false;
  page.onHide();
  assert.equal(page._walkAudio.isActive(), false);
  assert.equal(n.playing(), '');
});

test('(3) 前景 autoAdvance 自动接下一段并同步 activeNarrationKey 高亮', () => {
  const { page, audios } = loadPlayHost(fakeBgAudioManager());
  page._syncNarrationPlaylist([
    { i: 0, voiceKey: '5|p1', narrationUrl: 'https://cdn.example.cn/p1.m4a' },
    { i: 1, voiceKey: '5|p2', narrationUrl: 'https://cdn.example.cn/p2.m4a' },
  ]);
  const n = page._narration();
  n.reveal([{ key: '5|p1', url: 'https://cdn.example.cn/p1.m4a', index: 0 }]);
  assert.equal(page.data.activeNarrationKey, '5|p1');
  audios[0].end();
  assert.equal(n.playing(), '5|p2', '第一段播完前景自动接第二段');
  assert.equal(page.data.activeNarrationKey, '5|p2', '高亮同步切到第二段');
  audios[0].end();
  assert.equal(page.data.activeNarrationKey, '', '全部念完清除高亮');
});
