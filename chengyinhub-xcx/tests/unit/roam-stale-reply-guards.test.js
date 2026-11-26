const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-012 / L05-013:主题卡与官方活动横幅只认最后一笔、仍然有效的回包。
function load() {
  let def
  const held = []
  const prev = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  global.Page = c => { def = c }
  const app = { globalData: { features: {} }, getUserID: () => '1', sendRequest: o => held.push(o) }
  global.getApp = () => app
  global.getCurrentPages = () => []
  global.wx = { getStorageSync: () => undefined }
  delete require.cache[require.resolve('../../pages/roam/index.js')]
  require('../../pages/roam/index.js')
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.setData = function (patch, cb) { Object.assign(this.data, patch); if (cb) cb() }
  page._topicEnter = () => {}; page._syncPlayHeader = () => {}; page._syncSparkCircles = () => {}; page._syncGoal = () => {}
  return { page, held, restore: () => Object.assign(global, prev) }
}

test('连点两枚主题针:先到的旧回包不开卡,只开最后一枚', () => {
  const { page, held, restore } = load()
  try {
    page.data.screen = 'map'
    page._fallbackToShopCard = () => { throw new Error('不应回退白卡') }
    page.openTopicView({ topicId: 1, productType: 1 })
    page.openTopicView({ topicId: 2, productType: 1 })
    held[0].success({ code: 200, data: { name: 'A' } })
    assert.equal(page.data.topicView, null)
    held[1].success({ code: 200, data: { name: 'B' } })
    assert.equal(page.data.topicView.title, 'B')
  } finally { restore() }
})

test('回包前已离开地图:不开主题卡也不回退白卡', () => {
  const { page, held, restore } = load()
  try {
    page.data.screen = 'map'
    let fallback = 0
    page._fallbackToShopCard = () => { fallback += 1 }
    page.openTopicView({ topicId: 1 })
    page.data.screen = 'arrive'
    held[0].success({ code: 200, data: { name: 'A' } })
    held[0].fail()
    assert.equal(page.data.topicView, null)
    assert.equal(fallback, 0)
  } finally { restore() }
})

test('活动横幅:换活动后旧活动的迟到回包不覆盖', async () => {
  const { page, held, restore } = load()
  try {
    page._eventId = 1
    const a = page._loadBoundEvent(1)
    page._eventId = 2
    const b = page._loadBoundEvent(2)
    held[1].success({ code: 200, data: { title: '新活动' } })
    held[0].success({ code: 200, data: { title: '旧活动' } })
    await Promise.all([a, b])
    assert.equal(page.data.boundEvent.title, '新活动')
    assert.equal(page.data.boundEvent.id, 2)
  } finally { restore() }
})
