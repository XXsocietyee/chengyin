// AUDIT-1122 F06 L06-030:进度晚到时重新挂观察器,进入视野能播放
const test = require('node:test')
const assert = require('node:assert/strict')

test('L06-030 首次 total=0、进度晚到后仍会观察 .rp 并播放', () => {
  let def
  global.Component = v => { def = v }
  delete require.cache[require.resolve('../../pages/topic/components/cy/route-progress/index.js')]
  require('../../pages/topic/components/cy/route-progress/index.js')
  const observed = []
  const c = Object.assign({}, def.methods, {
    data: Object.assign({}, def.data, { total: 0, done: 0, labels: [], tone: 'city', reducedMotion: true }),
    setData(p, cb) { Object.assign(this.data, p); if (cb) cb() },
    createIntersectionObserver() {
      return { relativeToViewport() { return { observe: (sel, cb) => observed.push(cb) } }, disconnect() {} }
    },
  })
  def.lifetimes.attached.call(c)
  def.lifetimes.ready.call(c)
  assert.equal(observed.length, 0, 'total=0 时没有 .rp 节点,不挂')
  c.data.total = 4; c.data.done = 2
  def.observers['total, done, labels'].call(c)
  assert.equal(observed.length, 1)
  observed[0]({ intersectionRatio: 1 })
  assert.equal(c.data.fill, 50)
})
