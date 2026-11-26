// AUDIT-1122 F06 L06-064:改编模板同一意图复用 requestId,页面已卸载不跳转
const test = require('node:test')
const assert = require('node:assert/strict')

test('L06-064 网络失败后重试复用同一 requestId;有结果后换新号;页面不在时不跳转', async () => {
  const navs = []
  global.wx = { navigateTo: o => navs.push(o.url), showToast() {}, hideToast() {} }
  const { remixTopicTemplate } = require('../../pages/square/utils/topic-template-remix.js')
  const requests = []
  const app = { getUserID: () => 7, sendRequest: o => requests.push(o) }
  const first = remixTopicTemplate(app, 99)
  requests[0].fail()
  await first
  const second = remixTopicTemplate(app, 99, () => false)
  assert.equal(requests[1].data.requestId, requests[0].data.requestId)
  requests[1].success({ code: '200', data: { topicId: 5 } })
  assert.equal(await second, true)
  assert.equal(navs.length, 0, '页面已卸载不得跳转')
  remixTopicTemplate(app, 99)
  assert.notEqual(requests[2].data.requestId, requests[0].data.requestId)
})
