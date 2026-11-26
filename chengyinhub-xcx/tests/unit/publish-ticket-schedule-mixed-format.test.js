/* L04-117:集合时间混用 'T' 与空格格式时按时间先后比,不按字符串比。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { cityOrientationScheduleIssues: issues } = require('../../pages/publish/utils/publish/publish-ticket-schedule.js')

test('T 格式开始、空格格式结束且更晚:不报错', () => {
  assert.deepEqual(issues({ mode: 1, startTime: '2026-11-22T10:00:00', endTime: '2026-11-22 11:00' }), [])
})

test('空格格式开始、T 格式结束且更早:报错', () => {
  assert.deepEqual(issues({ mode: 1, startTime: '2026-11-22 11:00', endTime: '2026-11-22T10:00:00' }).map((x) => x.field), ['endTime'])
})

test('同格式照旧', () => {
  assert.equal(issues({ mode: 1, startTime: '2026-11-22 10:00', endTime: '2026-11-22 10:00' }).length, 1)
  assert.equal(issues({ mode: 1, startTime: '', endTime: '' }).length, 2)
})
