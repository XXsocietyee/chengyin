// P-09 / P-10:猜数字要显示题干,交过之后要有一行结果与作者揭示;交之前客户端拿不到真值。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js');

function loadEstimate() {
  let def = null;
  const prev = global.Component, prevB = global.Behavior, prevWx = global.wx;
  global.Component = (d) => { def = d; };
  global.Behavior = (d) => d;
  if (!global.wx) global.wx = { getSystemInfoSync: () => ({}), getAppBaseInfo: () => ({}) };
  try {
    delete require.cache[require.resolve('../../pages/playkit/components/playkit-estimate/index.js')];
    require('../../pages/playkit/components/playkit-estimate/index.js');
  } finally { global.Component = prev; global.Behavior = prevB; global.wx = prevWx; }
  return def;
}

test('题干从服务端 question 透传成 title;交之前没有真值与揭示', () => {
  const kit = pickPlayKit({ sessionId: 's1', version: 1, playKit: { estimate: {
    question: '海关大楼钟面的直径大约有几米？', unit: '米', min: 1, max: 20, submitted: false, tier: '' } } }, new Date());
  assert.equal(kit.type, 'estimate');
  assert.equal(kit.title, '海关大楼钟面的直径大约有几米？');
  assert.equal(kit.submitted, false);
  assert.equal(kit.reveal, '');
  assert.equal(kit.answer, 0);
});

test('交过之后:估数、真值、揭示透传', () => {
  const kit = pickPlayKit({ sessionId: 's1', version: 2, playKit: { estimate: {
    question: 'Q', unit: '米', min: 1, max: 20, submitted: true, tier: 'MISS', guess: 6, answer: 5.4, reveal: '约 5.4 米。' } } }, new Date());
  assert.equal(kit.submitted, true);
  assert.equal(kit.tier, 'MISS');
  assert.equal(kit.guess, 6);
  assert.equal(kit.answer, 5.4);
  assert.equal(kit.reveal, '约 5.4 米。');
});

test('结果一行:中 / 差一点 / 差得远,带差多少', () => {
  const line = loadEstimate().methods._resultLine;
  assert.equal(line({ submitted: false, tier: '' }), null);
  assert.deepEqual(line({ submitted: true, tier: 'MISS', guess: 6, answer: 5.4, unit: '米', reveal: ' 约 5.4 米。 ' }),
    { head: '差得有点远', detail: '你猜 6 米 · 实际 5.4 米 · 差 0.6 米', reveal: '约 5.4 米。', miss: true });
  assert.equal(line({ submitted: true, tier: 'CLOSE', guess: 6, answer: 5.4, unit: '米' }).head, '差一点');
  const hit = line({ submitted: true, tier: 'HIT', guess: 5, answer: 5, unit: '米' });
  assert.equal(hit.head, '猜中了');
  assert.equal(hit.detail, '正好 5 米');
  assert.equal(hit.miss, false);
});

test('playkit 容器把结果字段接到猜数字组件', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit/index.wxml'), 'utf8');
  assert.match(wxml, /submitted="\{\{kit\.submitted\}\}" tier="\{\{kit\.tier\}\}" guess="\{\{kit\.guess\}\}" answer="\{\{kit\.answer\}\}" reveal="\{\{kit\.reveal\}\}"/);
  const own = fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit-estimate/index.wxml'), 'utf8');
  assert.match(own, /\{\{result\.head\}\}/);
  assert.match(own, /\{\{title\}\}/);
});

