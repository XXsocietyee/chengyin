// L04-001:一次字段写入只跑受影响的派生刷新,存盘字段形状不变。
const test = require('node:test')
const assert = require('node:assert/strict')

const REFRESHERS = ['_refreshEffectResources', '_refreshSupportMatrix', '_refreshOutcomeContract', '_syncCheckDerived',
  '_syncQaAnswerError', '_syncQuesto', '_syncSegments', '_syncClueContent', 'refreshPreviewState']
let definition
function page() {
  global.getApp = () => ({ globalData: {}, tips() {}, getUserID: () => 9, getAuthorization: () => '', sendRequest() {} })
  global.Page = (value) => { definition = value }
  global.wx = Object.assign({ getBackgroundAudioManager: () => ({ stop() {} }), showToast() {} }, require('../helpers/memory-storage.js')())
  delete require.cache[require.resolve('../../pages/publish/temp/index.js')]
  require('../../pages/publish/temp/index.js')
  const host = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  host.setData = function (patch, done) {
    Object.entries(patch).forEach(([key, value]) => {
      const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.')
      let at = this.data
      parts.slice(0, -1).forEach((part) => { at = at[part] })
      at[parts.at(-1)] = value
    })
    if (done) done()
  }
  host.calls = []
  REFRESHERS.forEach((name) => { host[name] = () => { host.calls.push(name) } })
  return host
}

test('改标题只刷新预览,不重算玩法支持、效果和线索', () => {
  const host = page()
  const before = JSON.stringify(host.data.advanced)
  host._setFormState({ 'formData.title': '新玩法', advancedConfigError: '' })
  assert.equal(host.data.formData.title, '新玩法')
  assert.equal(JSON.stringify(host.data.advanced), before)
  assert.deepEqual(host.calls, ['refreshPreviewState'])
})

test('改剧情只同步线索回显', () => {
  const host = page()
  host._setFormState({ storyBeats: [{ id: 1, text: '一段', tag: '线索', imgs: [] }] })
  assert.equal(host.data.storyBeats[0].text, '一段')
  assert.deepEqual(host.calls, ['_syncClueContent'])
})

test('改问答配置才刷新玩法派生,标题字段不会被改写', () => {
  const host = page()
  host.data.formData.title = '保持'
  host._setFormState({ 'advanced.qa.options': [{ id: 'a', label: '甲' }], advancedConfigError: '' })
  assert.equal(host.data.formData.title, '保持')
  assert.equal(host.data.advanced.qa.options[0].label, '甲')
  assert.deepEqual(host.calls, ['_refreshEffectResources', '_refreshSupportMatrix', '_refreshOutcomeContract',
    '_syncCheckDerived', '_syncQaAnswerError', '_syncQuesto', '_syncSegments', 'refreshPreviewState'])
})
