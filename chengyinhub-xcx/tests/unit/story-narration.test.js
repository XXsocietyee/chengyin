'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createStoryNarration, hasStoryVoice } = require('../../pages/play/utils/story-narration.js');
const soundPrefs = require('../../pages/play/utils/sound-prefs.js');

function fakeWx(store) {
  const s = store || {};
  return {
    store: s,
    getStorageSync: (k) => (k in s ? s[k] : ''),
    setStorageSync: (k, v) => { s[k] = v; },
  };
}
function harness(opts) {
  const o = opts || {};
  const created = [];
  const ducks = [];
  const w = o.wx || fakeWx(o.store);
  const n = createStoryNarration({
    wx: w,
    on: o.on,
    duck: (on) => ducks.push(on),
    createAudio: () => {
      const c = { calls: [], src: '', handlers: {} };
      ['play', 'pause', 'stop', 'destroy'].forEach((m) => { c[m] = () => c.calls.push(m === 'play' ? 'play:' + c.src : m); });
      c.onEnded = (f) => { c.handlers.ended = f; };
      c.onError = (f) => { c.handlers.error = f; };
      created.push(c);
      return c;
    },
  });
  return { n, created, ducks, w };
}
const A = { key: 'c1|a', url: 'https://cdn.example.cn/a.m4a' };
const B = { key: 'c1|b', url: 'https://cdn.example.cn/b.m4a' };
const C = { key: 'c1|c', url: 'https://cdn.example.cn/c.m4a' };
const plays = (c) => c.calls.filter((x) => x.startsWith('play:'));

test('读到带配音的段就念它;同一段不重念;只建一个播放器', () => {
  const { n, created, ducks } = harness();
  assert.equal(n.reveal([A]), true);
  assert.equal(created.length, 1);
  assert.deepEqual(plays(created[0]), ['play:' + A.url]);
  assert.equal(n.playing(), A.key);
  assert.deepEqual(ducks, [true]);
  assert.equal(n.reveal([A]), false);   // 滚回来再进视口不重念
  n.reveal([B]);
  assert.equal(created.length, 1);
});

test('前进:新读到的段顶掉正在念的,不重叠', () => {
  const { n, created, ducks } = harness();
  n.reveal([A]);
  n.reveal([B]);
  const c = created[0];
  assert.deepEqual(c.calls, ['stop', 'play:' + A.url, 'stop', 'play:' + B.url]);
  assert.equal(n.playing(), B.key);
  assert.deepEqual(ducks, [true]);   // 两段之间不抬回配乐
});

test('同一屏露出多段:按顺序接着念,念完抬回配乐;放不出来静默跳过', () => {
  const { n, created, ducks } = harness();
  n.reveal([A, B, C]);
  const c = created[0];
  c.handlers.ended();
  assert.equal(n.playing(), B.key);
  c.handlers.error();
  assert.equal(n.playing(), C.key);
  c.handlers.ended();
  assert.equal(n.playing(), '');
  assert.deepEqual(plays(c), ['play:' + A.url, 'play:' + B.url, 'play:' + C.url]);
  assert.deepEqual(ducks, [true, false]);
  c.handlers.ended();   // 迟到的结束事件不再动配乐
  assert.deepEqual(ducks, [true, false]);
});

test('切后台暂停且不排队,回前台不自动续;离开故事流停;卸载销毁', () => {
  const { n, created, ducks } = harness();
  n.reveal([A, B]);
  n.pause();
  const c = created[0];
  assert.equal(c.calls[c.calls.length - 1], 'pause');
  assert.equal(n.playing(), '');
  assert.deepEqual(ducks, [true, false]);
  c.handlers.ended();   // 排队的 B 已清掉
  assert.deepEqual(plays(c), ['play:' + A.url]);
  n.reveal([C]);
  n.stop();
  assert.equal(c.calls[c.calls.length - 1], 'stop');
  n.destroy();
  assert.equal(c.calls[c.calls.length - 1], 'destroy');
  assert.deepEqual(ducks, [true, false, true, false]);
});

test('没配音 / 非 https / 坏数据什么都不做', () => {
  const { n, created, ducks } = harness();
  assert.equal(n.reveal([]), false);
  assert.equal(n.reveal([null, { key: 'x' }, { key: 'y', url: 'media-asset:3' }, { key: 'z', url: 'http://a.cn/1.m4a' }]), false);
  assert.equal(created.length, 0);
  assert.deepEqual(ducks, []);
});

test('开关:默认开;关掉立刻停;关着时读到的段记为已读,打开从下一段开始', () => {
  const { n, created } = harness();
  assert.equal(n.isOn(), true);
  n.reveal([A]);
  assert.equal(n.setOn(false), false);
  assert.equal(created[0].calls[created[0].calls.length - 1], 'stop');
  n.reveal([B]);
  assert.deepEqual(plays(created[0]), ['play:' + A.url]);
  n.setOn(true);
  assert.equal(n.playing(), '');       // 不回头念当前这段
  n.reveal([B, C]);
  assert.deepEqual(plays(created[0]), ['play:' + A.url, 'play:' + C.url]);
  assert.equal(harness({ on: false }).n.reveal([A]), false, '页面传入旁白关 = 不念');
});

