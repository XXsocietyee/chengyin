// AUDIT-1122 lane F03 (pages/publish/fabu) behaviour tests.
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/publish/fabu/index.js'

let pageConfig
let storage
let toasts
let requests

global.getApp = () => ({
  globalData: { statusBarHeight: 20, navBarHeight: 44 },
  getUserID: () => 42,
  getNickname: () => '测试创作者',
  getAvatar: () => '',
  sendRequest: options => { requests.push(options) },
  chooseImage: () => {},
  tips: message => { toasts.push(message) },
})

global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync: (key, value) => { storage[key] = value },
  removeStorageSync: key => { delete storage[key] },
  getSystemInfoSync: () => ({ windowWidth: 375 }),
  showToast: options => { toasts.push(options && options.title) },
  hideLoading: () => {},
  showModal: options => { if (options && options.success) options.success({ confirm: true }) },
  chooseLocation: () => {},
  createMapContext: () => ({ getCenterLocation: () => {} }),
  pageScrollTo: () => {},
  nextTick: callback => callback(),
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
  page.updateAllStatistics = function () { this.refreshPrimaryActionState() }
  return page
}

beforeEach(() => {
  storage = {}
  toasts = []
  requests = []
  pageConfig = null
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
})

function ruledPage() {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = [{ _localId: 'c0', name: '第1章', nodes: [], blocks: [] }]
  page.data.formData.themeRuntimeConfig = JSON.stringify({
    chapters: [{ index: 0, completion: { type: 'ANY_N', quantity: 1 }, hpCost: 2, luckCost: 0, statCosts: [], grants: [], eggs: [] }],
  })
  return page
}

const chapterRow = page => JSON.parse(page.data.formData.themeRuntimeConfig).chapters.find(ch => ch.index === 0)

test('L03-001 添加章节不把默认规则草稿写回第 1 章', () => {
  const page = ruledPage()
  const before = JSON.stringify(chapterRow(page))
  page.onTapAddChapter()
  assert.equal(page.data.formData.chapters.length, 2)
  assert.equal(JSON.stringify(chapterRow(page)), before)
})

test('L03-001 编辑章节后退出，再添加章节，不提交已取消的规则', () => {
  const page = ruledPage()
  const before = JSON.stringify(chapterRow(page))
  page.showEditChapter({ currentTarget: { dataset: { index: 0 } } })
  page.setData({ runtimeChapterCostRows: [], 'runtimeChapterRules.completionType': 'ALL' })
  page.cancelChapter()
  page.onTapAddChapter()
  assert.equal(JSON.stringify(chapterRow(page)), before)
})

test('L03-004 公共模板列表加载中 onHide 不再让回包作废、骨架屏不卡住', () => {
  const page = makePage()
  page.getPublicTempList()
  const call = requests.filter(r => r.url === '/api/template/list').pop()
  page.onHide()
  call.success({ code: 200, data: { total: 1, rows: [{ id: 5, name: '公共模板' }] } })
  assert.equal(page.data.publicTempState, 'ready')
  assert.equal(page.data.publicTempList.length, 1)
})

test('L03-004 回包因作用域变化被丢弃后，打开模板选择会重新拉取', () => {
  const page = makePage()
  page.getPublicTempList()
  const call = requests.filter(r => r.url === '/api/template/list').pop()
  page.data.operationScope = 'MERCHANT'
  call.success({ code: 200, data: { total: 0, rows: [] } })
  assert.equal(page.data.publicTempState, 'loading')
  const before = requests.filter(r => r.url === '/api/template/list').length
  page.showTemp()
  assert.equal(requests.filter(r => r.url === '/api/template/list').length, before + 1)
})

function itemPage(extra) {
  const page = makePage()
  page.data.formData.themeRuntimeConfig = JSON.stringify(Object.assign({
    items: [{ id: 'water', kind: 'ITEM', name: '水', image: 'https://example.com/w.png' }],
    chapters: [{ index: 0 }],
  }, extra))
  page.data.runtimeEditor = { kind: 'bag', index: 0 }
  return page
}
const itemIds = page => JSON.parse(page.data.formData.themeRuntimeConfig).items.map(i => i.id)

