const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-127 / L05-128:换票失败后改了内容要重新建;刮层画布拿不到时直接揭开。
function load() {
  let def
  const prev = { Page: global.Page, getApp: global.getApp, wx: global.wx }
  global.Page = d => { def = d }
  global.getApp = () => ({ globalData: {}, sendRequest() {}, getImgUrl: v => v, getUserID: () => '1' })
  global.wx = { getStorageSync: () => '', getWindowInfo: () => ({ pixelRatio: 2 }) }
  const file = require.resolve('../../subpackageRoam/citystamp/index.js')
  delete require.cache[file]
  require(file)
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  return { page, restore: () => Object.assign(global, prev) }
}

test('建好但换票失败后重拍或改字:作废旧建单,不再续换旧的', () => {
  const { page, restore } = load()
  try {
    page.data.photo = 'a.jpg'; page.data.note = 'hi'
    page._stampState = { idem: 'k1', stampId: 77 }
    page.onNoteInput({ detail: { value: 'hi' } })
    assert.equal(page._stampState.stampId, 77, '内容没变不作废')
    page.onNoteInput({ detail: { value: 'hello' } })
    assert.equal(page._stampState, null)
    page._stampState = { idem: 'k2', stampId: 78 }
    page.onCamShot({ detail: { path: 'b.jpg' } })
    assert.equal(page._stampState, null)
  } finally { restore() }
})

test('刮层画布拿不到:直接揭开,不把主按钮锁死', () => {
  const { page, restore } = load()
  try {
    let revealed = 0
    page._reveal = () => { revealed += 1 }
    global.wx.createSelectorQuery = () => ({ in() { return this }, select() { return this }, fields() { return this }, exec(cb) { cb([null]) } })
    page._initScratch()
    assert.equal(revealed, 1)
  } finally { restore() }
})

test('存相册:用户取消不报失败;拒权不在异步回调里直接开设置 (L05-131)', () => {
  const { page, restore } = load()
  const toasts = []
  try {
    page.data.torn = true; page.data.gotPic = 'wxfile://a.png'
    let openSetting = 0, modals = 0
    global.wx.showToast = (o) => toasts.push(o.title)
    global.wx.openSetting = () => { openSetting += 1 }
    global.wx.showModal = () => { modals += 1 }
    global.wx.saveImageToPhotosAlbum = (o) => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail cancel' })
    page.onSave()
    global.wx.saveImageToPhotosAlbum = (o) => o.fail({ errMsg: 'saveImageToPhotosAlbum:fail auth deny' })
    page.onSave()
    assert.equal(openSetting, 0)
    assert.equal(toasts.filter(t => /失败/.test(String(t))).length, 0)
  } finally { restore() }
})

test('拖签:同一帧内多次 touchmove 只写一次;落点状态不变不重发提示 (L05-130)', () => {
  const { page, restore } = load()
  try {
    const writes = []
    page.setData = function (p, cb) { writes.push(p); Object.assign(this.data, p); if (cb) cb() }
    page._drag = { x: 0, y: 0, dx: 0, dy: 0 }
    page._box = { left: 1000, right: 1100, top: 1000, bottom: 1100 }
    Object.assign(page.data, { noteScale: 0.88, boxArmed: false, hint: '把它拖进信箱，或点下面' }) // 已在拖:状态不变
    page.onNoteMove({ touches: [{ clientX: 10, clientY: 10 }] })
    page.onNoteMove({ touches: [{ clientX: 12, clientY: 12 }] })
    assert.equal(writes.length, 1)
    assert.equal(page._drag.dx, 12, '松手用的位移仍是最新的')
    assert.equal('hint' in writes[0] || 'boxArmed' in writes[0], false)
  } finally { restore() }
})
