'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// L05-157 / L05-164:价格滑块与输入框(searchmap 与 search2 同一份逻辑)。
function load(rel) {
  let def
  const queries = []
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx }
  global.Page = d => { def = d }
  global.getApp = () => ({ globalData: {}, sendRequest() {} })
  global.wx = {
    getStorageSync: () => '', showToast() {},
    createSelectorQuery: () => { const q = { select() { return q }, boundingClientRect() { return q }, exec(cb) { queries.push(1); cb([{ left: 0, width: 200 }]) } }; return q },
  }
  const file = path.resolve(__dirname, '../../', rel)
  delete require.cache[file]
  require(file)
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.writes = 0
  page.setData = function (p, cb) { this.writes += 1; Object.assign(this.data, p); if (cb) cb() }
  return { page, queries, restore: () => Object.assign(global, prev) }
}

for (const rel of ['pages/searchmap/index.js', 'pages/search2/index.js']) {
  test(rel + ':拖滑块只量一次轨道,每次移动一次 setData', () => {
    const { page, queries, restore } = load(rel)
    try {
      page.handleSliderMove({ touches: [{ clientX: 40 }] }, 'min')
      page.handleSliderMove({ touches: [{ clientX: 60 }] }, 'min')
      assert.equal(queries.length, 1)
      const before = page.writes
      page.handleSliderMove({ touches: [{ clientX: 80 }] }, 'min')
      assert.equal(page.writes - before, 1)
      assert.equal(page.data.minPercent, 40)
      assert.match(page.data.minHandleStyle, /left: 40%/)
    } finally { restore() }
  })

  test(rel + ':拖动开始只量一次,价格没变的像素不再 setData', () => {
    const { page, queries, restore } = load(rel)
    try {
      page.onMinSliderStart({ touches: [{ clientX: 40 }] })
      page.handleSliderMove({ touches: [{ clientX: 40 }] }, 'min')
      assert.equal(queries.length, 1)
      assert.equal(page.data.minPrice, 200)
      page._sliderRect = { left: 0, width: 10000 }
      const before = page.writes
      page.handleSliderMove({ touches: [{ clientX: 100 }] }, 'min')
      page.handleSliderMove({ touches: [{ clientX: 104 }] }, 'min')
      assert.equal(page.data.minPrice, 10)
      assert.equal(page.writes - before, 1)
      assert.equal(queries.length, 1)
      page.handleSliderMove({ touches: [{ clientX: 150 }] }, 'min')
      assert.equal(page.data.minPrice, 15)
      assert.equal(page.writes - before, 2)
    } finally { restore() }
  })

  test(rel + ':输入超上限夹到 1000;清空不报错不动数据', () => {
    const { page, restore } = load(rel)
    try {
      page.onMaxPriceInput({ detail: { value: '5000' } })
      assert.equal(page.data.maxPrice, page.data.priceRange.max)
      assert.ok(page.data.maxPercent <= 100)
      const before = page.data.maxPrice
      page.onMaxPriceInput({ detail: { value: '' } })
      assert.equal(page.data.maxPrice, before)
    } finally { restore() }
  })
}

test('search2:筛选搜索回来后再只搜关键词,不带上一次的日期/价格/类别;筛选单仍显示刚设的条件', () => {
  const urls = []
  const { page, restore } = load('pages/search2/index.js')
  try {
    global.wx.navigateTo = ({ url }) => urls.push(url)
    page.setData({
      searchKeyword: '外滩',
      activeCategory: 7,
      activeDate: '3',
      startdate: '2026-11-24',
      enddate: '2026-11-25',
      minPrice: 80,
      maxPrice: 300,
      jg1: '¥80',
      jg2: '¥300',
      filterConditions: Object.assign({}, page.data.filterConditions, { keyword: '外滩', categoryId: 7 }),
    })
    page.onShow()
    assert.equal(page.data.filterConditions.categoryId, 7, '还没离开时不把刚选的类别清掉')
    page.searchFilter()
    assert.match(urls[0], /categoryId=7/)
    assert.match(urls[0], /startDate=2026-11-24/)
    assert.match(urls[0], /endDate=2026-11-25/)
    assert.match(urls[0], /minPrice=80/)
    assert.match(urls[0], /maxPrice=300/)
    assert.equal(page.data.startdate, '2026-11-24')
    assert.equal(page.data.minPrice, 80)
    assert.equal(page.data.activeDate, '3')

    page.onHide()
    page.onShow()
    assert.equal(page.data.startdate, '2026-11-24')
    assert.equal(page.data.enddate, '2026-11-25')
    assert.equal(page.data.minPrice, 80)
    assert.equal(page.data.maxPrice, 300)
    assert.equal(page.data.jg1, '¥80')
    assert.equal(page.data.jg2, '¥300')
    assert.equal(page.data.activeDate, '3')
    assert.equal(page.data.activeCategory, null)
    assert.equal(page.data.filterConditions.categoryId, null)
    assert.equal(page.data.filterConditions.startDate, '')
    assert.equal(page.data.filterConditions.endDate, '')
    assert.equal(page.data.filterConditions.minPrice, 0)
    assert.equal(page.data.filterConditions.maxPrice, 1000)

    page.onKeywordInput({ detail: { value: '咖啡馆' } })
    page.onSearchConfirm()
    assert.match(urls[1], /keyword=/)
    assert.doesNotMatch(urls[1], /startDate=/)
    assert.doesNotMatch(urls[1], /endDate=/)
    assert.doesNotMatch(urls[1], /categoryId=/)
    assert.doesNotMatch(urls[1], /minPrice=80/)
    assert.doesNotMatch(urls[1], /maxPrice=300/)
    assert.equal(page.data.startdate, '2026-11-24')
    assert.equal(page.data.minPrice, 80)

    page.searchFilter()
    assert.match(urls[2], /startDate=2026-11-24/)
    assert.match(urls[2], /endDate=2026-11-25/)
    assert.match(urls[2], /minPrice=80/)
    assert.match(urls[2], /maxPrice=300/)
    assert.doesNotMatch(urls[2], /categoryId=/)
    assert.equal(page.data.startdate, '2026-11-24')
    assert.equal(page.data.activeDate, '3')
  } finally { restore() }
})

test('search2:重置清掉已生效的日期/价格/排序;再点已选类别取消', () => {
  const { page, restore } = load('pages/search2/index.js')
  try {
    page.data.filterConditions = Object.assign({}, page.data.filterConditions, { startDate: '2026-11-24', endDate: '2026-11-25', minPrice: 50, sortType: '2', categoryId: 3 })
    page.resetFilter()
    assert.equal(page.data.filterConditions.startDate, '')
    assert.equal(page.data.filterConditions.minPrice, 0)
    assert.equal(page.data.filterConditions.sortType, '1')
    const ev = { currentTarget: { dataset: { category: { id: 3 } } } }
    page.data.activeCategory = 3
    page.onCategoryClick(ev)
    assert.equal(page.data.activeCategory, null)
    assert.equal(page.data.filterConditions.categoryId, null)
    global.wx.navigateTo = () => {}
    page.onCategoryClick(ev)
    assert.equal(page.data.activeCategory, 3)
  } finally { restore() }
})