test('L03-014 配给引用的物品不能从背包删除，章节缺 grants/eggs 也不抛错', () => {
  const page = itemPage({ gameplayRuntime: { survival: { rations: [{ actKey: 'a1', itemId: 'water', quantity: 1 }] } } })
  page.removeRuntimeItem({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(itemIds(page), ['water'])
  assert.match(toasts.at(-1), /物品正在用于：配给/)
})

test('L03-090 设施条件引用的物品在线索与物品里删除时说明用在哪里', () => {
  const page = itemPage({ gameplayRuntime: { facilities: [{ name: '水站', when: [{ op: 'ITEM_HELD', itemId: 'water', quantity: 1 }] }] } })
  page.onKeysItemChange({ detail: { action: 'delete', id: 'water' } })
  assert.deepEqual(itemIds(page), ['water'])
  assert.match(toasts.at(-1), /物品正在用于：设施条件「水站」/)
})

test('L03-014 未被引用的物品可以删除', () => {
  const page = itemPage({})
  page.removeRuntimeItem({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(itemIds(page), [])
})

test('L03-009 通关规则行的节点总数来自 updateAllStatistics 写入的 totalStats', () => {
  const page = makePage()
  page.data.formData.chapters = [{ _localId: 'a', nodes: [{}, {}] }, { _localId: 'b', nodes: [{}] }]
  page.updateAllStatistics = pageConfig.updateAllStatistics
  page.updateAllStatistics()
  assert.equal(page.data.totalStats.totalNodes, 3)
  assert.equal('chapterStats' in page.data, false)
  assert.equal('completeness' in page.data, false)
})

test('L03-015 清空行动上限输入框不关掉行动开关、不写入 0', () => {
  const page = makePage()
  page.data.formData.themeRuntimeConfig = JSON.stringify({ actionLimit: 20 })
  page._syncRuntimeStats()
  assert.equal(page.data.runtimeActionEnabled, true)
  page.onRuntimeActionLimit({ detail: { value: '' } })
  assert.equal(page.data.runtimeActionEnabled, true)
  assert.equal(page.data.runtimeActionLimit, '')
  assert.equal(JSON.parse(page.data.formData.themeRuntimeConfig).actionLimit, 20)
  page.onRuntimeActionLimit({ detail: { value: '0' } })
  assert.equal(page.data.runtimeActionEnabled, true, '0 仍显示输入行，由校验提示范围')
  assert.match(page._validateRuntimeConfig(), /行动次数上限/)
  page.onRuntimeActionLimit({ detail: { value: '35' } })
  assert.equal(JSON.parse(page.data.formData.themeRuntimeConfig).actionLimit, 35)
})

test('L03-012 刷新主题统计不覆盖归零编辑器正在用的挑战节点列表', () => {
  const page = makePage()
  page.data.runtimeChallengeNodes = [{ id: 7, name: '编辑器里的节点', disabled: false }]
  page.data.runtimeAlternativeNodes = [{ id: 8, selected: true }]
  page._syncRuntimeStats()
  assert.deepEqual(page.data.runtimeChallengeNodes.map(n => n.id), [7])
  assert.deepEqual(page.data.runtimeAlternativeNodes.map(n => n.id), [8])
})

test('L03-013 彩蛋弹层有未填项也能退出，只提示本弹层的问题', () => {
  const page = makePage()
  page.data.formData.themeRuntimeConfig = JSON.stringify({
    chapters: [{ index: 0, hpCost: 0, luckCost: 0, eggs: [{ id: 'e1', name: '', trigger: 'TIME', threshold: 10, content: '', rewards: [] }] }],
    gameplayRuntime: { survival: { zeroHpPolicy: 'NOT_A_POLICY' } },
  })
  page.data.runtimeEditor = { show: true, kind: 'eggs', title: '途中彩蛋', index: 0 }
  page.closeRuntimeEditor()
  assert.equal(page.data.runtimeEditor.show, false)
  assert.equal(toasts.at(-1), '请填写彩蛋名称和内容')
})

test('L03-016 新主题首存拿到 topicId 后补存首存前设好的开局准备', () => {
  const page = makePage()
  page.onPrepChange({ detail: { items: ['带好雨伞'] } })
  assert.equal(requests.filter(r => r.url === '/api/topic/play-setup').length, 0)
  page.setData({ editingTopicId: '88' })
  page._savePlaySetupAfterCreate()
  const put = requests.filter(r => r.url === '/api/topic/play-setup' && r.method === 'PUT')
  assert.equal(put.length, 1)
  assert.deepEqual(JSON.parse(put[0].data).prepItems, ['带好雨伞'])
  assert.equal(JSON.parse(put[0].data).topicId, 88)
})

test('L03-016 没设过可玩时段和开局准备时首存不发 play-setup', () => {
  const page = makePage()
  page.setData({ editingTopicId: '88' })
  page._savePlaySetupAfterCreate()
  assert.equal(requests.filter(r => r.url === '/api/topic/play-setup').length, 0)
})

test('L03-083 改动后在途的 play-setup 读取回包不覆盖新值', () => {
  const page = makePage()
  page.setData({ editingTopicId: '88' })
  page._loadPlaySetup()
  const get = requests.filter(r => r.url === '/api/topic/play-setup' && r.method === 'GET').pop()
  page.onPrepChange({ detail: { items: ['新准备'] } })
  get.success({ code: 200, data: { playWindow: null, prepItems: ['旧准备'] } })
  assert.deepEqual(page.data.prepItems, ['新准备'])
})

test('L03-083 每次打开主题详情不重复读 play-setup；保存失败后下次打开重读', () => {
  const page = makePage()
  page.setData({ editingTopicId: '88' })
  const gets = () => requests.filter(r => r.url === '/api/topic/play-setup' && r.method === 'GET')
  page._loadPlaySetup()
  gets()[0].success({ code: 200, data: { playWindow: null, prepItems: [] } })
  page._loadPlaySetup()
  assert.equal(gets().length, 1)
  page.onPrepChange({ detail: { items: ['x'] } })
  requests.filter(r => r.method === 'PUT').pop().fail({})
  page._loadPlaySetup()
  assert.equal(gets().length, 2)
})

test('L03-007 路线图与节点不变时发布模拟只跑一次，改图后重跑', t => {
  const graph = require('../../pages/publish/utils/publish/topic-route-graph.js')
  const spy = t.mock.method(graph, 'simulate', () => ({ releaseReady: true }))
  const page = makePage()
  page._routeGraph = { edges: [{ from: 'a', to: 'b' }] }
  page._routeNodes = () => [{ id: 'a' }, { id: 'b' }]
  page._routeSimulationReport()
  page._routeSimulationReport()
  assert.equal(spy.mock.callCount(), 1)
  page._routeGraph = { edges: [{ from: 'a', to: 'c' }] }
  page._routeSimulationReport()
  assert.equal(spy.mock.callCount(), 2)
})

test('L03-045 页面参数 from=ai 不再被当成 AI 草稿，onLoad 不抛错且存储里的草稿照常回填', () => {
  storage['ai_topic_draft:m42'] = { formData: { productType: 1, name: '存储里的 AI 路线', chapters: [] } }
  const page = makePage()
  page.onLoad({ mode: '1', from: 'ai', chapters: 'not-an-array', name: 'URL 名称' })
  assert.equal(page.data.formData.name, '存储里的 AI 路线')
})

test('L03-151 模式切换复制稿打不开新页时收回复制稿并提示', () => {
  const page = makePage()
  const original = wx.navigateTo
  wx.navigateTo = options => options.fail({ errMsg: 'navigateTo:fail page limit exceeded' })
  try { page._openCopiedDraft(2) } finally { wx.navigateTo = original }
  assert.equal(storage['ai_topic_draft:m42'], null)
  assert.match(toasts.at(-1), /没能打开新草稿/)
})

test('L03-029 冷启动等会话时页面在后台，回到前台且已登录就继续加载', () => {
  const page = makePage()
  const realGetApp = global.getApp
  let uid = null
  const appStub = Object.assign(realGetApp(), { getUserID: () => uid, isAppReady: false, waitForAppReady: () => new Promise(() => {}) })
  global.getApp = () => appStub
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const p = makePage()
  try {
    p.onLoad({ mode: '1' })
    assert.equal(p.data.creatorLoginRequired, true)
    uid = 42
    p.onShow()
    assert.equal(p.data.creatorLoginRequired, false)
  } finally { global.getApp = realGetApp }
})

test('L03-071 连点「编辑玩法」只打开一层，返回后标记被消费', () => {
  const page = makePage()
  const calls = []
  const original = wx.navigateTo
  wx.navigateTo = options => { calls.push(options) }
  try {
    page.data.nodesForm = { templateId: 12 }
    page._runtimeConfig = () => ({ endings: [] })
    page.onEditBoundTemplate()
    page.onEditBoundTemplate()
    assert.equal(calls.length, 1)
    calls[0].complete()
    page.onShow()
    assert.equal(page._editingBoundTemplateId, 0)
  } finally { wx.navigateTo = original }
})

test('L03-062 自动保存不清手动保存留下的错误条；手动清时整组一起清', () => {
  const page = makePage()
  page._submitErrorStation = { key: 'x' }
  page.setData({ submitError: '保存失败', submitErrorRetry: 'draft', submitErrorNeedsEdit: true })
  page.setData(page._submitErrorAfterRun(true))
  assert.equal(page.data.submitError, '保存失败')
  assert.equal(page.data.submitErrorRetry, 'draft')
  page.setData(page._submitErrorAfterRun(false))
  assert.equal(page.data.submitError, '')
  assert.equal(page.data.submitErrorRetry, '')
  assert.equal(page.data.submitErrorNeedsEdit, false)
  assert.equal(page._submitErrorStation, null)
})

test('L03-067 城市定向未选归属俱乐部时打开主题详情(俱乐部选择所在处)', () => {
  const page = makePage()
  page.validateForm = () => true
  page.data.formData.productType = 1
  page.data.formData.clubId = ''
  page.data.myClubs = [{ id: 1, name: '甲' }, { id: 2, name: '乙' }]
  page.data.clubIndex = -1
  page.submitForm()
  assert.equal(page.data.topicDetailShow, true)
  assert.equal(toasts.at(-1), '请选择路线归属的俱乐部')
})

test('L03-092 新建命名键：在途时第二次不再发请求，请求不回调也会放开编辑器', () => {
  const page = makePage()
  page.data.editingTopicId = '9'
  page.data.routeMappingRows = [{ formIdentity: 'r1' }]
  const created = []
  page.selectComponent = () => ({ created: key => created.push(key) })
  page.onRouteRuleCreate({ detail: { identity: 'r1', kind: 'clue', label: '钥匙' } })
  page.onRouteRuleCreate({ detail: { identity: 'r1', kind: 'clue', label: '钥匙' } })
  const posts = requests.filter(r => r.url === '/api/topic/state-keys/named')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].autoErrorToast, false)
  posts[0].complete({})
  assert.deepEqual(created, ['', ''])
  page.onRouteRuleCreate({ detail: { identity: 'r1', kind: 'clue', label: '钥匙' } })
  assert.equal(requests.filter(r => r.url === '/api/topic/state-keys/named').length, 2)
})

test('L03-088 换主题背景音乐时时长归零，不沿用上一段', () => {
  const page = makePage()
  const realGetApp = global.getApp
  const appStub = Object.assign(realGetApp(), { chooseDocument: cb => cb([{ url: 'https://example.com/new.mp3' }]) })
  global.getApp = () => appStub
  try {
    page.data.formData.audioUrl = 'https://example.com/old.mp3'
    page.data.formData.audioDuration = 120
    page.uploadThemeAudio()
  } finally { global.getApp = realGetApp }
  assert.equal(page.data.formData.audioUrl, 'https://example.com/new.mp3')
  assert.equal(page.data.formData.audioDuration, 0)
})

test('L03-100/162 节点行普通点按不触发拖拽收尾 setData；真拖拽松手一次 setData 后回弹', () => {
  const page = makePage()
  let calls = 0
  const base = page.setData
  page.setData = function (patch, cb) { calls += 1; return base.call(this, patch, cb) }
  page.onNodeDragEnd({ currentTarget: { dataset: { chapterlid: 'c', nodelid: 'n' } } })
  assert.equal(calls, 0)
  page.data.dragNodeLid = 'n'
  page.onNodeDragEnd({ currentTarget: { dataset: { chapterlid: 'c', nodelid: 'n' } } })
  assert.equal(page.data.dragNodeLid, '')
  assert.equal(page.data.dragNudge, 0)
  assert.equal(calls, 2)
})

test('L03-035 选点期间节点被移到别处，回调按 _localId 写回原节点', () => {
  const page = makePage()
  page.data.formData.chapters = [{ _localId: 'c1', nodes: [
    { _localId: 'a', name: '甲', longitude: '', latitude: '' },
    { _localId: 'b', name: '乙', longitude: '', latitude: '' },
  ] }]
  let picker
  const original = wx.chooseLocation
  wx.chooseLocation = options => { picker = options }
  try {
    page.pickNodeLocation({ currentTarget: { dataset: { chapterindex: 0, nodeindex: 1 } } })
    page.data.formData.chapters[0].nodes.reverse()
    picker.success({ name: '新地点', address: '某路 1 号', longitude: 121.5, latitude: 31.2 })
  } finally { wx.chooseLocation = original }
  const nodes = page.data.formData.chapters[0].nodes
  assert.equal(nodes.find(n => n._localId === 'b').address, '某路 1 号')
  assert.equal(nodes.find(n => n._localId === 'a').address, undefined)
})

test('L03-041 编辑章节「完成」不原地改页面数据，产生新的章节数组', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = [{ _localId: 'c0', name: '第1章', nodes: [], blocks: [] }]
  page.showEditChapter({ currentTarget: { dataset: { index: 0 } } })
  const before = page.data.formData.chapters.slice()
  page.setData({ 'chapterForm.name': '新名字' })
  page.confirmChapter()
  const beforeChapter = before[0]
  assert.notEqual(page.data.formData.chapters[0], beforeChapter, 'L03-040 后按章路径回传：被改的那章是新对象')
  assert.equal(beforeChapter.name, '第1章')
  assert.equal(page.data.formData.chapters[0].name, '新名字')
})

test('L03-046 AI 草稿缺票种时，城市定向稿兜底的是定向票(mode 1)', () => {
  const page = makePage()
  page.applyAiDraft({ from: 'ai', formData: { productType: 1, name: '定向路线', chapters: [] } })
  const ticket = page.data.formData.tickets[0]
  assert.equal(ticket.mode, 1)
  assert.equal(ticket.meetingPointAddress, '')
  assert.equal(ticket.description, 'AI 辅助生成的体验票')
})

test('L03-054 校验定位打开票务编辑器时与点票卡同一规整，越界下标夹到最后一张', () => {
  const page = makePage()
  page._revealTicketEditor = () => {}
  page.data.formData.productType = 2
  page.data.formData.tickets = [{ id: 5, name: '探索票', price: null, totalStock: '', meetingPoint: '' }]
  page.focusValidationError({ ticketPrice3: '请填写票价' })
  assert.equal(page.data.showTicketEditor, true)
  assert.equal(page.data.editingTicket.editIndex, 0)
  assert.equal(page.data.editingTicket.price, '')
  assert.equal(page.data.editingTicket.totalStock, 100)
})

test('L03-055 勋章图：无设计权限不上传；离页期间回来的旧回包不写入', () => {
  const page = makePage()
  const realGetApp = global.getApp
  let pending = []
  const appStub = Object.assign(realGetApp(), { chooseImage: cb => pending.push(cb) })
  global.getApp = () => appStub
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const p = makePage()
  try {
    p.data.medalEditable = false
    p.uploadFinishMedal()
    assert.equal(pending.length, 0)
    p.data.medalEditable = true
    p.uploadFinishMedal()
    p.data.editingTopicId = '99'
    pending[0](['https://example.com/m.png'])
    assert.equal(p.data.formData.finishMedalImg || '', '')
    p.uploadFinishMedal()
    pending[1](['https://example.com/m2.png'])
    assert.equal(p.data.formData.finishMedalImg, 'https://example.com/m2.png')
  } finally { global.getApp = realGetApp }
})

test('L03-084 连续改开局准备：先发的 PUT 迟到失败不再报错', () => {
  const page = makePage()
  page.setData({ editingTopicId: '88' })
  page.onPrepChange({ detail: { items: ['a'] } })
  page.onPrepChange({ detail: { items: ['a', 'b'] } })
  const puts = requests.filter(r => r.method === 'PUT')
  const before = toasts.length
  puts[0].fail({})
  assert.equal(toasts.length, before)
  puts[1].fail({})
  assert.equal(toasts.length, before + 1)
})

test('L03-093 注册表还在读时打开「添加」不先报错，读完自动刷新', () => {
  const page = makePage()
  page.data.initialStateEditor = Object.assign({}, page.data.initialStateEditor, { rules: { attributes: [] }, carry: [] })
  page.data.attributeRegistrySnapshot = null
  page.data.attributeRegistryError = ''
  page.openCarryPicker()
  assert.equal(page.data.carryPicker.state, 'loading')
  page.data.attributeRegistrySnapshot = { definitions: [] }
  page._carryRegistrySettled()
  assert.equal(page.data.carryPicker.state, 'ready')
  page.data.attributeRegistrySnapshot = null
  page.data.attributeRegistryError = '注册定义读取失败，请重试'
  page.openCarryPicker()
  assert.equal(page.data.carryPicker.state, 'error')
})

test('L03-068 手动保存被前置条件拦下时有提示，自动保存仍静默', () => {
  const page = makePage()
  page._draftScopeUnconfirmed = true
  page._runServerDraft({}, false, true)
  assert.equal(toasts.length, 0)
  page._runServerDraft({}, false, false)
  assert.equal(toasts.at(-1), '先处理草稿恢复提示，再保存或发布')
  page.sendData({})
  assert.equal(toasts.length, 2)
})

test('L03-048 canplay 时时长为 0(iOS)会再读几次；取消章节弹窗时销毁探测音频', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = makePage()
  const audios = []
  const original = wx.createInnerAudioContext
  wx.createInnerAudioContext = () => { const a = { duration: 0, destroyed: false, onCanplay(cb) { a.canplay = cb }, onError() {}, destroy() { a.destroyed = true } }; audios.push(a); return a }
  try {
    page.data.popChapter = true
    page._chapterAudioToken = 1
    page.data.chapterForm = Object.assign({}, page.data.chapterForm, { audioUrl: 'https://example.com/a.mp3' })
    page.autoDetectAudioDuration('https://example.com/a.mp3')
    audios[0].canplay()
    audios[0].duration = 61.4
    t.mock.timers.tick(200)
    assert.equal(page.data.chapterForm.audioDuration, 61)
    assert.equal(audios[0].destroyed, true)
    page.autoDetectAudioDuration('https://example.com/a.mp3')
    page.cancelChapter()
    assert.equal(audios[1].destroyed, true)
  } finally { wx.createInnerAudioContext = original }
})

