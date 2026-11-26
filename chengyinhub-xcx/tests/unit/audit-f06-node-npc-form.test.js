// AUDIT-1122 F06:已存声音是素材引用时不拿去播放 (L06-035),关表单销毁音频并停时长轮询 (L06-118)
// 节点 NPC 半屏(CR-927)合同:字段/审核合同/失败口径/上传限制。
//
// 直接执行真实组件源码(vm 求值)+ 真实共享 upload-client(precheck 不被 mock 掉),
// 只把 getApp/wx/canvas 换成受控桩 —— 与 merchant-npc-voice-size-contract 同一套做法。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const upload = require('../../utils/transport/upload-client.js');

const COMPONENT = path.join(__dirname, '../../pages/topic/components/cy/node-npc-form/index.js');
const WXML = fs.readFileSync(path.join(__dirname, '../../pages/topic/components/cy/node-npc-form/index.wxml'), 'utf8');
const JS = fs.readFileSync(COMPONENT, 'utf8');

const NODE = 31;

function setAtPath(target, rawPath, value) {
  const parts = rawPath.split('.');
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function load(options = {}) {
  const state = { def: null, requests: [], uploads: [], chosen: null };
  const audio = {
    duration: options.duration == null ? 20 : options.duration,
    stop() {}, play() {}, destroy() {},
    onEnded(fn) { this.onEndedHandler = fn; },
    onStop(fn) { this.onStopHandler = fn; },
    onError(fn) { this.onErrorHandler = fn; },
  };
  const client = upload.createUploadClient({
    wxUploadFile(opts) {
      state.uploads.push(opts);
      // 真实 wx.uploadFile 是回调式的:这里同步回一个成功包,走完共享入口的完整链路
      opts.success({ data: JSON.stringify({ code: 200, assetId: 73, url: options.uploadUrl || 'https://o/up.png' }) });
      return { abort() {} };
    },
    getBaseUrl: () => 'https://base',
    getAuthorization: () => 'token',
    setTimer: () => 1,
    clearTimer: () => {},
  });
  const app = {
    getUserID: () => '7',
    requestSeparateConsent: () => options.consentDenied ? Promise.reject(new Error('已拒绝声音克隆')) : Promise.resolve(),
    getUploadClient: () => client,
    sendRequest(opts) {
      const payload = JSON.parse(opts.data || '{}');
      state.requests.push({ url: opts.url, payload });
      const canned = (options.responses && options.responses[opts.url]) || { code: 200, data: {} };
      if (canned.networkFail) return opts.fail({});
      if (String(canned.code) === '200') return opts.success(canned);
      return opts.successStatusAbnormal(canned);
    },
  };
  const wx = {
    chooseMessageFile(opts) { state.chosen = opts; },
    chooseMedia(opts) { state.media = opts; },
    createInnerAudioContext: () => audio,
  };
  require('../helpers/voice-enrollment-environment.cjs').install(app, wx);
  const localRequire = (id) => {
    if (id.endsWith('voice-enrollment-journal.js')) return require('../../pages/topic/utils/voice-enrollment-journal.js');
    if (id.endsWith('modal.js')) return { show() {} };
    if (id.endsWith('pixel-avatar.js')) return {
      AVATAR_IDS: ['p01', 'p04'],
      isPixelAvatar: (code) => String(code || '').indexOf('px1:') === 0,
      parseCode: (code) => String(code).slice(4),
      stringifyCode: (id) => 'px1:' + id,
    };
    if (id.endsWith('pixel-portrait.js')) return {
      squareCrop: () => ({ x: 0, y: 0, size: 10 }),
      buildPortrait: () => ({}),
      drawPortrait: () => {},
    };
    if (id.endsWith('transport/upload-client.js')) return upload;
    throw new Error('unexpected require ' + id);
  };
  // 计时器全部关掉:轮询/时长读取的 setTimeout 不真跑,避免测试进程被挂起的 timer 拖住
  vm.runInNewContext(JS, {
    getApp: () => app, Component: (def) => { state.def = def; }, wx,
    require: localRequire, console,
    setTimeout: () => 1, clearTimeout: () => {}, Promise,
    Object, Error, JSON, Math, Number, String, Array,
  }, { filename: COMPONENT });

  const component = Object.assign({}, state.def.methods);
  component.data = Object.assign(JSON.parse(JSON.stringify(state.def.data)), {
    show: true, nodeId: NODE, nodeName: '幸会咖啡',
  });
  component._photoMember = component._voiceMember = '7';
  component.setData = function (patch, cb) {
    Object.keys(patch || {}).forEach((key) => setAtPath(this.data, key, patch[key]));
    if (cb) cb();
  };
  component.triggerEvents = [];
  component.triggerEvent = function (name, detail) { this.triggerEvents.push({ name, detail }); };
  component.createSelectorQuery = () => ({ select: () => ({ fields: () => ({ exec: () => {} }) }) });
  state.component = component;
  state.wx = wx;
  state.audio = audio;
  return state;
}


test('L06-035 voiceSample 为 media-asset 引用且没有可播放文件时不播放,只给固定失败文案', () => {
  const { component, audio } = load();
  let played = 0;
  component._voiceDisplayContext = { current: () => true };
  component.data.voiceSample = 'media-asset:12';
  component._audioContext();
  audio.play = () => { played += 1; };
  component.playVoice();
  assert.equal(played, 0);
  assert.equal(audio.src, undefined);
  assert.equal(component.data.voiceError, '试听失败，请稍后重试');
});

function liveFiles(state, paths) {
  const live = new Set(paths);
  state.wx.env = { USER_DATA_PATH: 'wxfile://usr' };
  state.wx.getFileSystemManager = () => ({
    accessSync(filePath) { if (!live.has(filePath)) throw new Error('missing ' + filePath); },
    copyFile({ srcPath, destPath, success, fail }) {
      if (!live.has(srcPath)) { if (fail) fail({ errMsg: 'copyFile:fail temp gone secret' }); return; }
      live.add(destPath);
      success();
    },
  });
  return live;
}

test('L06-035 试听播放仍在的已保存副本,不把临时路径交给播放器', () => {
  const state = load();
  const { component, audio } = state;
  const played = [];
  liveFiles(state, ['wxfile://usr/saved.m4a']);
  audio.play = function () { played.push(this.src); };
  component._voiceFileContext = { current: () => true };
  component.data.voiceFile = { path: 'wxfile://tmp/a.m4a', savedPath: 'wxfile://usr/saved.m4a' };
  component.data.voiceSample = 'media-asset:12';
  component.playVoice();
  assert.deepEqual(played, ['wxfile://usr/saved.m4a']);
  assert.equal(component.data.voicePlaying, true);
  assert.equal(component.data.voiceError, '');
});

test('L06-035 选中录音后就把副本留在用户目录,临时文件删了仍能试听', () => {
  const state = load();
  const { component, audio } = state;
  const live = liveFiles(state, ['wxfile://tmp/a.m4a']);
  const played = [];
  audio.play = function () { played.push(this.src); };
  component.chooseVoice();
  state.chosen.success({ tempFiles: [{ name: 'a.m4a', size: 1024, path: 'wxfile://tmp/a.m4a' }] });
  assert.match(component.data.voiceFile.savedPath || '', /^wxfile:\/\/usr\/nnf-voice-.*\.m4a$/);
  live.delete('wxfile://tmp/a.m4a');
  let downloaded = 0;
  state.wx.downloadFile = () => { downloaded += 1; return { abort() {} }; };
  component.data.voiceSample = 'https://cdn.example/should-not-download.m4a';
  component.playVoice();
  assert.equal(downloaded, 0);
  assert.deepEqual(played, [component.data.voiceFile.savedPath]);
});

test('L06-035 临时录音先复制到用户目录,只播放复制后仍在的文件', () => {
  const state = load();
  const { component, audio } = state;
  const played = [];
  liveFiles(state, ['wxfile://tmp/a.m4a']);
  audio.play = function () { played.push(this.src); };
  component._voiceFileContext = { current: () => true };
  component.data.voiceFile = { path: 'wxfile://tmp/a.m4a', name: 'a.m4a' };
  component.playVoice();
  assert.equal(played.length, 1);
  assert.match(played[0], /^wxfile:\/\/usr\/nnf-voice-.*\.m4a$/);
  assert.notEqual(played[0], 'wxfile://tmp/a.m4a');
  assert.equal(component.data.voiceFile.savedPath, played[0]);
});

test('L06-035 临时文件已删除时改下载仍在的 https 声音', () => {
  const state = load();
  const { component, audio } = state;
  const played = [];
  let downloaded = '';
  liveFiles(state, ['wxfile://down/v.m4a']);
  state.wx.downloadFile = (opts) => {
    downloaded = opts.url;
    opts.success({ statusCode: 200, tempFilePath: 'wxfile://down/v.m4a' });
    return { abort() {} };
  };
  audio.play = function () { played.push(this.src); };
  component._voiceFileContext = { current: () => true };
  component.data.voiceFile = { path: 'wxfile://tmp/gone.m4a' };
  component.data.voiceSample = 'https://cdn.example/v.m4a';
  component.playVoice();
  assert.equal(downloaded, 'https://cdn.example/v.m4a');
  assert.deepEqual(played, ['wxfile://down/v.m4a']);
});

test('L06-035 素材引用下载预览地址指向的、仍存在的文件', () => {
  const state = load({
    responses: {
      '/api/media/asset/12/preview': { code: 200, data: { authorPreviewUrl: 'https://cdn.example/asset.m4a' } },
    },
  });
  const { component, audio } = state;
  const played = [];
  let downloaded = '';
  liveFiles(state, ['wxfile://down/asset.m4a']);
  state.wx.downloadFile = (opts) => {
    downloaded = opts.url;
    opts.success({ statusCode: 200, tempFilePath: 'wxfile://down/asset.m4a' });
    return { abort() {} };
  };
  audio.play = function () { played.push(this.src); };
  component._voiceDisplayContext = { current: () => true };
  component.data.voiceSample = 'media-asset:12';
  component.playVoice();
  assert.equal(downloaded, 'https://cdn.example/asset.m4a');
  assert.deepEqual(played, ['wxfile://down/asset.m4a']);
  assert.equal(state.requests.some((row) => row.url === '/api/media/asset/12/preview'), true);
});

test('L06-035 下载失败或文件已不在时只说试听失败,不展示异常', () => {
  const state = load();
  const { component, audio } = state;
  let played = 0;
  liveFiles(state, []);
  state.wx.downloadFile = (opts) => {
    opts.fail({ errMsg: 'downloadFile:fail domain secret-stack' });
    return { abort() {} };
  };
  audio.play = () => { played += 1; };
  component._voiceDisplayContext = { current: () => true };
  component.data.voiceSample = 'https://cdn.example/missing.m4a';
  component.playVoice();
  assert.equal(played, 0);
  assert.equal(component.data.voiceError, '试听失败，请稍后重试');
  assert.equal(JSON.stringify(component.data).includes('secret-stack'), false);

  component.data.voiceError = '';
  state.wx.downloadFile = (opts) => {
    opts.success({ statusCode: 200, tempFilePath: 'wxfile://down/gone.m4a' });
    return { abort() {} };
  };
  component.playVoice();
  assert.equal(played, 0);
  assert.equal(component.data.voiceError, '试听失败，请稍后重试');
  assert.equal(audio.src, undefined);
});

test('L06-035 播放器 onError 与 play 抛错都不把异常原文写出来', () => {
  const state = load();
  const { component, audio } = state;
  liveFiles(state, ['wxfile://usr/saved.m4a']);
  component._voiceFileContext = { current: () => true };
  component.data.voiceFile = { path: 'wxfile://tmp/a.m4a', savedPath: 'wxfile://usr/saved.m4a' };
  audio.play = () => { throw new Error('decode exploded'); };
  component.playVoice();
  assert.equal(component.data.voicePlaying, false);
  assert.equal(component.data.voiceError, '试听失败，请稍后重试');
  assert.equal(String(component.data.voiceError).includes('exploded'), false);

  component.data.voiceError = '';
  audio.play = () => {};
  component._audioContext();
  audio.onErrorHandler({ errMsg: 'InnerAudioContext:fail secret-stack' });
  assert.equal(component.data.voiceError, '试听失败，请稍后重试');
  assert.equal(String(component.data.voiceError).includes('secret-stack'), false);
});

test('L06-035 离开组件会停掉试听,晚到的下载不再播放', () => {
  const state = load();
  const { component, audio } = state;
  let played = 0;
  let stopped = 0;
  let download;
  liveFiles(state, ['wxfile://down/v.m4a']);
  state.wx.downloadFile = (opts) => {
    download = opts;
    return { abort() { opts.fail({ errMsg: 'downloadFile:fail abort secret' }); } };
  };
  audio.play = () => { played += 1; };
  audio.stop = () => { stopped += 1; };
  component._voiceDisplayContext = { current: () => true };
  component.data.voiceSample = 'https://cdn.example/v.m4a';
  component.playVoice();
  component._onHide();
  download.success({ statusCode: 200, tempFilePath: 'wxfile://down/v.m4a' });
  assert.equal(played, 0);
  assert.ok(stopped >= 1);
  assert.equal(component._audio, null);
  assert.equal(JSON.stringify(component.data).includes('secret'), false);
});

test('L06-118 关表单销毁音频上下文', () => {
  const { component } = load();
  let destroyed = 0;
  const audio = component._audioContext();
  audio.destroy = () => { destroyed += 1; };
  component._teardown();
  assert.equal(destroyed, 1);
  assert.equal(component._audio, null);
});
