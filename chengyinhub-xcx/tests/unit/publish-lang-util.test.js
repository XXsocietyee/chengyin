/* L04-089:发布分包共用的 text / clone / parseJsonObject。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const lang = require('../../pages/publish/utils/publish/lang.js')

test('text 去首尾空白,空值得空串', () => {
  assert.equal(lang.text('  a '), 'a')
  assert.equal(lang.text(null), '')
  assert.equal(lang.text(0), '0')
})

test('clone 深拷贝且不共享引用,空值得 null', () => {
  const src = { a: [{ b: 1 }] }
  const out = lang.clone(src)
  assert.deepEqual(out, src)
  out.a[0].b = 2
  assert.equal(src.a[0].b, 1)
  assert.equal(lang.clone(undefined), null)
})

test('parseJsonObject 只认对象', () => {
  assert.deepEqual(lang.parseJsonObject('{"a":1}'), { a: 1 })
  const obj = { a: 1 }
  assert.equal(lang.parseJsonObject(obj), obj)
  for (const bad of ['', null, '[1]', [1], '3', '{bad', 'null']) assert.equal(lang.parseJsonObject(bad), null, String(bad))
})

test('L04-078 媒体地址与 64 位 id 同一条规则;结果反馈另认 media-asset', () => {
  for (const ok of ['https://a.b/c.png', '/pages/x.png']) assert.equal(lang.isMediaUrl(ok), true, ok)
  for (const bad of ['//cdn/x', 'http://a', '/a\\b', '', null, 'media-asset:3']) assert.equal(lang.isMediaUrl(bad), false, String(bad))
  assert.equal(lang.isMediaUrl('media-asset:3', { mediaAsset: true }), true)
  assert.equal(lang.ID_64.test('a_b-C9'), true)
  assert.equal(lang.ID_64.test('x'.repeat(65)), false)
  const after = require('../../pages/publish/utils/publish/outcome-after.js')
  assert.equal(after.validate({ qa: { enabled: true }, outcomeRules: { version: 1, pass: { images: ['media-asset:12'] }, fail: {} } }), '')
})

test('L04-087 越界坐标不上地图、不计距离;有无玩法一条规则', () => {
  const view = require('../../pages/publish/utils/publish/route-map-view.js')
  const stats = require('../../pages/publish/utils/publish/publish-stats.js')
  const policy = require('../../pages/publish/utils/publish/pro-editor-policy.js')
  const chapters = [{ _localId: 'c', nodes: [
    { _localId: 'a', latitude: '31.2', longitude: '121.4', templateId: 3 },
    { _localId: 'b', latitude: '95', longitude: '121.5' },
    { _localId: 'd', latitude: '31.3', longitude: '121.5' },
  ] }]
  const out = view.buildRouteMapView({ chapters })
  const markers = (out.patch || out).mapMarkers || out.markers
  assert.equal(markers.length, 2, '纬度 95 的节点不画')
  assert.equal(stats.totalDistanceKm([{ nodes: [chapters[0].nodes[1], chapters[0].nodes[2]] }]) > 0, false, '越界坐标不计距离')
  assert.equal(policy.hasGameplay({ templateId: 3 }), true)
  assert.equal(policy.hasGameplay({ templateInfo: { title: 'x' } }), true)
  assert.equal(policy.hasGameplay({}), false)
})

test('L04-073 情境加值列表与幸运 / 生命值阶梯用同一份身份判定', () => {
  const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')
  const ctx = require('../../pages/publish/utils/publish/check-context.js')
  const ladder = cfg.toggleHpLadder([], true)
  const luck = cfg.applyLuck([], 2)
  for (const m of ladder.concat(luck)) assert.equal(ctx.isOwnRow(m), false, JSON.stringify(m))
  const renamed = Object.assign({}, ladder[0], { label: '受伤' })
  assert.equal(ctx.isOwnRow(renamed), false, '阶梯行按条件认,改了名也不会在加值列表里出现第二次')
  assert.equal(ctx.isOwnRow({ label: '雨天', value: -1, when: { var: 'sys.weather', op: 'EQ', value: 1 } }), true)
})
