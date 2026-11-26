'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { readStripPlace } = require('../../utils/roam-place-detail.js')

const place = { poiId: 9912406, name: '目录地点', lat: 31.2, lng: 121.4, tags: '["roam:park","roam:seed:v1:sh-place"]' }
const seed = 'roam:seed:v1:sh-place'
const poi = { ...place, id: place.poiId, type: 1 }

function appFor(calls, body) {
  return { sendRequest(req) {
    calls.push(req)
    req.success(typeof body === 'function' ? body(req) : body)
  } }
}

test('不在已加载集合里的地点按种子对上，附近半径不超过 50 公里', async () => {
  const calls = []
  const row = await readStripPlace(appFor(calls, req => ({ code: 200, data: req.url.endsWith('/pois') ? [poi] : place })),
    { id: 'sh-place', seed }, [], [31.2, 121.4])
  assert.equal(row.id, 9912406)
  assert.deepEqual(calls.map(r => r.url), ['/api/roam/pois', '/api/city/places/9912406'])
  assert.equal(calls[0].data.radius, 50000)
  assert.ok(calls[0].data.radius <= 50000)
  assert.notEqual(calls[0].data.radius, 100000)
  assert.deepEqual([calls[0].data.lat, calls[0].data.lng], [31.2, 121.4])
  assert.equal(calls.filter(r => r.url === '/api/roam/pois').length, 1)
})

test('已有数字编号时直接读这一处，不再发附近半径', async () => {
  const calls = []
  const row = await readStripPlace(appFor(calls, { code: 200, data: place }),
    { id: 9912406, seed }, [], [31.2, 121.4])
  assert.equal(row.id, 9912406)
  assert.deepEqual(calls.map(r => r.url), ['/api/city/places/9912406'])
  assert.equal(calls.some(r => r.data && r.data.radius != null), false)
})

test('已加载集合按种子命中时不再发附近查询', async () => {
  const calls = []
  const nearby = [{ id: place.poiId, type: 1, tags: place.tags, name: '别的名字' }]
  const row = await readStripPlace(appFor(calls, { code: 200, data: place }), { id: 'sh-place', seed }, nearby, [31.2, 121.4])
  assert.equal(row.id, 9912406)
  assert.deepEqual(calls.map(r => r.url), ['/api/city/places/9912406'])
})

test('50 公里内对不上就保持缺失，不放大半径也不按同名点猜', async () => {
  const calls = []
  const other = { ...poi, id: 2, name: place.name, tags: '["roam:park","roam:seed:v1:other"]' }
  await assert.rejects(readStripPlace(appFor(calls, { code: 200, data: [other], truncated: true }),
    { id: 'sh-place', seed }, [], [31.2, 121.4]), /暂时无法读取/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/api/roam/pois')
  assert.ok(calls[0].data.radius <= 50000)
  assert.notEqual(calls[0].data.radius, 100000)
})

test('数字编号对不上种子时保持缺失，不再改发附近查询', async () => {
  const calls = []
  const other = { ...place, tags: '["roam:park","roam:seed:v1:other"]' }
  await assert.rejects(readStripPlace(appFor(calls, { code: 200, data: other }),
    { id: 9912406, seed }, [], [31.2, 121.4]), /未能核对/)
  assert.deepEqual(calls.map(r => r.url), ['/api/city/places/9912406'])
})

test('附近查询被拒绝时不改用更大半径再查', async () => {
  const calls = []
  await assert.rejects(readStripPlace(appFor(calls, { code: 500, msg: '查询半径不能超过50公里' }),
    { seed }, [], [31.2, 121.4]), /暂时无法读取/)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].data.radius <= 50000)
})
