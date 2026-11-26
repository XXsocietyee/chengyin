// 2026-11-23 业主实走(路线 9913101 外滩回执)后批准的四项:
//   1 通关屏用路线自己的勋章(图 + 名),通用旗子只作兜底;2 答对后的柠檬绿卡通对勾 → 跟外观的「通过」章;
//   3 地点卡「开始任务」不再多弹一张同图同名的开始卡;4 首站定位在打开题目之前问。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const { buildFinishMedals, pickEndingMedal, themeMedals } = require('../../pages/play/utils/finish-medals.js')
const pops = require('../../pages/play/utils/play-stage-pops.js')
const locOnce = require('../../pages/play/utils/play-location-once.js')

test('1 主题自己配的勋章(主题规则 items kind=MEDAL)从背包视图里取:手里有的 + 结局快照里拿到过的,物品与没拿到的不算', () => {
  const view = {
    contents: [
      { id: 'an', kind: 'MEDAL', name: '一个安字', image: 'https://x/an.png', quantity: 1 },
      { id: 'key', kind: 'ITEM', name: '钥匙', image: 'https://x/key.png', quantity: 2 },
      { id: 'zero', kind: 'MEDAL', name: '没拿到', image: 'https://x/z.png', quantity: 0 },
    ],
    result: { acquired: { an: 1, end: 1, miss: 0 }, catalog: [
      { id: 'an', kind: 'MEDAL', name: '一个安字', image: 'https://x/an.png' },
      { id: 'end', kind: 'MEDAL', name: '回执', image: '' },
      { id: 'miss', kind: 'MEDAL', name: '错过的', image: 'https://x/m.png' },
    ] },
  }
  assert.deepEqual(themeMedals(view), [{ id: 'an', name: '一个安字', img: 'https://x/an.png' }, { id: 'end', name: '回执', img: '' }])
  assert.deepEqual(themeMedals(null), [])
  assert.deepEqual(themeMedals({ contents: 'x', result: { catalog: {} } }), [])
})

test('1 通关徽章没配图时借同名勋章的图(主题勋章 → 站点模板),都没有才是字形;配了图不被覆盖', () => {
  const theme = [{ id: 'an', name: '一个安字', img: 'https://x/an.png' }]
  const nodes = [{ nodeId: 1, done: true, medalName: '站点同名', medalImg: 'https://x/node.png' }]
  assert.deepEqual(pickEndingMedal({ allDone: true, reward: { finishMedalName: '一个安字' }, theme }),
    { name: '一个安字', img: 'https://x/an.png', glyph: 'flag' })
  assert.deepEqual(pickEndingMedal({ allDone: true, reward: { finishMedalName: '站点同名', finishMedalImg: '' }, nodes }),
    { name: '站点同名', img: 'https://x/node.png', glyph: 'flag' })
  assert.equal(pickEndingMedal({ allDone: true, reward: { finishMedalName: '一个安字', finishMedalImg: 'own.png' }, theme }).img, 'own.png')
  assert.deepEqual(pickEndingMedal({ allDone: true, reward: { finishMedalName: '谁也不像' }, theme: [], nodes }),
    { name: '谁也不像', img: '', glyph: 'flag' }, '真没有图:通用字形兜底')
})

test('1 路线没配通关徽章名、但有主题勋章:主视觉就是它;同名不重复、legacy_ 副本不重复、排在站点奖牌之前', () => {
  const theme = [
    { id: 'an', name: '一个安字', img: 'https://x/an.png' },
    { id: 'legacy_finish', name: '通关勋章', img: 'https://x/f.png' },
    { id: 'legacy_node_5', name: '邮差的钥匙', img: 'https://x/k.png' },
  ]
  const nodes = [{ nodeId: 5, done: true }]
  const won = [{ nodeId: 5, name: '邮差的钥匙', img: 'https://x/k.png', rank: 2 }]
  const list = buildFinishMedals({ allDone: true, reward: {}, theme, won, nodes })
  assert.deepEqual(list.map((m) => [m.key, m.name, m.img]), [['bag-an', '一个安字', 'https://x/an.png'], ['node-5', '邮差的钥匙', 'https://x/k.png']])
  assert.equal(list[0].sub, '主题勋章')
  assert.deepEqual(pickEndingMedal({ allDone: true, reward: {}, theme, won, nodes }), { name: '一个安字', img: 'https://x/an.png', glyph: 'flag' })
  const both = buildFinishMedals({ allDone: true, reward: { finishMedalName: '一个安字' }, theme, won, nodes })
  assert.deepEqual(both.map((m) => m.key), ['theme', 'node-5'], '通关徽章与主题勋章同名只列一枚')
  assert.equal(both[0].img, 'https://x/an.png')
  assert.deepEqual(buildFinishMedals({ allDone: true, reward: {} }), [], '路线真的一枚都没有 → 空,屏上回落通用成功插图')
})

