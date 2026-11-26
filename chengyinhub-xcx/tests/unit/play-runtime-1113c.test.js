'use strict'
// 2026-11-13 平台城市路线验收走查:开局 300m 闸不看首站玩法;逐字猜词解开后必须能「继续」收尾本站。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')

test('开局 300m 定位闸与首站是否用高级玩法无关', () => {
  const play = read('pages/play/index.js')
  const tap = play.slice(play.indexOf('  onArriveTap() {'), play.indexOf('  onScanArrive() {'))
  assert.match(tap, /const needsLocation = this\._startLocationNeeded\(\) && !this\._deskStart\(\);/)
  assert.doesNotMatch(tap, /_advancedReadyNodeId/, '解开玩法不能替代开局定位')
  // 没定位且需要开局定位:先申请(_locateThen:没问过就问,问过则复查系统设置),不发 arrive;授权后接着到达
  assert.match(tap, /!this\.data\.gpsOk && !this\._isStoryGame\(node\) && needsLocation\) \{ this\._locateThen\(\(\) => this\.onArriveTap\(\)\); return; \}/)
  assert.match(read('pages/play/utils/play-location-once.js'), /_locateThen\(resume\) \{\s*this\._setPendingStart\(resume\);\s*if \(!this\._locAsked\) \{ this\.requestPlayLocation\(\); return; \}/)
})

test('逐字猜词解开后在故事流里也有「继续」,并回到页面收尾本站', () => {
  const wxml = read('pages/playkit/components/playkit-hangman/index.wxml')
  // 内嵌时故事流那颗按钮(qa / 逐字猜词时就叫「继续」)是唯一的继续,猜词自己的不再叠一枚;整屏仍有
  // 2026-11-24 业主:不留「继续」钮 —— 整屏解开后点一下(台面 done-tap → verdicttap → 页面收起玩法)
  assert.match(wxml, /done-tap="\{\{solved && !inline\}\}"/)
  assert.doesNotMatch(wxml, /class="g-btn" bindtap="onContinue"/)
  assert.match(read('pages/play/index.wxml'), /class="chfull__kit kit-tapsurface" catchtap="onKitAreaTap"/)   // 2026-11-24 不画「继续」钮:玩完点玩法区回故事
  const js = read('pages/playkit/components/playkit-hangman/index.js')
  assert.doesNotMatch(js, /onContinue\(\)/, '2026-11-24:「继续」钮撤了,组件里不留没人绑的 handler')
  assert.match(read('pages/playkit/components/playkit/index.wxml'), /<cy-playkit-hangman[\s\S]*?bind:continue="onContinue"[^>]*\/>/)
  const play = read('pages/play/index.js')
  assert.match(play, /\(evt\.type === 'qa' \|\| evt\.type === 'hangman'\) && this\._kit\(\)\.type === evt\.type && this\.data\.playKit\.readyForBase/)
})

