const { test } = require('node:test')
const assert = require('node:assert/strict')
const story = require('../../pages/publish/utils/publish/pro-editor-story.js')
const copy = value => JSON.parse(JSON.stringify(value))
const when = { op: 'HAS_TAG', value: 'tag.open_door' }
function draft(blocks = [{ key: 'text', type: 'text', content: '前文后文', who: '作者', level: 2, when, branch: { answer: '保留原答案' }, custom: { nested: [1, 2] } }], nodes = []) {
  return { chapter: { name: '第一章', blocks, nodes, required: 1, schemaVersion: 1 }, pendingMaterials: [{ _localId: 'pending', intent: '保留' }] }
}
function apply(input, command) { return story.applyStoryCommand(input, command).draft }
function caret(cursor, extra = {}) {
  return Object.assign({ type: 'insertAtCaret', blockKey: 'text', cursor, trailingBlockKey: 'tail', insert: { type: 'insertMediaAt', mediaType: 'audio', blockKey: 'audio', url: '/audio.mp3' } }, extra)
}

test('caret insertion preserves both halves and all author metadata without mutating input', () => {
  const input = draft(); const before = copy(input)
  const result = apply(input, caret(2))
  assert.deepEqual(input, before)
  assert.deepEqual(result.chapter.blocks.map(b => [b.key, b.type, b.content]), [['text', 'text', '前文'], ['audio', 'audio', undefined], ['tail', 'text', '后文']])
  for (const block of [result.chapter.blocks[0], result.chapter.blocks[2]]) {
    for (const field of ['who', 'level', 'when', 'branch', 'custom']) assert.deepEqual(block[field], input.chapter.blocks[0][field])
  }
  assert.notEqual(result.chapter.blocks[0].branch, result.chapter.blocks[2].branch)
  assert.deepEqual(result.pendingMaterials, input.pendingMaterials)
  const reopened = story.materializeChapter(story.toPayloadChapter(result.chapter))
  assert.deepEqual(story.toPayloadChapter(reopened).blocks, story.toPayloadChapter(result.chapter).blocks)
  assert.equal(reopened.blocks[1]._name, "audio.mp3")
  assert.equal(reopened.description, '') // conditional prose does not leak into public summaries
})

test('caret start/end do not create empty duplicate text blocks; empty input inserts before', () => {
  for (const cursor of [0, 4]) {
    const result = apply(draft(), caret(cursor))
    assert.equal(result.chapter.blocks.length, 2)
    assert.equal(result.chapter.blocks[cursor === 0 ? 1 : 0].content, '前文后文')
    assert.equal(result.chapter.blocks[cursor === 0 ? 1 : 0].key, 'text')
  }
  assert.deepEqual(apply(draft([{ key: 'text', type: 'text', content: '' }]), caret(0)).chapter.blocks.map(b => b.key), ['audio', 'text'])
})

test('caret failures reject stale positions, surrogate cuts, key collisions and unsupported types atomically', () => {
  const input = draft([{ key: 'text', type: 'text', content: '前😀后' }]); const before = copy(input)
  for (const cursor of [-1, 99, 1.5, '1', 2]) assert.throws(() => apply(input, caret(cursor)), /光标/)
  assert.throws(() => apply(input, caret(1, { trailingBlockKey: 'text' })), /标识/)
  assert.throws(() => apply(input, caret(1, { trailingBlockKey: 'audio' })), /标识/)
  assert.throws(() => apply(input, caret(1, { insert: { type: 'insertMediaAt', mediaType: 'unsupported', blockKey: 'unsupported' } })), /不支持/)
  assert.deepEqual(input, before)
})

test('caret game insertion uses existing pending consumption and node binding contract', () => {
  const input = draft()
  input.pendingMaterials.push({ _localId: 'game', marker: 'original' })
  const node = { _localId: 'game', _storyGame: true, templateId: 11, templateInfo: { advancedConfigJson: '{"answers":["A","B"]}' } }
  const result = apply(input, caret(2, { insert: { type: 'insertNodeAt', blockKey: 'gameBlock', node } }))
  assert.deepEqual(result.pendingMaterials, [{ _localId: 'pending', intent: '保留' }])
  assert.equal(result.chapter.blocks[1].nodeKey, 'game')
  assert.equal(result.chapter.blocks[1].locationRequired, false)
  assert.equal(result.chapter.nodes[0].templateInfo.advancedConfigJson, node.templateInfo.advancedConfigJson)
  assert.equal(story.toPayloadChapter(result.chapter).blocks[1].nodeIndex, 0)
})

