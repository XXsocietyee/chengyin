const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('状态标签默认带左图标,mono 分类标签不带', () => {
  const js = read('components/cy/tag/index.js')
  const wxml = read('components/cy/tag/index.wxml')
  const json = read('components/cy/tag/index.json')
  assert.match(wxml, /cy-icon wx:if="\{\{_icon\}\}"/)
  assert.match(json, /"cy-icon"/)
  assert.match(js, /green:\s*'check'/)
  assert.match(js, /blue:\s*'info'/)
  assert.match(js, /red:\s*'warning'/)
  assert.match(js, /done:\s*'close-sm'/)
  assert.match(js, /mono:\s*''/)
})

test('cy-field 常态描边由主题决定，聚焦才显示交互边界', () => {
  const wxss = read('components/cy/field/index.wxss')
  const wxml = read('components/cy/field/index.wxml')
  assert.match(wxss, /background:\s*var\(--cy-comp-field-idle-bg\)/)
  assert.match(wxss, /box-shadow:\s*var\(--cy-comp-field-idle-shadow\)/)
  // L10-143:前置「兜底」行是死代码(后一条 var 未定义时计算期失效,从不回落),已删
  assert.doesNotMatch(wxss, /background:\s*var\(--cy-color-input-(idle|filled)-bg\)/)
  assert.doesNotMatch(wxss, /box-shadow:\s*var\(--cy-comp-field-shadow,/)
  assert.match(wxss, /\.is-filled \.fd__control/)
  assert.match(wxss, /var\(--cy-comp-field-filled-bg\)/)
  assert.match(wxss, /var\(--cy-comp-field-filled-shadow\)/)
  assert.match(wxml, /_filled \? 'is-filled'/)
})
