/* L04-079:支持矩阵读取失败不缓存,下次打开自动重取;成功结果仍复用。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const matrix = require('../../pages/publish/utils/publish/gameplay-support-matrix.js')
const ok = require('./fixtures/gameplay-support-matrix.json')

test('失败后下一次 load 重新请求，成功后不再请求', async () => {
  const calls = []
  const app = { sendRequest: (o) => calls.push(o) }
  const first = matrix.load(app)
  calls[0].fail()
  assert.equal(await first, null)
  const second = matrix.load(app)
  assert.equal(calls.length, 2, '失败没有被缓存')
  calls[1].success(ok)
  assert.ok(await second)
  await matrix.load(app)
  assert.equal(calls.length, 2, '成功结果复用')
})

test('L04-041 结果规则缺省形状只有一处定义', () => {
  const after = require('../../pages/publish/utils/publish/outcome-after.js')
  assert.deepEqual(after.defaultRules({ qa: { enabled: true } }), after.once({ qa: { enabled: true } }) ? { version: 1, pass: {} } : { version: 1, pass: {}, fail: {} })
  assert.ok(after.defaultRules({}).version === 1)
})
