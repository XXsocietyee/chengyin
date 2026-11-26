const assert = require('node:assert/strict')
const { test, beforeEach } = require('node:test')
const { evidenceCards } = require('../../pages/play/utils/evidence-cards.js')

const PLAY = '../../pages/play/index.js'

// 题面媒体到达玩家端的行为测。静态匹配挡不住「字段读到了但没贴到 opts 上」这类 ——
// 那会让选项图在编辑器里配得好好的、玩家端一张不显示,且没有任何报错。

let pageConfig
let audio

global.getApp = () => ({ globalData: {}, getUserID: () => 1, sendRequest: () => {} })

global.wx = {
  getSystemInfoSync: () => ({ windowWidth: 375, statusBarHeight: 20 }),
  getMenuButtonBoundingClientRect: () => ({ top: 20, height: 32 }),
  getStorageSync: () => null,
  setStorageSync: () => {},
  removeStorageSync: () => {},
  showToast: () => {},
  previewImage: () => {},
  createSelectorQuery: () => ({
    selectAll: () => ({ boundingClientRect: () => {} }),
    select: () => ({ boundingClientRect: () => {}, scrollOffset: () => {} }),
    exec: () => {},
  }),
  createInnerAudioContext: () => {
    audio = {
      src: '', played: 0, paused: 0, stopped: 0,
      play() { this.played += 1 }, pause() { this.paused += 1 }, stop() { this.stopped += 1 },
      onPlay() {}, onPause() {}, onStop() {}, onEnded() {}, onError() {}, onWaiting() {}, onCanplay() {},
      destroy() {},
    }
    return audio
  },
}

global.Page = config => { pageConfig = config }

