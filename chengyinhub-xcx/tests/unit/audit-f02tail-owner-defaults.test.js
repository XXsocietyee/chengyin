'use strict'
// AUDIT-1122 F02 tail —— 业主默认 A(2026-11-24),两项此前因落在游玩页模板而 OWNER-DEFAULT-BLOCKED(PR #973):
//   L02-059:自由探索进度 / 过期文案只认 pages/play/utils/fe-story-visit.js 一份,index.wxml 不再手写副本;
//   L02-085:营业态换算只出状态记号 open/soon/off,颜色由 index.wxss 的 od--* 类给,模板不再写内联 background/color。
// 两项都要求肉眼所见不变:文案逐字相同,颜色取同一个 --cy-* token。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const visit = require('../../pages/play/utils/fe-story-visit.js')
const { resolveOpenState } = require('../../pages/play/utils/play-open-state.js')

// ---------- L02-059 ----------

test('L02-059 进度文案的三段与 progressText() 逐字一致(模板按段绑定,数字仍是加粗那一段)', () => {
  const t = visit.PROGRESS_TEXT
  assert.ok(t && typeof t === 'object', 'fe-story-visit 必须导出 PROGRESS_TEXT 供模板按段绑定')
  for (const [u, n] of [[0, 0], [3, 12], [12, 12]]) {
    assert.equal(t.lead + u + t.sep + n + t.unit, visit.progressText(u, n))
  }
  assert.equal(visit.progressText(3, 12), '已解锁 3 / 12 章', '对外文案不变')
  assert.equal(visit.EXPIRED_TEXT, '已过期，不能再解锁', '对外文案不变')
})

test('L02-059 游玩页初始 data.feText 直接取自 fe-story-visit,不在页里另写一份', () => {
  const js = read('pages/play/index.js')
  assert.match(js, /feText:\s*feVisit\.viewText\(\)/, 'data.feText 必须由 feVisit.viewText() 给出')
  const v = visit.viewText()
  assert.deepEqual(v, { expired: visit.EXPIRED_TEXT, progressLead: visit.PROGRESS_TEXT.lead, progressSep: visit.PROGRESS_TEXT.sep, progressUnit: visit.PROGRESS_TEXT.unit })
})

test('L02-059 index.wxml 不再手写「已过期，不能再解锁」与「已解锁 … 章」,改绑 feText', () => {
  const wxml = read('pages/play/index.wxml')
  assert.doesNotMatch(wxml, /已过期，不能再解锁/, '过期文案只在 fe-story-visit.js 一处')
  assert.doesNotMatch(wxml, />已解锁 <text/, '进度文案只在 fe-story-visit.js 一处')
  assert.match(wxml, /<view class="fx-unlock" wx:if="\{\{storyGate\}\}" aria-role="text">\{\{feText\.progressLead\}\}<text class="fx-unlock__n">\{\{storyUnlocked\}\}\{\{feText\.progressSep\}\}\{\{storyTotal\}\}<\/text>\{\{feText\.progressUnit\}\}<\/view>/)
  assert.match(wxml, /\{\{storyExpired \? feText\.expired : '到访后解锁'\}\}/)
  assert.match(wxml, /\(storyExpired \? '，' \+ feText\.expired : '，到访后解锁'\)/)
  assert.match(wxml, /<text class="fx-tile__expired" wx:if="\{\{storyExpired\}\}">\{\{feText\.expired\}\}<\/text>/)
  assert.match(wxml, /<text class="fx-hero__expired" wx:if="\{\{hero\.node\.storyLocked\}\}">\{\{feText\.expired\}\}<\/text>/)
})

// ---------- L02-085 ----------

test('L02-085 resolveOpenState 只出状态记号 open / soon / off,不再出颜色', () => {
  const cases = [
    [{ openStatus: '营业中' }, undefined, '营业中', 'open'],
    [{ openStatus: '即将打烊' }, undefined, '即将打烊', 'soon'],
    [{ openStatus: '已打烊' }, undefined, '已打烊', 'off'],
    [{ businessTime: '10:00-22:00' }, 12 * 60, '营业中', 'open'],
    [{ businessTime: '10:00-22:00' }, 3 * 60, '已打烊', 'off'],
    [{ businessTime: '00:00-23:59' }, 12 * 60, '', ''],
    [{}, 12 * 60, '', ''],
    [null, 12 * 60, '', '']
  ]
  for (const [node, now, text, state] of cases) {
    const r = resolveOpenState(node, now)
    assert.deepEqual(r, { openText: text, openState: state }, JSON.stringify(node))
  }
  const mod = require('../../pages/play/utils/play-open-state.js')
  assert.equal(mod.OPEN_SOON, undefined, 'OPEN_SOON 颜色常量退场')
})

test('L02-085 模板用 od--{{state}} 类,不再内联 background / color', () => {
  const wxml = read('pages/play/index.wxml')
  assert.doesNotMatch(wxml, /openDot|openCol/, '模板不得再读颜色字段')
  assert.match(wxml, /<view class="fx-tile__dot od--\{\{item\.openState\}\}"><\/view>/)
  assert.match(wxml, /<view class="fx-tile__dot od--\{\{hero\.node\.openState\}\}"><\/view>/)
  assert.match(wxml, /<view class="od od--\{\{sheet\.node\.openState\}\}"><\/view>/)
  assert.match(wxml, /<text class="od-text--\{\{sheet\.node\.openState\}\}">\{\{sheet\.node\.openText\}\}<\/text>/)
  const js = read('pages/play/index.js')
  assert.doesNotMatch(js, /openDot|openCol/, '游玩页 JS 不得再写颜色字段')
})

test('L02-085 颜色搬进 index.wxss,取值与改前内联值同一 token', () => {
  const wxss = read('pages/play/index.wxss')
  const rule = (sel) => {
    const m = wxss.match(new RegExp('(^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))
    assert.ok(m, '缺规则 ' + sel)
    return m[2]
  }
  // 改前:OPEN_OK = OPEN_SOON = var(--cy-color-play-accent),OPEN_OFF = var(--cy-color-text-tertiary)
  assert.match(rule('.od--open, .od--soon'), /background:\s*var\(--cy-color-play-accent\)/)
  assert.match(rule('.od--off'), /background:\s*var\(--cy-color-text-tertiary\)/)
  assert.match(rule('.od-text--open, .od-text--soon'), /color:\s*var\(--cy-color-play-accent\)/)
  assert.match(rule('.od-text--off'), /color:\s*var\(--cy-color-text-tertiary\)/)
})