test('1 页面接线:本局完成屏 / 完成页勋章堆都带上背包里的主题勋章,勋章名跟主视觉同一枚;探店日不取', () => {
  const themeBag = { contents: [{ id: 'an', kind: 'MEDAL', name: '一个安字', image: 'https://x/an.png', quantity: 1 }] }
  const host = (data, won) => Object.assign({ data, _themeReward: null, _wonMedals: won || [] }, pops.methods())
  assert.deepEqual(host({ allDone: true, mode: 1, nodes: [], themeBag })._endingReward(),
    { reward: { name: '一个安字', img: 'https://x/an.png', count: 1 }, medal: { name: '一个安字', img: 'https://x/an.png', glyph: 'flag' } })
  assert.deepEqual(host({ allDone: true, mode: 2, nodes: [], themeBag })._endingReward(), { reward: null, medal: null })
  // 主视觉是主题勋章、又夺到站点奖牌:名字写主视觉那一枚,不再图是这枚、名字是那枚
  const withWon = host({ allDone: true, mode: 1, nodes: [{ nodeId: 5, done: true }], themeBag }, [{ nodeId: 5, name: '邮差的钥匙', img: '', rank: 1 }])._endingReward()
  assert.equal(withWon.medal.name, '一个安字'); assert.deepEqual(withWon.reward, { name: '一个安字', img: 'https://x/an.png', count: 1 })
  const js = read('pages/play/index.js')
  assert.match(js, /buildFinishMedals\(\{ allDone: !!this\.data\.allDone && !isShopDay, reward: this\._themeReward, won: this\._wonMedals, nodes: this\.data\.nodes, theme: isShopDay \? \[\] : themeMedals\(this\.data\.themeBag\) \}\)/)
  const wxml = read('pages/play/index.wxml')
  assert.match(wxml, /<image wx:if="\{\{previewEnding\.medal\.img\}\}" class="pv-ending__medal-img" src="\{\{previewEnding\.medal\.img\}\}"/, '有图就是路线勋章的图')
  assert.match(wxml, /previewEnding\.real && previewEnding\.reward \? previewEnding\.reward\.name/, '勋章名写在标题位')
})

test('2 答对后的判定屏:柠檬绿成功插图退场,换成跟外观配色的「通过」章;只落章一次,不循环', () => {
  const wxml = read('pages/play/components/play-verdict/index.wxml')
  assert.match(wxml, /<view class="pv__art" wx:if="\{\{kind === 'win' && !neutral\}\}">\s*<view class="pv__stamp"><view class="pv__stamp-in">通过<\/view><\/view>/)
  assert.ok(!/name="success"/.test(wxml), '成功插图(柠檬绿对勾方块)不再用在判定屏')
  assert.match(wxml, /<cy-illus wx:if="\{\{rising\}\}" name="fail"/, '失败屏不动')
  const wxss = read('pages/play/components/play-verdict/index.wxss')
  // 颜色只走外观 / 设计变量:主题内取外观强调色(纸本 = 印泥色,夜城 / 星尘 = 各自强调色),没有外观落回成功色
  assert.match(wxss, /\.pv--closable \.pv__stamp \{ --pv-stamp: var\(--cy-color-status-success\); \}/)
  assert.ok(!/pv__stamp[^}]*pk-embed-accent/.test(wxss), '通过章不跟外观强调色(2026-11-24 业主:通过绿、失败红)')
  assert.match(wxss, /\.pv__stamp \{[^}]*border: 8rpx solid var\(--pv-stamp\); border-radius: var\(--lk-r, var\(--cy-radius-md\)\);[^}]*color: var\(--pv-stamp\)/)
  assert.match(wxss, /\.pv__stamp-in \{[^}]*font-family: var\(--lk-fd, inherit\)/)
  const stamp = wxss.slice(wxss.indexOf('.pv__stamp {'), wxss.indexOf('.pv--reduced .pv__stamp'))
  assert.ok(!/animation|infinite|@keyframes/.test(stamp), '落章是一次过渡:不加 keyframes、不循环')
  assert.match(wxss, /\.pv--on \.pv__stamp \{ opacity: \.92; transform: rotate\(-8deg\) scale\(1\); \}/)
  assert.match(wxss, /\.pv--reduced \.pv__stamp \{ transition: none; opacity: \.92; transform: rotate\(-8deg\); \}/)
  // 外观强调色确实由宿主给到:玩家页的判定屏挂 pk-lookhost + lookClass,look-tokens 把 --pk-embed-accent 接到 --lk-a
  assert.match(read('pages/play/index.wxml'), /<cy-play-verdict class="pk-lookhost \{\{lookClass\}\}" show="\{\{r5Verdict\.show\}\}"/)
  assert.match(read('pages/play/look-tokens.wxss'), /\.pk-lookhost\[class\*="look--"\] \{[^}]*--pk-embed-accent:var\(--lk-a\)/)
})

