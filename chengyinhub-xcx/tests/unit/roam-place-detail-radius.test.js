'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readStripPlace } = require('../../utils/roam-place-detail.js')

const place = { poiId: 9912406, name: '目录地点', lat: 31.2, lng: 121.4, tags: '["roam:park","roam:seed:v1:sh-place"]' }
const seed = 'roam:seed:v1:sh-place'

function appFor(calls, pois) {
  return { sendRequest(req) {
    calls.push(req)
    req.success({ code: 200, data: req.url.endsWith('/pois') ? pois : place })
  } }
}

test('缺失条带地点的附近查询不超过 50 公里，仍按种子标签对上', async () => {
  const calls = []
  const row = await readStripPlace(appFor(calls, [{ ...place, id: place.poiId, type: 1 }]),
    { seed }, [], [31.2, 121.4])
  assert.equal(row.id, 9912406)
  assert.deepEqual(calls.map(r => r.url), ['/api/roam/pois', '/api/city/places/9912406'])
  assert.equal(calls[0].data.radius, 50000)
  assert.ok(calls[0].data.radius <= 50000)
  assert.deepEqual([calls[0].data.lat, calls[0].data.lng], [31.2, 121.4])
})

test('附近列表已按种子标签命中时不再发扩大范围查询', async () => {
  const calls = []
  const nearby = [{ id: place.poiId, type: 1, tags: place.tags, name: '别的名字' }]
  const row = await readStripPlace(appFor(calls, []), { seed }, nearby, [31.2, 121.4])
  assert.equal(row.id, 9912406)
  assert.deepEqual(calls.map(r => r.url), ['/api/city/places/9912406'])
})
