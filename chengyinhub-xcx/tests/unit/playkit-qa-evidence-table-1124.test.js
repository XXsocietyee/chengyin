// 2026-11-24 选项问答证据表(qa.table):主人批准的原型 —— 答题屏摆记录表 + 规则,点行划掉 / 恢复,右侧选一行,
// 底部「确认选择」提交;判错时那一行与它违反的规则标红,作者的话落在表下;划掉的行不能选,划痕跨判错 / 隐藏再显示保留。
// 判定仍是原 SUBMIT_QA {optionId}(服务端);组件只报选了哪一行。夹具为虚构内容。
const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const fs = require('node:fs')

const { pickPlayKit } = require('../../pages/play/utils/playkit-view.js')

const ROOT = path.join(__dirname, '../..')
const PAINT = 'optionList, table, rules, lastRule, passed, finished'

function loadQa() {
  let def = null
  const prevC = global.Component, prevB = global.Behavior
  global.Behavior = (b) => b
  global.Component = (d) => { def = d }
  const file = path.join(ROOT, 'pages/playkit/components/playkit-qa/index.js')
  delete require.cache[require.resolve(file)]
  require(file)
  global.Component = prevC; global.Behavior = prevB
  return def
}

const TABLE = {
  columns: ['借书人', '日期', '书名'],
  rows: [
    { id: 'r1', cells: ['甲', '周一', '星图'] },
    { id: 'r2', cells: ['乙', '周三', '潮汐'] },
    { id: 'r3', cells: ['丙', '周日', '风铃'] },
  ],
}
const RULES = [{ k: '①', t: '周一闭馆' }, { k: '②', t: '周日只还不借' }]
const OPTIONS = [{ id: 'r1', t: '甲' }, { id: 'r2', t: '乙' }, { id: 'r3', t: '丙' }]

function mount(def, props) {
  global.wx = Object.assign({}, global.wx, { vibrateShort() {}, vibrateLong() {} })
  const stage = { nudges: 0, misses: 0, wins: 0, nudge() { this.nudges++ }, miss() { this.misses++; return false },
    win() { this.wins++ }, fail() {}, begin() {}, _stopAll() {} }
  const events = []
  const c = Object.assign({
    data: Object.assign({}, def.data, {
      show: true, mode: 'pick', multi: false, judge: true, passed: false, finished: false, attempts: 0,
      options: OPTIONS, table: TABLE, rules: RULES, lastRule: 0, lastOptionId: '', lastOptionIds: [],
      feedbackText: '', feedbackImages: [], sessionId: 'S1', nodeId: 'N1', reducedMotion: true, maxTries: 0,
      answerIds: [], answerId: '', reveal: false,
    }, props),
    setData(patch) {
      Object.assign(this.data, patch)
      if (Object.keys(patch).some(k => PAINT.split(', ').includes(k))) def.observers[PAINT].call(this)
    },
    selectComponent: () => stage,
    triggerEvent: (name, detail) => events.push({ name, detail }),
  }, def.methods)
  const main = Object.keys(def.observers).find(k => k.startsWith('show, options'))
  c.update = (patch) => {
    Object.assign(c.data, patch || {})
    def.observers[main].apply(c, main.split(',').map(k => c.data[k.trim()]))
  }
  c.stage = stage
  c.events = events
  c.def = def
  c.update()
  return c
}

const tap = (i) => ({ currentTarget: { dataset: { i } } })

test('有表的单选题:表、规则都画出来,行与选项一一对应', () => {
  const c = mount(loadQa())
  assert.equal(c.data.tableOn, true)
  assert.deepEqual(c.data.tableCols, ['借书人', '日期', '书名'])
  assert.deepEqual(c.data.tableRows.map(r => r.id), ['r1', 'r2', 'r3'])
  assert.deepEqual(c.data.tableRows[1].cells, ['乙', '周三', '潮汐'])
  assert.deepEqual(c.data.ruleList.map(r => r.k + r.t), ['①周一闭馆', '②周日只还不借'])
  assert.equal(c.data.anyStruck, false)
  assert.equal(c.data.ctaLabel, '确认选择')
  assert.equal(c.data.ctaDisabled, true)
})

