'use strict'
// B1:onError / onUnhandledRejection 脱敏、去重、限量写入实时日志。
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const ce = require('../../utils/client-error.js')
let logs, filters
const wxApi = { getRealtimeLogManager: () => ({ error: (...args) => logs.push(args), addFilterMsg: (m) => filters.push(m) }) }
beforeEach(() => { logs = []; filters = []; ce.resetClientErrorReports() })

test('手机号、长数字与令牌被打码,消息截断', () => {
  assert.equal(ce.reportClientError('error', 'fail 13800138000 token eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop Bearer abc', { wx: wxApi }), true)
  const text = logs[0][2]
  assert.doesNotMatch(text, /13800138000/)
  assert.doesNotMatch(text, /eyJhbGciOiJIUzI1NiJ9/)
  assert.match(text, /Bearer \*\*\*/)
  assert.ok(ce.sanitize('x'.repeat(2000)).length <= 400)
  assert.deepEqual(filters, ['client_error'])
})

test('同一消息只报一次,单次启动最多 MAX_REPORTS 条', () => {
  ce.reportClientError('error', 'same', { wx: wxApi })
  ce.reportClientError('error', 'same', { wx: wxApi })
  assert.equal(logs.length, 1)
  for (let i = 0; i < 30; i++) ce.reportClientError('rejection', new Error('e' + i), { wx: wxApi })
  assert.equal(logs.length, ce.MAX_REPORTS)
})

test('没有实时日志能力时静默返回', () => {
  assert.equal(ce.reportClientError('error', 'x', { wx: {} }), false)
})
