'use strict'

// P2-A 主题内弹窗五件套(cy-club-topic-*)的结构契约。锚点钉结构(标签名/属性名/绑定表达式),
// 不钉字面量(注释文案改一下就会把钉字面量的断言自己撞红,已在别处踩过两次)。

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** 注释里提到"不许出现 sendRequest"这类解释性文字不算数,只看真代码。 */
function stripJsComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

// 2026-11-24 业主决策 L10-138(默认项 A):从未接入的四个 club-topic 面板已删除,只剩已接线的 end-confirm
const COMPONENTS = [
  'club-topic-end-confirm',
]
const RETIRED = ['club-topic-merchants', 'club-topic-settings', 'club-topic-groupcode', 'club-topic-onboarding', 'club-publish-sheet']

// ===================================================================
// J7 商家:合作确认后才展示联系人手机号 —— 判据必须是数据存不存在(station.contact),
// 不能是业务状态(station.status)。前端不是安全边界,但也不能自己在两边都留口子。
// ===================================================================

function assertPhoneGatedByContactPresence(wxml) {
  assert.match(
    wxml,
    /wx:if="\{\{station\.contact\}\}"/,
    '联系人行必须只由 station.contact 有没有值来决定要不要渲染',
  )
  assert.doesNotMatch(
    wxml,
    /wx:if="\{\{station\.status\s*===/,
    '联系人行不能改用 station.status 当判据 —— 状态字段可能和 contact 是否下发不同步,' +
      '真正的安全边界在后端"根本不下发"，前端只能照抄数据存在与否',
  )
}

test('J5 是纯 T2:不引入 cy-scene-sheet(没有顶栏/抓手/✕),只用 cy-modal', () => {
  const json = JSON.parse(read('pages/club/components/cy/club-topic-end-confirm/index.json'))
  assert.equal(json.usingComponents['cy-scene-sheet'], undefined)
  assert.equal(json.usingComponents['cy-modal'], '/components/cy/modal/index')

  const wxml = read('pages/club/components/cy/club-topic-end-confirm/index.wxml')
  assert.doesNotMatch(wxml, /cy-scene-sheet|class="[^"]*close[^"]*"|✕/)
  assert.match(wxml, /<cy-modal[\s\S]*danger="\{\{true\}\}"/)
  assert.match(wxml, /confirm-text="结束并退款"/)
  assert.match(wxml, /cancel-text="再想想"/)
})

// ===================================================================
// J3-A/J3-B:一个组件两种 variant,靠 mode 属性切,不是两个组件。
// ===================================================================

test('L10-138:从未接入的俱乐部话题/发布面板已删除', () => {
  for (const name of RETIRED) assert.equal(fs.existsSync(path.join(ROOT, 'components/cy', name)), false, name)
})

test('保留的组件目录存在且四件套齐全', () => {
  const BASE_OF = { 'club-topic-end-confirm': 'pages/club/components/cy' }
  for (const name of COMPONENTS) {
    const base = BASE_OF[name] || 'components/cy'
    for (const ext of ['js', 'json', 'wxml', 'wxss']) {
      const p = path.join(ROOT, base, name, `index.${ext}`)
      assert.ok(fs.existsSync(p), `缺少 ${name}/index.${ext}`)
    }
    const json = JSON.parse(read(`${base}/${name}/index.json`))
    assert.equal(json.component, true)
  }
})
