/* L04-002:老模板上加/删排序条目、连线对子后保存，派生的 answerOrder / pairs 必须跟着条目走。 */
const assert = require('node:assert/strict')
const test = require('node:test')
const cfg = require('../../pages/publish/utils/publish/advanced-game-config.js')

function savedSortRaw() {
  const m = cfg.defaultConfig()
  m.sort.enabled = true
  m.sort.prompt = '排好'
  m.sort.items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]
  m.match.enabled = true
  m.match.prompt = '连好'
  m.match.left = [{ id: 'l1', label: 'L1' }, { id: 'l2', label: 'L2' }]
  m.match.right = [{ id: 'r1', label: 'R1' }, { id: 'r2', label: 'R2' }]
  return cfg.serialize(m)
}

const edit = (raw, mutate) => {
  const model = cfg.parse(raw).value
  mutate(model)
  return JSON.parse(cfg.serializeChanges(model, raw))
}

test('加一个排序条目：answerOrder 覆盖新条目', () => {
  const saved = edit(savedSortRaw(), (m) => { m.sort.items.push({ id: 'd', label: 'D' }) })
  assert.deepEqual(saved.sort.answerOrder, ['a', 'b', 'c', 'd'])
})

test('删一个排序条目：answerOrder 不再引用它', () => {
  const saved = edit(savedSortRaw(), (m) => { m.sort.items = m.sort.items.filter((row) => row.id !== 'a') })
  assert.deepEqual(saved.sort.answerOrder, ['b', 'c'])
})

test('加一对连线：pairs 跟着加', () => {
  const saved = edit(savedSortRaw(), (m) => {
    m.match.left.push({ id: 'l3', label: 'L3' })
    m.match.right.push({ id: 'r3', label: 'R3' })
  })
  assert.deepEqual(saved.match.pairs, [['l1', 'r1'], ['l2', 'r2'], ['l3', 'r3']])
})

test('原稿没开排序，改成排序：存出的 sort 带 answerOrder', () => {
  const qa = cfg.defaultConfig()
  qa.match.enabled = true
  qa.match.prompt = '连好'
  qa.match.left = [{ id: 'l1', label: 'L1' }, { id: 'l2', label: 'L2' }]
  qa.match.right = [{ id: 'r1', label: 'R1' }, { id: 'r2', label: 'R2' }]
  const raw = cfg.serialize(qa)
  const saved = edit(raw, (m) => {
    m.sort.enabled = true
    m.sort.prompt = '排好'
    m.sort.items = [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }]
  })
  assert.deepEqual(saved.sort.answerOrder, ['x', 'y'])
  assert.equal(cfg.validate(saved), '')
})

test('没动过的模板原样返回', () => {
  const raw = savedSortRaw()
  assert.equal(cfg.serializeChanges(cfg.parse(raw).value, raw), raw)
})