test('media and game reorder preserve identity, answers, all pending intents and deterministic final indexes', () => {
  const nodes = [{ _localId: 'n1', name: '一', templateInfo: { answers: ['A', 'B'] } }, { _localId: 'n2', name: '二', templateInfo: { answers: ['C'] } }]
  const input = draft([{ key: 'text', type: 'text', content: '开场' }, { key: 'a', type: 'node', nodeKey: 'n1', custom: 7 }, { key: 'image', type: 'image', url: '/image.jpg', altText: '图片说明', branch: { original: true } }, { key: 'b', type: 'node', nodeKey: 'n2' }], nodes)
  const result = apply(apply(input, { type: 'moveBlock', blockKey: 'image', index: 0 }), { type: 'moveBlock', blockKey: 'b', index: 1 })
  assert.deepEqual(result.chapter.blocks.map(b => b.key), ['image', 'b', 'text', 'a'])
  assert.deepEqual(result.chapter.nodes.map(n => [n._localId, n.sortID]), [['n2', 1], ['n1', 2]])
  assert.deepEqual(result.chapter.nodes[1].templateInfo.answers, ['A', 'B'])
  assert.deepEqual(result.chapter.blocks[0], input.chapter.blocks[2])
  assert.deepEqual(result.pendingMaterials, input.pendingMaterials)
  assert.deepEqual(story.toPayloadChapter(result.chapter).blocks.filter(b => b.type === 'node').map(b => b.nodeIndex), [0, 1])
  assert.deepEqual(input.chapter.nodes, nodes)
  assert.throws(() => apply(input, { type: 'moveBlock', blockKey: 'image', index: 4 }), /插入点/)
  assert.throws(() => apply(input, { type: 'moveBlock', blockKey: 'missing', index: 0 }), /未找到/)
})

test('canonical voice/reveal/thought/mood/branch metadata survive reopen, reorder and serialization', () => {
  const blocks = [{ key: 'text', type: 'text', content: '开场' }, { key: 'voice', type: 'voice', who: '窗外', content: '内心声音', when, custom: { a: 1 } }, { key: 'reveal', type: 'reveal', who: '对方', content: '反转', branch: { original: 1 } }, { key: 'thought', type: 'thought', thoughtKey: 'remember', custom: true }, { key: 'mood', type: 'mood', mood: 'DEFAULT', branch: { tag: 'original' } }]
  const chapter = story.materializeChapter(draft(blocks).chapter)
  const result = apply({ chapter }, { type: 'moveBlock', blockKey: 'mood', index: 0 })
  const reopened = story.materializeChapter(story.toPayloadChapter(result.chapter))
  assert.deepEqual(reopened.blocks, result.chapter.blocks)
  assert.equal(reopened.blocks.find(b => b.key === 'voice').type, 'voice')
  assert.equal(reopened.blocks.find(b => b.key === 'reveal').type, 'reveal')
  const edited = apply({ chapter: reopened }, { type: 'updatePlainBlock', blockKey: 'voice', patch: { content: '编辑后的内心声音' } })
  assert.deepEqual(edited.chapter.blocks.find(b => b.key === 'voice').custom, { a: 1 })
  assert.deepEqual(edited.chapter.blocks.find(b => b.key === 'voice').when, when)
})

test('unknown custom blocks survive local editing and remain fail-closed at publication', () => {
  const custom = { key: 'custom', type: 'author-custom', branch: { routes: ['a', 'b'] }, config: { preserve: true } }
  const chapter = story.materializeChapter(draft([{ key: 'text', type: 'text', content: '开场' }, custom]).chapter)
  const result = apply({ chapter }, caret(1))
  assert.deepEqual(result.chapter.blocks.find(b => b.key === 'custom'), custom)
  assert.throws(() => story.toPayloadChapter(result.chapter), /失效/)
})