test('L03-057 票种已存日期超出 31 天候选时补进列表并选中它', () => {
  const page = makePage()
  page.data.dateList = [{ date: '2026-11-23', display: '11月23日' }, { date: '2026-11-24', display: '11月24日' }]
  page.data.editingTicket = Object.assign({}, page.data.editingTicket, { saleEndTime: '2027-03-01' })
  page.showTicketTimePicker({ currentTarget: { dataset: { field: 'saleEndTime', mode: 'date' } } })
  const list = page.data.dateList
  assert.equal(list[page.data.ticketDateIndex[0]].date, '2027-03-01')
  assert.equal(list.length, 3)
})

test('L03-056 编辑既有主题时用户资料不预填合作者，回包也不收别处的加载层', () => {
  const page = makePage()
  page.data.editingTopicId = '77'
  page.data.formData.collaboratorList = []
  page.getUserData()
  assert.deepEqual(page.data.formData.collaboratorList, [])
  const loading = require('../../utils/loading.js')
  let hidden = 0
  const original = loading.hide
  loading.hide = () => { hidden += 1 }
  try {
    requests.filter(r => r.url === '/api/user/info').pop().success({ code: 200, data: { id: 42, nickname: '我' } })
  } finally { loading.hide = original }
  assert.equal(hidden, 0)
  assert.deepEqual(page.data.formData.collaboratorList, [])
})

test('L03-167 AI 结果分类一处：盲区类型不算未通过，建议类型不阻断', () => {
  const page = makePage()
  const ai = page._classifyAiIssues([
    { type: 'missing_cover', level: 'error', message: '缺封面' },
    { type: 'timeline_conflict', level: 'error', message: '营业时间' },
    { type: 'parse_error', level: 'error', message: 'AI 炸了' },
    { type: 'unsafe', level: 'error', message: '违规' },
  ])
  assert.deepEqual(ai.issues.map(i => i.type), ['timeline_conflict', 'parse_error', 'unsafe'])
  assert.deepEqual(ai.blocking.map(i => i.type), ['unsafe'])
  page.buildPublishCheck = () => ({ blocking: [], advisory: [] })
  page._publishAfterIdentity = () => {}
  page._afterPrecheck([{ type: 'missing_cover', level: 'error', message: '缺封面' }], '')
  assert.equal(page._publishPrecheckOk, true)
})

test('L03-168 「通关规则已确定」按真实校验：至少完成数超过节点数时不算通过', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.data.formData.chapters = [{ _localId: 'c', name: '一', nodes: [{ _localId: 'n', name: '点' }] }]
  page.data.completionRuleMode = 'AT_LEAST'
  page.data.completionRequiredCount = 5
  const labels = page._buildPublishPassed(true).map(i => i.label)
  assert.equal(labels.includes('通关规则已确定'), false)
})

test('L03-161 连续两次定位：前一次的清空不会抹掉后一次的锚点', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = makePage()
  page._scrollSheetTo('a')
  t.mock.timers.tick(220)
  page._scrollSheetTo('b')
  t.mock.timers.tick(220)
  assert.equal(page.data.scrollIntoView, 'b')
  t.mock.timers.tick(300)
  assert.equal(page.data.scrollIntoView, 'b')
})

test('L03-154 卸载后迟到的俱乐部列表回包不写页面', () => {
  const page = makePage()
  page.loadMyClubs()
  page._unloaded = true
  requests.filter(r => r.url === '/api/club/my').pop().success({ code: 200, data: { owned: [{ id: 1, status: 1 }] } })
  assert.deepEqual(page.data.myClubs, [])
})

test('L03-184 玩法支持矩阵加载异常时解除加载态并可重试', async () => {
  const sm = require('../../pages/publish/utils/publish/gameplay-support-matrix.js')
  const original = sm.load
  sm.load = () => Promise.reject(new Error('boom'))
  try {
    const page = makePage()
    await page._loadSupportMatrix()
    assert.equal(page.data.supportMatrixLoading, false)
    assert.match(page.data.supportMatrixLoadError, /未加载/)
    assert.equal(page._supportMatrixRequested, false)
  } finally { sm.load = original }
})

test('L03-204 角色试听放完即销毁音频、不受静音键影响', () => {
  const page = makePage()
  const audios = []
  const original = wx.createInnerAudioContext
  wx.createInnerAudioContext = () => { const a = { destroyed: false, onEnded(cb) { a.ended = cb }, onError() {}, play() {}, destroy() { a.destroyed = true } }; audios.push(a); return a }
  try {
    page._castPreviewToken = 1
    page._playCastUrl('https://example.com/v.mp3', 1)
    assert.equal(audios[0].obeyMuteSwitch, false)
    audios[0].ended()
    assert.equal(audios[0].destroyed, true)
    assert.equal(page._castAudio, null)
  } finally { wx.createInnerAudioContext = original }
})

test('L03-202 归零编辑器字段按分区白名单写入', () => {
  const page = makePage()
  page.data.runtimeZeroEditor = { show: true, readOnly: false, draft: { policy: 'WAIT', wait: {}, steps: {}, challenge: {} } }
  const ev = (path, value) => ({ currentTarget: { dataset: { path } }, detail: { value } })
  page.inputZeroHpField(ev('wait.requiredCompletions', '3'))
  assert.equal(page.data.runtimeZeroEditor.draft.wait.requiredCompletions, undefined)
  page.inputZeroHpField(ev('wait.minutes', '30'))
  assert.equal(page.data.runtimeZeroEditor.draft.wait.minutes, 30)
  page.inputZeroHpField(ev('challenge.withinSeconds', '60'))
  assert.equal(page.data.runtimeZeroEditor.draft.challenge.withinSeconds, 60)
})

test('L03-137 标题相册块缺 images 字段时关闭故事流不抛错', () => {
  const page = makePage()
  page.data.formData.chapters = [{ _localId: 'c', blocks: [{ type: 'dream', key: 'd', title: '相册' }] }]
  page.data.storyEditor = Object.assign({}, page.data.storyEditor, { show: true, chapterIndex: 0 })
  assert.doesNotThrow(() => page.closeStoryEditor())
})

// ===== AUDIT-1122 第二轮 =====
function autosavePage(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = makePage()
  let writes = 0
  page._persistDraftEnvelope = () => { writes += 1; return true }
  page._queueCloudDraftAutosave = () => {}
  page._draftAutosaveReady = true
  page._installDraftAutosave()
  return { page, writes: () => writes }
}

test('L03-003/005 连续输入：第一下立即落本机，400ms 内的后续按键合并成一次', t => {
  const { page, writes } = autosavePage(t)
  page.setData({ 'formData.name': '寒' })
  assert.equal(writes(), 1)
  page.setData({ 'formData.name': '寒冬' })
  page.setData({ 'formData.name': '寒冬夜' })
  assert.equal(writes(), 1)
  t.mock.timers.tick(400)
  assert.equal(writes(), 2)
  t.mock.timers.tick(400)
  assert.equal(writes(), 2, '没有新编辑就不再写')
})

test('L03-003 切后台、返回、保存前都先把合并中的编辑落盘', t => {
  const { page, writes } = autosavePage(t)
  page.setData({ 'formData.name': 'a' })
  page.setData({ 'formData.name': 'ab' })
  page.onHide()
  assert.equal(writes(), 2)
  page._hidden = false
  page.setData({ 'formData.name': 'abc' }) // 窗口已被冲刷取消:这一下又是立即写
  assert.equal(writes(), 3)
  page.setData({ 'formData.name': 'abcd' })
  page.data.editingTopicId = '9'; page.data.editLoaded = true; page.data.editIsDraft = false
  page.saveServerDraft()
  assert.equal(writes(), 4)
  page.setData({ 'formData.name': 'x' })
  page.setData({ 'formData.name': 'xy' })
  page._exitEditor = () => {}
  page.goBack()
  assert.equal(writes(), 6, 'goBack 自己整包写一次,合并中的那次被取消不重复写')
  t.mock.timers.tick(1000)
  assert.equal(writes(), 6)
})

test('L03-003 清掉本机草稿后，合并中的编辑不会把草稿写回来', t => {
  const { page, writes } = autosavePage(t)
  page.setData({ 'formData.name': 'a' })
  page.setData({ 'formData.name': 'ab' })
  page._cancelDraftPersist()
  t.mock.timers.tick(1000)
  assert.equal(writes(), 1)
})

test('L03-002 改一段文字只回传那一块和它的分段缓存；插块等结构命令仍回传整章', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.data.formData.chapters = [{ _localId: 'c', name: '一', nodes: [], schemaVersion: 1, required: 1, description: '雨停了\n她推开门', blocks: [
    { type: 'text', key: 'p1', content: '雨停了' }, { type: 'text', key: 'p2', content: '她推开门' }] }]
  page.data.storyEditor = Object.assign({}, page.data.storyEditor, { show: true, chapterIndex: 0 })
  const patches = []
  const base = page.setData
  page.setData = function (patch, cb) { patches.push(Object.keys(patch)); return base.call(this, patch, cb) }
  let stats = 0
  page.updateAllStatistics = () => { stats += 1 }
  page._storyCommand({ type: 'editText', blockKey: 'p2', content: '她推开了门' })
  const keys = patches[0]
  assert.deepEqual(keys.sort(), ['formData.chapters[0].blocks[1]', 'formData.chapters[0].description', 'storySegs.p2'])
  assert.equal(page.data.formData.chapters[0].blocks[1].content, '她推开了门')
  assert.equal(stats, 0)
  patches.length = 0
  page._storyCommand({ type: 'insertMediaAt', mediaType: 'divider', index: 1, blockKey: 'd1' })
  assert.ok(patches[0].includes('formData.chapters[0]'))
  assert.equal(stats, 1)
})

