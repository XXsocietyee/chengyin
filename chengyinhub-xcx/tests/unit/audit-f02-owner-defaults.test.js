'use strict';
// AUDIT-1122 F02:业主 2026-11-24 对 L02 待定项的默认选项(owner-decisions-1123.json),逐条一个行为 / 源码测试。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** 取组件定义(不挂载):方法直接 call 到一个假实例上 */
function defOf(rel, globals = {}) {
  let def;
  global.Component = (d) => { def = d; };
  global.Behavior = (b) => b;
  global.getApp = () => ({ globalData: {} });
  global.wx = Object.assign({ getStorageSync() {}, setStorageSync() {}, getWindowInfo: () => ({}), getSystemInfoSync: () => ({}) }, globals.wx || {});
  const file = path.join(ROOT, rel);
  delete require.cache[require.resolve(file)];
  require(file);
  return def;
}

test('L02-019 (owner A): an idle chapter gate repaints every 100 ms instead of every frame, and goes back to frames on new motion', () => {
  const def = defOf('pages/play/components/chapter-flip/index.js');
  const timers = []; const realSet = global.setTimeout; global.setTimeout = (fn, ms) => { timers.push(ms); return 1; };
  try {
    let rafs = 0;
    const vm = Object.assign({}, def.methods, {
      data: {}, _gone: false, _cv: { requestAnimationFrame: () => { rafs += 1; return 9; } },
      _turn: null, _flash: 0, _shards: [], _waves: [], _confetti: [], _confettiUntil: 0, _sparks: [{ life: 1 }],
      _tiles: [{ loose: 0, vx: 0.01, vy: 0, x: 10, tx: 10, y: 5, ty: 5, sz: 7, tsz: 7 }],
      _paint() {},
    });
    Object.keys(def.methods).forEach((k) => { vm[k] = def.methods[k].bind(vm); });
    vm._loop();
    assert.deepEqual(timers, [100]); assert.equal(rafs, 0);
    vm._shards.push({});
    vm._loop();
    assert.equal(rafs, 1, 'a shatter goes back to full rate');
    vm._shards.length = 0; vm._tiles[0].x = 40;
    assert.equal(vm._idle(Date.now()), false, 'tiles still moving: not idle');
  } finally { global.setTimeout = realSet; }
});

test('L02-021 (owner A): extension-task flip cards drop the stale stq classes so play-stage .xd__c motion applies', () => {
  const wxml = read('pages/play/play-topbar.wxml');
  const wxss = read('pages/play/play-topbar.wxss');
  assert.doesNotMatch(wxml, /\bstq__/);
  assert.doesNotMatch(wxss, /\.stq/);
  assert.match(read('pages/play/play-stage.wxss'), /\.xd__c\s*\{[^}]*transition:[^}]*transform/);
});

test('L02-029 (owner A): album caption, submit status and CTA stack in one column above the page count', () => {
  const wxml = read('pages/playkit/components/playkit-album/index.wxml');
  const wxss = read('pages/playkit/components/playkit-album/index.wxss');
  const stack = wxml.slice(wxml.indexOf('<view class="album__stack">'), wxml.indexOf('<view class="album__back'));
  assert.equal((stack.match(/class="album__line"/g) || []).length, 3, 'caption, submitted note and CTA block all inside the stack');
  assert.match(wxss, /\.album__stack\{[^}]*position:absolute;[^}]*bottom:calc\(env\(safe-area-inset-bottom\) \+ 230rpx\);[^}]*flex-direction:column;/);
  assert.doesNotMatch(wxss.match(/\.album__line\{[^}]*\}/)[0], /position:\s*absolute/, 'lines no longer share one absolute spot');
});

test('L02-032 (owner A): the one/two dice toggle is gone; dice count comes only from the merchant config', () => {
  const wxml = read('pages/playkit/components/playkit-diceroll/index.wxml').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(wxml, /dz__seg|onCount|一颗|两颗<\/view>/);
  assert.doesNotMatch(read('pages/playkit/components/playkit-diceroll/index.wxss'), /\.dz__seg/);
  const def = defOf('pages/playkit/components/playkit-diceroll/index.js');
  assert.equal(def.methods.onCount, undefined);
  assert.doesNotMatch(read('pages/playkit/components/playkit/index.wxml'), /bind:count=/);
  assert.equal(defOf('pages/playkit/components/playkit/index.js').methods.onCount, undefined);
});

test('L02-067 (owner A): the unsupported-content notice tells the player to update the mini program', () => {
  const cap = require('../../pages/play/utils/client-capabilities.js');
  assert.equal(cap.unsupportedNotice({ err: cap.UNSUPPORTED }), '当前版本无法完整呈现本局内容，请更新小程序后重新进入');
  assert.equal(cap.unsupportedNotice({ data: { errorCode: cap.UNSUPPORTED } }), '当前版本无法完整呈现本局内容，请更新小程序后重新进入');
  assert.equal(cap.unsupportedNotice({ err: 'OTHER' }), '');
});

