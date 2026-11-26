'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

// L05-159 / L05-160 / L05-178:搜索结果页的请求次数与俱乐部拒绝文案。
function mount() {
  const file = path.resolve(__dirname, '../../pages/search2/result/index.js')
  let def
  const reqs = []
  const app = { globalData: {}, getUserID: () => '', getAuthorization: () => '', sendRequest: o => reqs.push(o), getImgUrl: v => v, getUserRole: () => 'player', canUseCommunity: () => false }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { getApp: () => app, Page: d => { def = d }, require: createRequire(file), wx: { getStorageSync: () => '' }, setTimeout, clearTimeout, console })
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p) } })
  page.data.keyword = '咖啡'
  return { page, reqs, app }
}
const urls = (reqs) => reqs.map(r => r.url)

test('主题模板整表同一账号在本页只拉一次', () => {
  const { page, reqs } = mount()
  page.runSearch()
  const first = reqs.filter(r => r.url === '/api/template/topic-template/list')
  assert.equal(first.length, 1)
  reqs.forEach(r => r.success({ code: 200, data: [] }))
  page.data.keyword = '书店'
  page.runSearch()
  assert.equal(urls(reqs).filter(u => u === '/api/template/topic-template/list').length, 1)
})

test('俱乐部以外那一路 403 不说「不能搜俱乐部」', () => {
  const { page, reqs } = mount()
  page.runSearch()
  const merchant = reqs.find(r => r.url === '/api/merchant/list')
  merchant.successStatusAbnormal ? merchant.successStatusAbnormal({ code: 403 }, 403) : merchant.fail({ code: 403 }, 403)
  assert.equal(page.data.clubSearchDenied, '')
})

test('合并搜索 503 记在 app 会话里,之后不再先撞一次', () => {
  const { page, reqs, app } = mount()
  app.getUserID = () => '7'; app.getAuthorization = () => 'tok'
  page.runSearch()
  const unified = reqs.find(r => r.url === '/api/search/unified')
  assert.ok(unified, '登录态首搜走合并搜索')
  unified.successStatusAbnormal({ code: 503 }, 503)
  assert.equal(app.globalData.searchUnifiedOff, true)
  const before = urls(reqs).filter(u => u === '/api/search/unified').length
  page.data.keyword = '书店'
  page.runSearch()
  assert.equal(urls(reqs).filter(u => u === '/api/search/unified').length, before)
})