test('L03-033 开场白/图片说明/分支文字逐字输入只回传那一格；分支去向变了仍整章', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.data.formData.chapters = [{ _localId: 'c', name: '一', nodes: [], schemaVersion: 1, required: 1, description: '', blocks: [
    { type: 'gallery', key: 'g1', layout: 1, images: [{ url: 'https://x/a.jpg' }] },
    { type: 'branch', key: 'b1', content: '去哪', options: [{ text: '左', to: 'continue' }, { text: '右', to: 'end' }] }] }]
  page.data.storyEditor = Object.assign({}, page.data.storyEditor, { show: true, chapterIndex: 0 })
  const patches = []
  const base = page.setData
  page.setData = function (patch, cb) { patches.push(Object.keys(patch)); return base.call(this, patch, cb) }
  let stats = 0
  page.updateAllStatistics = () => { stats += 1 }
  page._storyCommand({ type: 'setChapterCap', cap: 'open', content: '夜里' })
  assert.deepEqual(patches[0].sort(), ['formData.chapters[0]._capOpen', 'storyCaps.open'])
  assert.equal(page.data.storyCaps.open, '夜里')
  patches.length = 0
  page._storyCommand({ type: 'editGalleryCaption', blockKey: 'g1', altText: '街口' })
  assert.deepEqual(patches[0], ['formData.chapters[0].blocks[0]'])
  patches.length = 0
  page._storyCommand({ type: 'updateBranch', blockKey: 'b1', content: '往哪走' })
  assert.deepEqual(patches[0], ['formData.chapters[0].blocks[1]'])
  patches.length = 0
  page._storyCommand({ type: 'updateBranch', blockKey: 'b1', option: { index: 0, text: '向左' } })
  assert.deepEqual(patches[0], ['formData.chapters[0].blocks[1]'])
  assert.equal(stats, 0)
  patches.length = 0
  page._storyCommand({ type: 'updateBranch', blockKey: 'b1', option: { index: 0, to: 'end' } })
  assert.ok(patches[0].includes('formData.chapters[0]'), '去向变了走整章')
  assert.equal(stats, 1)
})

test('L03-021/034/040 改一章/一个节点只回传那一章；章数变了才整表', () => {
  const page = makePage()
  page.data.formData.productType = 2
  const node = (id) => ({ _localId: id, name: id, sortID: 1 })
  page.data.formData.chapters = [
    { _localId: 'c0', name: '一', nodes: [node('a')], blocks: [], imgArr: 'https://x/1.jpg,https://x/2.jpg' },
    { _localId: 'c1', name: '二', nodes: [node('b'), node('c')], blocks: [] }]
  const keys = []
  const base = page.setData
  page.setData = function (patch, cb) { keys.push(Object.keys(patch).filter((k) => k.indexOf('formData.chapters') === 0)); return base.call(this, patch, cb) }
  page.data.storyEditor = Object.assign({}, page.data.storyEditor, { chapterIndex: 0 })
  page.removeStoryCover()
  assert.deepEqual(keys.find((k) => k.length), ['formData.chapters[0]'])
  assert.equal(page.data.formData.chapters[0].imgArr, 'https://x/2.jpg')
  keys.length = 0
  const before = page.data.formData.chapters[1].nodes[0]
  page._reorderNode('c1', 'b', 1)
  assert.deepEqual(keys.find((k) => k.length), ['formData.chapters[1]'])
  assert.deepEqual(page.data.formData.chapters[1].nodes.map((n) => [n._localId, n.sortID]), [['c', 1], ['b', 2]])
  assert.equal(before.sortID, 1, '原节点对象不被原地改')
  keys.length = 0
  page.toggleChapterCollapse({ currentTarget: { dataset: { chapterindex: 0 } } })
  assert.deepEqual(keys[0], ['formData.chapters[0]._collapsed'])
  keys.length = 0
  page._setChapters(page.data.formData.chapters.concat([{ _localId: 'c2', name: '三', nodes: [], blocks: [] }]))
  assert.deepEqual(keys[0], ['formData.chapters'])
})

test('L03-034 行内改节点照片只回传那一章、抽屉没开不回传 nodesForm；删封面可撤销', () => {
  const page = makePage()
  page.data.formData.chapters = [
    { _localId: 'c0', name: '一', nodes: [{ _localId: 'n0', name: '甲' }], blocks: [], imgArr: 'https://x/1.jpg' },
    { _localId: 'c1', name: '二', nodes: [], blocks: [] }]
  const seen = []
  const base = page.setData
  page.setData = function (patch, cb) { seen.push(Object.keys(patch)); return base.call(this, patch, cb) }
  page.updateAllStatistics = () => {}
  assert.equal(page._commitInlineNodeAt(0, 0, { imgUrl: 'https://x/p.jpg' }), true)
  assert.deepEqual(seen[0].sort(), ['formData.chapters[0]', 'selectedNodeLid'])
  assert.equal('inlineEdit' in page.data, false)
  assert.deepEqual(page._inlineEdit, { chapterIndex: 0, nodeIndex: 0 })
  page.data.storyEditor = Object.assign({}, page.data.storyEditor, { chapterIndex: 0 })
  page._undoStack = []
  page.removeStoryCover()
  assert.equal(page._undoStack.length, 1)
  assert.equal(page._undoStack[0].formData.chapters[0].imgArr, 'https://x/1.jpg')
})

test('L03-011 一次运行配置编辑只发一次 setData，且批内读取拿到新值', () => {
  const page = makePage()
  page.data.formData.themeRuntimeConfig = JSON.stringify({ actionLimit: 20 })
  let calls = 0
  const base = page.setData
  page.setData = function (patch, cb) { calls += 1; return base.call(this, patch, cb) }
  page.onRuntimeActionLimit({ detail: { value: '35' } })
  assert.equal(calls, 1)
  assert.equal(JSON.parse(page.data.formData.themeRuntimeConfig).actionLimit, 35)
  assert.equal(page.data.runtimeActionLimit, 35, '同批里的统计视图读到刚存的配置')
})

test('L03-018 返回键先关最上层浮层；还有浮层时守卫保持挂着', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const page = makePage()
  page._installDraftAutosave()
  page.setData({ topicDetailShow: true })
  assert.equal(page.data.backGuardOn, true)
  page.setData({ lookSheetShow: true })
  page.onNativeBackGuard()
  assert.equal(page.data.lookSheetShow, false, '画面风格叠在主题详情上,先关它')
  assert.equal(page.data.topicDetailShow, true)
  assert.equal(page.data.backGuardOff, true)
  t.mock.timers.tick(50)
  assert.equal(page.data.backGuardOff, false)
  page.onNativeBackGuard()
  assert.equal(page.data.topicDetailShow, false)
  assert.equal(page.data.backGuardOn, false)
})

test('L03-018 自带返回守卫的组件(d20)在最上层时页面守卫让位', () => {
  const page = makePage()
  page._installDraftAutosave()
  page.setData({ topicDetailShow: true })
  page.setData({ 'd20Sheet.show': true })
  assert.equal(page.data.backGuardOn, false)
  page.setData({ 'd20Sheet.show': false })
  assert.equal(page.data.backGuardOn, true)
})

test('L03-136 自动保存等待与返回键用同一张浮层表(画面风格开着时也不上云)', () => {
  const page = makePage()
  assert.equal(page._cloudDraftEditorOpen(), false)
  page.data.lookSheetShow = true
  assert.equal(page._cloudDraftEditorOpen(), true)
})

test('L03-020 故事流 textarea 重新量高度不算草稿编辑、不落盘', t => {
  const { page, writes } = autosavePage(t)
  page.data.formData.chapters = [{ _localId: 'c', blocks: [{ type: 'text', key: 'p', content: 'a' }] }]
  page._reflowStoryTextareas(0)
  assert.equal(writes(), 0)
})

test('L03-197 无生产调用方的导出已收回（测试用的纯函数保留）', () => {
  const dir = '../../pages/publish/fabu/'
  const d20 = require(dir + 'theme-d20.js'), values = require(dir + 'theme-values.js'), rt = require(dir + 'theme-runtime.js')
  const structure = require(dir + 'theme-runtime-structure.js'), zeroHp = require(dir + 'theme-runtime-zero-hp.js')
  for (const [mod, name] of [[d20, 'parseRules'], [d20, 'presetLabel'], [values, 'REASONS'], [values, 'TRIGGERS'], [rt, 'rows'], [structure, 'modeKey'], [zeroHp, 'THEN']]) assert.equal(mod[name], undefined, name)
  assert.equal(typeof d20.read, 'function'); assert.equal(typeof rt.validate, 'function'); assert.equal(typeof structure.validate, 'function'); assert.equal(typeof zeroHp.apply, 'function')
})

test('L03-213 说话人面板的目标块存实例，不进 data', () => {
  const page = makePage()
  const keys = []
  const base = page.setData
  page.setData = function (patch, cb) { keys.push(...Object.keys(patch)); return base.call(this, patch, cb) }
  page._openSpeakerSheet('line_1')
  assert.equal(page._storyLineKey, 'line_1')
  assert.equal(keys.includes('storyLineKey'), false)
  assert.equal('storyLineKey' in page.data, false)
  let cmd = null
  page._pushUndo = () => {}; page._storyCommand = (c) => { cmd = c }
  page.onStorySpeakerPick({ currentTarget: { dataset: { value: 'm1' } } })
  assert.deepEqual(cmd, { type: 'updateLine', blockKey: 'line_1', speaker: 'm1' })
  assert.equal(page._storyLineKey, '')
})

test('L03-190 商家档只认 MERCHANT，其它真值不拼 scope=MERCHANT', () => {
  const page = makePage()
  page.data.operationScope = 'MERCHANT'
  assert.equal(page._isMerchantScope(), true)
  page.data.operationScope = 'CLUB'
  assert.equal(page._isMerchantScope(), false)
  page.data.operationScope = ''
  assert.equal(page._isMerchantScope(), false)
})

test('L03-160 章节旁白与音频块共用一个预听播放器；被顶掉的播放器回调弃权', () => {
  const page = makePage()
  const made = []
  const prev = global.wx.createInnerAudioContext
  global.wx.createInnerAudioContext = () => {
    const h = {}
    const a = { src: '', destroyed: false, play() {}, pause() {}, destroy() { this.destroyed = true } }
    for (const ev of ['onPlay', 'onPause', 'onStop', 'onEnded', 'onError']) a[ev] = (fn) => { h[ev] = fn }
    a.fire = (ev, arg) => h[ev](arg)
    made.push(a)
    return a
  }
  try {
    page.data.chapterForm = Object.assign({}, page.data.chapterForm, { audioUrl: 'https://x/a.mp3' })
    page.onPreviewChapterAudio()
    made[0].fire('onPlay')
    assert.equal(page.data.audioPreviewPlaying, true)
    page.data.formData.chapters = [{ _localId: 'c', blocks: [{ type: 'audio', key: 'au1', url: 'https://x/b.mp3' }] }]
    page.data.storyEditor = Object.assign({}, page.data.storyEditor, { chapterIndex: 0 })
    page.onPreviewStoryAudio({ currentTarget: { dataset: { blockkey: 'au1' } } })
    assert.equal(made[0].destroyed, true, '后起播的顶掉前一个')
    assert.equal(page.data.audioPreviewPlaying, false)
    made[0].fire('onPlay')
    assert.equal(page.data.audioPreviewPlaying, false, '旧播放器迟到的回调不改状态')
    made[1].fire('onPlay')
    assert.deepEqual([page.data.storyAudioPlaying, page.data.storyAudioKey], [true, 'au1'])
    made[1].fire('onPause')
    assert.deepEqual([page.data.storyAudioPlaying, page.data.storyAudioKey], [false, 'au1'])
    made[1].fire('onEnded')
    assert.equal(page.data.storyAudioKey, '')
  } finally { global.wx.createInnerAudioContext = prev }
})

