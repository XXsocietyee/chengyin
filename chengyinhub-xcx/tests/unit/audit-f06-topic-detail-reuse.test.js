// AUDIT-1122 F06:预览→详情复用模板数据 (L06-053),包内封面不读服务端封面署名、署名合成一次 setData (L06-054)
const test = require('node:test')
const assert = require('node:assert/strict')

function mount(requests) {
  let def
  global.getApp = () => ({ globalData: {}, getUserID: () => 'm1', getUserRole: () => 'player', getUserType: () => 1,
    sendRequest: o => requests.push(o), getRequestErrorMessage: (r, f) => f })
  global.Page = v => { def = v }
  global.wx = { getStorageSync: () => '', nextTick: () => {}, createSelectorQuery: undefined, showToast() {} }
  for (const f of ['topic-detail/index.js', 'utils/topic-info-cache.js']) delete require.cache[require.resolve('../../pages/templatedetail/' + f)]
  require('../../pages/templatedetail/topic-detail/index.js')
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  let setDataCalls = 0
  page.setData = function (p) { setDataCalls += 1; Object.entries(p).forEach(([k, v]) => { const m = /^gallery\[(\d+)\]\.credit$/.exec(k); if (m) this.data.gallery[+m[1]].credit = v; else this.data[k] = v }) }
  page.calls = () => setDataCalls
  return page
}

const INFO = { id: 9, name: '风味巡游', imgUrl: 'srv-cover', chapters: [{ name: 'A', nodes: [{ name: 'n1', imgUrl: 'i1' }, { name: 'n2', imgUrl: 'i2' }] }] }

test('L06-053 从预览页进入详情:复用缓存,不再请求 info', () => {
  const requests = []
  const page = mount(requests)
  require('../../pages/templatedetail/utils/topic-info-cache.js').put(9, INFO)
  page.onLoad({ id: '9' })
  assert.equal(requests.filter(r => r.url === '/api/template/topic-template/info').length, 0)
  assert.equal(page.data.name, '风味巡游')
})

test('L06-054 包内封面不读封面署名;节点署名全部回来后一次写入', () => {
  const requests = []
  const page = mount(requests)
  page.onLoad({ id: '9' })
  requests.find(r => r.url === '/api/template/topic-template/info').success({ code: '200', data: INFO })
  const credits = requests.filter(r => r.url === '/api/media/asset/attribution')
  assert.deepEqual(credits.map(r => r.data.reference), ['i1', 'i2'], '风味巡游有包内封面,不读 srv-cover 的署名')
  const before = page.calls()
  credits.forEach(r => r.success({ code: '200', data: { authorName: '甲', sourceType: 'ORIGINAL' } }))
  assert.ok(page.calls() - before <= 1)
})
