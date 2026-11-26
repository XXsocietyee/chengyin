'use strict'
// L09-109: 我的申诉标题读契约和 orient-score-view 已用的 nodeId；只有 nodeIndex 时仍读它。
const test = require('node:test')
const assert = require('node:assert/strict')
const { normalizeAppeal, normalizeList } = require('../../subpackageMember/appeal-mine/view.js')

function row(extra) {
  return Object.assign({
    kind: 'appeal', id: 12, status: 'open', sessionId: 88001, topicId: 5,
    topicName: '城南旧事', createTime: '2026-10-28 21:10:00',
  }, extra)
}

test('L09-109 reads nodeId, keeps nodeIndex only when that is the only field, and does not invent an id', () => {
  assert.equal(normalizeAppeal(row({ nodeId: 3, nodeIndex: 9 })).title, '计分申诉 · 第 3 个节点')
  assert.equal(normalizeAppeal(row({ nodeIndex: 4 })).title, '计分申诉 · 第 4 个节点')
  assert.equal(normalizeAppeal(row({ nodeId: null, nodeIndex: 4 })).title, '计分申诉')
  assert.equal(normalizeAppeal(row({ nodeId: 0, nodeIndex: 4 })).title, '计分申诉')
  assert.equal(normalizeAppeal(row({})).title, '计分申诉')
  const missing = normalizeAppeal(row({ nodeId: null }))
  assert.ok(missing)
  assert.equal(missing.title, '计分申诉')
  assert.equal(normalizeAppeal(row({ kind: 'dispute', status: 'rejected', nodeId: null })).title, '成绩争议')
  assert.deepEqual(normalizeList([row({ nodeId: null })]).map(item => item.title), ['计分申诉'])
})
