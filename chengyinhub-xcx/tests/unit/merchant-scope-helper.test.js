// L07-110:商家页「当前账号」与「无权限」判据只有一份,客户/账本/营销/店铺参谋都从 pages/merchant/utils/merchant-scope.js 取
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const { memberIdOf, isAccessDenied } = require('../../pages/merchant/utils/merchant-scope.js')

test('memberIdOf / isAccessDenied 行为', () => {
  assert.equal(memberIdOf({ getUserID: () => 42 }), '42')
  assert.equal(memberIdOf({ getUserID: () => null }), '')
  assert.equal(memberIdOf({}), '')
  assert.equal(isAccessDenied({ code: 403 }), true)
  assert.equal(isAccessDenied({ code: '401' }), true)
  assert.equal(isAccessDenied({ code: 500, statusCode: 403 }), true)
  assert.equal(isAccessDenied({ code: 500 }), false)
  assert.equal(isAccessDenied(null), false)
})

test('四个商家页不再各自定义这两个判据', () => {
  for (const rel of ['customer/index.js', 'ledger/index.js', 'marketing/index.js', 'marketing/ai-insight/index.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'pages/merchant', rel), 'utf8')
    assert.doesNotMatch(src, /^function (currentMemberId|isAccessDenied)\(/m, rel)
    assert.match(src, /require\('(\.\.\/)+utils\/merchant-scope\.js'\)/, rel)
  }
})

test('客户页的请求守卫都从 _scopeGuard 出发', () => {
  const src = fs.readFileSync(path.join(ROOT, 'pages/merchant/customer/index.js'), 'utf8')
  assert.equal((src.match(/=== currentMemberId\(\)/g) || []).length, 1, '只有 _scopeGuard 自己比对当前账号')
  assert.match(src, /const isCurrentRequest = \(\) => inScope\(\) && token === that\._token && queryKey === that\._activeQueryKey;/)
})

// L07-141:登录失效判据只有一份(team / reviews 共用)
test('isAuthenticationFailure:401 或业务码 2', () => {
  const { isAuthenticationFailure } = require('../../pages/merchant/utils/merchant-scope.js')
  assert.equal(isAuthenticationFailure({ code: 2 }), true)
  assert.equal(isAuthenticationFailure({ statusCode: 401 }), true)
  assert.equal(isAuthenticationFailure({ code: 500 }, 401), true)
  assert.equal(isAuthenticationFailure({ code: 403 }), false)
  for (const rel of ['team/index.js', 'reviews/index.js']) {
    const src = fs.readFileSync(path.join(ROOT, 'pages/merchant', rel), 'utf8')
    assert.doesNotMatch(src, /^function isAuthenticationFailure\(/m, rel)
  }
})
