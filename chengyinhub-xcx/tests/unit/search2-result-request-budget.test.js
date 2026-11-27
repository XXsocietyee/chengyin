'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

// L05-159 / L05-160 / L05-161 / L05-178:搜索结果页的请求次数、列表写入与俱乐部拒绝文案。
const TOPIC = '/api/template/topic-template/list'
function mount(sharedApp) {
  const file = path.resolve(__dirname, '../../pages/search2/result/index.js')
  let def
  const reqs = []
  const app = sharedApp || { globalData: {}, getUserID: () => '', getAuthorization: () => '', getImgUrl: v => v, getUserRole: () => 'player', canUseCommunity: () => false }
  app.sendRequest = o => reqs.push(o)
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { getApp: () => app, Page: d => { def = d }, require: createRequire(file), wx: { getStorageSync: () => '' }, setTimeout, clearTimeout, console })
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p) } })
  page.data.keyword = '咖啡'
  return { page, reqs, app }
}
const urls = (reqs) => reqs.map(r => r.url)
const topicReqs = (reqs) => reqs.filter(r => r.url === TOPIC)

test('主题模板整表同一账号在本页只拉一次', () => {
  const { page, reqs } = mount()
  page.runSearch()
  const first = topicReqs(reqs)
  assert.equal(first.length, 1)
  reqs.forEach(r => r.success({ code: 200, data: [] }))
  page.data.keyword = '书店'
  page.runSearch()
  assert.equal(urls(reqs).filter(u => u === TOPIC).length, 1)
})

test('同一次访问里换一页结果,同一账号不再拉主题目录', () => {
  const shared = { globalData: {}, getUserID: () => '9', getAuthorization: () => 'tok', getImgUrl: v => (v ? 'cdn:' + v : v), getUserRole: () => 'player', canUseCommunity: () => false }
  const first = mount(shared)
  first.page.runSearch()
  assert.equal(topicReqs(first.reqs).length, 1, '这次访问的第一次搜索仍要请求目录')
  first.reqs.forEach(r => r.success({ code: 200, data: r.url === TOPIC ? [{ id: 1, name: '咖啡探店', imgUrl: 'a.jpg' }] : [] }))
  const second = mount(shared)
  second.page.runSearch()
  assert.equal(topicReqs(second.reqs).length, 0)
  second.reqs.forEach(r => r.success({ code: 200, data: [] }))
  const hit = second.page.data.visibleResults.find(item => item.type === 'topicTemplate')
  assert.equal(hit && hit.title, '咖啡探店')
  assert.equal(hit && hit.cover, 'cdn:a.jpg')
})

test('主题目录失败不记入访问缓存,下次搜索会再请求', () => {
  const { page, reqs } = mount()
  page.runSearch()
  topicReqs(reqs).forEach(r => r.fail({ code: 500 }, 500))
  page.data.keyword = '书店'
  page.runSearch()
  assert.equal(topicReqs(reqs).length, 2)
})

test('主题目录不是数组时不算成功,下次还会请求', () => {
  const { page, reqs } = mount()
  page.runSearch()
  reqs.forEach(r => r.success({ code: 200, data: { rows: [{ id: 1, name: '咖啡' }], total: 1 } }))
  page.data.keyword = '书店'
  page.runSearch()
  assert.equal(topicReqs(reqs).length, 2)
})

test('换了账号会重新拉主题目录', () => {
  const { page, reqs, app } = mount()
  let id = '1'
  app.getUserID = () => id
  page.runSearch()
  reqs.forEach(r => r.success({ code: 200, data: [] }))
  id = '2'
  page.data.keyword = '书店'
  page.runSearch()
  assert.equal(topicReqs(reqs).length, 2)
})

