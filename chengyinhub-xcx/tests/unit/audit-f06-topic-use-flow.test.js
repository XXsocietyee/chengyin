// AUDIT-1122 F06 L06-055:预览页与详情页共用「已复制草稿」,第二次采用回到同一份
const test = require('node:test')
const assert = require('node:assert/strict')

test('L06-055 预览页复制成功后,详情页再点「用这个模板」直接打开同一份草稿,不再发 /use', () => {
  const requests = []
  global.getApp = () => ({ getUserID: () => 'm1', sendRequest: o => requests.push(o) })
  const file = require.resolve('../../pages/templatedetail/utils/topic-use-flow.js')
  delete require.cache[file]
  const flow = require(file)
  const opened = []
  const opts = { toast() {}, onCopied() {}, open: id => opened.push(id) }
  const input = { id: 9, scope: '', intent: '' }
  flow.submit({}, input, opts)
  requests[0].success({ code: 200, data: { topicId: 501 } })
  flow.submit({}, input, opts) // 另一页、新实例
  assert.equal(requests.length, 1, '不得再复制一份')
  assert.deepEqual(opened, ['501', '501'])
})