test('L03-036/066 回填绑定玩法详情：最多 3 个并发，全部回来只重算一次；换主题后的回包弃权', () => {
  const page = makePage()
  page._editLoadToken = 7
  let recomputes = 0
  page.refreshPrimaryActionState = () => { recomputes += 1 }
  const detail = () => requests.filter((r) => r.url === '/api/template/author-myinfo')
  page._loadBoundTemplateDetails([1, 2, 3, 4, 5])
  assert.deepEqual(detail().map((r) => String(r.data.id)), ['1', '2', '3'])
  detail()[0].success({ code: 200, data: { id: 1 } })
  assert.deepEqual(detail().map((r) => String(r.data.id)), ['1', '2', '3', '4'])
  detail()[1].fail()
  detail()[2].success({ code: 200, data: { id: 3 } })
  detail()[3].success({ code: 200, data: { id: 4 } })
  assert.equal(recomputes, 0)
  detail()[4].success({ code: 200, data: { id: 5 } })
  assert.equal(recomputes, 1)
  assert.deepEqual(Object.keys(page._templateDetailsById).sort(), ['1', '3', '4', '5'])
  requests.length = 0
  page._loadBoundTemplateDetails([9])
  page._editLoadToken += 1
  detail()[0].success({ code: 200, data: { id: 9 } })
  assert.equal(page._templateDetailsById[9], undefined)
  assert.equal(recomputes, 1)
})

test('L03-111/112/228 章节设置、剧情弹窗、角色、画面风格的内容首次打开才建，之后常驻', () => {
  const fs = require('node:fs'), path = require('node:path')
  const dir = path.join(__dirname, '../../pages/publish/fabu/')
  const wxml = fs.readFileSync(dir + 'index.wxml', 'utf8')
  assert.match(wxml, /pop-chapter-settings[^\n]*\n  <block wx:if="\{\{mounted\.chapter\}\}">/)
  assert.match(wxml, /<block wx:if="\{\{mounted\.storyPop\}\}">\s*<scroll-view class="sp-pop__body"/)
  assert.match(fs.readFileSync(dir + 'cast-sheet.wxml', 'utf8'), /<cy-sheet show="\{\{castSheetShow\}\}"[^\n]*\n  <block wx:if="\{\{mounted\.cast\}\}">/)
  assert.match(fs.readFileSync(dir + 'look-sheet.wxml', 'utf8'), /<cy-sheet show="\{\{lookSheetShow\}\}"[^\n]*\n  <block wx:if="\{\{mounted\.look\}\}">/)
  const page = makePage()
  assert.deepEqual(page.data.mounted, { chapter: false, storyPop: false, cast: false, look: false })
  page.openStoryPop({ currentTarget: { dataset: { chapterindex: 0 } } })
  assert.equal(page.data.mounted.storyPop, true)
  page.closeStoryPop && page.closeStoryPop()
  assert.equal(page.data.mounted.storyPop, true, '关上后保留，收起动画有内容')
})

test('L03-203 录音：在录时再起一段先丢弃前一段；来电暂停按停止收尾；切后台收掉', () => {
  const page = makePage()
  const h = {}, calls = []
  const rec = { start: (o) => calls.push('start'), stop: () => calls.push('stop') }
  for (const ev of ['onStop', 'onError', 'onPause', 'onInterruptionBegin']) rec[ev] = (fn) => { h[ev] = fn }
  const prev = global.wx.getRecorderManager
  global.wx.getRecorderManager = () => rec
  try {
    assert.equal(page._startCastRecording({ kind: 'line', blockKey: 'a', chapterLocalId: 'c' }), true)
    assert.equal(page._startCastRecording({ kind: 'line', blockKey: 'b', chapterLocalId: 'c' }), false)
    assert.deepEqual(calls, ['start', 'stop'])
    assert.equal(page._castRecTarget.discard, true)
    page._stopCastRecording(true)
    assert.deepEqual(calls, ['start', 'stop'], '收尾中不重复 stop')
    h.onStop({ tempFilePath: 'x', duration: 3000 })
    assert.equal(page._castRecTarget, null)
    page._startCastRecording({ kind: 'line', blockKey: 'a', chapterLocalId: 'c' })
    h.onInterruptionBegin()
    assert.equal(page._castRecTarget.stopping, true)
    assert.equal(page._castRecTarget.discard, false, '来电打断：已录的照常保存')
    h.onStop({})
    page._startCastRecording({ kind: 'line', blockKey: 'a', chapterLocalId: 'c' })
    page.onHide()
    assert.equal(page._castRecTarget.stopping, true)
  } finally { global.wx.getRecorderManager = prev }
})

test('L03-210 身份标题逐字输入：只回传那一格并与派生视图同一次 setData', () => {
  const page = makePage()
  page.data.formData.castConfig = { enabled: true, members: [], identities: [{ id: 'i1', title: '旅人', sub: '' }] }
  const seen = []
  const base = page.setData
  page.setData = function (patch, cb) { seen.push(Object.keys(patch)); return base.call(this, patch, cb) }
  page.onCastIdentityInput({ currentTarget: { dataset: { i: 0, field: 'title' } }, detail: { value: '旅行者' } })
  assert.equal(seen.length, 1)
  assert.ok(seen[0].includes('formData.castConfig.identities[0].title'))
  assert.equal(seen[0].includes('formData.castConfig'), false)
  assert.ok(seen[0].includes('castView'))
  assert.equal(page.data.formData.castConfig.identities[0].title, '旅行者')
  assert.equal(page.data.castView.identities[0].title, '旅行者')
})

test('L03-047 点地图 pin 打开节点抽屉与列表「编辑」同一套重置（子页、绑定行、待编排目标）', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.formData.chapters = [{ _localId: 'c0', name: '一', nodes: [{ _localId: 'n0', name: '甲' }, { _localId: 'n1', name: '乙' }] }]
  page._markerMap = { 7: { chapterLid: 'c0', nodeLid: 'n1' } }
  page.buildRouteMap = () => {}
  page.setData({ nodeSheetView: 'games', nodeBindingRows: [{ key: 'old' }] }); page._editingPendingLocalId = 'p9'; page._nodeDraftDestination = 'pending' // L03-131:实例字段
  page.onMarkerTap({ detail: { markerId: 7 } })
  assert.equal(page.data.popChapterNodes, true)
  assert.equal(page.data.nodesForm._localId, 'n1')
  assert.equal(page.data.nodeSheetView, 'detail')
  assert.equal(page._editingPendingLocalId, '')
  assert.equal(page._nodeDraftDestination, 'formal')
  assert.equal(page.data.selectedNodeLid, 'n1')
  assert.deepEqual(page._inlineEdit, { chapterIndex: 0, nodeIndex: 1 })
  page.cancelPopChapter()
  assert.equal(page._inlineEdit, null)
})

test('L03-134 故事流选图/选音频回来时，编辑器已换章、已关或换了账号就不写', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.data.formData.chapters = [
    { _localId: 'c0', name: '一', nodes: [], blocks: [{ type: 'audio', key: 'au', url: '' }, { type: 'dream', key: 'dr', images: [] }], imgArr: '' },
    { _localId: 'c1', name: '二', nodes: [], blocks: [{ type: 'audio', key: 'au', url: '' }], imgArr: '' }]
  page.data.storyEditor = Object.assign({}, page.data.storyEditor, { show: true, chapterIndex: 0 })
  const pending = []
  let cmds = 0
  const realGetApp = global.getApp
  const shared = Object.assign({}, realGetApp(), { chooseImage: (cb) => pending.push(cb), chooseDocument: (cb) => pending.push(cb) })
  global.getApp = () => shared
  try {
    delete require.cache[require.resolve(PAGE)]; require(PAGE)
    const p = makePage()
    Object.assign(p.data, { formData: page.data.formData, storyEditor: page.data.storyEditor })
    p._storyCommand = () => { cmds += 1 }; p._fillStoryAudioMeta = () => {}
    p.uploadStoryAudio({ currentTarget: { dataset: { blockkey: 'au' } } })
    p.addStoryDreamImage({ currentTarget: { dataset: { blockkey: 'dr' } } })
    p.pickStoryCover()
    p.data.storyEditor.chapterIndex = 1 // 选择器开着时换到第二章
    pending[0]([{ url: 'https://x/a.mp3' }]); pending[1](['https://x/d.jpg']); pending[2](['https://x/c.jpg'])
    assert.equal(cmds, 0)
    assert.equal(p.data.formData.chapters[1].imgArr, '')
    p.data.storyEditor.chapterIndex = 0
    p.pickStoryCover()
    pending[3](['https://x/c.jpg'])
    assert.equal(p.data.formData.chapters[0].imgArr, 'https://x/c.jpg')
  } finally { global.getApp = realGetApp; delete require.cache[require.resolve(PAGE)]; require(PAGE) }
})

test('L03-166/175 打开主题详情、刷新主按钮各只发一次 setData', () => {
  const page = makePage()
  page._loadPlaySetup = () => {}
  let calls = 0
  const base = page.setData
  page.setData = function (patch, cb) { calls += 1; return base.call(this, patch, cb) }
  page.openTopicDetail()
  assert.equal(calls, 1)
  assert.equal(page.data.topicDetailShow, true)
  calls = 0
  page.refreshPrimaryActionState()
  assert.ok(calls <= 1, 'refreshPrimaryActionState 合成一次(无变化时可为 0)')
})

test('L03-175 开亲子票编辑器：开编辑器与预填合成一次 setData', () => {
  const page = makePage()
  let calls = 0
  const base = page.setData
  page.setData = function (patch, cb) { calls += 1; return base.call(this, patch, cb) }
  page._revealTicketEditor = () => {}
  page.openFamilyTicketEditor()
  assert.equal(calls, 1)
  assert.equal(page.data.showTicketEditor, true)
  assert.equal(page.data.editingTicket.childCount, 1)
})

test('L03-183 _bindNodeTemplate 三态：详情未读回为 pending，读回绑定后回调；不支持为 rejected', () => {
  const page = makePage()
  page.data.nodesForm = { id: 1, _localId: 'n1', templateId: 0 }
  page.data.popChapterNodes = true
  page._nodeTemplateTargetCurrent = () => () => true
  page._templateSupportReason = () => ''
  page._openNodePlanEndings = () => {}
  let bound = 0
  assert.equal(page._bindNodeTemplate({ id: 5, title: 'x' }, () => { bound += 1 }), 'pending')
  const req = requests.filter((r) => r.url === '/api/template/author-myinfo').at(-1)
  req.success({ code: 200, data: { id: 5, title: 'x', advancedConfigJson: '{}' } })
  assert.equal(bound, 1)
  page._templateSupportReason = () => '不支持'
  assert.equal(page._bindNodeTemplate({ id: 6, advancedConfigJson: '{}' }), 'rejected')
})

test('L03-149 权限快照未到时，读回后自动把原动作跑一次；连点只跑最后一次，读失败不跑', () => {
  const roleGuard = require('../../utils/roleGuard.js')
  const page = makePage()
  const prev = { has: roleGuard.hasSnapshot, load: roleGuard.load }
  const loads = []
  let has = false
  roleGuard.hasSnapshot = () => has
  roleGuard.load = (cb) => loads.push(cb)
  try {
    let runs = 0
    assert.equal(page._canAddFormalNodes(() => { runs += 1 }), false)
    assert.equal(page._canAddFormalNodes(() => { runs += 10 }), false)
    loads[0](); loads[1]()
    assert.equal(runs, 0, '读失败(仍无快照)不重跑')
    page._canAddFormalNodes(() => { runs += 100 })
    has = true
    loads[2]()
    assert.equal(runs, 100)
    assert.equal(page._canAddFormalNodes(), true)
  } finally { roleGuard.hasSnapshot = prev.has; roleGuard.load = prev.load }
})

