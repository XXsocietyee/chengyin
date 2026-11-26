'use strict'
// RECHECK-1122 OR-038：退出账号保留按账号分键的俱乐部/商家写请求意图台账，其余账号私有键照删。
const test = require('node:test')
const assert = require('node:assert/strict')
const { clearStorageForLogout } = require('../../utils/roam-player-memory.js')

function memoryStorage(initial) {
  const values = { ...(initial || {}) }
  return {
    getStorageSync(key) { return values[key] },
    getStorageInfoSync() { return { keys: Object.keys(values) } },
    removeStorageSync(key) { delete values[key] },
    values,
  }
}

test('OR-038 退出保留 club_*/merchant_operator 意图台账(:m<会员号>)', () => {
  const storage = memoryStorage({
    authorization: 'tok',
    'club_post_request_intents_v1:m101': { a: 1 },
    'club_attendance_request_intents_v1:m101': { b: 1 },
    'club_role_request_intents_v1:m202': { c: 1 },
    'merchant_operator_request_intents_v1:m303': { d: 1 },
    'club_post_request_intents_v1': { legacy: 1 },
    'club_post_request_intents_v1:m0': { bad: 1 },
    'club_post_request_intents_v1:mabc': { bad: 1 },
  })
  assert.equal(clearStorageForLogout(storage), true)
  const keys = Object.keys(storage.values).sort()
  assert.deepEqual(keys, [
    'club_attendance_request_intents_v1:m101',
    'club_post_request_intents_v1:m101',
    'club_role_request_intents_v1:m202',
    'merchant_operator_request_intents_v1:m303',
  ])
})
