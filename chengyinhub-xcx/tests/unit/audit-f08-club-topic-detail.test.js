'use strict'
// AUDIT-1122 lane F08:pages/club/topic-detail 与 topic-story 行为测试
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')

function loadPage(rel) {
  const requests = []
  let definition = null
  const storage = {}
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(o) { requests.push(o) },
    getUserID: () => 9008, getUserRole: () => 'CLUB', getUserType: () => 1,
  }
  const navs = []
  const base = {
    switchTab: (o) => navs.push(o.url), navigateBack: () => navs.push('__back__'),
    getStorageSync: (k) => storage[k] || '', setStorageSync: (k, v) => { storage[k] = v }, removeStorageSync: (k) => { delete storage[k] },
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }), getSystemInfoSync: () => ({}),
  }
  const wx = new Proxy(base, { get(t, k) { return k in t ? t[k] : () => {} } })
  global.wx = wx
  global.getApp = () => app
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
    getApp: () => app, Page: (config) => { definition = config }, wx, console, Date, setTimeout, clearTimeout, JSON, Math, Promise,
    getCurrentPages: () => [],
    require: (id) => require(path.resolve(ROOT, path.dirname(rel), id)),
  }, { filename: rel })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { page, requests, navs }
}

test('L08-037 结束主题网络失败 / 5xx:说「结果待确认」,不说「没能结束」;明确 4xx 才说没结束', () => {
  for (const [kind, expectPending] of [['fail', true], [502, true], [408, true], [403, false]]) {
    const { page, requests } = loadPage('pages/club/topic-detail/index.js')
    page._topicId = 88; page._clubId = 9; page._endCancellationEpoch = 1
    page.confirmEndTopic()
    const req = requests.find((r) => r.url === '/api/club/topic-setting/end')
    assert.ok(req, '发出结束请求')
    if (kind === 'fail') req.fail()
    else req.successStatusAbnormal({ code: kind, msg: '当前岗位没有这个权限' }, kind)
    if (expectPending) assert.match(page.data.endErrorText, /待确认/, String(kind))
    else assert.equal(page.data.endErrorText, '当前岗位没有这个权限')
    assert.equal(page.data.endSubmitting, false)
  }
})

test('L08-038 先看 A 关掉再看 B:A 的迟到答案不落进 B 的弹层', () => {
  const { page, requests } = loadPage('pages/club/topic-story/index.js')
  page.clubId = 9; page.topicId = 88
  page.onViewAnswer({ currentTarget: { dataset: { nodeId: 1, title: 'A 题' } } })
  page.closeAnswer()
  page.onViewAnswer({ currentTarget: { dataset: { nodeId: 2, title: 'B 题' } } })
  const [a, b] = requests.filter((r) => /node-answer/.test(r.url))
  b.success({ code: '200', data: { question: 'B?', answerReveal: '答案B' } })
  a.success({ code: '200', data: { question: 'A?', answerReveal: '答案A' } })
  assert.equal(page.data.answerNodeName, 'B 题')
  assert.equal(page.data.answer.answerReveal, '答案B')
})

test('L08-035 从剧情页回来不整页重拉;从场次运营回来照旧重拉(CU-C-80)', () => {
  const { page, requests } = loadPage('pages/club/topic-detail/index.js')
  page._topicId = 88; page._clubId = 9; page._hasShown = true
  Object.assign(page.data, { loaded: true, loadError: '', missingParam: false })
  let fetches = 0
  page.fetchDetail = () => { fetches += 1 }
  page.loadManageStats = () => {}
  page.goStory(); page.onHide(); page.onShow()
  assert.equal(fetches, 0)
  page.goEventOps(); page.onHide(); page.onShow()
  assert.equal(fetches, 1)
})

test('L08-053 剧情页缺参作为根页时「返回」走统一的 goBack 兜底', () => {
  const { page, navs } = loadPage('pages/club/topic-story/index.js')
  page.onLoad({})
  assert.equal(page.data.missingParam, true)
  page.onRetry()
  assert.deepEqual(navs, ['/pages/index/index'])
})

test('L08-043 七个状态的主键都有落点;快捷圆钮不再有禁用态', () => {
  const { page } = loadPage('pages/club/topic-detail/index.js')
  assert.ok(page.data.quickActions.every((a) => !('disabled' in a)))
  const calls = []
  page._topicId = 88; page._clubId = 9; page._directorActivityId = 501
  for (const m of ['goEditTopic', 'goSettlement', 'goScan', 'onPrepareSession', 'onStartSession', 'notReady']) page[m] = () => calls.push(m)
  for (const key of ['rejected', 'ended', 'selfrun', 'confirmed', 'preparing', 'running']) {
    page.data.statusKey = key; page.data.primary = { text: 'x', disabled: false }
    page.onPrimary()
  }
  assert.deepEqual(calls, ['goEditTopic', 'goSettlement', 'goScan', 'onPrepareSession', 'onStartSession'])
  assert.equal(page.data.directorEndConfirmShow, true)
})

test('L08-046 商家 / 主题设置半屏:重开后旧回包不覆盖新回包', () => {
  const { page, requests } = loadPage('pages/club/topic-detail/index.js')
  page._topicId = 88; page._clubId = 9
  page.openMerchants(); page.closeMerchants(); page.openMerchants()
  const [m1, m2] = requests.filter((r) => r.url === '/api/club/recruit/overview')
  m2.success({ code: 200, data: { nodes: [] } })
  m1.success({ code: 403, msg: '旧的拒绝' })
  assert.equal(page.data.merchantState, 'ready')
  page.openTopicSetting(); page.openTopicSetting()
  const [s1, s2] = requests.filter((r) => r.url === '/api/club/topic-setting/detail')
  s2.success({ code: 200, data: { topicName: '新' } })
  s1.fail({}, 500)
  assert.equal(page.data.settingState, 'ready')
  assert.equal(page.data.setting.topicName, '新')
})

test('L08-054 切章节只 setData 下标,不再把整章拷进 data', () => {
  const { page } = loadPage('pages/club/topic-story/index.js')
  const writes = []
  const orig = page.setData
  page.setData = function (p) { writes.push(Object.keys(p)); return orig.call(this, p) }
  page.data.chapters = [{ id: 1, title: '第一章', plays: [] }, { id: 2, title: '第二章', plays: [{ nodeId: 5 }] }]
  page.data.activeChapterIndex = 0
  page.onChapterChip({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.activeChapterIndex, 1)
  assert.ok(writes.every((keys) => !keys.includes('activeChapter') && !keys.includes('chapters')))
  assert.equal(page.data.chapters[page.data.activeChapterIndex].title, '第二章')
})

test('L08-041 异常队伍判据只有一份:排序与徽标同口径', () => {
  const adapter = require('../../pages/club/utils/club-game-director-adapter.js')
  for (const t of [{ status: 'blocked' }, { status: 'PAUSED' }, { status: 'ERROR' }, { blockedReason: '卡住' }, { issue: 'x' }, { blocked: true }]) {
    assert.equal(adapter.isAbnormalTeam(t), true, JSON.stringify(t))
  }
  assert.equal(adapter.isAbnormalTeam({ status: 'RUNNING' }), false)
  assert.equal(adapter.numberOrNull('3'), null)
  assert.equal(adapter.numberOrNull(3), 3)
})
