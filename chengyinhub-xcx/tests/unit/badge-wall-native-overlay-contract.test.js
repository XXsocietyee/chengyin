const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const ROOT = path.resolve(__dirname, '../..')
const WXML_PATH = 'subpackageP3/pages/badge-wall/index/index.wxml'
const JS_PATH = 'subpackageP3/pages/badge-wall/index/index.js'
const WXSS_PATH = 'subpackageP3/pages/badge-wall/index/index.wxss'
const JSON_PATH = 'subpackageP3/pages/badge-wall/index/index.json'
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8')

function assertCoverBlock(source, cls, label) {
  const re = new RegExp('<cover-view class="' + cls + '(?:\\s|")[^>]*>[\\s\\S]*?<\\/cover-view>')
  assert.match(source, re, `${label} 必须使用 cover-view 置于 WebGL 原生层之上`)
}

function assertErrorContract(wxml, pageJson) {
  assert.match(wxml, /<cy-error load-failure="\{\{loadFail && !wallAuthRequired && !wallAccessDenied\}\}" class="bw-error-state" wx:if="\{\{loadFail \|\| partialFail\}\}"[\s\S]*retry="\{\{wallAuthRequired \? \'登录\' : \'重试\'\}\}"[\s\S]*bind:retry="retryWall"/)
  assert.match(wxml, /<scroll-view class="bw-list" scroll-y scroll-into-view="\{\{focusCell\}\}" wx:if="\{\{badges\.length && !loadFail && !partialFail\}\}"/)
  assert.doesNotMatch(wxml, /bw-err-btn|class="bw-err"/, '自绘错误按钮必须收编 cy-error')
  assert.equal(pageJson.usingComponents && pageJson.usingComponents['cy-error'], '/components/cy/error/index')
}

// L09-132
// 业主默认 A:墙面模式(WebGL canvas + 顶部返回 / 字幕 cover-view)已删除;
// 详情 veil + sheet 仍是 cover-view(无图勋章的兜底详情),导航用普通 cy-nav-bar
test('badge-wall 只剩列表:无 WebGL 墙与顶部覆盖层,详情层仍在 cover-view 上', () => {
  const wxml = read(WXML_PATH)
  const js = read(JS_PATH)
  const pageJson = JSON.parse(read(JSON_PATH))
  assert.doesNotMatch(wxml, /type="webgl"|class="bw-top|class="bw-cap|viewMode|glFail|goBack/)
  assert.doesNotMatch(js, /ENGINE|initCanvas|destroyEngine|onTouch|viewMode|glFail|setInsets|__capture|__probe/)
  assert.match(wxml, /<cy-nav-bar overlay \/>/)
  assertCoverBlock(wxml, 'bw-veil', '详情遮罩层')
  assertCoverBlock(wxml, 'bw-sheet', '详情 sheet')
  assert.match(wxml, /<cover-view class="bw-sh-x"[^>]*bindtap="closeSheet"[^>]*aria-role="button"[^>]*aria-label="关闭勋章详情"/)
  assert.match(js, /navBarHeight:\s*\(app\.globalData\s*&&\s*app\.globalData\.navBarHeight\)\s*\|\|\s*44/)
  assertErrorContract(wxml, pageJson)
})

test('badge-wall 详情关闭保留 88rpx 触达与正常视觉尺寸', () => {
  const wxss = read(WXSS_PATH)
  assert.match(wxss, /\.bw-sh-x\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/)
  assert.match(wxss, /\.bw-sh-x-visual\s*\{[^}]*width:\s*var\(--cy-comp-sheet-close-size\)[^}]*height:\s*var\(--cy-comp-sheet-close-size\)/)
})

test('负控：把详情 sheet 退回普通 view 必须判红', () => {
  const source = read(WXML_PATH)
  const mutated = source.replace('<cover-view class="bw-sheet ', '<view class="bw-sheet ')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assertCoverBlock(mutated, 'bw-sheet', '详情 sheet'))
})

test('负控：错误态恢复 bw-err-btn 自绘按钮必须判红', () => {
  const source = read(WXML_PATH)
  const mutated = source.replace('<cy-error load-failure="{{loadFail && !wallAuthRequired && !wallAccessDenied}}" class="bw-error-state"', '<view class="bw-err-btn"')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assertErrorContract(mutated, JSON.parse(read(JSON_PATH))))
})

test('负控：关闭按钮视觉盒撑满 88rpx 会把可视尺寸改大,必须判红', () => {
  const source = read(WXSS_PATH)
  const mutated = source.replace(/\.bw-sh-x-visual\s*\{[^}]*width:\s*var\(--cy-comp-sheet-close-size\)/, '.bw-sh-x-visual { width: 88rpx')
  assert.notEqual(mutated, source, '变异锚点失效')
  assert.throws(() => assert.match(mutated, /\.bw-sh-x-visual\s*\{[^}]*width:\s*var\(--cy-comp-sheet-close-size\)[^}]*height:\s*var\(--cy-comp-sheet-close-size\)/))
})
