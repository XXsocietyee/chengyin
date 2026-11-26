/* L04-095:纸本风格或减少动态时,风格预览只画一帧,不挂 requestAnimationFrame 循环。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

function mount(look, reducedMotion) {
  let def
  global.Behavior = (b) => b
  global.Component = (d) => { def = d }
  let rafs = 0
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true } })
  const node = () => ({ width: 0, height: 0, getContext: () => ctx, requestAnimationFrame: () => { rafs += 1; return 1 }, cancelAnimationFrame() {} })
  global.wx = {
    getStorageSync: () => '', getWindowInfo: () => ({ pixelRatio: 2 }),
    createSelectorQuery: () => { const q = { in: () => q, select: () => q, fields: () => q, exec: (cb) => cb([{ node: node(), width: 300, height: 400 }, { node: node(), width: 300, height: 400 }]) }; return q },
  }
  delete require.cache[require.resolve('../../pages/publishkit/components/look-preview/index.js')]
  require('../../pages/publishkit/components/look-preview/index.js')
  const c = Object.assign({}, def.methods, { data: { reducedMotion }, properties: { show: true }, setData(p) { Object.assign(this.data, p) } })
  c._look = require('../../pages/publishkit/utils/publish/theme-look.js').normalizeLook(look)
  c._paint()
  return { rafs: () => rafs, def }
}

test('纸本风格只画一帧', () => {
  assert.equal(mount({ style: 'PAPER' }, false).rafs(), 0)
})

test('减少动态时只画一帧', () => {
  assert.equal(mount({ style: 'STARDUST' }, true).rafs(), 0)
})

test('有粒子的风格照常动', () => {
  const m = mount({ style: 'STARDUST' }, false)
  assert.equal(m.rafs(), 1)
  assert.ok(m.def.behaviors && m.def.behaviors.length === 1, '接入全站减少动态偏好')
})
