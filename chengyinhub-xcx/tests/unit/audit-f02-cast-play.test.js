'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

function page(req, data) {
  global.wx = { getStorageSync() {}, setStorageSync() {}, showToast() {}, createInnerAudioContext: () => { created += 1; return { onCanplay() {}, onError() {}, play() {}, pause() {}, stop() {}, destroy() {}, onPlay() {}, onPause() {}, onStop() {}, onEnded() {} }; } };
  const cast = require('../../pages/play/utils/cast-play.js');
  const vm = Object.assign({ data: Object.assign({ chapter: { id: 'c1' }, topicId: 't1', chapterParas: [], cast: { start: { show: false } } }, data || {}) }, cast.methods(req));
  vm.patches = [];
  vm.setData = (p) => { vm.patches.push(p); Object.entries(p).forEach(([k, v]) => {
    const m = k.match(/^chapterParas\[(\d+)\]\.(\w+)$/);
    if (m) vm.data.chapterParas[+m[1]][m[2]] = v; else vm.data[k] = v; }); };
  return vm;
}
let created = 0;

test('L02-006: a voice reply landing after unload creates no audio, repeat taps share one request', async () => {
  created = 0;
  let resolve; let calls = 0;
  const vm = page(() => { calls += 1; return new Promise((r) => { resolve = r; }); });
  vm._castPlay('k1');
  vm._castPlay('k1');
  assert.equal(calls, 1);
  vm._playDisposed = true;
  resolve({ code: 200, data: { url: 'https://x/a.mp3' } });
  await new Promise((r) => setImmediate(r));
  assert.equal(created, 0);
});

test('L02-007: the same cast config does not re-render the chapter', () => {
  const vm = page(() => Promise.resolve({}), { chapterFull: true });
  let renders = 0;
  vm.openChapterFull = () => { renders += 1; };
  vm._castSet({ cast: [{ id: 'a' }] });
  vm._castSet({ cast: [{ id: 'a' }] });
  assert.equal(renders, 1);
});

test('L02-008: duration and hide-voice updates touch single paragraphs by path', () => {
  const vm = page(() => Promise.resolve({}), { chapterParas: [{ lineKey: 'a', voice: true }, { lineKey: 'b', voice: true }, { text: 'x' }] });
  vm._castAudio = { duration: 8 };
  vm._castPlayingKey = 'b';
  vm._castDur();
  assert.deepEqual(Object.keys(vm.patches.pop()), ['chapterParas[1].dur']);
  vm._castHideVoice('CAST_VOICE_NONE');
  assert.deepEqual(Object.keys(vm.patches.pop()).sort(), ['cast.card.voice', 'chapterParas[1].voice']);
  assert.equal(vm.data.chapterParas[0].voice, true);
});

test('L02-009: station sheet walking minutes work with the real distanceText output', () => {
  const { distanceText } = require('../../utils/geo.js');
  const pops = require('../../pages/play/utils/play-stage-pops.js');
  const sheetFacts = pops.sheetFacts || (pops.__test && pops.__test.sheetFacts);
  assert.equal(typeof sheetFacts, 'function');
  assert.equal(sheetFacts({}, distanceText(1700)).walkText, '22');
  assert.equal(sheetFacts({}, distanceText(350)).walkText, '5');
  assert.equal(sheetFacts({}, distanceText(1700)).distText, '1.7 公里');
  assert.equal(sheetFacts({}, '1.2km').walkText, '15');
});

test('L02-077: daily-sign date and casebook times use China time on any phone time zone', () => {
  const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js');
  const kit = pickPlayKit({ sessionId: 's', version: 1, playKit: { dailySign: { address: 'x', serial: 1 } } }, new Date('2026-11-22T17:00:00Z'));
  assert.equal(kit.dateLabel, '11 / 23');
});
