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
