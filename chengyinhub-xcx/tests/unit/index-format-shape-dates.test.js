'use strict';
// L10-121:首页三条列表共用一份日期整形。
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../../utils/index/index-format.js');

test('start/end 字段一次补齐,覆盖模式与旧 processTopicDate 补缺模式各自成立', () => {
  const [row] = f.shapeListDates([{ startDate: '2026-09-05 14:30:00', endDate: '2026-09-06' }], true);
  assert.equal(row.month, '09'); assert.equal(row.day, '05');
  assert.equal(row.dateTime, '09.05 14:30'); assert.equal(row.formattedStartDate, '09.05 14:30');
  assert.equal(row.endDateTime, '09.06 00:00'); assert.equal(row.formattedEndDate, '09.06 00:00');
  assert.match(row.formattedDateTime, /^2026年9月5日 周六 14:30$/);
  const [kept] = f.processTopicDate([{ startDate: '2026-09-05 14:30:00', dateTime: '服务端给的' }]);
  assert.equal(kept.dateTime, '服务端给的', '补缺模式不覆盖已有 dateTime');
});

test('解析不了的日期不写 NaN 文案', () => {
  const [row] = f.shapeListDates([{ startDate: 'not-a-date' }]);
  assert.equal(row.formattedDateTime, undefined);
});
