// 2026-11-23:章节开场白 / 结语(cap:open / cap:end,编辑器里固定在本章首尾的两张卡)玩家从来看不到 ——
// 故事流整块跳过,注释说「给章节开始 / 结束弹窗读」,但没有任何弹窗读它们。19 条城市路线里 16 条把
// 铺垫和结局(含整条路线的最终结局)写在这两张卡里。现在按普通正文段落铺进故事流:
//   open 在本章正文最前;end 接在流末尾,且只在本章各站都完成后出现(不提前剧透);末章的收尾先读完再进通关。
const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')

const PLAY = '../../pages/play/index.js'
const { hasTrailingContent, hasReadableStory, trailState } = require('../../pages/play/utils/chapter-trail.js')

let pageConfig

global.getApp = () => ({ globalData: {}, getUserID: () => 1, sendRequest: () => {} })
global.wx = {
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  getMenuButtonBoundingClientRect: () => ({ top: 20, height: 32 }),
  getStorageSync: () => null, setStorageSync: () => {}, removeStorageSync: () => {},
  showToast: () => {},
  getSetting: ({ success }) => success({ authSetting: {} }),
  createSelectorQuery: () => ({
    selectAll: () => ({ boundingClientRect: () => {} }),
    select: () => ({ boundingClientRect: () => {}, scrollOffset: () => {} }),
    exec: () => {},
  }),
  createInnerAudioContext: () => ({ play() {}, pause() {}, stop() {}, destroy() {},
    onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {}, onWaiting() {}, onCanplay() {} }),
}
global.Page = config => { pageConfig = config }

