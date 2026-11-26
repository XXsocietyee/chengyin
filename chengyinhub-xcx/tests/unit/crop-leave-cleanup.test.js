'use strict';
// 离开裁剪页后:定时器不再 setData,失败不展示异常原文,画布导出和临时文件停掉。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const FILE = path.resolve(__dirname, '../../pages/crop/index.js');

function loadCrop() {
  let def;
  const timers = [];
  let seq = 1;
  const unlinks = [];
  const exports = [];
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }),
    getImageInfo() {},
    navigateBack() {},
    reLaunch() {},
    setNavigationBarColor() {},
    setBackgroundColor() {},
    createSelectorQuery() {
      return { in() { return this; }, select() { return this; }, fields() { return this; }, exec() {} };
    },
    canvasToTempFilePath(opts) { exports.push(opts); },
    getFileSystemManager: () => ({ unlink(opts) { unlinks.push(opts.filePath); } }),
  };
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), {
    Page: (v) => { def = v; },
    getApp: () => ({ globalData: {} }),
    wx,
    require: createRequire(FILE),
    console,
    setTimeout(fn) {
      const id = seq++;
      timers.push({ id, fn, cleared: false });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.find((item) => item.id === id);
      if (timer) timer.cleared = true;
    },
  }, { filename: FILE });
  const page = Object.assign({}, def, {
    data: JSON.parse(JSON.stringify(def.data)),
    setData(patch) { Object.assign(this.data, patch); },
    getOpenerEventChannel: () => ({ on() {} }),
  });
  return { page, timers, unlinks, exports, wx };
}

function canvasOf() {
  const img = {};
  const canvas = {
    width: 0,
    height: 0,
    getContext() {
      return { fillRect() {}, clearRect() {}, drawImage() {}, set fillStyle(v) { this._fill = v; } };
    },
    createImage() { return img; },
  };
  return { img, canvas };
}

test('离开页面撤掉等图闸和还原定时器,到点回调不再 setData', () => {
  const { page, timers } = loadCrop();
  page.onLoad();
  const wait = timers.find((timer) => !timer.cleared);
  assert.ok(wait, '等图闸必须挂上');
  page.data.ready = true;
  page.data.sourceState = 'ready';
  page.onReset();
  const settle = timers.filter((timer) => !timer.cleared).pop();
  assert.ok(settle);
  assert.equal(page.data.settling, true);
  page.onHide();
  assert.equal(settle.cleared, true, '隐藏时还原定时器必须撤掉');
  assert.equal(page.data.settling, false);
  page.onUnload();
  assert.equal(wait.cleared, true, '卸载时等图闸必须撤掉');
  page.data.sourceState = 'waiting';
  page.data.settling = true;
  let writes = 0;
  page.setData = () => { writes += 1; };
  wait.fn();
  settle.fn();
  assert.equal(writes, 0, '离开后的定时器回调不能再 setData');
});

test('读图失败把原因和重试画出来,不留白也不自动离开', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/crop/index.wxml'), 'utf8');
  const branch = wxml.match(/sourceState === 'error'[\s\S]*?<cy-error\b([^>]*?)\s*\/>/);
  assert.ok(branch, '读图失败必须用 cy-error');
  const tag = branch[1];
  assert.match(tag, /title="图片没能打开"/);
  assert.match(tag, /sub="\{\{sourceError\}\}"/);
  assert.match(tag, /retry="重试"/);
  assert.match(tag, /bind:retry="onRetrySource"/);
  assert.doesNotMatch(tag, /load-failure/, 'load-failure 会把原因和重试画成空白');
  assert.doesNotMatch(tag, /auto-back/, 'auto-back 会在两秒后离开,来不及重试或使用原图');
});

test('读图失败和画布抛错只显示人话,不带异常原文', () => {
  const { page, wx } = loadCrop();
  const reads = [];
  wx.getImageInfo = (opts) => reads.push(opts);
  page.getOpenerEventChannel = () => ({
    on(name, cb) { if (name === 'cropInit') cb({ paths: ['/tmp/a.jpg'], ratio: '1:1' }); },
  });
  page.onLoad();
  reads[0].success(null);
  assert.equal(page.data.sourceState, 'error');
  assert.equal(page.data.sourceError, '这张图片暂时无法读取，请重试或使用原图');
  assert.doesNotMatch(page.data.sourceError, /TypeError|Cannot read|undefined/);

  page._unloaded = false;
  page.data.busy = true;
  page.data.src = '/tmp/a.jpg';
  page.drawAndExport({
    getContext() { throw new Error('TypeError: canvasToTempFilePath:fail invalid viewId at drawImage'); },
    createImage() { return {}; },
  }, { sx: 0, sy: 0, sw: 80, sh: 80 });
  assert.equal(page.data.busy, false);
  assert.equal(page.data.exportError, '裁剪结果没有生成，请重试或使用原图');
  assert.doesNotMatch(page.data.exportError, /TypeError|fail|drawImage|exception/i);
});

test('卸载后画布不再导出,迟到的临时文件会被删掉', () => {
  const { page, exports, unlinks } = loadCrop();
  page.onLoad();
  page.results = [];
  page.queue = ['/tmp/a.jpg'];
  page.idx = 0;
  page.data.src = '/tmp/a.jpg';
  const { img, canvas } = canvasOf();
  let drawn = 0;
  canvas.getContext = () => ({
    fillRect() {},
    clearRect() {},
    drawImage() { drawn += 1; },
    set fillStyle(v) { this._fill = v; },
  });
  page.drawAndExport(canvas, { sx: 0, sy: 0, sw: 40, sh: 40 });
  const onload = img.onload;
  page.onUnload();
  assert.equal(img.onload, null);
  assert.equal(canvas.width, 0);
  assert.equal(canvas.height, 0);
  onload();
  assert.equal(exports.length, 0, '卸载后的 onload 不能再 canvasToTempFilePath');
  assert.equal(drawn, 0);

  page._unloaded = false;
  page._exportGen = 0;
  page._exportImage = null;
  page._exportCanvas = null;
  const second = canvasOf();
  page.drawAndExport(second.canvas, { sx: 0, sy: 0, sw: 40, sh: 40 });
  second.img.onload();
  assert.equal(exports.length, 1);
  page.onUnload();
  exports[0].success({ tempFilePath: 'wxfile://tmp_crop.jpg' });
  assert.deepEqual(page.results, []);
  assert.deepEqual(unlinks, ['wxfile://tmp_crop.jpg']);
});

test('还在页上的导出结果会收下,不会被当成泄漏文件删掉', () => {
  const { page, exports, unlinks } = loadCrop();
  page.onLoad();
  page.results = [];
  page.queue = ['/tmp/a.jpg'];
  page.idx = 0;
  page.done = false;
  page.data.src = '/tmp/a.jpg';
  let left = 0;
  page.finish = () => { left += 1; };
  const { img, canvas } = canvasOf();
  page.drawAndExport(canvas, { sx: 0, sy: 0, sw: 40, sh: 40 });
  img.onload();
  exports[0].success({ tempFilePath: 'wxfile://kept.jpg' });
  assert.deepEqual(page.results, ['wxfile://kept.jpg']);
  assert.equal(left, 1);
  assert.deepEqual(unlinks, []);
});