// P-09 第三轮(业主):题干在深色上要看得清;结果行不能压在屏幕下沿被截掉。
test('P-09 第三轮:内嵌玩法块的上内边距至少到故事流顶部渐隐结束处', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/play/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(__dirname, '../../pages/play/index.wxss'), 'utf8')
  // AUDIT-1122 L01-043(业主 2026-11-24 默认 A):硬裁切由滚动区 mask 改为滚动区上方不随滚动的底色遮罩,高度同一条裁切线
  assert.match(wxss, /\.chfull__cap\{ position:absolute; left:0; right:0; top:0; height:var\(--chfull-fade-end\); background:#000; pointer-events:none; \}/, '顶部工具区硬裁切，不让半透明正文穿过按钮');
  assert.match(wxml, /<\/scroll-view>\n    <view class="chfull__cap" aria-hidden="true"><\/view>/)
  assert.ok(wxml.includes('--chfull-fade-end:max(340rpx, calc({{chrome.contentTop}}px + var(--cy-btn-h) + var(--cy-space-4)))'), '裁切线随原生顶栏安全位置下移');
  // V3-10/53(2026-11-06 业主「只是把之前的全屏缩小了」):块不再垫一屏高的上内边距,
  // 让位改由块内锚点承担 —— 对准锚点时题干仍落在渐隐结束处之下
  // AUDIT-1122 L01-127:锚点收进模板 chfullKitAnchor,两种章节块各用一次
  const anchors = wxml.match(/class="chfull__kit-anchor" id="[^"]*" style="[^"]*"/g)
  assert.equal(anchors.length, 1)
  assert.equal((wxml.match(/<template is="chfullKitAnchor" data="\{\{item, chrome\}\}" \/>/g) || []).length, 2)
  anchors.forEach((k) => assert.match(k, /top:calc\(0px - max\(var\(--chfull-fade-end\), calc\(/))
})

test('P-09 第三轮:交过之后滚筒收矮,只留中间那个数', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const dir = path.join(__dirname, '../../pages/playkit/components/playkit-estimate')
  assert.match(fs.readFileSync(path.join(dir, 'index.wxml'), 'utf8'), /<view class="g-col es \{\{result \? 'es--done' : ''\}\}">/)
  const css = fs.readFileSync(path.join(dir, 'index.wxss'), 'utf8')
  const done = Number(css.match(/\.es--done \.es__reel \{ height: (\d+)rpx; \}/)[1])
  const lane = Number(css.match(/\.es__lane--mid \{[^}]*height: (\d+)rpx;/)[1])
  assert.ok(done >= lane && done < 980, '收矮后放得下中间一格、又比原来的 980rpx 矮')
  // 故事流内嵌时上内边距变大(避开渐隐),滚筒同时矮 120rpx,「就这个数」不被挤出一屏
  assert.match(css, /height: var\(--pk-es-reel-h, 980rpx\);/)
  // AUDIT-1122 L01-131:变量从内联 style 收进 .chfull__kit 规则(同一元素、同一取值)
  const page = fs.readFileSync(path.join(__dirname, '../../pages/play/index.wxml'), 'utf8')
  const pageCss = fs.readFileSync(path.join(__dirname, '../../pages/play/index.wxss'), 'utf8')
  // AUDIT-1122 L01-131:内嵌玩法块的静态变量收成类(取值不变)
  assert.match(page, /item\.kind === 'kit'\}\}" class="chfull__kit kit-tapsurface" catchtap="onKitAreaTap" hover-class="none">/)
  assert.match(pageCss, /\.chfull__kit\{ --pk-es-reel-h:860rpx; --pk-es-q-display:none; \}/)
})

// 2026-11-24 业主:猜数字猜错可接着猜(与排序 / 连线 / 分类同口径)。
function fakeEstimate(def, stageLog) {
  const ctx = {
    data: Object.assign({}, def.data, { reducedMotion: false, guess: 0 }),
    setData(patch) { Object.assign(this.data, patch); },
    selectComponent: () => ({ nudge: () => stageLog.push('nudge'), win: (t) => stageLog.push('win:' + t), begin() {} }),
    triggerEvent: (name, detail) => stageLog.push('event:' + name + ':' + JSON.stringify(detail)),
  };
  Object.assign(ctx, def.methods);
  return ctx;
}
const RECEIPT = 'submitted, tier, guess, answer, reveal, unit, attempts';

test('猜错还能接着猜:红字回执 + 淡红闪,滚筒与「就这个数」不锁', () => {
  const def = loadEstimate();
  const log = [];
  const c = fakeEstimate(def, log);
  def.observers['show, min, max'].call(c, true, 0, 1000);
  c._paint(500); c._index = 500;
  c.onSubmit();
  def.observers[RECEIPT].call(c, false, 'CLOSE', 600, 0, '', '颗', 1);
  assert.deepEqual(c.data.retry, { head: '差一点', miss: true });
  assert.equal(c.data.result, null);
  assert.equal(c.data.locked, false, '还能接着猜');
  assert.equal(c.data.hit, false);
  assert.equal(c.data.used, 1);
  assert.deepEqual(log.filter((x) => x === 'nudge'), ['nudge']);
  // 再交一次:按钮仍发出 submit
  log.length = 0;
  c.onSubmit();
  assert.ok(log.some((x) => x.startsWith('event:submit:')), '锁住了就交不出第二次');
  def.observers[RECEIPT].call(c, false, 'MISS', 900, 0, '', '颗', 2);
  assert.equal(c.data.retry.head, '差得有点远');
  assert.equal(log.filter((x) => x === 'nudge').length, 1);
});

test('猜中:台面「通过」判定屏 + 整屏点一下继续,不闪红', () => {
  const def = loadEstimate();
  const log = [];
  const c = fakeEstimate(def, log);
  def.observers['show, min, max'].call(c, true, 0, 1000);
  c._index = 480;
  c.onSubmit();
  def.observers[RECEIPT].call(c, true, 'HIT', 480, 480, '一共 480 颗', '颗', 3);
  assert.equal(c.data.hit, true);
  assert.equal(c.data.locked, true);
  assert.equal(c.data.retry, null);
  assert.equal(c.data.used, 2, '猜中的那一次不算失手');
  assert.ok(log.includes('win:正好 480 颗'));
  assert.ok(!log.includes('nudge'));
});

test('重进页面带着旧回执:不闪、不弹判定屏', () => {
  const def = loadEstimate();
  const log = [];
  const c = fakeEstimate(def, log);
  def.observers[RECEIPT].call(c, false, 'MISS', 900, 0, '', '', 2);
  assert.equal(c.data.retry.head, '差得有点远');
  assert.deepEqual(log, []);
});

test('次数用完:收摊结果行 + 锁住;只有 maxTries>0 才给台面次数', () => {
  const def = loadEstimate();
  const c = fakeEstimate(def, []);
  def.observers[RECEIPT].call(c, true, 'MISS', 900, 480, '', '颗', 2);
  assert.equal(c.data.locked, true);
  assert.equal(c.data.result.miss, true);
  assert.equal(c.data.retry, null);
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit-estimate/index.wxml'), 'utf8');
  assert.match(wxml, /tries="\{\{maxTries\}\}" used="\{\{used\}\}" done-tap="\{\{hit\}\}"/);
  assert.match(wxml, /wx:elif="\{\{retry\}\}"/);
  const host = fs.readFileSync(path.join(__dirname, '../../pages/playkit/components/playkit/index.wxml'), 'utf8');
  assert.match(host, /attempts="\{\{kit\.attempts\}\}" limit-seconds="\{\{kit\.limitSeconds\}\}" max-tries="\{\{kit\.maxTries\}\}"/);
});

test('视图:maxTries / attempts / 上一次估数透传;没收摊不给真值', () => {
  const kit = pickPlayKit({ sessionId: 's1', version: 3, playKit: { estimate: {
    question: 'Q', unit: '颗', min: 0, max: 1000, maxTries: 3, attempts: 1, submitted: false, tier: 'CLOSE', guess: 600 } } }, new Date());
  assert.equal(kit.maxTries, 3);
  assert.equal(kit.attempts, 1);
  assert.equal(kit.guess, 600);
  assert.equal(kit.answer, 0);
  assert.equal(kit.reveal, '');
  const unlimited = pickPlayKit({ sessionId: 's1', version: 4, playKit: { estimate: {
    question: 'Q', min: 0, max: 10, maxTries: 0, attempts: 0, submitted: false, tier: '' } } }, new Date());
  assert.equal(unlimited.maxTries, 0);
  assert.equal(unlimited.attempts, 0);
});
