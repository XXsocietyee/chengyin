'use strict';
// 调音台(mixer):玩家端分发、提交形状与组件状态机。示例内容与音频地址均为虚构占位。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pickPlayKit, serverAction, serverPayload } = require('../../pages/play/utils/playkit-view.js');
const config = require('../../pages/publish/utils/publish/advanced-game-config.js');

const ROOT = path.join(__dirname, '../..');
const DIR = path.join(ROOT, 'pages/playkit/components/playkit-mixer');

const TRACKS = [
  { id: 'drum', label: '鼓', muted: false },
  { id: 'gtr', label: '吉他', muted: false },
  { id: 'voc', label: '人声', muted: true },
];
const seg = {
  title: '谁把声音删掉了', tracks: TRACKS,
  audioBefore: 'https://example.invalid/mixer/before.mp3', audioAfter: 'https://example.invalid/mixer/after.mp3',
  captionBefore: '只有鼓和吉他', captionAfter: '人声回来了',
  maxTries: 2, attempts: 0, finished: false, passed: false, lastCorrect: false, lastTrackId: '',
};

/* ---------- 最小组件宿主:属性默认值 + setData + observers + 生命周期,stage 与音频可替身 ---------- */
function loadDef() {
  let def;
  global.Component = (d) => { def = d; };
  global.Behavior = global.Behavior || ((b) => b);
  global.wx = global.wx || {};
  const file = require.resolve('../../pages/playkit/components/playkit-mixer/index.js');
  delete require.cache[file];
  require(file);
  return def;
}

function fakeAudio() {
  const ctx = { src: '', plays: 0, stops: 0, destroyed: false, currentTime: 0, duration: 0, handlers: {} };
  ['onTimeUpdate', 'onEnded', 'onStop', 'onError'].forEach((name) => { ctx[name] = (fn) => { ctx.handlers[name] = fn; }; });
  ctx.play = () => { ctx.plays++; };
  ctx.stop = () => { ctx.stops++; if (ctx.handlers.onStop) ctx.handlers.onStop(); };
  ctx.seek = () => {};
  ctx.destroy = () => { ctx.destroyed = true; };
  return ctx;
}

function mount(props) {
  const def = loadDef();
  const audios = [];
  global.wx = { createInnerAudioContext() { const a = fakeAudio(); audios.push(a); return a; }, vibrateShort() {} };
  const stage = { begins: [], wins: [], nudges: 0, begin(o) { this.begins.push(o || null); }, win(t) { this.wins.push(t); }, nudge() { this.nudges++; } };
  const events = [];
  const data = { reducedMotion: true };
  Object.keys(def.properties).forEach((k) => { data[k] = def.properties[k].value; });
  Object.assign(data, def.data);
  const inst = { data, events, stage, audios };
  Object.keys(def.methods).forEach((k) => { inst[k] = def.methods[k].bind(inst); });
  inst.setData = (patch) => { Object.assign(inst.data, patch); };
  inst.selectComponent = (id) => (id === '#cy-play-stage' ? stage : null);
  inst.triggerEvent = (name, detail) => events.push({ name, detail });
  inst.setProps = (patch) => {
    Object.assign(inst.data, patch);
    Object.keys(def.observers).forEach((key) => {
      const names = key.split(',').map((s) => s.trim());
      if (!names.some((n) => Object.prototype.hasOwnProperty.call(patch, n))) return;
      def.observers[key].apply(inst, names.map((n) => inst.data[n]));
    });
  };
  inst.lifetimes = def.lifetimes;
  inst.pageLifetimes = def.pageLifetimes;
  inst.setProps(Object.assign({ show: true }, props));
  return inst;
}
const tap = (inst, method, dataset) => inst[method]({ currentTarget: { dataset: dataset || {} } });

/* ---------- 分发与提交形状 ---------- */
test('mixer 段走 cy-playkit-mixer,答案与答错回复不在 kit 里', () => {
  const view = { sessionId: 3, version: 2, status: 'RUNNING', present: 'inline', playKit: { mixer: seg } };
  const kit = pickPlayKit(view, new Date());
  assert.equal(kit.type, 'mixer');
  assert.equal(kit.present, 'inline');
  assert.deepEqual(kit.tracks, TRACKS);
  assert.equal(kit.captionAfter, '人声回来了');
  assert.equal(kit.maxTries, 2);
  assert.ok(!('answer' in kit) && !('wrongReply' in kit));
});

