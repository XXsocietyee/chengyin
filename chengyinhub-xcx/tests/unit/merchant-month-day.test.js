// L07-124:「几月几日」写法只此一份,店铺参谋与合作中心共用
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { monthDay, slashDay } = require('../../pages/merchant/utils/month-day.js')

test('按上海日历写月日', () => {
  assert.equal(monthDay('2026-09-27T17:00:00.000+00:00'), '9月28日')
  assert.equal(slashDay('2026-10-20 09:00:00'), '10/20')
  assert.equal(monthDay(''), '')
  assert.equal(slashDay(null), '')
})

test('两页不再各自定义', () => {
  for (const rel of ['marketing/ai-insight/index.js', 'coop-center/index.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant', rel), 'utf8')
    assert.doesNotMatch(src, /^function (monthDay|slashDay)\(/m, rel)
  }
})