function kitHost(extra) {
  const h = Object.assign({
    data: Object.assign({}, JSON.parse(JSON.stringify(pops.data)), { nodes: [], chapterParas: [], playKit: {}, sheet: {}, advancedPlay: {} }),
    calls: [],
    setData(patch) { Object.assign(this.data, patch) },
    _isStoryGame() { return true },
  }, pops.methods(), {
    startGame() { this.calls.push('startGame') },
    expandPlayKit() { this.calls.push('expandPlayKit') },
    startStoryGame() { this.calls.push('startStoryGame') },
  }, extra || {})
  return h
}

test('3 地点卡「开始任务」/ 玩法横卡直接开始任务,不再弹第二张开始卡;入口卡同理;没有站点不动', () => {
  const sh = kitHost(); sh.data.sheet = { node: { nodeId: 9, name: '外滩', lat: 31, lng: 121, hasGame: true } }
  sh.openKitStart({ currentTarget: { dataset: { origin: 'sheet' } } })
  assert.deepEqual(sh.calls, ['startGame']); assert.equal(sh.data.kitStart.show, false)
  const none = kitHost(); none.openKitStart({ currentTarget: { dataset: { origin: 'sheet' } } })
  assert.deepEqual(none.calls, [])
  const cd = kitHost(); cd.data.playKit = { card: true, pop: false }
  cd.openKitStart({ currentTarget: { dataset: { origin: 'card' } } })
  assert.deepEqual(cd.calls, ['expandPlayKit']); assert.equal(cd.data.kitStart.show, false)
  const wxml = read('pages/play/index.wxml')
  assert.match(wxml, /<view class="lk-btn lk-btn--primary" data-origin="sheet" bindtap="openKitStart"[^>]*>开始任务<\/view>/)
})

test('3 故事流入口有「嵌入 / 全屏」可选:开始卡保留,pickKitMode / confirmKitStart 照旧', () => {
  const h = kitHost()
  h.data.nodes = [{ nodeId: 7, name: '谁在钟楼留下了钥匙' }]; h.data.chapterParas = [{ kind: 'game', nodeId: 7 }]
  h.openKitStart({ currentTarget: { dataset: { origin: 'story', nodeid: 7 } } })
  assert.equal(h.data.kitStart.show, true); assert.equal(h.data.kitStart.modes, true); assert.deepEqual(h.calls, [])
  h.setData = function (patch) { Object.keys(patch).forEach((k) => { const ks = k.split('.'); let o = this.data; ks.slice(0, -1).forEach((x) => { o = o[x] }); o[ks[ks.length - 1]] = patch[k] }) }
  h.pickKitMode({ currentTarget: { dataset: { mode: 'full' } } })
  h.confirmKitStart()
  assert.equal(h.data.kitStart.show, false); assert.equal(h._kitStartFull, '7'); assert.deepEqual(h.calls, ['startStoryGame'])
  const stage = read('pages/play/play-stage.wxml')
  assert.match(stage, /wx:if="\{\{kitStart\.modes\}\}" aria-role="radiogroup"/)
})