test('L02-083 (owner A): leaderboard elapsed time uses the same h:mm:ss as the score overlay', () => {
  const board = require('../../pages/play/utils/play-board-view.js');
  const hud = require('../../pages/play/utils/play-hud-overlays.js');
  assert.equal(hud.clock, board.clock, 'one formatter');
  assert.equal(board.clock('3600000'), '1:00:00');
  assert.equal(board.clock(65000), '01:05');
  assert.equal(board.clock('9223372036854775807'), '2562047788015:12:55');
  assert.equal(board.clock(-1), '00:00');
});

test('L02-109 (owner A): the advanced-game status pill row has its own classes, separate from the unknown-state card', () => {
  const wxml = read('pages/play/components/advanced-game/index.wxml');
  const wxss = read('pages/play/components/advanced-game/index.wxss').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(wxml, /<view class="ag__meta"><text class="ag__meta-text">\{\{state\.status === 'RUNNING'/);
  assert.equal((wxss.match(/\.ag__status\s*\{/g) || []).length, 1, 'only the unknown-state card defines .ag__status');
  assert.equal((wxss.match(/\.ag__status-text\s*\{/g) || []).length, 1);
  assert.match(wxss, /\.ag__meta-text \{background:var\(--cy-bg-card-2\);padding:8rpx 16rpx;border-radius:var\(--cy-radius-pill\)/);
});

test('L02-110 (owner A): on cast themes (book chapter heads) the hidden letter decode settles at once with no 45 ms timer', () => {
  const def = defOf('pages/play/components/chapter-flip/index.js');
  const intervals = []; const realSI = global.setInterval; global.setInterval = (fn, ms) => { intervals.push(ms); return 1; };
  try {
    const patches = [];
    const vm = { data: { reducedMotion: false }, setData(p) { patches.push(p); Object.assign(this.data, p); } };
    vm._decode = def.methods._decode.bind(vm);
    const ms = vm._decode({ book: '第一章', kicker: '第一章', title: '雨夜', desc: '', stats: [] }, 0);
    assert.deepEqual(intervals, []);
    assert.equal(patches.length, 1);
    assert.ok(ms > 0, 'timing for the next beat is unchanged');
    assert.deepEqual(vm.data.copy.t.map((c) => c.c).join(''), '雨夜');
    vm._decode({ kicker: '第一章', title: '雨夜', desc: '', stats: [] }, 0);
    assert.deepEqual(intervals, [45], 'without a book head the decode still animates');
  } finally { global.setInterval = realSI; }
});

test('L02-111 (owner A): the story sheet defines .serif itself, with the same family as the page', () => {
  const page = read('pages/play/index.wxss').match(/\.serif \{ font-family:([^;]+);/)[1].replace(/\s+/g, '');
  const own = read('pages/play/components/story-sheet/index.wxss').match(/\.serif \{ font-family: ([^;]+);/)[1].replace(/\s+/g, '');
  assert.equal(own, page);
  assert.match(read('pages/play/components/story-sheet/index.wxml'), /class="sts__title serif"/);
});

test('L02-112 (owner A): backpack, hint pop, spinner and press scaling follow the page reduced-motion class', () => {
  const rules = {
    'pages/play/play-help.wxss': ['.play--reduced-motion .phl__chev{transition:none}', '.play--reduced-motion .phl .cy-mm__spin{animation:none}', '.play--reduced-motion .phl-pop{animation:none}'],
    'pages/play/play-topbar.wxss': ['.play--reduced-motion .chfull__tasks--press{transform:none;}', '.play--reduced-motion .chfull .hud2{transition:none;}'],
    'pages/play/theme-backpack.wxss': ['.play--reduced-motion .tb-item--press{transform:none}', '.play--reduced-motion .tbp{animation:none}'],
  };
  for (const [file, list] of Object.entries(rules)) {
    const css = read(file);
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /prefers-reduced-motion/, file);
    list.forEach((r) => assert.ok(css.includes(r), file + ' ' + r));
  }
  assert.match(read('pages/play/index.wxml'), /\{\{reducedMotion \? 'play--reduced-motion' : ''\}\}/, 'the page root carries the class');
});

test('L02-114 (owner A): the nine backpack / player sheets share one tb-player-sheet class; only the max height stays inline', () => {
  const files = ['pages/play/theme-backpack.wxml', 'pages/play/theme-plan-sheet.wxml', 'pages/play/theme-player-ops.wxml'];
  let n = 0;
  for (const f of files) {
    const w = read(f);
    assert.doesNotMatch(w, /--cy-comp-sheet-role-glass/, f);
    n += (w.match(/class="[^"]*\btb-player-sheet\b[^"]*"[^>]*style="--cy-comp-sheet-max-h:calc\(100vh - \{\{chrome\.sheetTop\}\}px\)/g) || []).length;
  }
  assert.equal(n, 9);
  const css = read('pages/play/theme-backpack.wxss');
  assert.match(css, /\.tb-player-sheet\{--cy-comp-sheet-blur:0px;--cy-comp-sheet-role-glass:var\(--cy-comp-sheet-player-glass\);[^}]*--cy-comp-sheet-role-btn-fg:var\(--cy-comp-sheet-player-page\);\}/);
  assert.doesNotMatch(css, /\.tb-item__ini\b/);
});

test('L02-115 (owner A): unused look button styles are gone from both synced look-tokens copies', () => {
  const a = read('pages/play/look-tokens.wxss'); const b = read('pages/publish/fabu/look-tokens.wxss');
  assert.equal(a, b, 'copies stay identical');
  const css = a.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const sel of ['.lk-btn--accent', '.lk-btn--text', '.lk-btn--ok', '.lk-plain']) assert.ok(!css.includes(sel), sel);
  assert.match(css, /\.lk-btn--primary \{/);
  assert.match(css, /\.lk-btn--ghost \{/);
});

test('L02-120 (owner A, foil part): pack-foil.png is a lossless 8-bit palette PNG under 70 KB', () => {
  const png = fs.readFileSync(path.join(ROOT, 'pages/play/assets/pack-foil.png'));
  assert.equal(png.readUInt32BE(16), 330); assert.equal(png.readUInt32BE(20), 577);
  assert.equal(png[24], 8, 'bit depth'); assert.equal(png[25], 3, 'colour type: palette');
  assert.ok(png.includes(Buffer.from('tRNS')), 'alpha kept in tRNS');
  assert.ok(png.length < 70000, String(png.length));
});

test('L02-147 (owner A): the branch kit no longer carries the never-shown feedback block or the hidden tail node', () => {
  const wxml = read('pages/playkit/components/playkit-branch/index.wxml');
  const wxss = read('pages/playkit/components/playkit-branch/index.wxss');
  assert.doesNotMatch(wxml, /br__fb|br__tail|\{\{feedback\}\}/);
  assert.doesNotMatch(wxss, /\.br__fb|\.br__tail/);
  const def = defOf('pages/playkit/components/playkit-branch/index.js');
  assert.equal('feedback' in def.data, false);
});

test('L02-152 (owner A): bingo panel body text and borders follow the look, with the old values as fallbacks', () => {
  const css = read('pages/playkit/components/playkit-bingo/index.wxss');
  const body = (sel) => css.match(new RegExp(sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}'))[1];
  assert.match(body('.bg__panel-p'), /color: var\(--lk-mute, #3c4043\)/);
  assert.match(body('.bg__panel'), /border-top: 6rpx solid var\(--lk-ink, #000\)/);
  assert.match(body('.bg__panel-x'), /border: 4rpx solid var\(--lk-ink, #000\)/);
  assert.match(body('.bg__panel-x'), /box-shadow: 0 8rpx 0 var\(--lk-ink, #000\)/);
  assert.doesNotMatch(body('.bg__panel') + body('.bg__panel-p') + body('.bg__panel-x'), /#3c4043;|solid #000;|0 #000;/);
});

test('L02-161 (owner B): the blind-taste hint is no longer built, bound or declared; the page is unchanged', () => {
  const view = require('../../pages/play/utils/playkit-view.js');
  const src = read('pages/play/utils/playkit-view.js');
  const fn = src.slice(src.indexOf('function buildBlindTaste'), src.indexOf('\n}\n', src.indexOf('function buildBlindTaste')));
  assert.doesNotMatch(fn, /hint:/);
  const host = read('pages/playkit/components/playkit/index.wxml');
  const tag = host.slice(host.indexOf('<cy-playkit-blindtaste'), host.indexOf('/>', host.indexOf('<cy-playkit-blindtaste')));
  assert.doesNotMatch(tag, /hint=/);
  assert.equal('hint' in defOf('pages/playkit/components/playkit-blindtaste/index.js').properties, false);
  assert.ok(view);
});

test('L02-168 (owner A): diyname, music corner and match keep one declaration per property (no later override blocks)', () => {
  const strip = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');
  const count = (css, sel) => (css.match(new RegExp('(^|\\n|\\})\\s*' + sel.replace(/[.]/g, '\\.') + '\\s*\\{', 'g')) || []).length;
  const dn = strip('pages/playkit/components/playkit-diyname/index.wxss');
  assert.equal(count(dn, '.dn__input'), 1); assert.equal(count(dn, '.dn__chip'), 1);
  assert.match(dn, /\.dn__input \{[^}]*border: 3rpx solid var\(--cy-color-playkit-craft\)/);
  assert.match(dn, /\.dn__chip \{[^}]*border: 2rpx solid var\(--cy-color-playkit-craft\);[^}]*background: rgba\(46, 196, 182, \.16\)/);
  const mc = strip('pages/playkit/components/playkit-musiccorner/index.wxss');
  for (const sel of ['.mc__bar--on', '.mc__track-fill', '.mc__play', '.mc__pause-bar']) assert.equal(count(mc, sel), 1, sel);
  assert.doesNotMatch(mc, /status-info/);
  const ma = strip('pages/playkit/components/playkit-match/index.wxss');
  assert.equal(count(ma, '.ma__card'), 1);
  assert.match(ma, /\.ma__card \{[^}]*position: relative;[^}]*box-shadow: var\(--cy-depth-rest\);/);
  assert.doesNotMatch(ma, /\.ma__c[0-5] \{[^}]*border-color/);
  assert.equal(count(ma, '.g-btn--press'), 0, 'play-surface already has it');
});

test('L02-171 (owner A): the journey-check verdict button uses the same colours as every kit primary button', () => {
  const strip = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');
  const g = strip('pages/playkit/style/play-surface.wxss').match(/\n\.g-btn \{([^}]*)\}/)[1];
  const jc = strip('pages/playkit/components/playkit-journey-check/index.wxss').match(/\.jc__act-main \{([^}]*)\}/)[1];
  const pick = (body, prop) => body.match(new RegExp('(?:^|;|\\s)' + prop + ':\\s*([^;]+);'))[1].trim();
  assert.equal(pick(jc, 'background'), pick(g, 'background'));
  assert.equal(pick(jc, 'color'), pick(g, 'color'));
});

test('L02-174 (owner A): the music-corner continue button takes its width and gap from a class, not an inline style', () => {
  const body = read('pages/playkit/components/playkit-musiccorner/body.wxml');
  assert.match(body, /<cy-btn class="mc__cta" variant="secondary" bindtap="onClose">继续<\/cy-btn>/);
  assert.doesNotMatch(body, /<cy-btn[^>]*style=/);
  assert.match(read('pages/playkit/components/playkit-musiccorner/index.wxss'), /\.mc__cta \{ width: 100%; margin-top: var\(--cy-space-4\); \}/);
});

test('L02-185 (owner A): silent-order and time-window colours are declared once, with the value that applies', () => {
  const strip = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, '');
  const so = strip('pages/playkit/components/playkit-silentorder/index.wxss');
  for (const sel of ['so__timer', 'so__giveup']) {
    const rules = so.match(new RegExp('\\.' + sel + '\\s*\\{[^}]*\\}', 'g'));
    assert.equal(rules.length, 1, sel);
    assert.match(rules[0], /color: var\(--cy-color-playkit-silent\)/);
  }
  const tw = strip('pages/playkit/components/playkit-timewindow/index.wxss').match(/\.tw__window\s*\{[^}]*\}/g);
  assert.equal(tw.length, 1);
  assert.match(tw[0], /color: var\(--cy-color-playkit-night\)/);
});

test('L02-186 (owner A): dead kit styles and always-empty class expressions are gone', () => {
  const css = (k) => read('pages/playkit/components/' + k + '/index.wxss').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css('playkit-qa'), /\.qa__tail\b/);
  assert.doesNotMatch(css('playkit-sort'), /\.so__hint\b|\.g-btn--press\b/);
  assert.doesNotMatch(css('playkit-stopwatch'), /\.sw__hat-s\b/);
  const ti = read('pages/playkit/components/playkit-typein/index.wxml');
  const plain = ti.slice(ti.indexOf('<block wx:else>'));
  assert.doesNotMatch(plain, /ti--terminal|'ti--' \+ off/, 'non-terminal branch carries no terminal-only classes');
  assert.match(ti, /class="terminal \{\{off \? 'ti--' \+ off : ''\}\}/, 'terminal branch keeps its power-off classes');
});

test('L02-187 (owner A): kits without their own slots drop multipleSlots, and the slow-task comment matches the page', () => {
  for (const k of ['slowtask', 'steps', 'timewindow']) {
    const def = defOf('pages/playkit/components/playkit-' + k + '/index.js');
    assert.ok(!def.options || !def.options.multipleSlots, k);
  }
  const body = read('pages/playkit/components/playkit-slowtask/body.wxml');
  assert.doesNotMatch(body, /也有可见的直接揭示按钮/);
});
