'use strict'
// L07-003:20 条后不能永久锁死新建声音;只淘汰已结算行,UNKNOWN 永不淘汰
const test = require('node:test')
const assert = require('node:assert/strict')
const journal = require('../../pages/merchant/utils/voice-enrollment-journal.js')

function store() { const m = {}; return { m, getStorageSync: k => m[k], setStorageSync: (k, v) => { m[k] = JSON.parse(JSON.stringify(v)) } } }
const rid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
function seed(s, states) {
  s.setStorageSync('npc_voice_v1:7:merchant', { version: 1, active: null,
    records: states.map((state, i) => ({ requestId: rid(i + 1), intentId: i + 1, previousIntentId: null, state, createdAt: i })) })
}

test('begin evicts the oldest settled row when 20 READY rows exist', () => {
  const s = store(); seed(s, Array(20).fill('READY'))
  const row = journal.begin(s, 7, 'merchant', null, false)
  const saved = journal.load(s, 7, 'merchant')
  assert.equal(saved.records.length, 20)
  assert.equal(saved.active, row.requestId)
  assert.ok(!saved.records.some(r => r.requestId === rid(1)), 'oldest settled row evicted')
})
test('UNKNOWN rows are never evicted; a full journal of UNKNOWN still refuses', () => {
  const s = store(); seed(s, Array(20).fill('UNKNOWN'))
  assert.throws(() => journal.begin(s, 7, 'merchant', null, false), /20条上限/)
  const mixed = store(); seed(mixed, ['UNKNOWN'].concat(Array(19).fill('READY')))
  journal.begin(mixed, 7, 'merchant', null, false)
  assert.ok(journal.load(mixed, 7, 'merchant').records.some(r => r.requestId === rid(1) && r.state === 'UNKNOWN'))
})
test('recover from a long server history leaves room for begin', () => {
  const s = store()
  journal.recover(s, 7, 'merchant', Array.from({ length: 30 }, (_, i) => ({ requestId: rid(i + 1), intentId: i + 1, state: 'READY' })))
  assert.equal(journal.load(s, 7, 'merchant').records.length, journal.LIMIT - 1)
  assert.doesNotThrow(() => journal.begin(s, 7, 'merchant', null, false))
})
