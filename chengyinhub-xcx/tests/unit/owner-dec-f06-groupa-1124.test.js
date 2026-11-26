// 2026-11-24 业主决策 F06 A 组:按默认选项落地(L06-042 / L06-151 / L06-135 / L06-058 / L06-170)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function setByPath(target, keyPath, value) {
  // 同真机 setData:支持 a.b 与 a[0].b 路径
  const parts = []
  for (const m of keyPath.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) parts.push(m[2] !== undefined ? Number(m[2]) : m[1])
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(rel, app, wx, pages) {
  let config = null
  global.getApp = () => app
  global.wx = wx
  global.getCurrentPages = () => pages || [{}]
  global.Page = (value) => { config = value }
  const abs = path.join(ROOT, rel)
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(ROOT) && !key.includes('node_modules')) delete require.cache[key]
  })
  require(abs)
  const page = Object.assign({}, config)
  page.data = JSON.parse(JSON.stringify(config.data))
  page.setData = function (patch, callback) {
    Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
    if (callback) callback()
  }
  return page
}

// ── L06-042 分享直入结算页:返回 / 门卡兜底回本场活动详情 ─────────────────────
function baomingHarness(stackDepth) {
  const navigation = []
  const app = {
    globalData: { user_id: 9, features: {} },
    getUserID: () => 9,
    isDevEnv: () => false,
    tips() {},
    sendRequest() { return { abort() {} } },
  }
  const wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showToast() {},
    showModal() {},
    navigateBack(options) { navigation.push({ type: 'back' }); if (options && options.fail) options.fail() },
    redirectTo(options) { navigation.push({ type: 'redirect', url: options.url }) },
    navigateTo(options) { navigation.push({ type: 'navigate', url: options.url }) },
  }
  const page = loadPage('pages/activity/baoming/baoming.js', app, wx,
    Array.from({ length: stackDepth }, () => ({})))
  return { page, navigation }
}

test('L06-042 深链直入结算页(无上一页)点返回:回这场活动的详情,不去官方活动列表', () => {
  const { page, navigation } = baomingHarness(1)
  page.setData({ activityId: '77' })
  page.onNavBack()
  assert.deepEqual(navigation, [{ type: 'redirect', url: '/pages/activity/detail/index?id=77' }])
})

test('L06-042 返回失败兜底、门卡无俱乐部时的出口也回本场活动详情', () => {
  const { page, navigation } = baomingHarness(2)
  page.setData({ activityId: '77', gateClubId: null })
  page.onNavBack()
  page.goGateClub()
  assert.deepEqual(navigation, [
    { type: 'back' },
    { type: 'redirect', url: '/pages/activity/detail/index?id=77' },
    { type: 'redirect', url: '/pages/activity/detail/index?id=77' },
  ])
})

test('L06-042 缺 activityId 无从回详情时才去活动列表;门卡有俱乐部仍去俱乐部', () => {
  const { page, navigation } = baomingHarness(1)
  page.setData({ activityId: null, gateClubId: 5 })
  page.onNavBack()
  page.goGateClub()
  assert.deepEqual(navigation, [
    { type: 'redirect', url: '/pages/activity/list/index' },
    { type: 'navigate', url: '/pages/club/detail/index?id=5' },
  ])
})

// ── L06-151 官方活动四页:静态底按玩家深色(黑底白字),商家视角运行时切浅 ──────────
const OFFICIAL_PAGES = ['list', 'official-inbox', 'official-mine', 'official-organizer']

test('L06-151 官方活动四页 json 底色黑、状态栏白字(下拉/回弹不再露浅灰)', () => {
  OFFICIAL_PAGES.forEach((name) => {
    const json = JSON.parse(read(`pages/activity/${name}/index.json`))
    assert.equal(json.backgroundColor, '#000000', name)
    assert.equal(json.navigationBarTextStyle, 'white', name)
  })
})

test('L06-151 身份翻转三页:商家视角仍在 onShow 切浅色原生底,玩家视角恢复深色', () => {
  ;['official-inbox', 'official-mine', 'official-organizer'].forEach((name) => {
    const js = read(`pages/activity/${name}/index.js`)
    assert.match(js, /if \(isMerchantViewer\) merchantTheme\.merchantPageShow\(\);\s*else merchantTheme\.merchantPageRestore\(\);/, name)
    const wxml = read(`pages/activity/${name}/index.wxml`)
    assert.match(wxml, /isMerchantViewer \? 'theme-merchant' : 'theme-dark'/, name)
  })
  // 官方活动列表恒深色,不按身份切
  assert.match(read('pages/activity/list/index.wxml'), /^<view class="theme-dark">/)
})

// ── L06-135 合作页保留:俱乐部深色定价页进合作页沿用深色 ──────────────────────
function topicHarness(rel) {
  const calls = { navigate: [], navColor: [], bgColor: [], requests: [] }
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest(options) { calls.requests.push(options); return { abort() {} } },
  }
  const wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    getSystemInfoSync: () => ({}),
    getWindowInfo: () => ({}),
    getAppBaseInfo: () => ({}),
    navigateTo(options) { calls.navigate.push(options.url) },
    redirectTo(options) { calls.navigate.push('redirect:' + options.url) },
    navigateBack() {},
    setNavigationBarColor(options) { calls.navColor.push(options.frontColor) },
    setBackgroundColor(options) { calls.bgColor.push(options.backgroundColor) },
  }
  return { page: loadPage(rel, app, wx), calls }
}