test('点行划掉、再点恢复;「全部恢复」一次清空', () => {
  const c = mount(loadQa(), { sessionId: 'S-strike' })
  c.onStrike(tap(0))
  assert.equal(c.data.tableRows[0].struck, true)
  assert.equal(c.data.anyStruck, true)
  c.onStrike(tap(0))
  assert.equal(c.data.tableRows[0].struck, false)
  assert.equal(c.data.anyStruck, false)
  c.onStrike(tap(0)); c.onStrike(tap(2))
  assert.deepEqual(c.data.tableRows.map(r => r.struck), [true, false, true])
  c.onRestoreAll()
  assert.deepEqual(c.data.tableRows.map(r => r.struck), [false, false, false])
  assert.equal(c.data.anyStruck, false)
})

test('划掉的行不能选;划掉已选中的那行就取消选中', () => {
  const c = mount(loadQa(), { sessionId: 'S-lock' })
  c.onStrike(tap(0))
  c.onPick(tap(0))
  assert.equal(c.data.tableRows[0].state, '', '划掉的行点圆点没反应')
  assert.equal(c.data.ctaDisabled, true)
  c.onPick(tap(1))
  assert.equal(c.data.tableRows[1].state, 'is-on')
  assert.equal(c.data.ctaDisabled, false)
  c.onStrike(tap(1))
  assert.equal(c.data.tableRows[1].state, '')
  assert.equal(c.data.ctaDisabled, true, '选中的行被划掉后不能再确认')
})

test('确认选择报所选那一行的 optionId(仍是 SUBMIT_QA {optionId})', () => {
  const c = mount(loadQa(), { sessionId: 'S-submit' })
  c.onPick(tap(2))
  c.onCta()
  const submit = c.events.find(e => e.name === 'submit')
  assert.deepEqual(submit.detail, { mode: 'pick', index: 2, optionId: 'r3' })
})

test('判错:那一行与 lastRule 那条规则标红,作者的话写出来,台面 nudge;划痕保留', () => {
  const c = mount(loadQa(), { sessionId: 'S-wrong' })
  c.onStrike(tap(0))
  c.onPick(tap(2))
  c.onCta()
  c.settle(false, { index: 2, feedback: '周日不借', lastRule: 2 })
  assert.equal(c.data.tableRows[2].state, 'is-wrong')
  assert.deepEqual(c.data.ruleList.map(r => r.hot), [false, true])
  assert.equal(c.data.feedback, '周日不借')
  assert.equal(c.stage.nudges, 1)
  assert.equal(c.data.tableRows[0].struck, true, '判错后划痕还在')
  assert.equal(c.data.ctaLabel, '确认选择')
})

test('故事流:服务端回流 attempts / lastOptionId / lastRule,同样标红并 nudge', () => {
  const c = mount(loadQa(), { sessionId: 'S-inline', inline: true })
  c.onStrike(tap(1))
  c.update({ attempts: 1, lastOptionId: 'r1', lastRule: 1, feedbackText: '那天闭馆' })
  attemptsObserved(c, 1)
  assert.equal(c.data.tableRows[0].state, 'is-wrong')
  assert.deepEqual(c.data.ruleList.map(r => r.hot), [true, false])
  assert.equal(c.data.feedback, '那天闭馆')
  assert.equal(c.stage.nudges, 1)
  assert.equal(c.data.tableRows[1].struck, true)
})

function attemptsObserved(c, n) {
  c._seenTypeAttempts = n - 1
  c.def.observers.attempts.call(c, n)
}

test('隐藏再显示 / 组件重挂(同一局同一站):划痕还在;换一站从空开始', () => {
  const def = loadQa()
  const a = mount(def, { sessionId: 'S-keep', nodeId: 'N9' })
  a.onStrike(tap(2))
  a.update({ show: false }); a.update({ show: true })
  assert.equal(a.data.tableRows[2].struck, true, '隐藏再显示保留')
  const b = mount(def, { sessionId: 'S-keep', nodeId: 'N9' })
  assert.equal(b.data.tableRows[2].struck, true, '同一局同一站重挂保留')
  b.update({ nodeId: 'N10' })
  assert.equal(b.data.tableRows[2].struck, false, '换一站是另一份')
})

