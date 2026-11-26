'use strict'
// L08-035:预览 / 地图 / 系统选择器是只读离开,回来不重拉详情和管理统计。
// 能改活动日期或名册的页面回来仍重拉;详情失败时下次出现仍重拉。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')

function loadPage() {
  let definition = null
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    sendRequest() {},
    getUserID: () => 9008, getUserRole: () => 'CLUB', getUserType: () => 1,
  }
  const base = {
    switchTab() {}, navigateBack() {}, navigateTo() {},
    getStorageSync: () => '', setStorageSync() {}, removeStorageSync() {},
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 667 }), getSystemInfoSync: () => ({}),
    previewImage() {}, previewMedia() {}, openLocation() {}, chooseLocation() {}, choosePoi() {},
    chooseImage() {}, chooseMedia() {}, chooseVideo() {}, chooseMessageFile() {},
  }
  const wx = new Proxy(base, { get(t, k) { return k in t ? t[k] : () => {} } })
  global.wx = wx
  global.getApp = () => app
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'pages/club/topic-detail/index.js'), 'utf8'), {
    getApp: () => app, Page: (config) => { definition = config }, wx, console, Date, setTimeout, clearTimeout, JSON, Math, Promise,
    getCurrentPages: () => [],
    require: (id) => require(path.resolve(ROOT, 'pages/club/topic-detail', id)),
  }, { filename: 'pages/club/topic-detail/index.js' })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) },
  })
  return { page, wx }
}

function shown(page) {
  page.onLoad({ topicId: '88', clubId: '9' })
  const calls = { detail: 0, stats: 0 }
  page.fetchDetail = () => { calls.detail += 1 }
  page.loadManageStats = () => { calls.stats += 1 }
  page._hasShown = true
  page.data.loaded = true
  page.data.loadError = false
  page.data.missingParam = false
  return calls
}

test('L08-035 预览、地图、系统选择器回来不重拉;改期页和名册页回来仍重拉', () => {
  const { page, wx } = loadPage()
  const calls = shown(page)
  wx.previewImage({ urls: ['https://cdn.example/a.png'], current: 'https://cdn.example/a.png' })
  page.onHide(); page.onShow()
  wx.openLocation({ latitude: 31.2, longitude: 121.5, name: '集合点' })
  page.onHide(); page.onShow()
  wx.chooseImage({ count: 1 })
  page.onHide(); page.onShow()
  assert.equal(calls.detail, 0)
  assert.equal(calls.stats, 0)
  page.goEventOps(); page.onHide(); page.onShow()
  assert.equal(calls.detail, 1)
  assert.equal(calls.stats, 1)
  page.goLedger(); page.onHide(); page.onShow()
  assert.equal(calls.detail, 2)
  assert.equal(calls.stats, 2)
  page.onUnload()
})

test('L08-035 详情失败时,只读离开后再出现仍重拉这两项', () => {
  const { page, wx } = loadPage()
  const calls = shown(page)
  page.data.loadError = true
  wx.previewMedia({ sources: [{ url: 'https://cdn.example/a.png', type: 'image' }] })
  page.onHide(); page.onShow()
  assert.equal(calls.detail, 1)
  assert.equal(calls.stats, 1)
  page.onUnload()
})

test('L08-035 选择器没打开就失败,下一次出现仍重拉', () => {
  const { page, wx } = loadPage()
  wx.chooseMedia = function (options) { if (options && options.fail) options.fail({ errMsg: 'chooseMedia:fail cancel' }) }
  const calls = shown(page)
  wx.chooseMedia({})
  page.onHide(); page.onShow()
  assert.equal(calls.detail, 1)
  assert.equal(calls.stats, 1)
  page.onUnload()
})

test('L08-035 缺 topicId 的终态出现时不重拉', () => {
  const { page } = loadPage()
  page.onLoad({})
  let detail = 0
  page.fetchDetail = () => { detail += 1 }
  page.loadManageStats = () => { detail += 1 }
  page._hasShown = true
  page.onShow()
  assert.equal(detail, 0)
  assert.equal(page.data.missingParam, true)
  page.onUnload()
})
