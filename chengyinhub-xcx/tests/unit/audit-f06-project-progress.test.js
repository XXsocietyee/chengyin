// AUDIT-1122 F06 L06-026:lifecycle 未知(null/缺省/非法)不当成草稿 0,不给主键
const test = require('node:test')
const assert = require('node:assert/strict')
const pp = require('../../pages/topic/utils/project-progress.js')

test('L06-026 parseLifecycle 只认 0–7', () => {
  assert.equal(pp.parseLifecycle(3), 3)
  assert.equal(pp.parseLifecycle('7'), 7)
  for (const v of [null, undefined, '', 8, -1, 2.5, '7x']) assert.equal(pp.parseLifecycle(v), null)
})

test('L06-026 lifecycle 为 null 时主键不是「继续编辑」', () => {
  assert.equal(pp.hostPrimary({ productType: 2, lifecycle: null }).disabled, true)
  assert.equal(pp.hostPrimary({ productType: 2, lifecycle: 0 }).text, '继续编辑')
})
