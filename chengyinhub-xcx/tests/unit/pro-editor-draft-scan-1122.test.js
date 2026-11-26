// AUDIT-1122 L04-021:打开编辑页找「活动的新草稿」时,只读新草稿桶;主题桶的信封一份都不读。
// 指针写失败后的找回语义不变:仍在新草稿里挑 savedAt 最新的一份并补写指针。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const draft = require('../../pages/publish/utils/publish/pro-editor-draft.js')

function memoryStorage() {
  const map = new Map()
  const reads = []
  return {
    map, reads,
    getStorageSync: (k) => { reads.push(k); return map.has(k) ? JSON.parse(JSON.stringify(map.get(k))) : '' },
    setStorageSync: (k, v) => { map.set(k, JSON.parse(JSON.stringify(v))) },
    removeStorageSync: (k) => { map.delete(k) },
    getStorageInfoSync: () => ({ keys: [...map.keys()] }),
  }
}

test('20 份主题草稿在场时,找活动新草稿不读任何主题桶信封', () => {
  const st = memoryStorage()
  for (let i = 1; i <= 20; i++) draft.saveDraft(st, { memberId: 7, topicId: i, formData: { title: 't' + i }, savedAt: 1000 + i })
  draft.saveDraft(st, { memberId: 7, draftUuid: 'u1', formData: { title: 'new' }, savedAt: 5000 })
  st.reads.length = 0
  assert.equal(draft.readActiveNewDraft(st, 7), 'u1')
  assert.deepEqual(st.reads.filter((k) => k.includes('_topic_')), [])
})

test('指针写失败:仍找回 savedAt 最新的新草稿并补写指针;别人的草稿和另一身份的不算', () => {
  const st = memoryStorage()
  draft.saveDraft(st, { memberId: 7, draftUuid: 'old', formData: {}, savedAt: 100 })
  const realSet = st.setStorageSync
  st.setStorageSync = (k, v) => { if (k.startsWith('pro_editor_active_')) throw new Error('quota'); realSet(k, v) }
  draft.saveDraft(st, { memberId: 7, draftUuid: 'newer', formData: {}, savedAt: 200 })
  draft.saveDraft(st, { memberId: 8, draftUuid: 'other', formData: {}, savedAt: 900 })
  draft.saveDraft(st, { memberId: 7, draftUuid: 'merchant', operationScope: 'MERCHANT', formData: {}, savedAt: 950 })
  st.setStorageSync = realSet
  assert.equal(draft.readActiveNewDraft(st, 7), 'newer')
  assert.equal(st.map.get('pro_editor_active_7'), 'newer')
  assert.equal(draft.readActiveNewDraft(st, 7, 'MERCHANT'), 'merchant')
})

test('删掉活动草稿时只比对指针、不再扫全部信封;下次打开按桶找回剩下最新的一份', () => {
  const st = memoryStorage()
  draft.saveDraft(st, { memberId: 7, draftUuid: 'a', formData: {}, savedAt: 100 })
  draft.saveDraft(st, { memberId: 7, draftUuid: 'b', formData: {}, savedAt: 200 })
  for (let i = 1; i <= 5; i++) draft.saveDraft(st, { memberId: 7, topicId: i, formData: {}, savedAt: 10 })
  st.reads.length = 0
  assert.equal(draft.removeDraft(st, { draftUuid: 'b' }, { memberId: 7 }), true)
  assert.deepEqual(st.reads.filter((k) => !k.includes('_new_') && !k.startsWith('pro_editor_active_')), [])
  assert.equal(st.map.has('pro_editor_active_7'), false)
  assert.equal(draft.readActiveNewDraft(st, 7), 'a')
})