test('提交按服务端 SUBMIT_MIXER 要的 trackId + unmuted 形状', () => {
  assert.equal(serverAction('mixer', 'submit'), 'SUBMIT_MIXER');
  assert.deepEqual(serverPayload('mixer', 'submit', { trackId: 'voc', unmuted: ['voc'] }), { trackId: 'voc', unmuted: ['voc'] });
});

test('客户端能力声明带 game.mixer', () => {
  const caps = require('../../pages/play/utils/client-capabilities.js');
  assert.ok(caps.keys().includes('game.mixer'));
});

/* ---------- 组件:开关 / 选中 / 确认 ---------- */
test('波形由轨道 id 确定:同 id 同形,不同 id 不同形', () => {
  const def = loadDef();
  assert.deepEqual(def.methods._waveOf('voc'), def.methods._waveOf('voc'));
  assert.notDeepEqual(def.methods._waveOf('voc'), def.methods._waveOf('drum'));
  assert.ok(def.methods._waveOf('voc').every((h) => h >= 20 && h <= 100));
});

test('选中静音轨时确认不可用;打开它才可用,交上去的是 trackId + 亲手打开的轨', () => {
  const k = mount({ tracks: TRACKS });
  assert.equal(k.stage.begins.length, 1);
  assert.equal(k.data.rows.find((r) => r.id === 'voc').on, false);
  tap(k, 'onPick', { id: 'voc' });
  assert.equal(k.data.selectedId, 'voc');
  assert.equal(k.data.ready, false);
  k.onConfirm();
  assert.equal(k.events.length, 0, '静音的那一轨不能确认');
  tap(k, 'onSwitch', { id: 'voc' });
  assert.equal(k.data.ready, true);
  k.onConfirm();
  assert.deepEqual(k.events.pop(), { name: 'submit', detail: { trackId: 'voc', unmuted: ['voc'] } });
  tap(k, 'onSwitch', { id: 'drum' });
  assert.equal(k.data.selectedId, 'drum');
  assert.equal(k.data.ready, false, '关掉的轨不能确认');
});

test('答错:红字来自服务端 lastFeedback,四边红光一下,台面 nudge,不判过', () => {
  const k = mount({ tracks: TRACKS, maxTries: 2 });
  tap(k, 'onSwitch', { id: 'voc' });
  tap(k, 'onPick', { id: 'gtr' });
  k.onConfirm();
  k.setProps({ attempts: 1, lastCorrect: false, passed: false, lastTrackId: 'gtr', lastFeedback: '那一轨一直在响' });
  assert.equal(k.data.feedback, '那一轨一直在响');
  assert.equal(k.data.edge, true);
  assert.equal(k.stage.nudges, 1);
  assert.equal(k.stage.wins.length, 0);
  assert.equal(k.data.phase, 'play');
  tap(k, 'onSwitch', { id: 'drum' });
  assert.equal(k.data.feedback, '', '动过开关就撤掉上一次的红字');
  k.lifetimes.detached.call(k);
});

test('答对:台面「通过」章,点任意处收章进入对比卡;之后不能再改轨', () => {
  const k = mount({ tracks: TRACKS });
  k.setProps({ attempts: 1, lastCorrect: true, passed: true, finished: true, lastTrackId: 'voc' });
  assert.deepEqual(k.stage.wins, ['']);
  assert.equal(k.data.phase, 'stamp');
  tap(k, 'onSwitch', { id: 'drum' });
  assert.equal(k.data.rows.find((r) => r.id === 'drum').on, true, '通过后开关不再动');
  k.onStampTap();
  assert.equal(k.data.phase, 'ab');
  assert.deepEqual(k.stage.begins.pop(), { immediate: true });
  assert.equal(k.data.seg, 'before');
});

test('重进已通过的局直接是对比卡,不再盖章', () => {
  const k = mount({ tracks: TRACKS, attempts: 1, passed: true, finished: true, lastTrackId: 'voc' });
  assert.equal(k.data.phase, 'ab');
  assert.equal(k.stage.wins.length, 0);
});

/* ---------- 对比卡播放 ---------- */
test('对比卡:点一段放、播放头跟时间走、再点停、切段换音源;说明一直在', () => {
  const k = mount({ tracks: TRACKS, attempts: 1, passed: true, finished: true,
    audioBefore: seg.audioBefore, audioAfter: seg.audioAfter, captionBefore: seg.captionBefore, captionAfter: seg.captionAfter });
  tap(k, 'onSeg', { seg: 'before' });
  const a = k.audios[0];
  assert.equal(a.src, seg.audioBefore);
  assert.equal(a.plays, 1);
  assert.equal(k.data.playing, true);
  a.currentTime = 2; a.duration = 4; a.handlers.onTimeUpdate();
  assert.equal(k.data.head, 50);
  tap(k, 'onSeg', { seg: 'before' });
  assert.equal(k.data.playing, false, '再点同一段就停');
  assert.equal(k.data.head, 0);
  tap(k, 'onSeg', { seg: 'after' });
  assert.equal(k.audios.length, 1, '同一个播放器换音源');
  assert.equal(a.src, seg.audioAfter);
  assert.equal(k.data.seg, 'after');
  a.handlers.onEnded();
  assert.equal(k.data.playing, false);
});