test('L03-152 插入分支任务按新块 key 打开分支面板', () => {
  const page = makePage()
  page.data.formData.productType = 1
  page.data.formData.chapters = [{ _localId: 'c', name: '一', nodes: [], blocks: [{ type: 'text', key: 'p1', content: '雨' }] }]
  page.data.storyEditor = Object.assign({}, page.data.storyEditor, { show: true, chapterIndex: 0 })
  let opened = ''
  page.openStoryBranch = (e) => { opened = e.currentTarget.dataset.blockkey }
  page._storyUndoBar = () => {}
  const key = page._insertStoryMedia('branch', 1, {})
  assert.ok(key)
  assert.ok(page.data.formData.chapters[0].blocks.some((b) => b.key === key && b.type === 'branch'))
  page.onStoryAdd({ currentTarget: { dataset: { kind: 'branch', index: 0 } } })
  const branches = page.data.formData.chapters[0].blocks.filter((b) => b.type === 'branch')
  assert.equal(branches.length, 2)
  assert.ok(branches.some((b) => b.key === opened))
})

test('L03-150 新开始时间不早于结束时，结束按原时长顺延，票时间随之更新', () => {
  const page = makePage()
  page.data.dateList = [{ date: '2026-12-01', display: '12月1日' }, { date: '2026-12-10', display: '12月10日' }]
  page.data.hours = [9, 10]; page.data.minutes = [0, 30]
  page.data.formData.startDate = '2026-12-01 09:00:00'
  page.data.formData.endDate = '2026-12-03 09:00:00'
  page.data.endDateTime = '12月3日 09:00'
  page.data.startDateIndex = [1]; page.data.startTimeIndex = [1, 1]
  page.showEndTimePicker = () => {}
  let ticketTimes = null
  page.updateTicketTimes = (s, e) => { ticketTimes = [s, e] }
  page.confirmStartTime()
  assert.equal(page.data.formData.startDate, '2026-12-10 10:30:00')
  assert.equal(page.data.formData.endDate, '2026-12-12 10:30:00', '顺延原来的 2 天')
  assert.equal(page.data.endDateTime, '2026-12-12 10:30')
  assert.deepEqual(ticketTimes, ['2026-12-10 10:30:00', '2026-12-12 10:30:00'])
  page.data.startDateIndex = [0]; page.data.startTimeIndex = [0, 0]
  page.confirmStartTime()
  assert.equal(page.data.formData.endDate, '2026-12-12 10:30:00', '开始仍早于结束时不动结束')
})

test('L03-164 锁定的俱乐部不在已通过列表里时选择器不显示另一家；行业读取失败有提示、下次重读', () => {
  const page = makePage()
  page.data.formData.clubId = 99
  page.data.clubIndex = 0
  page.loadMyClubs()
  requests.at(-1).success({ code: 200, data: { owned: [{ id: 1, status: 1 }] } })
  assert.equal(page.data.clubIndex, -1)
  page.data.formData.productType = 2
  page.loadMerchantCategories()
  const req = requests.at(-1)
  req.success({ code: 500, msg: '' }); req.complete && req.complete()
  assert.ok(toasts.some((t) => /商家行业读取失败/.test(String(t))))
  const before = requests.length
  page.loadMerchantCategories()
  assert.equal(requests.length, before + 1, '列表仍空,再触发会重读')
})

test('L03-211 只打开角色面板不写配置、不算草稿编辑；第一次真正改动才建配置', () => {
  const page = makePage()
  page.data.formData.castConfig = null
  const keys = []
  const base = page.setData
  page.setData = function (patch, cb) { keys.push(...Object.keys(patch)); return base.call(this, patch, cb) }
  page.openCastSheet()
  assert.equal(page.data.castSheetShow, true)
  assert.equal(keys.some((k) => k.indexOf('formData') === 0), false)
  assert.equal(page.data.formData.castConfig, null)
  page.addCastIdentity()
  assert.equal(page.data.formData.castConfig.identities.length, 1)
})

test('L03-217 节点照片折叠归节点编辑，不再挂在路线命名 mixin 上', () => {
  const routeNames = require('../../pages/publish/fabu/theme-route-names.js')
  assert.equal('nodePhotosOpen' in routeNames.data, false)
  assert.equal((routeNames.methods || {}).toggleNodePhotos, undefined)
  const page = makePage()
  assert.equal(page.data.nodePhotosOpen, false)
  page.toggleNodePhotos()
  assert.equal(page.data.nodePhotosOpen, true)
})

test('L03-224/233 编辑器里 cy-btn 用 accessibility-label，开关都有名字，删除/上传/格子按钮带上下文', () => {
  const fs = require('node:fs'), path = require('node:path')
  const dir = path.join(__dirname, '../../pages/publish/fabu/')
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.wxml'))) {
    const src = fs.readFileSync(dir + f, 'utf8')
    for (const m of src.matchAll(/<cy-btn\b(?:[^>"]|"[^"]*")*>/g)) assert.doesNotMatch(m[0], / aria-label=/, f + ': ' + m[0].slice(0, 80))
    for (const m of src.matchAll(/<cy-switch\b(?:[^>"]|"[^"]*")*>/g)) assert.match(m[0], /accessibility-label=|aria-label=/, f + ': ' + m[0].slice(0, 80))
  }
  const rt = fs.readFileSync(dir + 'runtime-editor.wxml', 'utf8')
  for (const tap of ['removeRuntimeItem', 'removeRuntimeEgg"', 'removeRuntimeEggReward', 'uploadRuntimeImage', 'openRuntimeBingoCell', 'clearRuntimeCompletionItem'])
    assert.match(rt, new RegExp('bindtap="' + tap + '[^>]*aria-label="'), tap)
  assert.match(fs.readFileSync(dir + 'index.wxml', 'utf8'), /aria-role="tab" aria-selected="\{\{viewMode === 'map'\}\}"/)
})

test('L03-140 页面里不再有遮蔽 memberId 的局部变量或参数；账号核对两侧都用 memberId(app)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/publish/fabu/index.js'), 'utf8')
  const body = src.slice(src.indexOf('Page({'))
  assert.doesNotMatch(body, /(const|let|var)\s+memberId\s*=|,\s*memberId\s*=|\(\s*[^)]*\bmemberId\s*[,)][^)]*\)\s*\{/)
  assert.doesNotMatch(body, /owner\s*[!=]==\s*String\(app\.getUserID\(\) \|\| ''\)/)
})

