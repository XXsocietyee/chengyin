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
    stop() {}, play() {}, destroy() {}, onEnded() {}, onStop() {}, onError() {},
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
  return state;
}


test('L06-035 voiceSample 为 media-asset 引用时不播放,给出说明', () => {
  const { component } = load();
  let played = 0;
  component._voiceDisplayContext = { current: () => true };
  component.data.voiceSample = 'media-asset:12';
  const audio = component._audioContext();
  audio.play = () => { played += 1; };
  component.playVoice();
  assert.equal(played, 0);
  assert.ok(component.data.voiceError);
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
