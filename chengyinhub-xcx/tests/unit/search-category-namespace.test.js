'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// L05-155:商家行业 id 与主题/活动类别 id 不能共用 filterConditions.categoryId。
const PAGE = path.resolve(__dirname, '../../pages/searchmap/index.js')

function setByPath(target, key, value) {
  const parts = key.split('.')
  if (parts.length === 1) {
    target[key] = value
    return
  }
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {}
    cursor = cursor[part]
  })
  cursor[parts.at(-1)] = value
}

function loadSearchMap() {
  let definition
  const requests = []
  const previous = { Page: global.Page, getApp: global.getApp, wx: global.wx }
  global.Page = (config) => { definition = config }
  global.getApp = () => ({
    globalData: { statusBarHeight: 20 },
    sendRequest(request) { requests.push(request) },
  })
  global.wx = {
    createMapContext: () => ({}),
    getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    showToast() {},
  }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  global.Page = previous.Page
  global.getApp = previous.getApp
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (callback) callback()
    },
  })
  page._hasLocation = true
  return {
    page,
    requests,
    restore() {
      global.wx = previous.wx
    },
  }
}

function activityRequest(requests) {
  return requests.filter((request) => request.url === '/api/activity/list').at(-1)
}

function merchantRequest(requests) {
  return requests.filter((request) => request.url === '/api/city/nodes').at(-1)
}

test('商家半屏的行业 id 只进商家节点,不进活动类别', () => {
  const { page, requests, restore } = loadSearchMap()
  try {
    page.setData({ 'filterConditions.categoryId': 4 })
    page.onMerchantCategoryChange({ detail: { selectedCategories: [{ id: 9, categoryName: '咖啡馆' }] } })
    assert.equal(page.data.filterConditions.categoryId, 4)
    assert.equal(page.data.filterConditions.merchantCategoryId, 9)
    page.searchFilter()
    assert.equal(activityRequest(requests).data.category_id, 4)
    assert.equal(merchantRequest(requests).data.categoryId, 9)

    page.onMerchantCategoryChange({ detail: { selectedCategories: [] } })
    assert.equal(page.data.filterConditions.categoryId, 4)
    assert.equal(page.data.filterConditions.merchantCategoryId, null)
  } finally { restore() }
})

test('搜索带入的主题类别只进活动列表,不进商家节点', () => {
  const { page, requests, restore } = loadSearchMap()
  try {
    const params = encodeURIComponent(JSON.stringify({ categoryId: 4, keyword: '夜游' }))
    page.onLoad({ params })
    assert.equal(page.data.filterConditions.categoryId, 4)
    assert.equal(page.data.filterConditions.merchantCategoryId, null)
    assert.equal(activityRequest(requests).data.category_id, 4)
    assert.equal(merchantRequest(requests).data.categoryId, '')

    const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/searchmap/index.wxml'), 'utf8')
    assert.match(wxml, /ids="\{\{filterConditions\.merchantCategoryId \|\| ''\}\}"/)
    assert.doesNotMatch(wxml, /ids="\{\{filterConditions\.categoryId/)
  } finally { restore() }
})