test('beat metadata retains node identity and conditions while structural edits fail closed', () => {
  const beat = { key: 'text', type: 'text', content: '到达前', beat: 'brief', field: 'carry', nodeId: 22, when: { op: 'HAS_TAG', value: 'tag.open_door' }, npcId: 33, qid: 'question', claimLater: true, custom: { original: true } }
  const nodes = [{ id: 11, _localId: 'n1' }, { id: 22, _localId: 'n2' }]
  const chapter = story.materializeChapter(draft([beat, { key: 'image', type: 'image', url: '/image.jpg' }, { key: 'node2', type: 'node', nodeKey: 'n2' }, { key: 'node1', type: 'node', nodeKey: 'n1' }], nodes).chapter)
  assert.equal(chapter.blocks[0]._storyNodeKey, 'n2')
  const result = apply({ chapter }, { type: 'moveBlock', blockKey: 'image', index: 3 })
  const payload = story.toPayloadChapter(result.chapter)
  assert.equal(payload.blocks[0].nodeIndex, 0)
  for (const field of ['beat', 'field', 'when', 'npcId', 'qid', 'claimLater', 'custom']) assert.deepEqual(payload.blocks[0][field], beat[field])
  assert.equal(payload.blocks[0].nodeId, undefined)
  assert.equal(payload.blocks[0]._storyNodeKey, undefined)
  const reopened = story.materializeChapter({ ...payload, nodes: result.chapter.nodes })
  assert.equal(reopened.blocks[0]._storyNodeKey, 'n2')
  assert.throws(() => apply({ chapter }, caret(1)), /不能拆分/)
  assert.throws(() => apply({ chapter }, { type: 'moveBlock', blockKey: 'node2', index: 0 }), /叙事段/)
})

test('existing page snapshot undo restores commands, pending intents and route graph exactly', () => {
  let pageConfig
  global.getApp = () => ({ globalData: {}, getUserID: () => 42 })
  global.wx = { getStorageSync: () => '', removeStorageSync: () => {}, getSystemInfoSync: () => ({ windowWidth: 375 }) }
  global.Page = config => { pageConfig = config }
  require('../../pages/publish/fabu/index.js')
  const input = draft()
  const page = Object.assign({}, pageConfig, { data: { formData: { chapters: [input.chapter], imgArr: '' }, pendingMaterials: input.pendingMaterials, storyEditor: { chapterIndex: 0 } }, _routeGraph: { frozen: 'original' } })
  // 与真机 setData 一致支持路径写入(_storyCommand 只回传当前章 formData.chapters[i])
  page.setData = patch => Object.entries(patch).forEach(([path, value]) => {
    const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.')
    let cursor = page.data
    keys.slice(0, -1).forEach(key => { cursor = cursor[key] })
    cursor[keys[keys.length - 1]] = value
  })
  page.updateAllStatistics = () => {}
  page._parseImgArr = () => []
  const before = copy({ formData: page.data.formData, pendingMaterials: page.data.pendingMaterials, routeGraph: page._routeGraph })
  page._pushUndo()
  page._storyCommand(caret(2))
  page._storyCommand({ type: 'moveBlock', blockKey: 'audio', index: 0 })
  assert.notDeepEqual(page.data.formData, before.formData)
  page.undo()
  assert.deepEqual({ formData: page.data.formData, pendingMaterials: page.data.pendingMaterials, routeGraph: page._routeGraph }, before)
  assert.equal(page._undoStack.length, 0) // AUDIT-1122 L03-158:canUndo 不再下发,直接看撤销栈
})


test('divider uses the canonical type/key schema through caret insertion, move, reopen and removal', () => {
  const result = apply(draft(), caret(2, { insert: { type: 'insertMediaAt', mediaType: 'divider', blockKey: 'divider' } }))
  const divider = result.chapter.blocks.find(b => b.type === 'divider')
  assert.deepEqual(divider, { key: 'divider', type: 'divider' })
  const moved = apply(result, { type: 'moveBlock', blockKey: 'divider', index: 0 })
  const payload = story.toPayloadChapter(moved.chapter)
  assert.deepEqual(payload.blocks[0], { key: 'divider', type: 'divider' })
  const reopened = story.materializeChapter(payload)
  assert.deepEqual(reopened.blocks[0], divider)
  assert.equal(reopened.description, '')
  const removed = apply({ chapter: reopened }, { type: 'removeMedia', blockKey: 'divider' })
  assert.deepEqual(removed.chapter.blocks.map(b => b.content), ['前文', '后文'])
  assert.equal(result.chapter.blocks[0].when.value, 'tag.open_door')
})