test('声音偏好:只有旁白 / 背景音乐两个键,按账号存;旁白默认开', () => {
  const w = fakeWx({});
  assert.deepEqual(soundPrefs.read('u1', w), { voiceOn: true, musicOn: true });
  assert.equal(soundPrefs.write('u1', 'voice', false, w), true);
  assert.equal(soundPrefs.write('u1', 'music', false, w), true);
  assert.deepEqual(Object.keys(w.store).sort(), ['play.musicOn.u1', 'play.voiceOn.u1']);
  assert.deepEqual(soundPrefs.read('u1', w), { voiceOn: false, musicOn: false });
  assert.deepEqual(soundPrefs.read('u2', w), { voiceOn: true, musicOn: true }, '别的账号不受影响');
});

test('声音偏好迁移:音乐开关没存过时用旧 play.narrationOn 播种(false 仍是 false),旁白一律开', () => {
  const w = fakeWx({ 'play.narrationOn': false });
  assert.deepEqual(soundPrefs.read('u1', w), { voiceOn: true, musicOn: false });
  assert.equal(w.store['play.musicOn.u1'], false, '播种后当场写下,只迁一次');
  w.store['play.narrationOn'] = true;
  assert.equal(soundPrefs.read('u1', w).musicOn, false, '已存过的新值不再被旧值改');
  assert.equal(soundPrefs.read('u3', fakeWx({ 'play.narrationOn': true })).musicOn, true);
  assert.equal(soundPrefs.read('u4', fakeWx({ 'play.bgmOn': false })).musicOn, false, '旧的主题配乐关也算关');
  assert.equal(soundPrefs.read('u5', fakeWx({ 'play.musicOn.u5': true, 'play.narrationOn': false })).musicOn, true);
  const broken = { getStorageSync: () => { throw new Error('x'); }, setStorageSync: () => { throw new Error('x'); } };
  assert.deepEqual(soundPrefs.read('u1', broken), { voiceOn: true, musicOn: true }, '读不到 = 开');
  assert.equal(soundPrefs.write('u1', 'music', false, broken), false);
});

test('hasStoryVoice 只认正文段 / 章节卡上的 voice', () => {
  assert.equal(hasStoryVoice(null), false);
  assert.equal(hasStoryVoice([{ blocks: [{ type: 'image', voice: 'x' }, { type: 'text', voice: ' ' }] }]), false);
  assert.equal(hasStoryVoice([{ blocks: [{ type: 'cap', cap: 'open', voice: 'https://a/1.m4a' }] }]), true);
  assert.equal(hasStoryVoice([{}, { blocks: [{ type: 'text', voice: 'media-asset:1' }] }]), true);
});

test('游玩页接线:显形时报读到、切后台暂停、卸载销毁、离开故事流停;工具菜单只有旁白 / 背景音乐两个声音开关且同形', () => {
  const root = path.join(__dirname, '../../pages/play');
  const js = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(root, 'index.wxml'), 'utf8');
  assert.match(js, /that\._narration\(\)\.reveal\(/);
  assert.match(js, /onHide\(\) \{[\s\S]{0,600}if \(this\._storyNarration\) this\._storyNarration\.pause\(\);/);
  assert.match(js, /this\._storyNarration\.destroy\(\)/);
  assert.match(js, /closeChapterFull\(\) \{[\s\S]{0,600}this\._storyNarration\.stop\(\)/);
  assert.match(js, /this\._duckBgm\('storyVoice', on\)/);
  assert.equal((js.match(/createStoryNarration\(/g) || []).length, 1, '整页只有一个配音控制器');
  const row = (label, handler, flag) => new RegExp('<view class="drow" wx:if="\\{\\{\\w+\\}\\}">\\s*<view class="dic pic pic--play"></view>\\s*'
    + '<view class="dcopy"><text class="dt">' + label + '</text></view>\\s*<view class="dsw \\{\\{' + flag
    + " \\? 'is-on' : ''\\}\\}\" catchtap=\"" + handler + '" aria-role="switch" aria-checked="\\{\\{' + flag
    + '\\}\\}" aria-label="' + label + '" hover-class="cy-pressed" hover-stay-time="80"><view class="dsw-i"></view></view>');
  assert.match(wxml, row('旁白', 'toggleNarration', 'narrationOn'));
  assert.match(wxml, row('背景音乐', 'toggleThemeBgm', 'themeBgmOn'));
  const switches = (wxml.match(/aria-role="switch"[^>]*aria-label="([^"]+)"/g) || []).map((m) => m.replace(/.*aria-label="([^"]+)"/, '$1'));
  assert.deepEqual(switches.filter((l) => /旁白|音乐|配音|声音|音效/.test(l)), ['背景音乐', '旁白'], '只有两个声音开关');
  assert.doesNotMatch(wxml, /toggleStoryVoice|storyVoiceOn/);
  assert.doesNotMatch(js, /pause chapter|暂停整章音频|混好背景乐/);
});
