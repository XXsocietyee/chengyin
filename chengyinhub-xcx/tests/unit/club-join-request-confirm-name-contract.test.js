// CU-C-95 / CU-C-96 · 入会审批页(C07)
// CU-C-95:两个确认层都没把申请人显示名传进去 —— 通过写死「通过入会申请」,拒绝只给 dangerKey,
//         标题模板里的 {name} 落到中性兜底「这一项」。相邻申请连着点时,最后一步核对不了点的是谁。
// CU-C-96:待审为 0 时顶部状态条与页面中央空态说的是同一句「暂无待审申请」,同屏重复。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·modal.js

const ROOT = path.resolve(__dirname, '../..')
const PAGE = 'pages/club/join-requests/index.js'
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8')

function applyDataPatch(target, patch) {
  Object.keys(patch).forEach((key) => { target[key] = patch[key] })
}

function mount() {
  let definition
  const requests = []
  const modals = []
  const toasts = []
  const app = {
    globalData: { statusBarHeight: 44, navBarHeight: 44 },
    sendRequest(options) { requests.push(options) },
  }
  vm.runInNewContext(read(PAGE), {
    getApp: () => app,
    Page(config) { definition = config },
    require(request) {
      if (request === '../../../utils/response-shape.js') return require(path.join(ROOT, 'utils/response-shape.js'))
      throw new Error(`unexpected require: ${request}`)
    },
    JSON,
    String,
    wx: {
      navigateBack() {},
      switchTab() {},
      redirectTo() {},
      stopPullDownRefresh() {},
      // 只记录弹窗参数,不替用户点确认 —— 这里要断的就是确认层文案
      showModal(options) { modals.push(options) },
      showToast(options) { toasts.push(options) },
    },
  }, { filename: path.join(ROOT, PAGE) })
  const page = Object.assign({}, definition, {
    data: Object.assign({}, definition.data),
    setData(patch) { applyDataPatch(this.data, patch) },
  })
  return { page, requests, modals, toasts }
}

function openWithRequests(rows) {
  const harness = mount()
  harness.page.onLoad({ clubId: '9' })
  assert.equal(harness.requests[0].url, '/api/club/join-requests')
  harness.requests[0].success({ code: '200', data: rows })
  return harness
}

const TWO_APPLICANTS = [
  { id: 1, memberId: 901, nickname: '小林', joinTime: '2026-09-23 10:00:00', joinMessage: '住得近' },
  { id: 2, memberId: 902, nickname: '阿照', joinTime: '2026-09-23 11:00:00', joinMessage: '' },
]

test('通过/拒绝的确认层都写上申请人姓名，不再用「这一项」兜底', () => {
  const approve = openWithRequests(TWO_APPLICANTS)
  approve.page.approve({ currentTarget: { dataset: { memberId: 902 } } })
  assert.equal(approve.modals.length, 1)
  assert.equal(approve.modals[0].title, '通过「阿照」的入会申请',
    '通过确认层必须指名道姓 —— 相邻申请连着点时才知道点的是谁')

  const reject = openWithRequests(TWO_APPLICANTS)
  reject.page.reject({ currentTarget: { dataset: { memberId: 901 } } })
  assert.equal(reject.modals.length, 1)
  assert.equal(reject.modals[0].title, '拒绝「小林」的入会申请？')
  assert.doesNotMatch(reject.modals[0].title, /这一项/, '缺参保底词不该再出现')
})

test('拿不到该行昵称时退回中性称呼，不显示 memberId 或少一个占位', () => {
  const harness = openWithRequests([{ id: 3, memberId: 903, joinTime: '2026-09-23 11:00:00' }])
  harness.page.approve({ currentTarget: { dataset: { memberId: 903 } } })
  assert.equal(harness.modals[0].title, '通过「城瘾玩家」的入会申请')
})

test('待审为 0 时顶部状态条不再重复空态的「暂无待审申请」', () => {
  const empty = openWithRequests([])
  // 第十轮 f3 第 5 项(p3 F7):动作口径那句属说明小字,按 owner 新规则撤掉;0 条时顶部条不出。
  assert.equal(empty.page.data.introText, '',
    '中央空态已经写着「暂无待审申请」,顶部条不再重复')
  assert.doesNotMatch(empty.page.data.introText, /暂无待审申请/)

  const busy = openWithRequests(TWO_APPLICANTS)
  assert.equal(busy.page.data.introText, '2 条待审')

  // 空态那一句本身要留着 —— 这次是去重叠,不是把提示删掉
  assert.match(read('pages/club/join-requests/index.wxml'), /title="暂无待审申请"/)
})

