'use strict'
// L10-001 / L10-012:清单结果按 URL 缓存、并发封顶;裸 JSON 与 AjaxResult 两种形态都按同一校验处理。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const media = require('../../utils/roam-place-media.js')
const PM = require('../../utils/roam-place-map.js')

const seed = '["roam:seed:v1:test"]'
const row = (id) => ({ id, coverImg: `poi/p${id}.jpg`, tags: seed })
const doc = (id) => ({ poiId: id, coverKey: `poi/p${id}.jpg`, credit: '作者 · CC BY 4.0', images: [] })
const flush = () => new Promise((r) => setImmediate(r))
beforeEach(() => media.resetPlaceMediaCache())

test('同一清单成功后再次解析不再发请求', async () => {
  const requests = []
  const app = { sendRequest: (r) => requests.push(r) }
  const first = media.resolvePlaceMedia(app, [row(1)])
  requests[0].success({ code: 200, data: doc(1) })
  assert.equal(PM.coverKey((await first)[0]), 'poi/p1.jpg')
  const again = await media.resolvePlaceMedia(app, [row(1)])
  assert.equal(requests.length, 1)
  assert.equal(PM.coverKey(again[0]), 'poi/p1.jpg')
})

test('失败结果不缓存,下次重取', async () => {
  const requests = []
  const app = { sendRequest: (r) => requests.push(r) }
  const first = media.resolvePlaceMedia(app, [row(2)])
  requests[0].fail({})
  assert.equal(PM.coverKey((await first)[0]), '')
  const second = media.resolvePlaceMedia(app, [row(2)])
  assert.equal(requests.length, 2)
  requests[1].success({ code: 200, data: doc(2) })
  assert.equal(PM.coverKey((await second)[0]), 'poi/p2.jpg')
})

test('同时最多 4 个清单请求在途,完成一个再放下一个', async () => {
  const requests = []
  const app = { sendRequest: (r) => requests.push(r) }
  const rows = [10, 11, 12, 13, 14, 15].map(row)
  const pending = media.resolvePlaceMedia(app, rows)
  assert.equal(requests.length, 4)
  requests[0].success({ code: 200, data: doc(10) })
  await flush()
  assert.equal(requests.length, 5)
  for (let i = 1; i < requests.length; i++) requests[i].success({ code: 200, data: doc(10 + i) })
  await flush()
  requests[5].success({ code: 200, data: doc(15) })
  const out = await pending
  assert.deepEqual(out.map(PM.coverKey), rows.map((r) => r.coverImg))
})

test('静态文件裸 JSON 形态同样通过地点/封面/署名校验', async () => {
  const requests = []
  const pending = media.resolvePlaceMedia({ sendRequest: (r) => requests.push(r) }, [row(3)])
  requests[0].success(doc(3))
  assert.equal(PM.coverKey((await pending)[0]), 'poi/p3.jpg')
  const wrong = media.resolvePlaceMedia({ sendRequest: (r) => r.success(doc(99)) }, [row(4)])
  assert.equal(PM.coverKey((await wrong)[0]), '')
})
