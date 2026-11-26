const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

// 2026-11-24 业主决策 L10-138(默认项 A):从未接入的 cy-identity-tag 组件已删除;
// 公开投影只下发封顶 identityKind 的后端契约仍保留。
test('L10-138:cy-identity-tag 组件已删除', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'components/cy/identity-tag')), false)
})

test('后端只下发封顶的 identityKind,绝不下发账号级 user_type', () => {
  const mapper = read('../chengyinhub-system/src/main/resources/mapper/business/PublicMemberMapper.xml')
  // 2026-08-29 窄投影:在 SQL 里就把账号类型收敛成 BIZ/null,原始枚举不出库。
  assert.match(mapper, /<result property="identityKind" column="identity_kind"\/>/,
    'resultMap 必须映射收敛后的 identity_kind')
  // RUN-13 后该投影 join 了 player_growth,列必须带表别名消歧 —— pin 允许可选的 `x.` 前缀,
  // 契约要钉的是「收敛在 SQL 里、值域封顶」,不是别名写法。
  assert.match(mapper, /CASE WHEN (?:\w+\.)?role = 'merchant' THEN 'BIZ' ELSE NULL END AS identity_kind/,
    '收敛必须发生在 SQL 里 —— 值域封顶，不靠调用方自觉')
  assert.doesNotMatch(mapper, /<result property="userType"/,
    'user_type 不得出现在公开投影的 resultMap 里')

  const vo = read('../chengyinhub-system/src/main/java/com/chengyinhub/business/domain/vo/PublicMemberVO.java')
  assert.match(vo, /private String identityKind;/)
  assert.match(vo, /public String getIdentityKind\(\)/, '没有 getter 的话 JSON 里根本不会出现这个字段')
  assert.doesNotMatch(vo, /userType/,
    'PublicMemberVO 不得含 userType —— 它与 password/phone/openId 同属匿名响应禁止字段')
})
