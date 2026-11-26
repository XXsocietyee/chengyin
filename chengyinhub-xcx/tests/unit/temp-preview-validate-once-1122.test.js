// AUDIT-1122 L04-115:每次表单改动的预览刷新里,整份玩法配置只校验一次;
// 排序 / 配对 / 分类面板的实时报错直接用这一次的结果,与单独校验得到的一字不差。
const test = require('node:test')
const assert = require('node:assert/strict')

const config = require('../../pages/publish/utils/publish/advanced-game-config.js')
const app = { globalData: {}, tips() {}, getUserID: () => 9, getAuthorization: () => '', sendRequest() {} }
const clone = (v) => JSON.parse(JSON.stringify(v))
let definition
function page() {
  global.getApp = () => app
  global.Page = (value) => { definition = value }
  global.wx = Object.assign({ getBackgroundAudioManager: () => ({ stop() {} }), showToast() {} }, require('../helpers/memory-storage.js')())
  delete require.cache[require.resolve('../../pages/publish/temp/index.js')]; require('../../pages/publish/temp/index.js')
  const p = Object.assign({}, definition, { data: clone(definition.data) })
  p.setData = function (patch, done) { for (const [k, value] of Object.entries(patch)) { const keys = k.replace(/\[(\d+)\]/g, '.$1').split('.'); let at = this.data; for (const key of keys.slice(0, -1)) at = at[key]; at[keys.at(-1)] = value } if (done) done() }
  p._refreshOutcomeContract = () => ({ items: [], errors: [] }); p._syncCheckDerived = () => {}; p.hasModule = () => false
  return p
}

test('排序面板打开时,一次预览刷新只跑一遍整份校验,面板报错与校验结果一致', (t) => {
  const p = page()
  p.data.gameSection = 'sort'
  p.data.advanced = config.defaultConfig()
  p.data.advanced.sort.enabled = true
  const expected = config.validate(clone(p.data.advanced), p._advancedValidateOpts())
  assert.ok(expected, '夹具必须是一份校验不过的配置')
  let calls = 0
  const real = config.validate
  t.mock.method(config, 'validate', function () { calls += 1; return real.apply(this, arguments) })
  p.refreshPreviewState()
  assert.equal(calls, 1)
  assert.equal(p.data.gameConfigError, expected)
  assert.equal(p.data.canOpenPreview, false)
})

test('不在实时报错的面板时,预览刷新同样只校验一遍,面板报错为空', (t) => {
  const p = page()
  p.data.gameSection = 'qa'
  p.data.advanced = config.defaultConfig()
  let calls = 0
  const real = config.validate
  t.mock.method(config, 'validate', function () { calls += 1; return real.apply(this, arguments) })
  p.refreshPreviewState()
  assert.equal(calls, 1)
  assert.equal(p.data.gameConfigError, '')
})
