'use strict'
// AUDIT-1122 L10-087(业主 2026-11-24 选 B):协作邀约的待缴保证金。服务端没给金额时不再写死 ¥50,
// 写「保证金金额待确认」;给了金额照实显示。
const test = require('node:test')
const assert = require('node:assert/strict')
const { decorate } = require('../../utils/coop-invite-view.js')

const row = (extra) => decorate([Object.assign({ id: 101, inviteType: 1, status: 0, depositOwed: true }, extra)])[0]

test('L10-087 服务端给了保证金金额:按真实金额显示', () => {
  assert.match(row({ depositAmount: 80 }).depositDueText, /^锁价后待缴 ¥80(\.0)? 保证金$/)
})

test('L10-087 服务端没给金额(缺字段、null、0、非数字):不写死 50,写金额待确认', () => {
  for (const depositAmount of [undefined, null, 0, '50', NaN]) {
    const text = row({ depositAmount }).depositDueText
    assert.equal(text, '锁价后待缴保证金，保证金金额待确认', String(depositAmount))
    assert.doesNotMatch(text, /50/)
  }
})

test('L10-087 不欠保证金或旧版只读邀约:不出这一行', () => {
  assert.equal(row({ depositOwed: false, depositAmount: 80 }).depositDueText, '')
  assert.equal(row({ inviteType: 2, depositAmount: 80 }).depositDueText, '')
})