test('俱乐部以外那一路 403 不说「不能搜俱乐部」', () => {
  const { page, reqs } = mount()
  page.runSearch()
  const merchant = reqs.find(r => r.url === '/api/merchant/list')
  merchant.successStatusAbnormal ? merchant.successStatusAbnormal({ code: 403 }, 403) : merchant.fail({ code: 403 }, 403)
  assert.equal(page.data.clubSearchDenied, '')
})

test('合并搜索没打开时第一次也不发,主题和活动走原来的列表', () => {
  const { page, reqs } = mount()
  page.runSearch()
  assert.equal(urls(reqs).includes('/api/search/unified'), false)
  assert.ok(urls(reqs).includes('/api/topic/list'))
  assert.ok(urls(reqs).includes('/api/activity/list'))
  assert.ok(urls(reqs).includes('/api/club/list'))
  assert.ok(urls(reqs).includes('/api/merchant/list'))
})

test('合并搜索打开后遇到 503 就关掉,之后不再先撞一次', () => {
  const { page, reqs, app } = mount()
  app.globalData.searchUnifiedOn = true
  app.getUserID = () => '7'; app.getAuthorization = () => 'tok'
  page.runSearch()
  const unified = reqs.find(r => r.url === '/api/search/unified')
  assert.ok(unified, '打开后的首搜走合并搜索')
  const clubBefore = reqs.filter(r => r.url === '/api/club/list').length
  const merchantBefore = reqs.filter(r => r.url === '/api/merchant/list').length
  unified.successStatusAbnormal({ code: 503 }, 503)
  assert.equal(app.globalData.searchUnifiedOff, true)
  assert.equal(app.globalData.searchUnifiedOn, false)
  assert.equal(reqs.filter(r => r.url === '/api/club/list').length, clubBefore, '已发出的俱乐部请求留在本轮')
  assert.equal(reqs.filter(r => r.url === '/api/merchant/list').length, merchantBefore, '已发出的商家请求留在本轮')
  assert.equal(reqs.filter(r => r.url === '/api/topic/list').length, 1)
  assert.equal(reqs.filter(r => r.url === '/api/activity/list').length, 1)
  const before = urls(reqs).filter(u => u === '/api/search/unified').length
  page.data.keyword = '书店'
  page.runSearch()
  assert.equal(urls(reqs).filter(u => u === '/api/search/unified').length, before)
  assert.ok(urls(reqs).includes('/api/topic/list'))
  assert.ok(urls(reqs).includes('/api/activity/list'))
})

test('L05-161 结果列表一次写入,当前页签的行还在,分组不进页面数据', () => {
  const { page, reqs } = mount()
  page.runSearch()
  let listWrites = 0
  const orig = page.setData.bind(page)
  page.setData = function (patch) {
    if (Object.prototype.hasOwnProperty.call(patch, 'visibleResults')) {
      listWrites += 1
      assert.equal(Object.prototype.hasOwnProperty.call(patch, 'resultGroups'), false)
    }
    orig(patch)
  }
  reqs.forEach(r => r.success({ code: 200, data: r.url === '/api/activity/list'
    ? { rows: [{ id: 1, name: '夜行' }] }
    : r.url === '/api/club/list'
      ? { rows: [{ id: 2, name: '夜行俱乐部' }] }
      : [] }))
  assert.equal(listWrites, 1, '各路到齐后列表只写一次')
  assert.equal(page.data.resultGroups, undefined)
  assert.equal(page.data.visibleResults.length, 2)
  listWrites = 0
  page.onResultTab({ detail: { key: 'activity' } })
  assert.equal(listWrites, 1, '切页签一次写完')
  assert.equal(page.data.activeResultType, 'activity')
  assert.equal(page.data.visibleResults.length, 1)
  assert.equal(page.data.visibleResults[0].type, 'activity')
  page.onHide()
  listWrites = 0
  page.onShow()
  assert.equal(listWrites, 1, '回到本页一次写回')
  assert.equal(page.data.visibleResults.length, 1)
  assert.equal(page.data.visibleResults[0].type, 'activity')
})
