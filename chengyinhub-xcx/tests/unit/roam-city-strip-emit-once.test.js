const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-085:最近城市不变时不重复发 strip
test('同一座城里挪图不重复发 strip,换城才发', () => {
  let def
  const prev = global.Component
  global.Component = d => { def = d }
  const file = require.resolve('../../subpackageRoam/components/roam-city-strip/index.js')
  delete require.cache[file]
  require(file)
  global.Component = prev
  const CENTERS = { SH: [31.2304, 121.4737], BJ: [39.9042, 116.4074] }   // 与 roam-city-guide 的城市中心同值
  const ids = Object.keys(CENTERS)
  const events = []
  const inst = Object.assign({}, def.methods, { data: {}, triggerEvent: (n, d) => events.push(d) })
  const at = (c, dx) => { inst.data.lat = c[0] + dx; inst.data.lng = c[1]; inst._run() }
  const a = CENTERS[ids[0]]
  at(a, 0); at(a, 0.001); at(a, 0.002)
  assert.equal(events.length, 1)
  if (ids.length > 1) { at(CENTERS[ids[1]], 0); assert.equal(events.length, 2) }
})
