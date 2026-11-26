const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-081:observer + attached 只出一次码;隐藏期间不走表、不在后台重出码。
function mount(rel, props) {
  let def
  const reqs = []
  const prev = { Component: global.Component, getApp: global.getApp }
  global.Component = d => { def = d }
  global.getApp = () => ({ sendRequest: o => reqs.push(o) })
  const file = require.resolve('../../subpackageRoam/components/cy/' + rel + '/index.js')
  delete require.cache[file]
  require(file)
  Object.assign(global, prev)
  const inst = Object.assign({}, def.methods, { data: Object.assign({}, def.data, props), setData(p, cb) { Object.assign(this.data, p); if (cb) cb() } })
  return { inst, def, reqs }
}

test('据点核销码:observer 与 attached 同一个 poiId 只出一次', () => {
  const { inst, def, reqs } = mount('scene-qr-citynode', { poiId: '9' })
  def.observers.poiId.call(inst, '9')
  def.lifetimes.attached.call(inst)
  assert.equal(reqs.length, 1)
})

test('团码:observer 与 attached 只出一次;隐藏停表,回来续表', () => {
  const { inst, def, reqs } = mount('scene-qr-group-code', { activityId: '12', topicId: '' })
  def.observers['activityId, topicId'].call(inst, '12', '')
  def.lifetimes.attached.call(inst)
  assert.equal(reqs.length, 1)
  reqs[0].success({ code: 200, data: { code: 'c', qrcodeUrl: 'q.png', ttlMs: 60000 } })
  assert.ok(inst._timer)
  def.pageLifetimes.hide.call(inst)
  assert.equal(inst._timer, null)
  def.pageLifetimes.show.call(inst)
  assert.ok(inst._timer, '没过期就续表')
  assert.equal(reqs.length, 1, '回来不重出码')
  inst.clearTimer()
})
