// 业主 2026-11-24:路线只用一种故事字;段首「[手写]」的信件 / 便条 / 日记 / 电报 / 手写留言单段用手写体。
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '../..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const { handPara, handParas } = require('../../pages/play/utils/story-font.js')

test('标记去掉、置 hand;标记后的一个空格也去掉', () => {
  assert.deepEqual(handPara('[手写]亲爱的阿青:'), { text: '亲爱的阿青:', hand: true })
  assert.deepEqual(handPara('[手写] 明早六点,老地方。'), { text: '明早六点,老地方。', hand: true })
})

test('其他段原样不动,hand 为 false', () => {
  assert.deepEqual(handPara('雨下了一整夜。'), { text: '雨下了一整夜。', hand: false })
  assert.deepEqual(handPara('她说[手写]不算数'), { text: '她说[手写]不算数', hand: false })
  assert.deepEqual(handPara('【手写】全角括号不是标记'), { text: '【手写】全角括号不是标记', hand: false })
})

test('只有标记的段丢掉', () => {
  assert.equal(handPara('[手写]'), null)
  assert.equal(handPara('[手写]   '), null)
})

test('多段逐段解析,只标记那一段', () => {
  assert.deepEqual(handParas('门开着。\n[手写] 别等我。\n\n[手写]\n他把信折好。'), [
    { text: '门开着。', hand: false },
    { text: '别等我。', hand: true },
    { text: '他把信折好。', hand: false },
  ])
  assert.deepEqual(handParas(''), [])
})

test('编辑器预览副本与玩家端逐字相同', () => {
  assert.equal(read('pages/publish/utils/publish/story-font.js'), read('pages/play/utils/story-font.js'))
})

test('三处入口都接了 hand 标志并按它换样式类', () => {
  const play = read('pages/play/index.js')
  assert.match(play, /const p = handPara\(x\.trim\(\)\)[\s\S]{0,200}hand: p\.hand/, 'chapterParas 的 push 解析标记')
  assert.match(play, /\.filter\(Boolean\)\.map\(handPara\)\.filter\(Boolean\)/, 'chapStory.lines 解析标记')
  assert.match(read('pages/play/utils/cast-play.js'), /handPara\(castVars\(/, '角色台词同正文')
  const wxml = read('pages/play/index.wxml')
  assert.equal((wxml.match(/item\.hand \? 'cy-story-note' : 'cy-story-hand'/g) || []).length, 2)
  assert.match(read('pages/publish/temp/index.js'), /paras: handParas\(b\.text\)/)
  assert.match(read('pages/publish/temp/index.wxml'), /pp\.hand \? 'cy-story-note' : 'cy-story-hand'/)
  for (const f of ['pages/play/index.wxss', 'pages/publish/temp/index.wxss']) {
    assert.match(read(f), /\.cy-story-note \{ font-family: 'CyStoryHand',/, f)
    assert.doesNotMatch(read(f), /story-font--\w+ \.cy-story-note/, '路线 storyFont 不覆盖手写段')
  }
})