test('没有音频地址时只切段看说明,不建播放器', () => {
  const k = mount({ tracks: TRACKS, attempts: 1, passed: true, finished: true });
  tap(k, 'onSeg', { seg: 'after' });
  assert.equal(k.data.seg, 'after');
  assert.equal(k.audios.length, 0);
  assert.equal(k.data.playing, false);
});

test('收尾:页面隐藏停播,收起停播,卸载停播并销毁', () => {
  const k = mount({ tracks: TRACKS, attempts: 1, passed: true, finished: true, audioBefore: seg.audioBefore });
  tap(k, 'onSeg', { seg: 'before' });
  const a = k.audios[0];
  k.pageLifetimes.hide.call(k);
  assert.equal(k.data.playing, false);
  assert.ok(a.stops >= 1);
  tap(k, 'onSeg', { seg: 'before' });
  k.setProps({ show: false });
  assert.equal(k.data.playing, false);
  k.lifetimes.detached.call(k);
  assert.equal(a.destroyed, true);
});

/* ---------- 文案、无障碍与动效守则 ---------- */
test('每个可点的都有 aria-label 与 hover-class;不新增 @keyframes;静音不只靠颜色', () => {
  const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(DIR, 'index.wxss'), 'utf8');
  const taps = wxml.match(/<view[^>]*(bindtap|catchtap)=[^>]*>/g) || [];
  assert.ok(taps.length >= 5);
  taps.forEach((tag) => {
    assert.match(tag, /aria-label="/, tag);
    assert.match(tag, /hover-class="/, tag);
  });
  assert.doesNotMatch(wxss, /@keyframes/);
  assert.doesNotMatch(wxss, /shake/);
  assert.match(wxml, />静音</);
  assert.match(wxml, />\s*就是这一轨\s*</);
  assert.match(wxml, />复原前</);
  assert.match(wxml, />复原后</);
  assert.doesNotMatch(wxml, />\s*继续\s*</, '通过之后点任意处继续,不出「继续」按钮');
  assert.match(wxss, /mx--reduced/);
});

test('分发器登记了 mixer 并把属性全部喂到', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit/index.wxml'), 'utf8');
  const tag = shell.slice(shell.indexOf('<cy-playkit-mixer'), shell.indexOf('/>', shell.indexOf('<cy-playkit-mixer')));
  const def = loadDef();
  Object.keys(def.properties).forEach((prop) => {
    const attr = prop.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    assert.match(tag, new RegExp('\\s' + attr + '="'), prop);
  });
  assert.match(fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit/index.json'), 'utf8'), /playkit-mixer\/index/);
  const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(app), /mixer/, '不新增 app.json 页面');
});

/* ---------- 编辑器:读到 mixer 段不坏,原样带回 ---------- */
/* 2026-11-25:作者端目录与表单补齐后,mixer 不再是「未知段透传」—— 它是选得到、配得出的玩法段。
   这一条改成钉新的真源:读进来每个字段都在、本页校验放行、存回去不丢,答案与答错回复留在配置里(不进投影)。 */
test('发布编辑器认得 mixer 段:字段不丢,答案与答错回复留在配置里', () => {
  const catalog = require('../../pages/publish/utils/publish/node-game-catalog.js');
  const raw = { schemaVersion: config.SCHEMA_VERSION, mixer: Object.assign({ enabled: true, answer: 'voc', wrongReply: '再听听' }, seg) };
  const parsed = config.parse(JSON.stringify(raw));
  assert.equal(parsed.error, '');
  for (const [key, value] of Object.entries(raw.mixer)) assert.deepEqual(parsed.value.mixer[key], value, key);
  assert.equal(config.validate(parsed.value), '');
  assert.equal(catalog.detectGame(parsed.value), 'mixer');
  const saved = JSON.parse(config.serialize(parsed.value));
  for (const [key, value] of Object.entries(raw.mixer)) assert.deepEqual(saved.mixer[key], value, key);
  assert.equal(saved.mixer.answer, 'voc');
});
