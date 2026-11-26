// AUDIT-1122 F06 L06-027:开售截止支持带偏移 ISO,裸串按中国时区
process.env.TZ = 'UTC'
const test = require('node:test')
const assert = require('node:assert/strict')
const motion = require('../../pages/topic/utils/topic-motion.js')

test('L06-027 带偏移 ISO 的开售截止能判出已截止', () => {
  const end = '2026-11-22T23:59:59+08:00'
  assert.equal(motion.topicSaleClosed({ saleEndAt: end }, Date.parse('2026-11-22T16:00:00Z')), true)
  assert.equal(motion.topicSaleClosed({ saleEndAt: end }, Date.parse('2026-11-22T15:00:00Z')), false)
})

test('L06-027 裸串按中国时区(手机在 UTC)', () => {
  // 中国 2026-11-22 10:00 = UTC 02:00
  assert.equal(motion.topicSaleClosed({ saleEndAt: '2026-11-22 10:00:00' }, Date.parse('2026-11-22T02:30:00Z')), true)
})