function setAtPath(target, rawPath, value) {
  const parts = rawPath.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function makePage(chapter, nodes) {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.data.chapter = chapter
  page.data.nodes = nodes || []
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(key => setAtPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  page.measureChapter = () => {}
  return page
}

beforeEach(() => {
  pageConfig = null
  delete require.cache[require.resolve(PLAY)]
  require(PLAY)
})

const blocks = () => [
  { key: 'cap-open', type: 'cap', cap: 'open', content: '雨刚停。\n石板路上还有积水。' },
  { type: 'text', content: '她推开咖啡馆的门。' },
  { type: 'node', nodeId: 51 },
  { type: 'text', content: '第一站之后。' },
  { type: 'node', nodeId: 52 },
  { key: 'cap-end', type: 'cap', cap: 'end', content: '门铃响了一声,{name|她}没有回头。' },
]
const texts = page => page.data.chapterParas.filter(p => p.kind === 'text').map(p => p.text)

test('开场白铺在本章正文最前面,按换行拆成普通段落,与 .chfull__para 一一对应', () => {
  const page = makePage({ blocks: blocks() }, [{ nodeId: 51, done: false }, { nodeId: 52, done: false }])
  page.openChapterFull()
  assert.deepEqual(texts(page), ['雨刚停。', '石板路上还有积水。', '她推开咖啡馆的门。'])
  assert.deepEqual(page.data.chapterParas.map(p => p.i), page.data.chapterParas.map((p, i) => i), '下标连续:items 与 .chfull__para 1:1')
  assert.ok(page.data.chapterParas.slice(0, 3).every(p => p.kind === 'text'), '开场白就是普通正文段(同一个渲染分支,不加新样式)')
})

test('开场白不排在第一块时也铺在第一段正文之前(封面之后)', () => {
  const page = makePage({ cover: 'https://x/cover.jpg', blocks: [
    { type: 'text', content: '正文第一段。' },
    { type: 'cap', cap: 'open', content: '开场白。' },
  ] }, [])
  page.openChapterFull()
  assert.deepEqual(page.data.chapterParas.map(p => p.kind), ['cover', 'text', 'text'])
  assert.deepEqual(texts(page), ['开场白。', '正文第一段。'])
})

test('结语在本章还有站没完成时不出现(不提前剧透结局)', () => {
  const none = makePage({ blocks: blocks() }, [{ nodeId: 51, done: false }, { nodeId: 52, done: false }])
  none.openChapterFull()
  assert.equal(texts(none).some(t => t.indexOf('门铃') >= 0), false)

  const half = makePage({ blocks: blocks() }, [{ nodeId: 51, done: true }, { nodeId: 52, done: false }])
  half.openChapterFull()
  assert.deepEqual(texts(half), ['雨刚停。', '石板路上还有积水。', '她推开咖啡馆的门。', '第一站之后。'])

  // 结语被排在前面(非编辑器产物)也一样:不能因为位置靠前就提前露出来
  const early = makePage({ blocks: [{ type: 'cap', cap: 'end', content: '结局。' }, { type: 'text', content: '正文。' }, { type: 'node', nodeId: 51 }] },
    [{ nodeId: 51, done: false }])
  early.openChapterFull()
  assert.deepEqual(texts(early), ['正文。'])
})

test('本章各站都完成后,结语作为普通段落接在最后一站之后;故事变量照常替换', () => {
  const page = makePage({ blocks: blocks() }, [{ nodeId: 51, done: true }, { nodeId: 52, done: true }])
  page._storyVars = { name: '阿青' }
  page.openChapterFull()
  assert.deepEqual(texts(page), ['雨刚停。', '石板路上还有积水。', '她推开咖啡馆的门。', '第一站之后。', '门铃响了一声,阿青没有回头。'])
  const last = page.data.chapterParas[page.data.chapterParas.length - 1]
  assert.equal(last.kind, 'text', '结语是流里最后一段:章末「继续探索」按钮排在它后面')

  const early = makePage({ blocks: [{ type: 'cap', cap: 'end', content: '结局。' }, { type: 'text', content: '正文。' }, { type: 'node', nodeId: 51 }] },
    [{ nodeId: 51, done: true, story: '手记。' }])
  early.openChapterFull()
  assert.deepEqual(texts(early), ['正文。', '手记。', '结局。'], '结语永远在最后一站之后')
})

test('没有站点的章节:开场白在前、结语在后,直接可读', () => {
  const page = makePage({ blocks: [
    { type: 'cap', cap: 'open', content: '开场。' }, { type: 'text', content: '正文。' }, { type: 'cap', cap: 'end', content: '结语。' },
  ] }, [])
  page.openChapterFull()
  assert.deepEqual(texts(page), ['开场。', '正文。', '结语。'])
})

test('条件卡(when):服务端没下发的不出现;空内容不占段', () => {
  // 真玩家拿到的块流已由服务端按本局标签筛过(ChapterBlockReadSupport.projectForPlayer 对任何带 when 的块生效)——
  // 没满足条件的 cap 根本不在 blocks 里;下发了的带 when 的 cap 不带「只给谁看」标签。
  const filtered = makePage({ blocks: [{ type: 'text', content: '正文。' }, { type: 'node', nodeId: 51 }] }, [{ nodeId: 51, done: true }])
  filtered.openChapterFull()
  assert.deepEqual(texts(filtered), ['正文。'])

  const passed = makePage({ blocks: [
    { type: 'cap', cap: 'open', content: '只给选了左边的人。', when: { op: 'has', value: 'left' }, condLabel: '选了左边' },
    { type: 'cap', cap: 'open', content: '   ' },
    { type: 'node', nodeId: 51 },
    { type: 'cap', cap: 'end', content: '左边的结局。', when: { op: 'has', value: 'left' }, condLabel: '选了左边' },
  ] }, [{ nodeId: 51, done: true }])
  passed.openChapterFull()
  assert.deepEqual(texts(passed), ['只给选了左边的人。', '左边的结局。'])
  assert.ok(passed.data.chapterParas.every(p => !p.cond), '真玩家不出条件标签')
})

test('试玩(isPreview):开场白 / 结语同样出现,带条件的标出「只给谁看」', () => {
  const page = makePage({ blocks: [
    { type: 'cap', cap: 'open', content: '开场白。\n第二行。', when: { op: 'has', value: 'left' }, condLabel: '选了左边' },
    { type: 'text', content: '正文。' },
    { type: 'node', nodeId: 51 },
    { type: 'cap', cap: 'end', content: '结语。', when: { op: 'has', value: 'left' } },
  ] }, [{ nodeId: 51, done: false }])
  page.data.isPreview = true
  page.openChapterFull()
  assert.deepEqual(texts(page), ['开场白。', '第二行。', '正文。'], '试玩里没走完的站之后同样不剧透')
  assert.deepEqual(page.data.chapterParas.filter(p => p.kind === 'text').map(p => p.cond), ['选了左边', '', ''], '条件标签只标首段,同正文块')

  page.data.nodes = [{ nodeId: 51, done: true }]
  page.openChapterFull()
  const paras = page.data.chapterParas.filter(p => p.kind === 'text')
  assert.deepEqual(paras.map(p => p.text), ['开场白。', '第二行。', '正文。', '结语。'])
  assert.equal(paras[3].cond, '有条件才看到')
})

test('只读回看(走完后回读):开场白与结语都在', () => {
  const page = makePage({ id: 7, blocks: blocks() }, [{ nodeId: 51, done: true }, { nodeId: 52, done: true }])
  page._chapterReadCursor = { id: 7 }
  page.openChapterFull()
  assert.equal(texts(page)[0], '雨刚停。')
  assert.match(texts(page).pop(), /^门铃响了一声/)
})

test('换章 / 回看判定:结语算本章收尾,只有 cap 的章节也算有故事可读', () => {
  assert.equal(hasTrailingContent([{ type: 'node', nodeId: 1 }, { type: 'cap', cap: 'end', content: '结语。' }]), true)
  assert.equal(hasTrailingContent([{ type: 'cap', cap: 'end', content: '结语。' }, { type: 'node', nodeId: 1 }]), true, '结语不论排在哪都接在流末尾')
  assert.equal(hasTrailingContent([{ type: 'cap', cap: 'open', content: '开场。' }, { type: 'node', nodeId: 1 }]), false, '开场白在站点之前,不是收尾')
  assert.equal(hasTrailingContent([{ type: 'node', nodeId: 1 }, { type: 'cap', cap: 'end', content: '  ' }]), false)
  assert.equal(hasReadableStory([{ type: 'cap', cap: 'open', content: '开场。' }, { type: 'node', nodeId: 1 }]), true)
  const card = { id: 44, blocks: [{ type: 'node', nodeId: 75 }, { type: 'cap', cap: 'end', content: '结语。' }] }
  assert.equal(trailState(card, [{ nodeId: 75, done: true }], {}, ['75']), 'hold', '中间章:先读完结语再换下一章(P-29 同一条)')
})

// ── 末章:结语要在通关页之前读到 ──
function finishPage(cardBlocks, doneAtLoad) {
  const nodes = [{ nodeId: 51, chapterId: 9, done: true }]
  const page = makePage({ id: 9, blocks: cardBlocks }, nodes)
  page.data.mode = 1
  page.data.allDone = true
  page.data.chapterCards = [{ id: 9, title: '终章', blocks: cardBlocks }]
  page._trailDoneAtLoad = doneAtLoad
  page._startStoryDust = () => {}
  page._endTeamTrail = () => {}
  page._endRunSession = () => {}
  page.finishOpened = 0
  page._loadLifeEnding = () => { page.finishOpened += 1 }   // openFinish 过了收尾这道闸就会走到这里
  return page
}
const finalBlocks = [{ type: 'text', content: '终章正文。' }, { type: 'node', nodeId: 51 }, { type: 'cap', cap: 'end', content: '整条路线的结局。' }]

test('末章最后一站完成:先在故事流里铺出结语,点章末「继续探索」才进通关,读过不再拦', () => {
  const page = finishPage(finalBlocks, ['51'])
  page.openFinish()
  assert.equal(page.finishOpened, 0, '结语还没读:通关页先不出')
  assert.equal(page.data.chapterFull, true)
  assert.deepEqual(texts(page), ['终章正文。', '整条路线的结局。'])
  assert.equal(page.data.chapterParas[page.data.chapterParas.length - 1].text, '整条路线的结局。')

  page.closeChapterFull = () => { page.data.chapterFull = false }
  page.continueChapterStory()
  assert.equal(page.finishOpened, 1, '读完点继续:接着进通关')
  assert.equal(page._chapterTrailRead['9'], true)
  assert.equal(page._holdFinishForTrail(), false, '读过的结语不再拦通关')
})

test('末章结语还没到手(块流是最后一站完成前拉的):等同页重拉带来结语;拿不到也不挡通关', () => {
  const truncated = finalBlocks.slice(0, 2)   // 服务端只下发到第一个未完成的站
  const page = finishPage(truncated, [])
  const timers = []
  const realSetTimeout = global.setTimeout
  global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length }
  try {
    page.openFinish()
    assert.equal(page.finishOpened, 0, '先等重拉,不抢在结语前面出通关页')
    assert.ok(page._finishTrailWait)
    // 重拉到手:章节卡换成完整块流,rebuild 再叫一次 openFinish
    page.data.chapterCards = [{ id: 9, title: '终章', blocks: finalBlocks }]
    page._trailDoneAtLoad = ['51']
    page.openFinish()
    assert.equal(page.finishOpened, 0)
    assert.equal(page._finishTrailWait, null)
    assert.match(texts(page).pop(), /整条路线的结局/)

    // 另一局:重拉一直没回来,到点照常通关
    const stuck = finishPage(truncated, [])
    timers.length = 0
    stuck.openFinish()
    assert.equal(stuck.finishOpened, 0)
    timers.filter(t => t.ms === 6000).forEach(t => t.fn())
    assert.equal(stuck.finishOpened, 1, '等不到就放行,不把玩家卡在通关前')
  } finally { global.setTimeout = realSetTimeout }
})

test('没有收尾的末章、试玩、自由探索:通关照旧,不多拦一步', () => {
  const plain = finishPage([{ type: 'text', content: '正文。' }, { type: 'node', nodeId: 51 }], ['51'])
  plain.openFinish()
  assert.equal(plain.finishOpened, 1)

  const shop = finishPage(finalBlocks, ['51'])
  shop.data.mode = 2
  assert.equal(shop._holdFinishForTrail(), false)
  const preview = finishPage(finalBlocks, ['51'])
  preview.data.isPreview = true
  assert.equal(preview._holdFinishForTrail(), false)

  const unfinished = finishPage(finalBlocks, [])
  unfinished.data.nodes[0].done = false   // 长按提前结束这一局:站没走完,不露结局
  assert.equal(unfinished._holdFinishForTrail(), false)
})