function gateHost(over) {
  const h = Object.assign({
    data: { mode: 1, gpsOk: false, isPreview: false, isMock: false, nodes: [] },
    asked: 0, _locAsked: false, _loc: null,
    _startLocationNeeded() { return !(this.data.nodes || []).some((n) => n && n.done) },
    _isStoryGame() { return false },
    _startTooFar() { return '' },
    _sessionKey() { return 't:1' },
    requestPlayLocation() { this.asked++; this._locAsked = true },
  }, locOnce.methods(), over || {})
  return h
}

test('4 首站开局:先做完不带坐标的故事玩法也照样在打开题目之前问定位;授权后接着打开;之后各站不再问', () => {
  const first = { nodeId: 11, lat: 31, lng: 121 }
  const story = { nodeId: 1, done: true }   // 序章里的故事玩法:完成了,但没有坐标
  const h = gateHost(); h.data.nodes = [story, first]
  assert.equal(h._startLocationNeeded(), false, '原判据:已有完成站 = 不再问(闸被跳过,题目打开后才弹定位)')
  assert.equal(h._startAskNeeded(), true)
  let opened = 0
  assert.equal(h._startGate(first, () => { opened++ }), true, '拦下:题目还没打开')
  assert.equal(h.asked, 1); assert.equal(opened, 0)
  h._runPendingStart(); assert.equal(opened, 1, '定位拿到后接着打开任务')
  // 第一站(带坐标)完成之后:后面各站不问
  const later = gateHost(); later.data.nodes = [story, Object.assign({}, first, { done: true }), { nodeId: 12, lat: 31, lng: 121 }]
  assert.equal(later._startAskNeeded(), false)
  assert.equal(later._startGate(later.data.nodes[2], () => {}), false); assert.equal(later.asked, 0)
})

test('4 服务端刚因缺定位拒过(_forceStartFix):再开题也先问;问过没开仍走扫码,不重复弹;已有定位不问', () => {
  const node = { nodeId: 12, lat: 31, lng: 121 }
  const forced = gateHost({ _forceStartFix: true }); forced.data.nodes = [{ nodeId: 11, lat: 31, lng: 121, done: true }, node]
  assert.equal(forced._startGate(node, () => {}), true); assert.equal(forced.asked, 1)
  const declined = gateHost({ _locAsked: true }); declined.data.nodes = [node]
  assert.equal(declined._startGate(node, () => {}), false, '问过没开:照旧放行,走扫码到达'); assert.equal(declined.asked, 0)
  const located = gateHost(); located.data.nodes = [node]; located.data.gpsOk = true; located._loc = { latitude: 31, longitude: 121, capturedAt: Date.now() }
  assert.equal(located._startGate(node, () => {}), false); assert.equal(located.asked, 0)
  // 不带坐标的站 / 故事玩法 / 预览 / 探店日:不进这道闸
  const g = gateHost(); g.data.nodes = [node]
  assert.equal(g._startGate({ nodeId: 2 }, () => {}), false)
  assert.equal(gateHost({ _isStoryGame: () => true })._startGate(node, () => {}), false)
  const pv = gateHost(); pv.data.isPreview = true; assert.equal(pv._startGate(node, () => {}), false)
  const shop = gateHost(); shop.data.mode = 2; assert.equal(shop._startGate(node, () => {}), false)
})

test('4 开局闸仍在 startGame 打开任务之前(题目 / 玩法整屏之前),300 米判定与原来同一处', () => {
  const js = read('pages/play/index.js')
  const start = js.indexOf('  startGame(nodeOverride) {')
  const gate = js.indexOf('if (this._startGate(node, () => this.startGame())) return;', start)
  const open = js.indexOf("screen: 'gamePlay', 'sheet.show': false", start)
  const adv = js.indexOf('advancedPlay: { show: true, node } });', start)
  assert.ok(start > 0 && gate > start && gate < open && gate < adv)
  const once = read('pages/play/utils/play-location-once.js')
  assert.match(once, /const tooFar = this\._startTooFar\(node\);\s*if \(tooFar\) \{ this\._startRefusal\(tooFar, resume\); return true; \}/)
})
