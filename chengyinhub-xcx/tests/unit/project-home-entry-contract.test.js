process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');

const PROJECT_HOME = /\/pages\/topic\/merchantinfo\/merchantinfo\?topicId=/;
const PLAYER_PAGE = /\/pages\/topic\/index\/index\?id=/;

/**
 * 项目主页(主办视图)的入口契约。
 *
 * 2026-08-05 实测:project-host 组件做完之后,全仓 grep `merchantinfo?topicId=` 零命中 ——
 * 页面做好了但没有任何地方能走到它,等于死码。这三条断点各修一次,这里钉死不许回退。
 *
 * 判据是「发布者要去的是哪儿」:topic/index 是**玩家买票页**,发布者在那儿看不到
 * 谁来接、谁带团、卖了多少。三个入口都必须指向项目主页。
 */
/* 2026-09-06 用户裁决「统一」:发布成功不再有按钮,面板自愈后直接跳。
 * 被保护的事实没变 —— 落点必须是项目主页(主办视图),不是玩家买票页。
 * 断言随之从「主按钮是 projectUrl」改成「面板收掉后跳的就是 projectUrl」。 */
test('发布成功后直接落项目主页,不是玩家买票页', () => {
  const js = read('pages/publish/fabu/index.js');
  assert.match(js, PROJECT_HOME, '发布成功后必须能落到项目主页');
  assert.match(js, /_resultSheetNext = projectUrl/, '落点就是它，不能换成别的页');
  assert.match(js, /if \(next\) wx\.redirectTo/, '面板收掉必须真的跳过去，不能只是关掉面板');
});

test('「我的项目」待接受邀请进入招商页，已承接与主办仍进项目主页', () => {
  const pagePath = path.resolve(__dirname, '../../subpackageA/pages/myproject/index.js');
  const previous = { wx: global.wx, getApp: global.getApp, Page: global.Page };
  const urls = [];
  let page;
  global.getApp = () => ({ globalData: {} });
  global.wx = { getStorageSync: () => '', navigateTo: options => urls.push(options.url) };
  global.Page = definition => { page = definition; };
  try {
    delete require.cache[require.resolve(pagePath)];
    require(pagePath);
    for (const [pending, state, key] of [[true, 'pending', 'id'], [false, 'running', 'topicId'], [undefined, 'pending', 'topicId']]) {
      page.onCardTap.call({ data: { operationScope: 'MERCHANT' } }, { currentTarget: { dataset: {
        item: { id: 9170200, bizType: 'topic', state, _pendingChapterInvite: pending }
      } } });
      assert.equal(urls.at(-1), '/pages/topic/merchantinfo/merchantinfo?' + key + '=9170200&scope=MERCHANT');
    }
  } finally {
    Object.assign(global, previous);
    delete require.cache[require.resolve(pagePath)];
  }
  // 活动详情已收成场景单一真源；主题去向变更不能把活动入口删掉或退回深链页。
  assert.match(read('subpackageA/pages/myproject/index.js'), /openScene\('play-activity-detail',\s*\{\s*id\s*\}\)/, '活动仍应进入活动详情场景');
});

// 原本这里还有第三条:商家工作台「我发布的主题」卡片。#516 重做工作台时把那个列表
// 整块删了(自己发布的主题统一从「我的项目」进),入口只剩上面两个,断言随之下掉。

// 2026-09-30用户裁决：导览台不放玩家预览，主办/承办标签与时间同一行。
// 发布编辑器现有预览与玩家详情方法仍保留，不能连带移除其他入口。
test('导览台保留主办标签，承接页移除重复承办标签且保留档期', () => {
  const host = read('pages/topic/components/project-host/index.wxml');
  const join = read('pages/topic/components/project-join/index.wxml');
  assert.doesNotMatch(host, /data-act="goTopicDetail"|预览玩家看到的|我发布的/);
  assert.match(host, /class="head-meta"[\s\S]*?hostTopic\.scheduleValue[\s\S]*?class="chip head-role">主办/);
  assert.match(join, /class="head-meta"[\s\S]*?scheduleValue/);
  assert.doesNotMatch(join, /class="chip head-role">承办/);
  // AUDIT-1122 L06-088:goTopicDetail 没有任何组件或 wxml 入口(project-host/join 都不发该 act),作为死方法删除
  assert.doesNotMatch(read('pages/topic/merchantinfo/merchantinfo.js'), PLAYER_PAGE);
  assert.match(read('pages/publish/fabu/index.js'), /_buildPublishPreview/,
    '发布编辑器预览不受导览台入口裁决影响');
});

// L09-127
// 卡片只带下标:点卡 / ··· 按 data-index(+ data-src=tpl)在当前列表里取行;一次成功加载只落一次 setData
test('L09-127 我的项目卡片按下标取行,加载结果一次落地', () => {
  const dir = path.resolve(__dirname, '../../subpackageA/pages/myproject/')
  const wxml = require('node:fs').readFileSync(path.join(dir, 'index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /data-item="\{\{item\}\}"/)
  assert.match(wxml, /wx:for="\{\{topicTemplates\}\}" wx:key="id" data-index="\{\{index\}\}" data-src="tpl"/)
  const pagePath = path.join(dir, 'index.js')
  const previous = { wx: global.wx, getApp: global.getApp, Page: global.Page }
  const urls = []
  let page
  global.getApp = () => ({ globalData: {} })
  global.wx = { getStorageSync: () => '', navigateTo: options => urls.push(options.url) }
  global.Page = definition => { page = definition }
  try {
    delete require.cache[require.resolve(pagePath)]
    require(pagePath)
    const ctx = { data: { operationScope: 'MERCHANT', list: [{ id: 1, bizType: 'topic', state: 'running' }, { id: 9170201, bizType: 'topic', state: 'pending', _pendingChapterInvite: true }], topicTemplates: [] } }
    page.onCardTap.call(ctx, { currentTarget: { dataset: { index: 1 } } })
    assert.equal(urls.at(-1), '/pages/topic/merchantinfo/merchantinfo?id=9170201&scope=MERCHANT')
    const writes = []
    const view = Object.assign({}, page, { data: { typeTab: 'topic', canPublishActivity: false }, _all: [{ id: 3, bizType: 'topic', isTemplate: false }],
      setData(p) { writes.push(Object.keys(p)); Object.assign(this.data, p) } })
    view.applyView({ topicTemplates: [], capped: false })
    const dataWrites = writes.filter(keys => !keys.every(k => /^pm/.test(k)))
    assert.equal(dataWrites.length, 1, '入场动效之外只有一次数据写入')
    for (const k of ['list', 'emptyTit', 'topicTemplates', 'loaded', 'projectState', 'capped']) assert.ok(dataWrites[0].includes(k), k)
  } finally { Object.assign(global, previous) }
})

// L09-127
// 抵消本页改动带来的分包增量:无任何标记引用的旧筛选条 / 汇总条 / 状态选择器样式已删
test('L09-127 我的项目样式不再保留无标记的旧筛选与汇总条', () => {
  const wxss = require('node:fs').readFileSync(path.resolve(__dirname, '../../subpackageA/pages/myproject/index.wxss'), 'utf8')
  assert.doesNotMatch(wxss, /\.mp-(filter|chip|summary|toolbar|state-btn|state-option|accept|badge|tit-row|create-row|tags-gap)\b/)
})