function setAtPath(target, rawPath, value) {
  const parts = rawPath.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

function makePage() {
  const page = Object.assign({}, pageConfig)
  page.data = JSON.parse(JSON.stringify(pageConfig.data))
  page.setData = function (patch, callback) {
    Object.keys(patch).forEach(key => setAtPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  return page
}

beforeEach(() => {
  audio = null
  pageConfig = null
  delete require.cache[require.resolve(PLAY)]
  require(PLAY)
})

test('normNode 把后端下发的题面媒体带进节点,不在这一层丢掉', () => {
  const page = makePage()

  const node = page.normNode({
    nodeId: 7, validationMethod: 3, question: '题目',
    questionImg: 'https://cdn/q.jpg', questionAudio: 'https://cdn/q.mp3',
    options: { A: '甲', B: '乙' },
    optionMedia: { A: { img: 'https://cdn/a.jpg' } },
  }, 0)

  assert.equal(node.questionImg, 'https://cdn/q.jpg')
  assert.equal(node.questionAudio, 'https://cdn/q.mp3')
  assert.deepEqual(node.optionMedia, { A: { img: 'https://cdn/a.jpg' } })
})

test('三个存量商家题图按已有清单恢复原图，高级玩法返回实际答题卡且不改源配置', async () => {
  const { legacyMerchantGameImageUrl } = require('../../pages/play/utils/merchant-game-assets.js')
  for (const name of ['signature-dish-blitz', 'stain-detective', 'home-safety-mines']) {
    const page = makePage()
    const original = { nodeId: 7, validationMethod: 3, advancedConfigJson: JSON.stringify({ timer: { enabled: true } }),
      questionImg: `/images/merchant-games/${name}.jpg`, storyImg: `/images/merchant-games/${name}.jpg` }
    const before = structuredClone(original)
    const expected = `https://www.chengyinhub.com/prod-api/profile/merchant-game-covers/${name}.jpg`
    const node = page.normNode(original, 0)
    page._playOwner = '1'
    page._boundPlayOwner = () => '1'
    page._isPlayAccountCurrent = () => true
    page._sessionKey = () => 'same-session'
    page._advancedGameComponent = () => null
    page.data.advancedPlay = { show: true, node }
    await page.onAdvancedReady({ detail: { nodeId: node.nodeId } })
    assert.equal(legacyMerchantGameImageUrl(original.questionImg), expected)
    assert.equal(page.data.game.qImg, expected)
    assert.equal(node.cover, original.storyImg, '未消费的旧剧情图字段不改写')
    assert.deepEqual(original, before)
  }
})

test('商家题图只映射精确清单，未知或歧义路径不会变成可用原图', () => {
  const { legacyMerchantGameImageUrl } = require('../../pages/play/utils/merchant-game-assets.js')
  for (const url of [
    '/images/merchant-games/missing.jpg',
    '/images/merchant-games/../merchant-games/stain-detective.jpg',
    '/images/merchant-games/%2e%2e/stain-detective.jpg',
    '/images/merchant-games/stain-detective.jpg?next=home-safety-mines.jpg',
    '/images/merchant-games/stain-detective.jpg#fragment',
    '/images/merchant-games/stain-detective.jpg/extra',
    '/images/merchant-games/stain-detective.jpg\n',
    '/images/merchant-games/\\stain-detective.jpg',
    '//www.chengyinhub.com/images/merchant-games/stain-detective.jpg',
    'http://www.chengyinhub.com/images/merchant-games/stain-detective.jpg',
    'https://www.chengyinhub.com.evil.test/images/merchant-games/stain-detective.jpg',
    'https://user@www.chengyinhub.com/images/merchant-games/stain-detective.jpg',
    'https://127.0.0.1/images/merchant-games/stain-detective.jpg',
  ]) {
    const page = makePage()
    const node = page.normNode({ nodeId: 7, validationMethod: 3, questionImg: url }, 0)
    page.startGame(node)
    assert.equal(legacyMerchantGameImageUrl(url), '', url)
    assert.equal(page.data.game.qImg, url.replace(/^http:\/\/www\.chengyinhub\.com\//, 'https://www.chengyinhub.com/'))
  }
  for (const value of [null, undefined, 7, {}]) assert.equal(legacyMerchantGameImageUrl(value), '')
})

test('答题卡按字母把媒体贴到对应选项上,没配媒体的选项拿到空串而不是 undefined', () => {
  const page = makePage()
  page.data.sheet = {
    show: true,
    node: page.normNode({
      nodeId: 7, validationMethod: 3, question: '题目',
      questionImg: 'https://cdn/q.jpg', questionAudio: 'https://cdn/q.mp3',
      options: { A: '甲', B: '乙' },
      optionMedia: { B: { img: 'https://cdn/b.jpg', audio: 'https://cdn/b.mp3' } },
    }, 0),
  }

  page.startGame()

  assert.deepEqual(page.data.game.opts, [
    { k: 'A', v: '甲', img: '', audio: '' },
    { k: 'B', v: '乙', img: 'https://cdn/b.jpg', audio: 'https://cdn/b.mp3' },
  ])
  assert.equal(page.data.game.qImg, 'https://cdn/q.jpg')
  assert.equal(page.data.game.qAudio, 'https://cdn/q.mp3')
})

test('startGame 可直接接收以 nodeId 为真源的归一化节点', () => {
  const page = makePage()
  const node = page.normNode({ nodeId: 7, validationMethod: 6, gameTitle: '收纳安装' }, 0)

  page.startGame(node)

  assert.equal(page.data.game.nodeId, 7)
  assert.equal(page.data.screen, 'gamePlay')
})

test('后端没下发 optionMedia 的老响应照常渲染选项,不因为少一个字段炸掉', () => {
  const page = makePage()
  page.data.sheet = {
    show: true,
    node: page.normNode({ nodeId: 7, validationMethod: 3, question: '题目', options: { A: '甲' } }, 0),
  }

  page.startGame()

  assert.deepEqual(page.data.game.opts, [{ k: 'A', v: '甲', img: '', audio: '' }])
})

// ★ 题干音、选项音、节点语音导览共用同一个 InnerAudioContext。
//   键必须互不相撞,否则「点选项 B 的音」会被判成「正在播的那段」而变成暂停。
test('题干音与选项音用不同的播放键,互不误判成同一段', () => {
  const page = makePage()
  page.data.game = {
    qAudio: 'https://cdn/q.mp3',
    opts: [{ k: 'A', v: '甲', img: '', audio: 'https://cdn/a.mp3' }],
  }

  page.toggleQuestionAudio()
  assert.equal(page.data.audioNodeId, 'q')
  assert.equal(audio.src, 'https://cdn/q.mp3')

  page.data.audioPlaying = true
  page.toggleOptionAudio({ currentTarget: { dataset: { k: 'A' } } })

  assert.equal(page.data.audioNodeId, 'optA')
  assert.equal(audio.src, 'https://cdn/a.mp3', '换的是源，不该被当成「同一段 → 暂停」')
  assert.equal(audio.paused, 0)
})

test('没配音频的选项点了不出声,也不把播放器状态改掉', () => {
  const page = makePage()
  page.data.game = { qAudio: '', opts: [{ k: 'A', v: '甲', img: '', audio: '' }] }

  page.toggleOptionAudio({ currentTarget: { dataset: { k: 'A' } } })

  assert.equal(audio, null, '不该为一个没有音频的选项创建播放器')
  assert.equal(page.data.audioNodeId, null)
})

test('旧商家节奏题干与选项音映射到实际分包路径，源配置不改写', () => {
  const page = makePage()
  page.data.game = {
    qAudio: '/audio/merchant-games/rhythm-three.mp3',
    opts: [{ k: 'A', audio: '/audio/merchant-games/rhythm-one.mp3' }],
  }
  page.toggleQuestionAudio()
  assert.equal(audio.src, '/pages/play/audio/merchant-games/rhythm-three.mp3')
  assert.equal(page.data.game.qAudio, '/audio/merchant-games/rhythm-three.mp3')
  page.toggleOptionAudio({ currentTarget: { dataset: { k: 'A' } } })
  assert.equal(audio.src, '/pages/play/audio/merchant-games/rhythm-one.mp3')
  assert.equal(page.data.game.opts[0].audio, '/audio/merchant-games/rhythm-one.mp3')
})

test('未知旧商家音频不创建播放器、不覆盖正在播放的状态', () => {
  const page = makePage()
  page.data.game = { qAudio: '/audio/merchant-games/missing.mp3' }
  page.data.audioNodeId = 'optA'
  page.toggleQuestionAudio()
  assert.equal(audio, null)
  assert.equal(page.data.audioNodeId, 'optA')
})

test('v5.1 盲品配置必须算 hasAdvanced，否则开始任务打不开 playkit', () => {
  const page = makePage()
  const node = page.normNode({
    nodeId: 8,
    advancedConfigJson: JSON.stringify({ schemaVersion: 1, blindTaste: { enabled: true, title: '闭上眼' } }),
  }, 0)
  assert.equal(node.hasAdvanced, true)
})

test('通关探索值不得用站点数乘 12', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../pages/play/index.js'), 'utf8')
  assert.doesNotMatch(src, /finishScore:\s*this\.data\.total\s*\*\s*12/)
})


test('旧商家节奏题音频归一到已打包路径，源配置不改写', () => {
  const page = makePage()
  page.data.game = {
    qAudio: '/audio/merchant-games/rhythm-three.mp3',
    opts: [{ k: 'A', audio: '/audio/merchant-games/rhythm-one.mp3' }],
  }
  page.toggleQuestionAudio()
  assert.equal(audio.src, '/pages/play/audio/merchant-games/rhythm-three.mp3')
  assert.equal(page.data.game.qAudio, '/audio/merchant-games/rhythm-three.mp3')
  page.toggleOptionAudio({ currentTarget: { dataset: { k: 'A' } } })
  assert.equal(audio.src, '/pages/play/audio/merchant-games/rhythm-one.mp3')
  assert.equal(page.data.game.opts[0].audio, '/audio/merchant-games/rhythm-one.mp3')
})

test('未知旧商家音频不创建播放器、不覆盖正在播放的状态', () => {
  const page = makePage()
  page.data.game = { qAudio: '/audio/merchant-games/missing.mp3' }
  page.data.audioNodeId = 'optA'
  page.toggleQuestionAudio()
  assert.equal(audio, null)
  assert.equal(page.data.audioNodeId, 'optA')
  page._toggleMediaAudio('optA', 'https://cdn/current.mp3')
  const before = { src: audio.src, played: audio.played, stopped: audio.stopped }
  page.toggleQuestionAudio()
  assert.deepEqual({ src: audio.src, played: audio.played, stopped: audio.stopped }, before)
  assert.equal(page.data.audioNodeId, 'optA')
})

// 实走复核:后端签名链接是 http://,真机不放 http 音频。自有域名升 https,外域原样不动
test('站点语音与题面媒体的自有域名 http 链接升 https', () => {
  const page = makePage()
  const node = page.normNode({ nodeId: 7, validationMethod: 3,
    audioUrl: 'http://chengyin-oss.oss-cn-shanghai.aliyuncs.com/upload/a.mp3?Signature=x',
    questionAudio: 'http://www.chengyinhub.com/prod-api/profile/q.mp3',
    questionImg: 'http://example.com/q.jpg' }, 0)
  assert.equal(node.audio, 'https://chengyin-oss.oss-cn-shanghai.aliyuncs.com/upload/a.mp3?Signature=x')
  assert.equal(node.questionAudio, 'https://www.chengyinhub.com/prod-api/profile/q.mp3')
  assert.equal(node.questionImg, 'http://example.com/q.jpg')
})

// 实走复核:站点卡不写「00:00–23:59」、导语不从句中硬切、简介与标题重复时不再写一遍
test('站点卡:全天营业不挂、导语取整句、简介重复标题时隐藏', () => {
  const page = makePage()
  page._routeInteractionBlocked = () => false
  page._lockedTip = () => false
  page.selectComponent = () => null
  const node = page.normNode({ nodeId: 9, name: '结语 · 1945年以后', description: '1945年以后', address: '故事玩法',
    businessTime: '00:00-23:59', storyText: '你面前的霍山路119—121号，曾是美犹联合分配委员会的上海办公处。JDC 1914年成立于纽约。' }, 0)
  page.openSheet(node)
  const s = page.data.sheet.node
  assert.equal(s.metaLine, '故事玩法')
  assert.equal(s.gameLede, '你面前的霍山路119—121号，曾是美犹联合分配委员会的上海办公处。')
  assert.equal(s.description, '')
  page.openSheet(Object.assign({}, node, { businessTime: '06:00-18:00', description: '纪念碑' }))
  assert.equal(page.data.sheet.node.metaLine, '故事玩法 · 06:00-18:00')
  assert.equal(page.data.sheet.node.description, '纪念碑')
})

test('L01-026 未解出且未揭示的节点不把答案和完成句写进 setData', () => {
  const page = makePage()
  const hidden = page._nodeForSetData(page.normNode({
    nodeId: 7, validationMethod: 1, question: '门牌', name: '门牌站',
    answerReveal: '梧桐', feedbackText: '恭喜你解开了', hint1: '抬头',
  }, 0))
  assert.equal(hidden.reveal, '')
  assert.equal(hidden.passText, '')
  assert.equal(hidden.feedback, '答案还没咬合，再看看四周……')
  assert.equal(hidden.hint1, '抬头')
  assert.equal(Object.prototype.hasOwnProperty.call(hidden, 'answerReveal'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(hidden, 'feedbackText'), false)
  assert.equal(hidden._heldAnswer, undefined)
  assert.equal(hidden._heldPass, undefined)
  assert.equal(JSON.stringify(hidden).includes('梧桐'), false)
  assert.equal(JSON.stringify(hidden).includes('恭喜你解开了'), false)

  assert.equal(page.normNode({ nodeId: 8, done: true, answerReveal: '梧桐', feedbackText: '恭喜你解开了' }, 0).reveal, '梧桐')
  assert.equal(page.normNode({ nodeId: 8, done: true, answerReveal: '梧桐', feedbackText: '恭喜你解开了' }, 0).passText, '恭喜你解开了')
  assert.equal(page.normNode({ nodeId: 9, revealed: true, answerReveal: '第二句' }, 0).reveal, '第二句')
  assert.equal(page.normNode({ nodeId: 10, completionMode: 'REVEALED', answerReveal: '已揭示的答案' }, 0).reveal, '已揭示的答案')
  assert.equal(page.normNode({ nodeId: 11, gameDone: true, answerReveal: '店内答案' }, 0).reveal, '店内答案')
  assert.equal(page.normNode({ nodeId: 12, done: true, reveal: '回执里的答案' }, 0).reveal, '回执里的答案')
  assert.equal(page._nodeForSetData(page.normNode({ nodeId: 13, reveal: '不该留下', answerReveal: '也不该' }, 0)).reveal, '')

  const completedByRoute = page._nodesForRoute([
    page.normNode({ nodeId: 21, answerReveal: '路线完成才给的答案', feedbackText: '路线完成的那句话' }, 0),
  ], { routeMode: 'BRANCH_GRAPH', nodeStates: { 21: 'COMPLETED' } })
  assert.equal(completedByRoute[0].reveal, '路线完成才给的答案')
  assert.equal(completedByRoute[0].passText, '路线完成的那句话')
  assert.equal(completedByRoute[0]._heldAnswer, undefined)
  assert.equal(completedByRoute[0]._heldPass, undefined)
  assert.equal(Object.prototype.hasOwnProperty.call(completedByRoute[0], 'answerReveal'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(completedByRoute[0], 'feedbackText'), false)

  const stillOpen = page._nodesForRoute([
    page.normNode({ nodeId: 22, done: true, answerReveal: '还没轮到这站', feedbackText: '不该提前看见' }, 0),
  ], { routeMode: 'BRANCH_GRAPH', nodeStates: { 22: 'PLAYABLE' } })
  assert.equal(stillOpen[0].done, false)
  assert.equal(stillOpen[0].reveal, '')
  assert.equal(stillOpen[0].passText, '')
  assert.equal(JSON.stringify(stillOpen[0]).includes('还没轮到这站'), false)
  assert.equal(JSON.stringify(stillOpen[0]).includes('不该提前看见'), false)

  page.data.nodes = [hidden]
  page.data.mode = 1
  page.data.sheet = { node: hidden }
  page.data.isPreview = true
  page.stopAudio = () => {}
  page._stageEvent = () => {}
  page._startGate = () => false
  page._autoStationVoice = () => {}
  page.loadHelpLadder = () => {}
  page.startGame()
  assert.equal(page.data.game.passText, '')
  assert.equal(page.data.game.feedback, '答案还没咬合，再看看四周……')
  assert.equal(JSON.stringify(page.data.game).includes('恭喜你解开了'), false)

  page._answerRight(7, { firstTime: true, answerReveal: '梧桐' }, '')
  assert.equal(page.data.gRight.text, '恭喜你解开了')
  assert.equal(JSON.stringify(page.data.nodes).includes('恭喜你解开了'), false)

  const earned = page._nodeForSetData(Object.assign({}, hidden, { done: true, name: '门牌站' }))
  assert.equal(earned.passText, '恭喜你解开了')
  assert.deepEqual(evidenceCards([earned]), [{ key: '7', name: '门牌站', text: '恭喜你解开了' }])
  assert.equal(evidenceCards([hidden]).length, 0)
})
