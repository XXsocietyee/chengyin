'use strict'
/* 2026-11-22 业主走查上海 07 / SH01 / SH04 / SH05 游玩页:浅底状态栏、开场封面遮罩、本局完成徽章。 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (p) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8')
const lc = require('../../pages/play/utils/look-colors.js')
const themeLook = require('../../pages/play/utils/theme-look.js')
const { pickEndingMedal, buildFinishMedals } = require('../../pages/play/utils/finish-medals.js')

const STYLES = themeLook.STYLES.map((s) => s.value)
const PALETTES = themeLook.PALETTES.map((p) => p[0])
const LIGHT = { 'STARDUST:WHITE': 1, 'PAPER:WHITE': 1, 'PAPER:YELLOW': 1, 'SURVIVAL:WHITE': 1, 'CYBER:WHITE': 1 }

test('isLight:四种风格 × 五种配色逐格 —— 各风格的白 + 纸本黄(牛皮纸)是浅底,其余都是深底', () => {
  assert.equal(STYLES.length * PALETTES.length, 20)
  STYLES.forEach((style) => PALETTES.forEach((palette) => {
    assert.equal(lc.isLight({ style, palette }), !!LIGHT[style + ':' + palette], style + ' × ' + palette)
    // 主题没设配色:按传进来的章节配色判(故事流铺的就是它)
    assert.equal(lc.isLight({ style }, palette), !!LIGHT[style + ':' + palette], style + ' × 章节 ' + palette)
    // 判定来自底色亮度,不是名单:浅底的墨色必是深色
    const c = lc.colorsFor({ style, palette })
    assert.equal(lc.luminance(c.bg) > 0.5, lc.luminance(c.ink) < 0.5, style + ' × ' + palette + ' 底与墨一明一暗')
  }))
  // 纸张参数(牛皮纸 / 宣纸 / 深色卡纸)只改纸纹,底色只由配色定
  ;['KRAFT', 'XUAN', 'CARD'].forEach((paper) => {
    assert.equal(lc.isLight({ style: 'PAPER', palette: 'YELLOW', params: { paper } }), true)
    assert.equal(lc.isLight({ style: 'PAPER', palette: 'RED', params: { paper } }), false)
  })
  assert.equal(lc.isLight({ style: 'PAPER' }), false, '没设配色 = 默认黑')
  assert.equal(lc.isLight({ style: 'STARDUST', palette: 'WHITE', legacy: true }), false, '老主题没有外观底色')
  assert.equal(lc.isLight(null), false)
})

test('statusBarLight:最上面那层面决定状态栏 —— 深色面盖在浅底故事流上要回白字', () => {
  const white = { style: 'STARDUST', palette: 'WHITE' }, kraft = { style: 'PAPER', palette: 'YELLOW' }, red = { style: 'PAPER', palette: 'RED' }
  const story = { story: true, chapterFull: true }
  assert.equal(lc.statusBarLight(Object.assign({ look: white }, story)), true, 'SH01 故事流')
  assert.equal(lc.statusBarLight(Object.assign({ look: kraft }, story)), true, 'SH05 故事流')
  assert.equal(lc.statusBarLight(Object.assign({ look: red }, story)), false, '07 故事流')
  assert.equal(lc.statusBarLight(Object.assign({ look: { style: 'CYBER' }, chapterPreset: 'WHITE' }, story)), true, '没设主题配色,本章配色是白')
  // 章节门(章节标题卡):以前只有故事流才换,门在屏上时还是白字
  assert.equal(lc.statusBarLight({ look: white, story: true, chapterFull: true, gate: true }), true)
  assert.equal(lc.statusBarLight({ look: kraft, story: true, chapterFull: true, gate: true }), true)
  assert.equal(lc.statusBarLight({ look: red, story: true, chapterFull: true, gate: true }), false)
  assert.equal(lc.statusBarLight({ look: white, story: true, chapterFull: true, gate: true, held: true }), false, '等待放行屏是深底')
  assert.equal(lc.statusBarLight({ look: { style: 'STARDUST', legacy: true }, chapterPreset: 'WHITE', story: true, chapterFull: true, gate: true }), false, '老主题章节门是深底')
  // 深色整屏面盖上来:开场页、本局完成、完成页、初始状态、开机
  ;['intro', 'ending', 'finish', 'stats', 'boot'].forEach((k) => {
    assert.equal(lc.statusBarLight(Object.assign({ look: white, [k]: true }, story)), false, k)
    assert.equal(lc.statusBarLight(Object.assign({ look: white, gate: true, [k]: true }, story)), false, k + ' 盖在章节门上')
  })
  // 相册底跟外观
  assert.equal(lc.statusBarLight({ look: white, album: true }), true)
  assert.equal(lc.statusBarLight({ look: red, album: true }), false)
  // 老主题:只有章节故事流的白底章节换;自由探索 fx-story 不换
  const legacy = { style: 'STARDUST', legacy: true }
  assert.equal(lc.statusBarLight({ look: legacy, chapterPreset: 'WHITE', story: true, chapterFull: true }), true)
  assert.equal(lc.statusBarLight({ look: legacy, chapterPreset: 'WHITE', story: true, chapterFull: false }), false)
  assert.equal(lc.statusBarLight({ look: legacy, chapterPreset: 'BLUE', story: true, chapterFull: true }), false)
  assert.equal(lc.statusBarLight({ look: white }), false, '封面 / 卡包页是深底')
  assert.equal(lc.statusBarLight(), false)
})

test('_syncStatusBar:页面状态 → 一次微信调用;颜色没变不重复调,关掉浅底面回白字', () => {
  const methods = require('../../pages/play/utils/play-look.js').methods()
  const calls = []
  global.wx = { setNavigationBarColor: (o) => calls.push(o.frontColor) }
  try {
    const page = Object.assign({ _look: { style: 'STARDUST', palette: 'WHITE' }, data: { chapterFull: true, chapterGate: { show: true }, chapter: {} } }, methods)
    page._gateStatusBar()
    assert.deepEqual(calls, ['#000000'], '章节门在屏上就换黑字')
    page.data.chapterGate.show = false; page._storyStatusBar(true)   // continueChapterGate:门一收就标故事流在屏
    assert.equal(calls.length, 1, '门 → 故事流仍是浅底,不重复调')
    page.data.previewEnding = { show: true }; page._syncStatusBar()
    assert.deepEqual(calls, ['#000000', '#ffffff'], '本局完成盖上来回白字')
    page.data.previewEnding.show = false; page.data.showFinish = true; page._syncStatusBar()
    assert.equal(calls.length, 2)
    page.data.showFinish = false; page.data.storyIntro = { show: true }; page._syncStatusBar()
    assert.equal(calls.length, 2, '开场页是深底')
    page.data.storyIntro.show = false; page._syncStatusBar()
    assert.deepEqual(calls.slice(2), ['#000000'], '回到故事流')
    page._storyStatusBar(false)
    assert.deepEqual(calls.slice(3), ['#ffffff'], '收起故事流回白字')
    page.data.chapterGate.show = true; page._gateStatusBar(); page._storyStatusBar(false)   // 门还在屏上就返回卡包(closeChapterFull 先停故事流、后撤门)
    assert.deepEqual(calls.slice(4), ['#000000', '#ffffff'], '门上直接离开也回白字')
  } finally { delete global.wx }
  const js = read('pages/play/index.js'), look = read('pages/play/utils/play-look.js')
  assert.equal((js.match(/setNavigationBarColor/g) || []).length, 0, 'index.js 不再自己改状态栏')
  assert.equal((look.match(/wx\.setNavigationBarColor\(/g) || []).length, 1, '只有 _syncStatusBar 一处调用')
  assert.ok((js.match(/this\._syncStatusBar\(\)/g) || []).length >= 12, '开场页 / 初始状态 / 开机 / 放行 / 相册 / 结局 / 完成页开关都挂了')
  assert.match(js, /legacy: !!this\._look\.legacy \} : null \}, flip\) \}, \(\) => this\._gateStatusBar\(\)\);/, '章节门挂上就同步')
})

test('开场页:封面满亮度、渐变只在下方文字块后面、不放「城瘾 · 玩法」小标、副标题取墨色', () => {
  const wxml = read('pages/play/index.wxml')
  const intro = wxml.slice(wxml.indexOf('<view class="st-intro '), wxml.indexOf('<view class="st-intro__go"'))
  assert.doesNotMatch(intro, /城瘾 ·|modeLabel/)
  assert.match(intro, /<text class="st-intro__k" wx:if="\{\{topicAiGenerated\}\}">AI 生成<\/text>/, 'AI 生成标识(合规披露)保留')
  assert.match(intro, /\{\{topicCover \|\| chapter\.cover \? 'st-intro--cover' : ''\}\}/)
  const css = read('pages/play/index.wxss')
  const im = css.match(/\.st-intro__im\{[^}]*\}/)[0]
  assert.doesNotMatch(im, /opacity|filter|blur|saturate/, '封面不压暗、不模糊、不去饱和')
  const after = css.match(/\.st-intro__bg::after\{[^}]*\}/)[0]
  const stops = Array.from(after.matchAll(/rgba\(var\(--lk-bg-rgb, 0,0,0\), ([\d.]+)\) (\d+)%/g)).map((m) => [Number(m[1]), Number(m[2])])
  assert.equal(stops.length, 6)
  const alphaAt = (pct) => { for (let i = 1; i < stops.length; i += 1) { const [a0, p0] = stops[i - 1], [a1, p1] = stops[i]; if (pct <= p1) return a0 + (a1 - a0) * (pct - p0) / (p1 - p0) } return stops[stops.length - 1][0] }
  assert.ok(stops[0][0] <= 0.3 && alphaAt(14) === 0 && alphaAt(46) === 0, '上半张封面满亮度(顶部只留一小条给状态栏)')
  assert.ok(alphaAt(60) >= 0.74, '下方约四成是文字块的底')
  // 对比度:最浅的封面(纯白)+ 各风格默认底色做遮罩,文字块(60% 以下)里标题 / 副标题 / 都 ≥ WCAG AA 4.5:1;最深的封面(纯黑)更高
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const mix = (top, a, under) => top.map((v, i) => v * a + under[i] * (1 - a))
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
  assert.match(css, /\.st-intro__line\{[^}]*color:rgba\(var\(--lk-ink-rgb, 255,255,255\), \.85\);/)
  assert.match(css, /\.st-intro--cover \.st-intro__body\{ justify-content:flex-end;/, '有封面时文字块落在渐变上')
  STYLES.forEach((style) => {
    const c = lc.LOOK_COLORS[style].DEFAULT, bg = hex(c.bg), ink = hex(c.ink)
    ;[[255, 255, 255], [0, 0, 0]].forEach((cover) => {
      const title = mix(bg, alphaAt(60), cover), line = mix(bg, alphaAt(70), cover)
      assert.ok(ratio(ink, title) >= 4.5, style + ' 标题 ' + ratio(ink, title).toFixed(2))
      assert.ok(ratio(mix(ink, 0.85, line), line) >= 4.5, style + ' 副标题 ' + ratio(mix(ink, 0.85, line), line).toFixed(2))
    })
  })
  assert.doesNotMatch(css.slice(css.indexOf('.st-intro{'), css.indexOf('.st-stats{')), /@keyframes|animation:/)
})

test('本局完成:有路线徽章用路线徽章(染外观主色),没有才回落通用成功插图', () => {
  const reward = { finishMedalName: '外滩夜行者', finishMedalImg: 'm.png' }
  const nodes = [{ nodeId: 1, done: true }, { nodeId: 2, done: false }]
  const won = [{ nodeId: 2, name: '没走完的', img: 'x.png' }, { nodeId: 1, name: '邮差的钥匙', img: 'k.png', rank: 1 }]
  assert.deepEqual(pickEndingMedal({ allDone: true, reward, won, nodes }), { name: '外滩夜行者', img: 'm.png', glyph: 'flag' }, '主题通关徽章优先')
  assert.deepEqual(pickEndingMedal({ allDone: true, reward: { finishMedalName: '只有名字' } }), { name: '只有名字', img: '', glyph: 'flag' }, '没配图用字形')
  assert.deepEqual(pickEndingMedal({ allDone: false, reward, won, nodes }), { name: '邮差的钥匙', img: 'k.png', glyph: 'star' }, '没全部完成:本局真夺到、且该站仍已完成的第一枚')
  assert.equal(pickEndingMedal({ allDone: false, reward, won: [won[0]], nodes }), null, '一枚都没有 → 回落')
  assert.equal(pickEndingMedal({ allDone: true, reward: {} }), null)
  assert.equal(pickEndingMedal(), null)
  const opts = { allDone: true, reward, won, nodes }
  assert.equal(pickEndingMedal(opts).name, buildFinishMedals(opts)[0].name, '与完成页勋章堆同一口径同一顺序')

  // 页面方法:带上 medal;探店日不取主题徽章
  const pops = require('../../pages/play/utils/play-stage-pops.js')
  const host = (data) => Object.assign({ data, _themeReward: reward, _wonMedals: [] }, pops.methods())
  assert.deepEqual(host({ allDone: true, mode: 1, nodes })._endingReward(), { reward: { name: '外滩夜行者', img: 'm.png', count: 1 }, medal: { name: '外滩夜行者', img: 'm.png', glyph: 'flag' } })   // 2026-11-23:主视觉是路线勋章时也写出勋章名
  assert.deepEqual(host({ allDone: true, mode: 2, nodes })._endingReward(), { reward: null, medal: null })
  assert.deepEqual(host({ allDone: false, mode: 1, nodes })._endingReward(), { reward: null, medal: null })

  const wxml = read('pages/play/index.wxml')
  assert.match(wxml, /\{\{previewEnding\.medal \? 'pv-ending--medal' : ''\}\}/)
  assert.match(wxml, /<view class="pv-ending__medal" wx:if="\{\{previewEnding\.medal\}\}"><image wx:if="\{\{previewEnding\.medal\.img\}\}" class="pv-ending__medal-img" src="\{\{previewEnding\.medal\.img\}\}" mode="aspectFill" \/><cy-icon wx:else name="\{\{previewEnding\.medal\.glyph\}\}" size="120" \/><\/view><cy-frames [^>]* wx:else \/>/, '通用插图只在没有徽章时出')
  const css = read('pages/play/play-stage.wxss')
  assert.match(css, /\.pv-ending--medal \{ --pe-rgb: var\(--lk-a-rgb, 255,255,255\);/, '染外观主色')
  assert.match(css, /\.look--stardust\.look-palette--white \.pv-ending--medal \{ --pe-rgb: var\(--lk-bg-rgb\); \}/, '星尘白的主色是墨黑,黑底上取纸白')
  assert.match(css, /\.pv-ending--reduced \.pv-ending__medal \{ transition: none; opacity: 1; transform: none; \}/, '减弱动态:直接落位')
  assert.doesNotMatch(css.slice(css.indexOf('.pv-ending--medal')), /@keyframes|animation:/, '不加关键帧')
  // 外观主色在玩家黑上要看得见(星尘白除外,已换纸白)
  STYLES.forEach((style) => PALETTES.forEach((palette) => {
    const c = lc.colorsFor({ style, palette }), tint = style === 'STARDUST' && palette === 'WHITE' ? c.bg : c.a
    assert.ok(lc.luminance(tint) > 0.035, style + ' × ' + palette + ' 徽章色 ' + tint)
  }))
})
