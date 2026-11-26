'use strict'
// DEC-F11(业主 2026-11-24):
//   L02-117 背包列表 / 格子里的 cy-illus 关掉待机晃动(loop=false),详情 / 主视觉照常动;
//   L08-081 核销详情退款键:.ckd-foot 只留上间距,不再叠一层左右内缩和底部安全区。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const ROOT = path.join(__dirname, '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

test('L02-117:背包列表行里的每个 cy-illus 都传 loop=false', () => {
  const tags = read('pages/play/theme-backpack.wxml').match(/<cy-illus\b[^>]*>/g) || []
  assert.equal(tags.length, 3, '待领取 / 随身物品格 / 线索三处')
  for (const tag of tags) assert.match(tag, /loop="\{\{false\}\}"/, tag)
})

test('L02-117:cy-illus 默认仍循环,loop=false 时不排待机帧', () => {
  const src = read('pages/play/components/cy-illus/index.js')
  assert.match(src, /loop: \{ type: Boolean, value: true \}/)
  assert.match(src, /if \(!this\.properties\.loop \|\|/)
})

test('L08-081:.ckd-foot 只留 margin-top;页面根已给左右与底部安全区', () => {
  const css = read('pages/club/checkin-detail/index.wxss')
  const foot = css.match(/\.ckd-foot \{([^}]*)\}/)[1].trim()
  assert.equal(foot, 'margin-top: var(--cy-space-5);')
  const root = css.match(/\.ckd \{([^}]*)\}/)[1]
  assert.match(root, /padding: 0 var\(--cy-page-x\) calc\(var\(--cy-space-6\) \+ env\(safe-area-inset-bottom\)\)/)
  const wxml = read('pages/club/checkin-detail/index.wxml')
  assert.match(wxml, /<view wx:if="\{\{detail\.canRefund\}\}" class="ckd-foot cy-fade-in">/)
  assert.match(wxml, /bindtap="refund"/)
  assert.match(wxml, /\{\{refunding \? '正在退款…' : '清退并退款'\}\}/)
})
