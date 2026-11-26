/* L04-091:请求层统一挡掉页面已切走 / 已销毁之后的回包;各回调里不再逐个判 current()。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createServerDraftSaver } = require('../../pages/publish/utils/publish/server-draft.js')

function harness() {
  const calls = { save: [], readback: [], publish: [] }
  let alive = true
  const results = []
  const saver = createServerDraftSaver({
    save: (payload, done) => calls.save.push(done),
    readback: (id, done) => calls.readback.push(done),
    publish: (id, done) => calls.publish.push(done),
    isCurrent: () => alive,
  })
  return { saver, calls, results, leave: () => { alive = false } }
}

test('保存回包晚到时页面已离开:不回读、不回调', () => {
  const h = harness()
  let reported = 0
  assert.equal(h.saver.save({ topicId: 7 }, { onDone: () => { reported += 1 }, onError: () => { reported += 1 } }), true)
  h.leave()
  h.calls.save[0]({ ok: true, topicId: 7 })
  assert.equal(h.calls.readback.length, 0)
  assert.equal(reported, 0)
})

test('销毁后回包同样被挡', () => {
  const h = harness()
  h.saver.save({ topicId: 7 }, {})
  h.saver.destroy()
  h.calls.save[0]({ ok: true, topicId: 7 })
  assert.equal(h.calls.readback.length, 0)
})

test('正常回包照常进回读', () => {
  const h = harness()
  h.saver.save({ topicId: 7 }, {})
  h.calls.save[0]({ ok: true, topicId: 7, data: 7 })
  assert.equal(h.calls.readback.length, 1)
})
