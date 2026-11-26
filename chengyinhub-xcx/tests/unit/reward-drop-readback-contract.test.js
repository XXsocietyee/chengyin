const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const WALL_PATH = require.resolve('../../subpackageP3/pages/badge-wall/index/index.js');
let wallDef;
{
  const prevPage = global.Page;
  const prevApp = global.getApp;
  const prevWx = global.wx;
  global.Page = (options) => { wallDef = options; };
  global.getApp = () => ({ globalData: {} });
  global.wx = { getWindowInfo: () => ({}), getSystemInfoSync: () => ({}) };
  delete require.cache[WALL_PATH];
  require(WALL_PATH);
  global.Page = prevPage;
  global.getApp = prevApp;
  global.wx = prevWx;
}

function createWall(focusCode) {
  const page = Object.assign({}, wallDef, {
    data: JSON.parse(JSON.stringify(wallDef.data)),
    setData(update, cb) { Object.assign(this.data, update); if (cb) cb(); },
  });
  page._focusCode = focusCode;
  return page;
}

// ── 奖励掉落卡:留住服务端稳定 ID,不用 toast ────────────────
test('★徽章掉落必须留住 badgeCode，并给出查看收藏 + 继续两条路', () => {
  const js = read('pages/play/index.js');
  const wxml = read('pages/play/index.wxml');

  const hunk = js.slice(js.indexOf('const newBadges'), js.indexOf('const newBadges') + 700);
  assert.match(hunk, /code: b\.code/, 'badgeCode 是刷新用的稳定 ID，映射时不能丢');
  assert.doesNotMatch(hunk, /this\.diegetic\('解锁徽章/,
    '奖励落位不能只是一句 toast —— 一闪而过就没有刷新入口了');

  assert.match(wxml, /bindtap="openRewardCollection"/);
  assert.match(wxml, /bindtap="closeRewardDrop"/);
  assert.match(js, /openRewardCollection\(\)/);
});

test('查看收藏跳的是注册过的徽章墙路由，并带上 badgeCode', () => {
  const js = read('pages/play/index.js');
  const appJson = JSON.parse(read('app.json'));
  assert.match(js, /badgeCode=' \+ encodeURIComponent/);

  const target = 'pages/badge-wall/index/index';
  const registered = (appJson.subPackages || appJson.subpackages || [])
    .some((pkg) => (pkg.pages || []).includes(target));
  assert.ok(registered, '徽章墙必须是 app.json 注册过的页面，否则这个入口点了就是死的');
});

// ── 徽章墙侧:真的去墙上找那枚徽章 ────────────────────────
// L09-049 / L09-132
// 业主默认:回读结论不再是一行字(那行字只在已删除的墙面模式里显示过),而是滚到那一枚并高亮。
// 已点亮 / 未点亮都定位到它;不在本页(成长六枚等非身份卡)就不定位,也不断言「没发」。
test('★找得到 ⇒ 记下它在列表里的位置(点亮与否都定位)', () => {
  for (const locked of [false, true]) {
    const wall = createWall('FIRST_STEP');
    wall._resolveFocus([{ code: 'TOPIC_CLEAR', name: '完成一程', locked: false }, { code: 'FIRST_STEP', name: '第一步', locked }]);
    assert.equal(wall._focusIdx, 1);
  }
});

test('★不在本页 ⇒ 不定位、不出任何文字', () => {
  const wall = createWall('STREAK_3');
  wall._resolveFocus([{ code: 'TOPIC_CLEAR', name: '完成一程', locked: false }]);
  assert.equal(wall._focusIdx, -1);
  assert.equal('focusText' in wall.data, false);
});

test('没带 badgeCode 进来时不定位', () => {
  const wall = createWall('');
  wall._resolveFocus([{ code: 'FIRST_STEP', name: '第一步', locked: false }]);
  assert.equal(wall._focusIdx, -1);
});

test('★两个 mapper 都必须保留 badgeCode —— 丢了就没法按 ID 回读', () => {
  const js = read('subpackageP3/pages/badge-wall/index/index.js');
  const identity = js.slice(js.indexOf('function itemToBadge'), js.indexOf('function medalToBadge'));
  assert.match(identity, /code: item\.badgeCode/);
  const medal = js.slice(js.indexOf('function medalToBadge'));
  assert.match(medal.slice(0, 600), /code: item\.badgeCode/);
});

// L09-049
// 业主默认 A:列表模式自动滚到带进来的那一枚并短暂高亮;找不到不滚、不加说明文字
test('L09-049 列表里滚到 badgeCode 那一枚并短暂高亮,只做一次', () => {
  const timers = [];
  const prevSet = global.setTimeout;
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  try {
    const wall = createWall('SECOND');
    wall._renderPins = () => {};
    wall.applyBadges([{ code: 'FIRST', name: 'A', locked: false }, { code: 'SECOND', name: 'B', locked: true }]);
    assert.equal(wall.data.focusCell, 'bw-cell-1');
    assert.equal(wall.data.focusIdx, 1);
    const hl = timers.find((t) => t.ms === 1600);
    assert.ok(hl, '高亮 1.6 秒后撤掉');
    hl.fn();
    assert.equal(wall.data.focusIdx, -1);
    wall.data.focusCell = '';
    wall.applyBadges([{ code: 'FIRST', name: 'A', locked: false }, { code: 'SECOND', name: 'B', locked: false }]);
    assert.equal(wall.data.focusCell, '', '刷新不再重滚');
    const miss = createWall('NOT_HERE');
    miss._renderPins = () => {};
    miss.applyBadges([{ code: 'FIRST', name: 'A', locked: false }]);
    assert.equal(miss.data.focusCell, '');
    assert.equal(miss.data.focusIdx, -1);
  } finally { global.setTimeout = prevSet; }
  const wxml = read('subpackageP3/pages/badge-wall/index/index.wxml');
  assert.match(wxml, /<scroll-view class="bw-list" scroll-y scroll-into-view="\{\{focusCell\}\}"/);
  assert.match(wxml, /<view class="bw-cell" id="bw-cell-\{\{item\._idx\}\}"/);
  assert.match(wxml, /\{\{focusIdx === item\._idx \? 'is-focus' : ''\}\}/);
});
