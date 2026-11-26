// AUDIT-1122 L04-020:左滑 / 拖动排序跟手在渲染层(WXS):touchmove 只 setStyle,不回逻辑层;
// 松手回调一次。开着的行偏移按真实屏宽换算(156rpx),不再按 2 倍屏粗算。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const DIR = path.join(__dirname, '../../pages/publish/components/swipe-row')
function loadWxs() {
  const mod = { exports: {} }
  // WXS 是 ES5 子集 + module.exports;同一 realm 里跑,断言才能直接比对象
  new Function('module', fs.readFileSync(path.join(DIR, 'swipe-row.wxs'), 'utf8'))(mod)
  return mod.exports
}
function owner() {
  const state = {}
  const styles = { '.sw__row': [], '.sw': [] }
  const calls = []
  return {
    styles, calls,
    getState: () => state,
    selectComponent: (sel) => ({ setStyle: (s) => styles[sel].push(s) }),
    callMethod: (name, arg) => calls.push([name, arg]),
  }
}
const touch = (x, y, ds = {}) => ({ touches: [{ clientX: x, clientY: y }], currentTarget: { dataset: ds } })

test('左滑:移动只改渲染层样式、不回逻辑层;过阈值松手回调一次 open', () => {
  const sw = loadWxs(); const o = owner()
  sw.setOpenPx(82.47, 0, o)
  sw.start(touch(300, 100, { open: false }), o)
  for (let x = 295; x >= 200; x -= 5) sw.move(touch(x, 101), o)
  assert.equal(o.calls.length, 0, 'touchmove 期间不能 callMethod')
  assert.equal(o.styles['.sw__row'].at(-1).transform, 'translateX(-100px)', '左滑最多比开口再多 20px')
  assert.equal(o.styles['.sw__row'].at(-1).transition, 'none')
  sw.end(touch(200, 101), o)
  assert.deepEqual(o.calls, [['onSwipeEnd', { open: true }]])
  assert.deepEqual(o.styles['.sw__row'].at(-1), { transform: '', transition: '' })
})

test('开着的行从真实开口位置起滑;回滑过阈值才关;竖向滑动不动行', () => {
  const sw = loadWxs(); const o = owner()
  sw.setOpenPx(82.47, 0, o)
  sw.setOpenPx('abc', 82.47, o)
  sw.start(touch(200, 100, { open: true }), o)
  sw.move(touch(210, 100), o)
  assert.equal(o.styles['.sw__row'].at(-1).transform, 'translateX(-72.47px)')
  sw.end(touch(210, 100), o)
  assert.deepEqual(o.calls, [], '只回滑 10px,不关')
  sw.start(touch(200, 100, { open: true }), o)
  sw.move(touch(250, 100), o); sw.end(touch(250, 100), o)
  assert.deepEqual(o.calls, [['onSwipeEnd', { open: false }]])
  const v = owner()
  sw.start(touch(200, 100, {}), v); sw.move(touch(203, 140), v); sw.move(touch(150, 180), v); sw.end(touch(150, 180), v)
  assert.deepEqual(v.styles['.sw__row'], []); assert.deepEqual(v.calls, [])
  const off = owner()
  sw.start(touch(200, 100, { editing: true }), off); sw.move(touch(100, 100), off); sw.end(touch(100, 100), off)
  assert.deepEqual(off.calls, [])
})

test('拖动排序:按下回调一次量高,移动只 setStyle,松手把位移交回', () => {
  const sw = loadWxs(); const o = owner()
  sw.gripStart(touch(0, 300, {}), o)
  for (let y = 310; y <= 420; y += 10) sw.gripMove(touch(0, y), o)
  assert.deepEqual(o.calls, [['onGripStart', {}]])
  assert.equal(o.styles['.sw'].at(-1).transform, 'translateY(120px)')
  sw.gripEnd(touch(0, 420), o)
  assert.deepEqual(o.calls.at(-1), ['onGripEnd', { dy: 120 }])
  assert.deepEqual(o.styles['.sw'].at(-1), { transform: '' })
})

test('组件:开口按屏宽换算;松手按行高算步数发 move;禁用不发', () => {
  let def
  global.Component = (d) => { def = d }
  global.wx = { getWindowInfo: () => ({ windowWidth: 414 }) }
  delete require.cache[require.resolve(path.join(DIR, 'index.js'))]; require(path.join(DIR, 'index.js'))
  const events = []
  const c = Object.assign({}, def.methods, {
    data: Object.assign({}, def.data, { index: 1, count: 4, open: false, disabled: false }),
    setData(p) { Object.assign(this.data, p) },
    triggerEvent: (n, d) => events.push([n, d]),
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: (cb) => ({ exec: () => cb({ height: 50 }) }) }) }),
  })
  def.lifetimes.attached.call(c)
  assert.equal(c.data._openPx, 86.11)
  c.onSwipeEnd({ open: true })
  assert.deepEqual(events.at(-1), ['swipe', { index: 1, open: true }])
  c.onGripStart(); assert.equal(c.data._dragging, true)
  c.onGripEnd({ dy: 98 }); assert.equal(c.data._dragging, false)
  assert.deepEqual(events.at(-1), ['move', { from: 1, to: 3 }])
  c.data.disabled = true; events.length = 0
  c.onSwipeEnd({ open: true }); c.onGripStart(); c.onGripEnd({ dy: 100 })
  assert.deepEqual(events, [])
  const wxml = fs.readFileSync(path.join(DIR, 'index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /bindtouchmove="on|catchtouchmove="on/, 'touchmove 不能再绑逻辑层方法')
})
