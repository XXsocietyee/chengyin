// L07-086:品牌中心四页的失败分类只有一份;各页只传自己的无权限文案
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { classifyFailure } = require('../../pages/merchant/utils/request-failure.js')

test('失败分类：权限 / 断网 / 数据', () => {
  const app = { getRequestErrorMessage: (e, f) => (e && e.msg) || f }
  assert.deepEqual(classifyFailure(app, { code: 403 }, 'x', '当前身份不能装修店铺'), { kind: 'permission', text: '当前身份不能装修店铺' })
  assert.deepEqual(classifyFailure(app, { code: 500, msg: '仅审核通过的商家可用' }, 'x', 'P'), { kind: 'permission', text: 'P' })
  assert.deepEqual(classifyFailure(app, { errMsg: 'request:fail timeout' }, 'x', 'P'), { kind: 'network', text: '网络异常，请重试。' })
  assert.deepEqual(classifyFailure(app, { code: 500, msg: '服务繁忙' }, '兜底', 'P'), { kind: 'data', text: '服务繁忙' })
  assert.deepEqual(classifyFailure({}, { code: 500 }, '兜底', 'P'), { kind: 'data', text: '兜底' })
})

test('四页不再各自定义 classifyFailure/requestText', () => {
  for (const rel of ['index.js', 'coop-setting/index.js', 'gallery/index.js', 'perks/index.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/decor', rel), 'utf8')
    assert.doesNotMatch(src, /^function (classifyFailure|requestText)\(/m, rel)
    assert.match(src, /require\('(\.\.\/)+utils\/request-failure\.js'\)/, rel)
  }
})
