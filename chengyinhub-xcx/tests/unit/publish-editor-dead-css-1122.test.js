// AUDIT-1122 附录(模板编辑页 / 活动发布页死样式):删掉的规则里的类名,页面和它能影响到的组件里一个节点都没有,
// 所以删样式不改任何画面。这里钉住两件事:类名不在 wxml / js 里出现,也不会再回到 wxss。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const has = (src, cls) => new RegExp('(^|[^\\w-])' + cls.replace(/[-_]/g, (m) => '\\' + m) + '(?![\\w-])').test(src)

const TEMP_GONE = [
  'cg-titlebox', 'cg-card-head', 'cg-bar', 'cg-cover', 'cg-cover-empty', 'cg-modsec', 'cg-tool-list', 'cg-tool-footer',
  'cg-outcome-code', 'cg-mod-ico--blue', 'cg-mod-ico--orange', 'cg-mod-head--blue', 'cg-tiles', 'cg-tile', 'cg-radio',
  'cg-rw-ico', 'cg-coupon-pop', 'cg-coupon-card', 'cg-coupon-search', 'cg-gpick', 'cg-gsheet', 'cg-gsheet-card',
  'cg-sq-sub', 'cg-card-note', 'cg-opt', 'cg-hero-c2', 'cg-r5-line', 'cg-r5-effect', 'cg-r5-amount', 'cg-qa-modes',
  'cg-pv-dot', 'cg-pv-meta', 'cg-topbar',
]
const ACTIVITY_GONE = ['modal-mask', 'category-item', 'category-checkbox', 'item-add', 'selected-mark', 'time-picker-help',
  'ticket-section', 'multi-select-modal', 'step-heading', 'item-tip']

function pageSources(dir) {
  return fs.readdirSync(path.join(ROOT, dir)).filter((f) => /\.(wxml|js)$/.test(f)).map((f) => read(path.join(dir, f))).join('\n')
}

test('模板编辑页:已删样式的类名不在页面节点或脚本里,也没回到样式表', () => {
  const src = pageSources('pages/publish/temp')
  const wxss = read('pages/publish/temp/index.wxss')
  for (const cls of TEMP_GONE) {
    assert.equal(has(src, cls), false, cls + ' 仍被页面使用')
    assert.equal(new RegExp('\\.' + cls + '(?![\\w-])').test(wxss), false, cls + ' 规则回来了')
  }
  assert.doesNotMatch(wxss, /@keyframes cg-tile-select/)
})

test('活动发布页:已删样式的类名不在页面节点或脚本里,也没回到样式表', () => {
  const src = pageSources('pages/publish/activity')
  const wxss = read('pages/publish/activity/index.wxss')
  for (const cls of ACTIVITY_GONE) {
    assert.equal(has(src, cls), false, cls + ' 仍被页面使用')
    assert.equal(new RegExp('\\.' + cls + '(?![\\w-])').test(wxss), false, cls + ' 规则回来了')
  }
})

// AUDIT-1122 L04-050:试玩三颗主按钮的上间距收成一个类;弹层上限仍逐个弹层按胶囊实测下发
// (game / toolpicker 两个自适应弹层不带这条覆盖,挂到根上会改它们的高度)。
test('试玩按钮上间距走 .cg-pv-btn,不再逐个内联;弹层胶囊上限仍逐个下发', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  const wxss = read('pages/publish/temp/index.wxss')
  assert.doesNotMatch(wxml, /style="margin-top:var\(--cy-space-4\)"/)
  assert.equal((wxml.match(/<cy-btn variant="primary" class="[^"]*\bcg-pv-btn\b/g) || []).length, 3)
  assert.match(wxss, /\.cg-pv-btn \{ margin-top: var\(--cy-space-4\); \}/)
  assert.equal((wxml.match(/--cy-comp-sheet-max-h:calc\(100vh - \{\{sheetTop\}\}px\);/g) || []).length, 9)
  assert.doesNotMatch(wxml, /class="cg sheet[^"]*"[^>]*--cy-comp-sheet-max-h/)
})

// AUDIT-1122 L04-047:同一个选择器写两遍时,前一条里被后一条重写的声明永远不生效。合并后不许再出现。
function topLevelRules(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
  const rules = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open < 0) break
    let depth = 0; let k = open
    for (; k < src.length; k++) {
      if (src[k] === '{') depth++
      else if (src[k] === '}' && --depth === 0) break
    }
    const sel = src.slice(i, open).trim().split(',').map((s) => s.trim().replace(/\s+/g, ' ')).join(',')
    if (!sel.startsWith('@')) {
      const props = src.slice(open + 1, k).split(';').map((d) => (d.match(/^\s*([-\w]+)\s*:/) || [])[1]).filter(Boolean)
        .filter((p) => !p.startsWith('--'))
      rules.push({ sel, props, important: /!important/.test(src.slice(open + 1, k)) })
    }
    i = k + 1
  }
  return rules
}

test('模板编辑页样式:同一选择器后写的那条不再覆盖前一条已写的属性', () => {
  const rules = topLevelRules(read('pages/publish/temp/index.wxss'))
  const fights = []
  rules.forEach((r, idx) => {
    if (r.important) return
    for (const later of rules.slice(idx + 1)) {
      if (later.sel !== r.sel) continue
      for (const p of r.props) if (later.props.includes(p)) fights.push(r.sel + ' :: ' + p)
    }
  })
  assert.deepEqual(fights, [])
  const pressOnly = rules.filter((r) => r.props.length === 1 && r.props[0] === 'transition' && !r.sel.includes(','))
  assert.ok(pressOnly.length < 5, '按压过渡应收成一条选择器列表,不再逐条各写一遍')
})

// AUDIT-1122 L04-110:这 10 个组件都开了 addGlobalClass,全局 .cy-pressed(.92 + scale .97)本来就进得来;
// 本地那份 .88 只会和全局那条打架,让发布页的按压反馈和全站不一样。删掉后统一走全局一条。
test('发布页 10 个共享样式组件不再各写一份 .cy-pressed,按压反馈走全局', () => {
  const names = ['chips', 'choice-sheet', 'list-group', 'list-row', 'segmented', 'sheet-nav', 'stepper', 'swipe-row', 'start-prep', 'd20-settings']
  for (const n of names) {
    const dir = 'pages/publish/components/' + n + '/index'
    assert.match(read(dir + '.js'), /addGlobalClass:\s*true/, n + ' 必须仍收全局类')
    assert.doesNotMatch(read(dir + '.wxss'), /\.cy-pressed\b/, n + ' 又写回了本地按压样式')
    assert.match(read(dir + '.wxml'), /hover-class="[^"]*cy-pressed/, n + ' 按压类还在用')
  }
  assert.match(read('style/components.wxss'), /\.cy-pressed\s*\{ opacity: \.92; transform: scale\(\.97\);/)
})