test('L06-135 俱乐部深色定价页点合作行:带 club=1 进合作页;商家浅色不带', () => {
  const { page, calls } = topicHarness('pages/topic/pricing/index.js')
  page.setData({ topicId: 12, themeClass: 'theme-dark', lineup: [{ toType: 'club', toId: 8 }] })
  page.goPartner({ currentTarget: { dataset: { idx: 0 } } })
  page.setData({ themeClass: 'theme-merchant' })
  page.goPartner({ currentTarget: { dataset: { idx: 0 } } })
  assert.deepEqual(calls.navigate, [
    '/pages/topic/pricing/partner/index?topicId=12&toType=club&toId=8&club=1',
    '/pages/topic/pricing/partner/index?topicId=12&toType=club&toId=8',
  ])
})

test('L06-135 合作页 club=1:根节点深色、原生顶栏白字深底;返回兜底仍回深色定价页', () => {
  const { page, calls } = topicHarness('pages/topic/pricing/partner/index.js')
  page.onLoad({ topicId: '12', toType: 'club', toId: '8', club: '1' })
  page.onShow()
  assert.equal(page.data.themeClass, 'theme-dark')
  assert.deepEqual(calls.navColor, ['#ffffff'])
  assert.notEqual(calls.bgColor[0].toLowerCase(), '#ffffff')
  global.getCurrentPages = () => [{}]
  page.goBack()
  assert.equal(calls.navigate.pop(), 'redirect:/pages/topic/pricing/index?topicId=12&club=1')
  const wxml = read('pages/topic/pricing/partner/index.wxml')
  assert.match(wxml, /class="pr-page \{\{themeClass === 'theme-dark' \? 'theme-dark' : 'theme-merchant'\}\}/)
})

// ── L06-058 动态详情关注评论者:成功即本地标记同一用户全部评论,不回读评论分页 ────────
function squareDetailHarness() {
  const requests = []
  const toasts = []
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID: () => 1,
    getPageSize: () => 10,
    canUseCommunity: () => true,
    sendRequest(options) { requests.push(options); return { abort() {} } },
  }
  const wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    removeStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 390, windowHeight: 844 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32, left: 300, right: 380, width: 80, bottom: 56 }),
    showToast(options) { toasts.push(options.title) },
    request(options) { requests.push(options); return { abort() {} } },
  }
  return { page: loadPage('pages/square/detail/index.js', app, wx), requests, toasts }
}

test('L06-058 关注评论者成功:同一用户的所有评论都变已关注,不发评论列表回读', () => {
  const { page, requests, toasts } = squareDetailHarness()
  page.setData({
    id: 56,
    list: [
      { id: 8, memberId: 77, isFollowTheUser: 0 },
      { id: 9, memberId: 5, isFollowTheUser: 0 },
      { id: 10, memberId: 77, isFollowTheUser: 0, lifecycle: 'DELETED' },
      { id: 11, memberId: '77', isFollowTheUser: 0 },
    ],
  })
  page.commentFollowClick({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/user/follow/action')
  requests[0].success({ code: '200' })
  assert.equal(requests.length, 1, '不再回读评论分页,下一页游标不受影响')
  assert.deepEqual(page.data.list.map((row) => row.isFollowTheUser), [1, 0, 1, 1])
  assert.equal(toasts.at(-1), '关注成功')
  assert.doesNotMatch(toasts.join('|'), /状态确认失败/)
  // 同一用户可再次关注(请求锁已释放)
  page.commentFollowClick({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(requests.length, 2)
})

test('L06-058 关注写失败:列表不变、不报成功', () => {
  const { page, requests, toasts } = squareDetailHarness()
  const list = [{ id: 8, memberId: 77, isFollowTheUser: 0 }, { id: 10, memberId: 77, isFollowTheUser: 0 }]
  page.setData({ id: 56, list: JSON.parse(JSON.stringify(list)) })
  page.commentFollowClick({ currentTarget: { dataset: { index: 0 } } })
  requests[0].success({ code: '500', msg: '关注失败' })
  assert.deepEqual(page.data.list, list)
  assert.doesNotMatch(toasts.join('|'), /关注成功/)
})

test('L06-135 合作页无 club 参数:仍是商家浅色', () => {
  const { page, calls } = topicHarness('pages/topic/pricing/partner/index.js')
  page.onLoad({ topicId: '12', toType: 'merchant', toId: '8' })
  page.onShow()
  assert.equal(page.data.themeClass, 'theme-merchant')
  assert.deepEqual(calls.navColor, ['#000000'])
})

// ── L06-170 删除三个闲置的广场组件,无残留引用 ────────────────────────────────
const RETIRED_SQUARE = /square\/components\/(?:activity-picker|route-map)|square\/utils\/topic-route-preview/

test('L06-170 activity-picker / route-map / square topic-route-preview 已删,产品代码与门禁零引用', () => {
  ;['pages/square/components/activity-picker', 'pages/square/components/route-map', 'pages/square/utils/topic-route-preview.js']
    .forEach((rel) => assert.equal(fs.existsSync(path.join(ROOT, rel)), false, rel))
  // topic 详情自用的那份路线预览仍在
  assert.equal(fs.existsSync(path.join(ROOT, 'pages/topic/utils/topic-route-preview.js')), true)
  const hits = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (/\.(js|json|wxml|wxss|wxs)$/.test(entry.name) && RETIRED_SQUARE.test(fs.readFileSync(abs, 'utf8'))) {
        hits.push(path.relative(ROOT, abs))
      }
    }
  }
  ;['pages', 'components', 'utils', 'style', 'tests', 'scripts/baselines'].forEach((rel) => walk(path.join(ROOT, rel)))
  assert.doesNotMatch(read('app.json'), RETIRED_SQUARE)
  assert.deepEqual(hits.filter((rel) => !rel.endsWith('owner-dec-f06-groupa-1124.test.js')), [])
  assert.doesNotMatch(read('AGENTS.md'), /route-map|activity-picker/)
})