test('点规则展开 / 收起,不影响划痕', () => {
  const c = mount(loadQa(), { sessionId: 'S-rule' })
  c.onStrike(tap(1))
  c.onRule(tap(1))
  assert.deepEqual(c.data.ruleList.map(r => r.open), [false, true])
  c.onRule(tap(1))
  assert.deepEqual(c.data.ruleList.map(r => r.open), [false, false])
  assert.equal(c.data.tableRows[1].struck, true)
})

test('答对:不再标红规则、划痕不再显示;走原 stage.win', () => {
  const c = mount(loadQa(), { sessionId: 'S-win' })
  c.onStrike(tap(0))
  c.onPick(tap(1)); c.onCta()
  c.settle(true, { index: 1, feedback: '' })
  assert.equal(c.stage.wins, 1)
  assert.equal(c.data.tableRows[1].state, 'is-right')
  c.update({ passed: true, lastRule: 0 })
  assert.equal(c.data.anyStruck, false)
  assert.ok(c.data.ruleList.every(r => !r.hot))
})

test('没表 / 行与选项对不上 / 多选:照旧画普通选项行', () => {
  assert.equal(mount(loadQa(), { table: null, rules: [] }).data.tableOn, false)
  assert.equal(mount(loadQa(), { options: OPTIONS.slice(0, 2) }).data.tableOn, false)
  assert.equal(mount(loadQa(), { multi: true }).data.tableOn, false)
})

test('playkit-view 过桥 table / rules / lastRule;老题不带', () => {
  const view = (qa) => pickPlayKit({ sessionId: 1, version: 2, status: 'RUNNING', playKit: { qa } }, new Date())
  const kit = view({ mode: 'PICK', title: '哪一张是真的', options: [{ id: 'r1', label: '甲' }, { id: 'r2', label: '乙' }],
    table: { columns: ['a', 'b'], rows: [{ id: 'r1', cells: ['1', '2'] }, { id: 'r2', cells: ['3', '4'] }] },
    rules: [{ k: '①', t: '虚构规则' }], lastRule: 1, attempts: 1 })
  assert.equal(kit.table.rows.length, 2)
  assert.equal(kit.rules[0].k, '①')
  assert.equal(kit.lastRule, 1)
  const old = view({ mode: 'PICK', title: '老题', options: [{ id: 'A', label: '甲' }, { id: 'B', label: '乙' }] })
  assert.equal(old.table, null)
  assert.deepEqual(old.rules, [])
  assert.equal(old.lastRule, 0)
})

test('WXML:表分支、每个可点元素有 aria-label 与 hover-class;不加 @keyframes', () => {
  const wxml = fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit-qa/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(ROOT, 'pages/playkit/components/playkit-qa/index.wxss'), 'utf8')
  const block = wxml.slice(wxml.indexOf("mode === 'pick' && tableOn"), wxml.indexOf("mode === 'pick' && picGrid"))
  for (const handler of ['onStrike', 'onPick', 'onRule', 'onRestoreAll']) {
    const at = block.indexOf('bindtap="' + handler + '"')
    assert.ok(at > 0, handler + ' 已绑定')
    const tag = block.slice(block.lastIndexOf('<view', at), block.indexOf('>', block.indexOf('hover-stay-time', at)))
    assert.match(tag, /aria-label="/, handler + ' 有 aria-label')
    assert.match(tag, /hover-class="/, handler + ' 有 hover-class')
  }
  assert.ok(block.includes('全部恢复'))
  assert.equal((wxss.match(/@keyframes/g) || []).length, (wxss.split('.qa__tb {')[0].match(/@keyframes/g) || []).length, '证据表不新增 @keyframes')
  assert.ok(!/shake/.test(wxss.split('.qa__tb {')[1]), '不抖')
})
