'use strict';

const assert = require('node:assert');
const test = require('node:test');
const { parseRoleNeed } = require('../../utils/role-need');

const FE_SAMPLE = [
  '坐坐逛逛｜参考示例 · 适合店铺：书店咖啡、甜品咖啡。',
  '参考示例 · 权益示例：指定饮品或甜品 1 份。',
  '最低交付要求：杯型、可选饮品、冷热选择、堂食外带、加奶或换豆差价写清；饮品权益不自动包含座位保留。',
  '（以上为模板参考，不是已确认的商家供给；最终以本地版本商家确认的权益卡为准。）',
].join('\n');

test('自由探索位置指引拆成适合店铺、权益示例、最低交付要求', () => {
  assert.deepStrictEqual(parseRoleNeed(FE_SAMPLE), {
    shops: '书店咖啡、甜品咖啡',
    perkExample: '指定饮品或甜品 1 份',
    minDelivery: '杯型、可选饮品、冷热选择、堂食外带、加奶或换豆差价写清；饮品权益不自动包含座位保留',
    raw: '',
  });
});

test('只有部分标签时其余字段为空', () => {
  assert.deepStrictEqual(parseRoleNeed('歇脚｜参考示例 · 适合店铺：茶馆。\r\n最低交付要求：写清茶位费'), {
    shops: '茶馆',
    perkExample: '',
    minDelivery: '写清茶位费',
    raw: '',
  });
});

test('没有任何标签的自由文本整段放进 raw', () => {
  assert.deepStrictEqual(parseRoleNeed('  需要一家能坐下来的店。\n最好有窗。 '), {
    shops: '',
    perkExample: '',
    minDelivery: '',
    raw: '需要一家能坐下来的店。\n最好有窗。',
  });
});

test('空值返回全空字段', () => {
  const empty = { shops: '', perkExample: '', minDelivery: '', raw: '' };
  assert.deepStrictEqual(parseRoleNeed(null), empty);
  assert.deepStrictEqual(parseRoleNeed(undefined), empty);
  assert.deepStrictEqual(parseRoleNeed(''), empty);
  assert.deepStrictEqual(parseRoleNeed('  \n '), empty);
});