test('F-L3-09 / p3 N13:拒绝只有一个弹层(指名道姓 + 选填原因 + 确认拒绝),原因随拒绝请求发送；不填则不带该字段', () => {
  const withReason = openWithRequests(TWO_APPLICANTS)
  withReason.page.reject({ currentTarget: { dataset: { memberId: 901 } } })
  assert.equal(withReason.modals.length, 1, '拒绝不再先过一层危险确认')
  assert.equal(withReason.modals[0].title, '拒绝「小林」的入会申请？')
  assert.equal(withReason.modals[0].editable, true)
  assert.equal(withReason.modals[0].confirmText, '确认拒绝')
  assert.ok(!withReason.modals[0].content, '弹层不再带说明行')
  assert.equal(withReason.requests.length, 1, '原因弹层确认前不得发出拒绝')
  assert.equal(withReason.modals[0].validate('长'.repeat(501)), '拒绝原因不能超过500字')
  withReason.modals[0].success({ confirm: true, cancel: false, content: '  本期名额已满  ' })
  assert.equal(withReason.requests[1].url, '/api/club/join-request/reject')
  assert.deepEqual(JSON.parse(withReason.requests[1].data), { clubId: 9, memberId: 901, reviewReason: '本期名额已满' })

  const blank = openWithRequests(TWO_APPLICANTS)
  blank.page.reject({ currentTarget: { dataset: { memberId: 902 } } })
  blank.modals[0].success({ confirm: true, cancel: false, content: '   ' })
  assert.deepEqual(JSON.parse(blank.requests[1].data), { clubId: 9, memberId: 902 })

  const cancelled = openWithRequests(TWO_APPLICANTS)
  cancelled.page.reject({ currentTarget: { dataset: { memberId: 902 } } })
  cancelled.modals[0].success({ confirm: false, cancel: true, content: '' })
  assert.equal(cancelled.requests.length, 1, '原因弹层取消 = 不拒绝')
})

// AUDIT-1122 L08-085(第二批集成复核,2026-11-23):这条修复把行尾标注插进了表达式中间,三元运算整段落进注释,
// 通过确认层正文变成「false通过后…」;原有用例只断言标题,所以一直是绿的。下面按弹层真实参数断言正文。
const APPROVE_BODY = '通过后，对方将成为正式成员，可查看成员名单并使用成员功能。'

test('L08-085 通过确认层正文:申请人有昵称时只有说明句,不混入 false / undefined', () => {
  const harness = openWithRequests(TWO_APPLICANTS)
  harness.page.approve({ currentTarget: { dataset: { memberId: 902 } } })
  assert.equal(harness.modals[0].content, APPROVE_BODY)
})

test('L08-085 兜底昵称「城瘾玩家」与历史默认昵称「城瘾用户」分不出人:通过确认层正文带上申请时刻', () => {
  const fallback = openWithRequests([{ id: 3, memberId: 903, joinTime: '2026-09-23T11:05:00' }])
  fallback.page.approve({ currentTarget: { dataset: { memberId: 903 } } })
  assert.equal(fallback.modals[0].title, '通过「城瘾玩家」的入会申请')
  assert.equal(fallback.modals[0].content, '申请于 2026-09-23 11:05。' + APPROVE_BODY)

  const legacy = openWithRequests([{ id: 4, memberId: 904, nickname: '城瘾用户', joinTime: '2026-09-23 12:30:00' }])
  legacy.page.approve({ currentTarget: { dataset: { memberId: 904 } } })
  assert.equal(legacy.modals[0].content, '申请于 2026-09-23 12:30。' + APPROVE_BODY)
})

test('L08-085 拒绝弹层标题:默认昵称带申请时刻,有昵称时只写名字', () => {
  const fallback = openWithRequests([{ id: 3, memberId: 903, joinTime: '2026-09-23 11:05:00' }])
  fallback.page.reject({ currentTarget: { dataset: { memberId: 903 } } })
  assert.equal(fallback.modals[0].title, '拒绝「城瘾玩家 · 2026-09-23 11:05 申请」的入会申请？')

  const named = openWithRequests(TWO_APPLICANTS)
  named.page.reject({ currentTarget: { dataset: { memberId: 901 } } })
  assert.equal(named.modals[0].title, '拒绝「小林」的入会申请？')
})

test('L08-085 点到一条已不在名单里的申请:正文仍是说明句,不出现 undefined', () => {
  const harness = openWithRequests(TWO_APPLICANTS)
  harness.page.approve({ currentTarget: { dataset: { memberId: 999 } } })
  assert.equal(harness.modals[0].title, '通过「城瘾玩家」的入会申请')
  assert.equal(harness.modals[0].content, APPROVE_BODY)
})
