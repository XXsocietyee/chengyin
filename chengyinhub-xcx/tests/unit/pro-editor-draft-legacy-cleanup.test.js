/* L04-003 / L04-006:草稿只存一份章节、同一草稿不重复写活动指针；发布后旧版无 scope 信封不再复活。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const draft = require('../../pages/publish/utils/publish/pro-editor-draft.js')
const memoryStorage = require('../helpers/memory-storage.js')

function counting() {
  const storage = memoryStorage()
  const writes = []
  const set = storage.setStorageSync
  storage.setStorageSync = (key, value) => { writes.push(key); set(key, value) }
  return { storage, writes }
}

test('L04-006 旧版无 scope 信封:恢复、重存、发布清除后,下次打开不再当成新草稿', () => {
  const storage = memoryStorage()
  storage.setStorageSync('pro_editor_draft_new_X', { memberId: '1', draftUuid: 'X', formData: { name: '旧稿', chapters: [] }, savedAt: 1 })
  assert.equal(draft.loadDraft(storage, { draftUuid: 'X' }, { memberId: '1', operationScope: '' }).status, 'ready')
  draft.saveDraft(storage, { memberId: '1', operationScope: '', draftUuid: 'X', formData: { name: '旧稿', chapters: [] } })
  assert.equal(draft.removeDraft(storage, { draftUuid: 'X' }, { memberId: '1', operationScope: '' }), true)
  assert.equal(draft.readActiveNewDraft(storage, '1', ''), '')
  assert.equal(draft.loadDraft(storage, { draftUuid: 'X' }, { memberId: '1', operationScope: '' }).status, 'missing')
})

test('L04-006 别人的旧版信封不动', () => {
  const storage = memoryStorage()
  storage.setStorageSync('pro_editor_draft_new_X', { memberId: '2', draftUuid: 'X', formData: {}, savedAt: 1 })
  draft.removeDraft(storage, { draftUuid: 'X' }, { memberId: '1', operationScope: '' })
  assert.equal(storage.getStorageSync('pro_editor_draft_new_X').memberId, '2')
})

test('L04-003 信封里章节只存一份；连续保存同一草稿只写一次活动指针', () => {
  const { storage, writes } = counting()
  const save = (name) => draft.saveDraft(storage, { memberId: '9', operationScope: '', draftUuid: 'D', formData: { name, chapters: [{ name: '一' }] } })
  const key = save('a'); save('b'); save('c')
  const envelope = storage.getStorageSync(key)
  assert.equal('chapters' in envelope, false)
  assert.deepEqual(envelope.formData.chapters, [{ name: '一' }])
  assert.equal(writes.filter((k) => k.indexOf('pro_editor_active_') === 0).length, 1)
  assert.equal(writes.filter((k) => k === key).length, 3)
  assert.equal(draft.readActiveNewDraft(storage, '9', ''), 'D')
})

test('L04-003 指针被清掉后再保存会重新写回', () => {
  const { storage } = counting()
  const save = () => draft.saveDraft(storage, { memberId: '8', operationScope: '', draftUuid: 'E', formData: { chapters: [] } })
  save()
  draft.removeDraft(storage, { draftUuid: 'E' }, { memberId: '8', operationScope: '' })
  save()
  assert.equal(storage.getStorageSync('pro_editor_active_8'), 'E')
})

test('L04-090 create() 生成的发布号随 UNKNOWN 记录落盘并原样读回', () => {
  const rid = require('../../pages/publish/utils/publish/publication-request-id.js')
  const storage = memoryStorage()
  const id = rid.create()
  draft.saveDraft(storage, { memberId: '5', operationScope: '', draftUuid: 'P', formData: { chapters: [] },
    publishAttempt: { status: 'UNKNOWN', topicId: '3', publishRequestId: id } })
  const back = draft.loadDraft(storage, { draftUuid: 'P' }, { memberId: '5', operationScope: '' }).envelope
  assert.equal(back.publishAttempt.publishRequestId, id)
})