test('L03-173 删伏笔时只解析像 JSON 的串，仍能找到块里、结局里与 JSON 字段里的引用', () => {
  const page = makePage()
  const thoughts = [{ key: 't1', desc: '甲' }, { key: 't2', desc: '乙' }]
  page.data.thoughtsEditor = { show: true, list: thoughts.slice(), count: 2, error: '' }
  page.data.formData.journeyRules = ''
  page.data.formData.chapters = [{ _localId: 'c', blocks: [{ type: 'thought', key: 'b', thoughtKey: 't1' }, { type: 'text', key: 'p', content: '{不是 JSON' }] }]
  page.data.formData.themeRuntimeConfig = JSON.stringify({ endings: [{ thoughtKey: 't2' }] })
  const realParse = JSON.parse
  let parses = 0
  JSON.parse = function (v) { parses += 1; return realParse.apply(this, arguments) }
  try {
    page.removeThought({ currentTarget: { dataset: { index: 0 } } })
    assert.match(page.data.thoughtsEditor.error, /仍引用/)
    page.removeThought({ currentTarget: { dataset: { index: 1 } } })
    assert.match(page.data.thoughtsEditor.error, /仍引用/, 'JSON 字段里的引用照样找到')
  } finally { JSON.parse = realParse }
  assert.ok(parses < 20, '不再对每个普通字符串 JSON.parse')
  page.data.formData.themeRuntimeConfig = ''
  page.data.formData.chapters = []
  page.removeThought({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(page.data.thoughtsEditor.list.length, 1)
})

test('L03-194 归零面板的方法与 data 只在页面里展开一次', () => {
  const runtime = require('../../pages/publish/fabu/theme-runtime.js')
  const zeroHp = require('../../pages/publish/fabu/theme-runtime-zero-hp.js')
  for (const name of Object.keys(zeroHp.methods)) assert.equal(name in runtime.methods, false, name)
  for (const key of Object.keys(zeroHp.data)) assert.equal(key in runtime.data, false, key)
  const page = makePage()
  for (const name of Object.keys(zeroHp.methods)) assert.equal(typeof page[name], 'function', name)
  for (const key of Object.keys(zeroHp.data)) assert.ok(key in page.data, key)
})

test('L03-209 到访方式按主题缓存：同一主题再开抽屉不再 GET，换主题重读', () => {
  const page = makePage()
  page.data.formData.productType = 2
  page.data.editingTopicId = 77
  const gets = () => requests.filter((r) => r.url === '/api/topic/free-explore/visit-config' && r.method === 'GET')
  page._openFeVisitConfig({ id: 5 })
  assert.equal(gets().length, 1)
  gets()[0].success({ code: 200, data: [{ nodeId: 5, checkMethod: 'GPS', radius: 300 }] })
  page._closeFeVisitConfig()
  page._openFeVisitConfig({ id: 5 })
  assert.equal(gets().length, 1, '缓存命中不再请求')
  assert.equal(page.data.feVisit.show, true)
  page.data.editingTopicId = 78
  page._openFeVisitConfig({ id: 5 })
  assert.equal(gets().length, 2, '换主题清缓存重读')
})

test('L03-188 点选与完成共用模板闸；支持原因只在输入变化时重算', () => {
  const page = makePage()
  const reviewing = { id: 3, draftStatus: 1, status: 0 }
  page.selectTemp({ currentTarget: { dataset: { item: reviewing, source: 'mine' } } })
  assert.ok(toasts.some((t) => /审核通过后才能选用/.test(String(t))))
  toasts.length = 0
  page.data.selectedTempInfo = reviewing; page.data.selectedTempSource = 'mine'
  page.confirmTemp()
  assert.ok(toasts.some((t) => /审核通过后才能选用/.test(String(t))), '完成按钮同一道闸')
  let calls = 0
  const base = page.setData
  page.setData = function (patch, cb) { calls += 1; return base.call(this, patch, cb) }
  page._refreshSupportMatrix(); page._refreshSupportMatrix()
  assert.equal(calls, 1, '没变化不重算')
  page.data.tempList = [{ id: 9, advancedConfigJson: '{}' }]
  page._refreshSupportMatrix()
  assert.equal(calls, 2)
})

test('L03-186 上次保存结果不明时点发布：只核对那次保存、不跑 AI 预检', () => {
  const page = makePage()
  page.data.editLoaded = true
  page._serverDraftAttempt = { status: 'UNKNOWN', topicId: '', payload: {} }
  let prechecks = 0, runs = null
  page.runPublishPrecheck = () => { prechecks += 1 }
  page._runServerDraft = function (apiData, publish, automatic) { runs = [apiData, publish, automatic, this._recheckBeforePublish] }
  page.submitForm()
  assert.equal(prechecks, 0)
  assert.deepEqual(runs, [null, false, false, true])
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/publish/fabu/index.js'), 'utf8')
  assert.match(src, /title: recheck \? '已核对上次保存，请再点发布' : '草稿已保存到云端'/)
})

test('L03-078 运行统计刷新不再每次重算模板支持原因（输入没变时跳过）', () => {
  const page = makePage()
  page.data.tempList = [{ id: 9, advancedConfigJson: '{}' }]
  page._syncRuntimeStats()
  let validated = 0
  const sm = require('../../pages/publish/utils/publish/gameplay-support-matrix.js')
  const real = sm.validate
  sm.validate = function () { validated += 1; return real.apply(this, arguments) }
  try {
    page._syncRuntimeStats(); page._syncRuntimeStats()
    assert.equal(validated, 0, '矩阵/列表/上下文都没变')
    page.data.formData.themeRuntimeConfig = JSON.stringify({ schemaVersion: 1, gameplayRuntime: { runtimeScope: 'TEAM', worldMode: 'WORLD_SHARED' } })
    page._syncRuntimeStats()
    assert.ok(validated > 0, '配置变了上下文变,照常重算')
  } finally { sm.validate = real }
})

test('L03-174 注册属性快照按主题/版本缓存：重开初始状态不再 GET，「刷新」与版本变化才重读', () => {
  const page = makePage()
  page.data.editingTopicId = 77
  page.data.formData.configVersion = 3
  page._carryRegistrySettled = () => {}
  const gets = () => requests.filter((r) => r.url === '/api/topic/attribute-binding')
  page.loadAttributeRegistry('cached')
  assert.equal(gets().length, 1)
  gets()[0].success({ code: 200, data: { topicId: 77, configVersion: '3', registryVersion: '1', definitions: [] } })
  assert.equal(page._attributeRegistryWriteReady, true)
  page.loadAttributeRegistry('cached')
  assert.equal(gets().length, 1, '命中缓存')
  page.loadAttributeRegistry({ type: 'refresh' })
  assert.equal(gets().length, 2, '编辑器里的刷新照读')
  gets()[1].success({ code: 200, data: { topicId: 77, configVersion: '3', registryVersion: '1', definitions: [] } })
  page.data.formData.configVersion = 4
  page.loadAttributeRegistry('cached')
  assert.equal(gets().length, 3, '版本变了重读')
})

test('L03-206 章节音频与章节视频同在 theme-media，chapterVideoError 有声明', () => {
  const media = require('../../pages/publish/fabu/theme-media.js')
  for (const name of ['uploadChapterVideo', 'clearChapterVideo', 'uploadChapterAudio', 'clearChapterAudio', 'autoDetectAudioDuration', '_destroyChapterDurationAudio'])
    assert.equal(typeof media.methods[name], 'function', name)
  assert.deepEqual(media.data, { chapterVideoError: '' })
  const page = makePage()
  assert.equal(page.data.chapterVideoError, '')
  assert.equal(page.uploadChapterAudio, media.methods.uploadChapterAudio)
})

test('L03-031/061 系统选择器回来后自动只读核对被打断的草稿保存；有待结算发布时不动', () => {
  const page = makePage()
  let runs = []
  page._runServerDraft = (...args) => runs.push(args)
  page._serverDraftBusy = () => false
  page._creatorOwnerChanged = () => false
  page.syncNodeGameSwitchWithTemplate = () => {}
  page._serverDraftAttempt = { status: 'UNKNOWN', topicId: '', payload: {} }
  page.onShow()
  assert.deepEqual(runs, [[null, false, true]])
  runs = []
  page._publishAttempt = { requestId: 'x' }
  page.onShow()
  assert.deepEqual(runs, [], '发布结果待结算时不自动核对草稿')
})

test('L03-099 编辑器图片按槽位走 img.fit，出错退回原图', () => {
  const fs = require('node:fs'), path = require('node:path')
  const dir = path.join(__dirname, '../../pages/publish/fabu/')
  for (const f of ['index.wxml', 'cast-sheet.wxml']) {
    const src = fs.readFileSync(dir + f, 'utf8')
    for (const m of src.matchAll(/<image\b(?:[^>"]|"[^"]*")*>/g)) {
      if (/castEdit\.avatarPreview/.test(m[0])) continue // 刚选的本地临时文件
      assert.match(m[0], /img\.fit\(/, f + ': ' + m[0].slice(0, 90))
      assert.match(m[0], /binderror="onImgRenditionError"/, f)
    }
  }
  const page = makePage()
  page.onLoad({})
  assert.ok(page.data.imgCtx && 'base' in page.data.imgCtx)
  assert.equal(typeof page.onImgRenditionError, 'function')
})

function fakeUploads() {
  const jobs = []
  const client = { uploadOne(path, opts) { const job = { path, opts, aborted: false }; jobs.push(job); return { abort() { job.aborted = true } } } }
  return { jobs, client }
}

test('L03-085 角色头像/录音上传在途时「完成」先等；关面板中止上传', () => {
  const page = makePage()
  const up = fakeUploads()
  const realGetApp = global.getApp
  const app = Object.assign({}, realGetApp(), { getUploadClient: () => up.client })
  global.getApp = () => app
  const prevMedia = global.wx.chooseMedia
  global.wx.chooseMedia = (o) => o.success({ tempFiles: [{ tempFilePath: 'tmp/a.jpg', size: 10 }] })
  try {
    page.data.formData.castConfig = { enabled: true, cast: [], identities: [] }
    page.setData({ castEdit: { show: true, m: { id: 'm1', name: '甲', clues: [] }, errField: '', errMsg: '' } })
    page.pickCastAvatar()
    assert.equal(up.jobs.length, 1)
    page.saveCastMember()
    assert.equal(page.data.castEdit.errField, 'avatar')
    assert.match(page.data.castEdit.errMsg, /还在上传/)
    page.closeCastMember()
    assert.equal(up.jobs[0].aborted, true)
    up.jobs[0].opts.onDone({ ok: true, data: { assetId: 'x' } })
    assert.equal(page.data.castEdit.avatarPreview, undefined, '中止后的回包不再写')
  } finally { global.getApp = realGetApp; global.wx.chooseMedia = prevMedia }
})

test('L03-089 章节视频重选/取消时中止在途上传；回包缺 data 不崩', () => {
  const page = makePage()
  const up = fakeUploads()
  const realGetApp = global.getApp
  const app = Object.assign({}, realGetApp(), { getUploadClient: () => up.client })
  global.getApp = () => app
  const prevMedia = global.wx.chooseMedia
  global.wx.chooseMedia = (o) => o.success({ tempFiles: [{ tempFilePath: 'tmp/v.mp4', thumbTempFilePath: 'tmp/p.jpg', duration: 10, size: 1000 }] })
  try {
    page.setData({ popChapter: true, chapterForm: { opening: true, name: '一' } })
    page.uploadChapterVideo()
    assert.equal(up.jobs.length, 1)
    up.jobs[0].opts.onDone({ ok: true })
    assert.match(page.data.chapterVideoError, /封面上传失败/)
    page.uploadChapterVideo()
    page.uploadChapterVideo()
    assert.equal(up.jobs[1].aborted, true, '重选中止上一次')
    page.clearChapterVideo()
    assert.equal(up.jobs[2].aborted, true)
  } finally { global.getApp = realGetApp; global.wx.chooseMedia = prevMedia }
})

test('L03-027/065 开编辑器不读模板库；第一次打开选玩法面板才读，行上只带 id', () => {
  const page = makePage()
  page.onLoad({})
  const lists = () => requests.filter((r) => r.url === '/api/template/my-list' || r.url === '/api/template/list')
  assert.equal(lists().length, 0, '开编辑器不读')
  page.showTemp()
  assert.equal(lists().length, 2)
  const mine = lists().find((r) => r.url === '/api/template/my-list')
  mine.success({ code: 200, data: { rows: [{ id: 41, title: '甲', draftStatus: 1, status: 1, advancedConfigJson: '{}' }], total: 1 } })
  page.showTemp()
  assert.equal(lists().filter((r) => r.url === '/api/template/my-list').length, 1, '读好了不再读')
  page.selectTemp({ currentTarget: { dataset: { id: '41', source: 'mine' } } })
  assert.equal(page.data.selectedTempId, 41)
  const wxml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/publish/fabu/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /data-item="\{\{item\}\}" data-source=/)
})

test('L03-132 草稿编辑器字段只列一次：修订号、编辑识别、本机 editorMeta、恢复同一张表', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/publish/fabu/index.js'), 'utf8')
  const keys = ['selectedCategoryIds', 'selectedCategoryNames', 'startDateTime', 'endDateTime', 'completionRuleMode', 'completionRequiredCount', 'bingoRows', 'publishToCreative', 'aiSimple']
  const page = makePage()
  for (const key of keys) assert.equal(page._isDraftPatch({ [key]: 1 }), true, key)
  assert.equal(page._isDraftPatch({ storySegs: {} }), false)
  assert.match(src, /const DRAFT_META_KEYS = Object\.keys\(DRAFT_META_FIELDS\)/)
  assert.doesNotMatch(src, /\['completionRuleMode', 'completionRequiredCount', 'bingoRows', 'publishToCreative', 'aiSimple'\]\.includes/)
  page.data.bingoRows = [{ pos: 1 }]
  const before = page._draftContentRevision()
  page.data.aiSimple = !page.data.aiSimple
  assert.notEqual(page._draftContentRevision(), before, '表里的字段变了修订号就变')
})

test('L03-133 恢复本机草稿时章节数组只整份过桥一次（后续补 id/物化只回传变了的章）', () => {
  const page = makePage()
  page.data.formData.productType = 2
  const chapters = [1, 2, 3].map((i) => ({ _localId: 'c' + i, name: '第' + i + '章', nodes: [{ _localId: 'n' + i, name: '点' + i }], blocks: [] }))
  const sends = []
  const base = page.setData
  page.setData = function (patch, cb) { sends.push(Object.keys(patch).filter((k) => k.indexOf('formData') === 0)); return base.call(this, patch, cb) }
  page._applyDraftEnvelope({ formData: Object.assign({}, page.data.formData, { chapters }), pendingMaterials: [] })
  const whole = sends.filter((keys) => keys.some((k) => k === 'formData' || k === 'formData.chapters')).length
  assert.equal(whole, 1, JSON.stringify(sends))
})

test('L03-131 只给 JS 用的编辑状态不再进页面 data', () => {
  const page = makePage()
  for (const key of ['pendingInsertAt', 'clubPlaceCaptureActive', 'editTargetChapterLid', 'editingPendingLocalId', 'nodeDraftDestination', 'assignPendingLocalId', 'merchantCategoryLoading', 'inlineEdit'])
    assert.equal(key in page.data, false, key)
  const wxml = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/publish/fabu/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /pendingInsertAt|editTargetChapterLid|nodeDraftDestination|assignPendingLocalId/)
})

test('L03-138 只在一个罕用处理函数里用的模块改为用到时再 require；每行一个顶层 require', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/publish/fabu/index.js'), 'utf8')
  const top = src.slice(0, src.indexOf('Page({'))
  for (const m of ['node-game-catalog', 'template-author-fields', 'story-rule-form', 'node-outcome-contract', 'publish-validation-bag', 'money-format']) {
    assert.doesNotMatch(top, new RegExp("require\\('[^']*" + m + "\\.js'\\)"), m)
    assert.match(src, new RegExp("require\\('[^']*" + m + "\\.js'\\)"), m + ' 仍被打包计入')
  }
  for (const line of top.split('\n')) if (/^const /.test(line)) assert.ok((line.match(/require\(/g) || []).length <= 1, line.slice(0, 80))
})

test('L03-135 光标只记一处，开/关故事编辑器用同一个清理', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../pages/publish/fabu/index.js'), 'utf8')
  assert.doesNotMatch(src, /this\._storyTextCursor\s*=|this\._storySelection\s*=/)
  assert.equal((src.match(/this\._resetStoryCaret\(\);/g) || []).length, 2)
  const page = makePage()
  page._storyCaret = { blockKey: 'a', cursor: 1 }; page._storyPendingCaret = { blockKey: 'a' }; page._storyFocusKey = 'a'
  page._resetStoryCaret()
  assert.deepEqual([page._storyCaret, page._storyPendingCaret, page._storyFocusKey], [null, null, ''])
})

test('L03-238 业主默认 A：新草稿未保存时注册属性是普通提示，不是红色错误', () => {
  const page = makePage()
  page.data.editingTopicId = ''
  page._carryRegistrySettled = () => {}
  page.loadAttributeRegistry()
  assert.equal(page.data.attributeRegistryError, '')
  assert.match(page.data.attributeRegistryHint, /请先保存主题草稿/)
  page.data.editingTopicId = 77
  page.loadAttributeRegistry()
  assert.equal(page.data.attributeRegistryHint, '')
})

test('L03-187 业主默认 A：发布回包时草稿版本已变，按「结果未知」结算，按钮不再卡在提交中', () => {
  const page = makePage()
  page.data.draftUuid = 'd1'
  const wf = page.getPublishWorkflow()
  let failed = null
  wf.submit({ name: 'x' }, { onFail: (res) => { failed = res } })
  assert.equal(wf.getState(), 'submitting')
  page.data.draftUuid = 'd2' // 发布在途时草稿身份变了
  const req = requests.at(-1)
  req.success({ code: 200, data: { id: 9 } })
  assert.equal(wf.getState(), 'unknown', '工作流不再卡在 submitting')
  assert.deepEqual(failed, { ok: false, networkError: true, stale: true })
})

test('L03-126 业主默认 A：章节配色按 2026-09-06 的决定用纯色，不再被渐变覆盖', () => {
  const fs = require('node:fs'), path = require('node:path')
  const dir = path.join(__dirname, '../../pages/publish/fabu/')
  const rt = fs.readFileSync(dir + 'runtime-editor.wxss', 'utf8')
  assert.doesNotMatch(rt, /atmosphere-swatch--[a-z]+\{background:linear-gradient/)
  assert.doesNotMatch(rt, /chapter-atmosphere__item:not\(\.atmosphere-swatch--default\)\{color/)
  const idx = fs.readFileSync(dir + 'index.wxss', 'utf8')
  // 合并 master ef37a53d：业主 2026-11-24 把 BLUE 槽改为松绿（#1A2620）
  for (const [k, c] of [['default', '#0A0A0A'], ['blue', '#1A2620'], ['red', '#4E1C24'], ['yellow', '#4E4114'], ['white', '#F5F6F8']])
    assert.match(idx, new RegExp('\\.atmosphere-swatch--' + k + '\\{ background:' + c))
})

test('L03-201 业主默认 B：D20 属性与数值编辑共用同一范围，调一下不再把 -10000..10000 压成 0..20', () => {
  const d20 = require('../../pages/publish/fabu/theme-d20.js')
  const values = require('../../pages/publish/fabu/theme-values.js')
  const attr = { key: 'counter.mood', label: '心情', min: -50, max: 300, initial: 0 }
  const a = d20.clampAttr(attr, 'initial', 10)
  assert.deepEqual([a.min, a.max, a.initial], [-50, 300, 10])
  assert.equal(d20.clampAttr(attr, 'min', -20000).min, values.RANGE.MIN)
  assert.equal(d20.clampAttr(attr, 'max', 20000).max, values.RANGE.MAX)
  assert.doesNotThrow(() => values.attribute({ key: 'counter.mood', label: '心情', min: -50, max: 300, initial: 10 }))
})

test('L03-113/227 业主默认 A：主题详情、画面风格、玩法配置只留「完成」，不再有不撤销的取消/关闭/退出', () => {
  const fs = require('node:fs'), path = require('node:path')
  const dir = path.join(__dirname, '../../pages/publish/fabu/')
  for (const [file, handler] of [['topic-detail-sheet.wxml', 'closeTopicDetail'], ['look-sheet.wxml', 'closeLookEditor'], ['runtime-editor.wxml', 'closeRuntimeEditor']]) {
    const src = fs.readFileSync(dir + file, 'utf8')
    const top = src.slice(src.indexOf('<view class="node-sheet__top">'), src.indexOf('node-sheet__titlebar') > 0 ? src.indexOf('node-sheet__titlebar') : undefined)
    assert.doesNotMatch(top, /node-sheet__close/, file + ' 头部不应再有取消/关闭/退出')
    assert.match(top, /node-sheet__top-spacer[\s\S]*node-sheet__done" bindtap="/ , file + ' 完成仍贴右')
    assert.equal((top.match(new RegExp('bindtap="' + handler + '"', 'g')) || []).length, 1, file + ' 只剩完成一个关闭入口')
    assert.match(top, />完成<\/view>/)
  }
})

test('L03-086 业主默认 A：对白录音可回放、可删除，录音键用麦克风图标', () => {
  const fs = require('node:fs'), path = require('node:path')
  const cast = require('../../pages/publish/fabu/theme-cast.js')
  const audios = []
  const prevCreate = global.wx.createInnerAudioContext
  global.wx.createInnerAudioContext = () => { const a = { played: false, destroyed: false, play() { this.played = true }, destroy() { this.destroyed = true }, onEnded(f) { this.end = f }, onError(f) { this.err = f } }; audios.push(a); return a }
  const toasts = []
  const realGetApp = global.getApp
  const up = []
  global.getApp = () => Object.assign({}, realGetApp(), { getUploadClient: () => ({ uploadOne: (p, o) => up.push(o) }), tips: m => toasts.push(m) })
  const commands = []
  const self = Object.assign({}, cast.methods, {
    data: Object.assign(JSON.parse(JSON.stringify(cast.data)), { storyLineRec: '' }),
    setData(p) { Object.assign(this.data, p) },
    _storyChapter: () => ({ _localId: 'c1' }),
    _storyCommand(c) { commands.push(c) },
  })
  try {
    // 刚录完:上传回 media-asset:N,回放用本机临时文件
    self._castRecTarget = { kind: 'line', blockKey: 'b1', chapterLocalId: 'c1' }
    self._onCastRecStop({ tempFilePath: 'tmp/line.mp3', duration: 1200, fileSize: 10 })
    up[0].onDone({ ok: true, data: { assetId: '77' } })
    assert.deepEqual(commands.at(-1), { type: 'updateLine', blockKey: 'b1', audioUrl: 'media-asset:77' })
    self.playStoryLineAudio({ currentTarget: { dataset: { blockkey: 'b1', src: 'media-asset:77' } } })
    assert.equal(audios.at(-1).src, 'tmp/line.mp3')
    assert.equal(audios.at(-1).played, true)
    assert.equal(self.data.storyLinePlaying, 'b1')
    // 再点同一句 = 停止
    self.playStoryLineAudio({ currentTarget: { dataset: { blockkey: 'b1', src: 'media-asset:77' } } })
    assert.equal(self.data.storyLinePlaying, '')
    assert.equal(audios.at(-1).destroyed, true)
    // 已保存的录音:服务端给 https,直接放;放完复位
    self.playStoryLineAudio({ currentTarget: { dataset: { blockkey: 'b2', src: 'https://cdn.example/l.mp3' } } })
    assert.equal(audios.at(-1).src, 'https://cdn.example/l.mp3')
    audios.at(-1).end()
    assert.equal(self.data.storyLinePlaying, '')
    // 别的会话录的 media-asset 放不了:说一句,不静默
    const n = audios.length
    self.playStoryLineAudio({ currentTarget: { dataset: { blockkey: 'b3', src: 'media-asset:5' } } })
    assert.equal(audios.length, n)
    // 删除:清空这一句的 audioUrl
    self.clearStoryLineAudio({ currentTarget: { dataset: { blockkey: 'b1' } } })
    assert.deepEqual(commands.at(-1), { type: 'updateLine', blockKey: 'b1', audioUrl: '' })
  } finally { global.wx.createInnerAudioContext = prevCreate; global.getApp = realGetApp }
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/publish/fabu/index.wxml'), 'utf8')
  const line = wxml.slice(wxml.indexOf('catchtap="toggleStoryLineRecord"') - 200, wxml.indexOf('catchtap="clearStoryLineAudio"') + 300)
  assert.match(line, /catchtap="toggleStoryLineRecord"[^\n]*<cy-icon name="mic"/)
  assert.doesNotMatch(line, /toggleStoryLineRecord[^\n]*play-filled/, '录音键不再画播放图标')
  assert.match(line, /catchtap="playStoryLineAudio"/)
  assert.match(line, /catchtap="clearStoryLineAudio"/)
})

test('L03-082 业主默认 A：可玩时段 / 开局准备只存游玩设置，保存主题时不再写进规则', () => {
  const d20 = require('../../pages/publish/fabu/theme-d20.js')
  const raw = JSON.stringify({ schemaVersion: 1, hp: { enabled: true, init: 8, max: 8 }, playWindow: { mode: 'custom', start: '18:00', end: '22:00' }, startPrep: ['带手电'] })
  assert.deepEqual(JSON.parse(d20.withoutPlaySetup(raw)), { schemaVersion: 1, hp: { enabled: true, init: 8, max: 8 } })
  const plain = '{"schemaVersion":1,  "hp":{"enabled":true}}'
  assert.equal(d20.withoutPlaySetup(plain), plain, '没有这两项时原文一字不动(回读比对不受影响)')
  assert.equal(d20.withoutPlaySetup(''), '')

  const page = makePage()
  page.onLoad({})
  page.data.formData.name = '夜巡'
  page.data.formData.journeyRules = raw
  const payload = page._buildSubmitPayload({ draft: true, quiet: true })
  assert.ok(payload)
  const sent = JSON.parse(payload.journeyRules)
  assert.equal(sent.playWindow, undefined)
  assert.equal(sent.startPrep, undefined)
  assert.equal(sent.hp.init, 8)
  assert.equal(JSON.parse(page.data.formData.journeyRules).playWindow.mode, 'custom', '本机暂存不动:新主题首存后照旧补 PUT 到游玩设置')
  page.data.editScope = 'WHITELIST'
  assert.equal(page._buildSubmitPayload({ draft: true, quiet: true }).journeyRules, raw, '白名单编辑原样回送')
  page._playSetupLoadedFor = '77'
  page.applyEditingTopic({ topic: { id: 77, name: '夜巡' }, chapters: [] })
  assert.equal(page._playSetupLoadedFor, '', '换上服务端版本后下次打开主题详情重读游玩设置')
})
