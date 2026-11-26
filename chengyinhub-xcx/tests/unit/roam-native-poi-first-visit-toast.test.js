const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// 3-06:首亮原生 POI 的「+N 探索值 · 点亮xx」刚弹出就被兜底文案盖掉(分支末尾没 return)。
// L05-001:「当前位置」只认实时定位接受的点,不认视口中心、更不回落成 POI 自己的坐标。
// L05-002:连点只发一笔;业务错由通道 toast,页面不再补第二声。
async function tapPoi(response, opts = {}) {
  let def
  const toasts = []
  const sent = []
  const toastPath = require.resolve(path.join(__dirname, '../../utils/toast.js'))
  const savedToast = require.cache[toastPath]
  require.cache[toastPath] = { id: toastPath, filename: toastPath, loaded: true, exports: Object.assign((t) => toasts.push(t), { success() {}, hide() {} }) }
  const prev = { Page: global.Page, getApp: global.getApp, getCurrentPages: global.getCurrentPages, wx: global.wx }
  global.Page = c => { def = c }
  const pending = []
  global.getApp = () => ({
    globalData: { features: {} },
    getUserID: () => '1',
    sendRequest: o => {
      sent.push(o)
      if (opts.hold) pending.push(() => o.success(response))
      else if (response && response.netFail) o.fail({}, 0)
      else o.success(response)
    },
  })
  global.getCurrentPages = () => []
  global.wx = { getStorageSync: () => undefined }
  try {
    delete require.cache[require.resolve('../../pages/roam/index.js')]
    require('../../pages/roam/index.js')
    const page = Object.assign({}, def, { data: { center: { lat: 31.9, lng: 121.9 }, fogScreenGuard: false } })
    if (opts.gps !== false) {
      page._realOn = true
      page._realAnchor = { lat: 31.2001, lng: 121.4001 }
    }
    const taps = opts.taps || 1
    for (let i = 0; i < taps; i += 1) page.onPoiTap({ detail: { name: '外滩', latitude: 31.2, longitude: 121.4 } })
    pending.forEach(fn => fn())
    await new Promise(r => setImmediate(r))
  } finally {
    Object.assign(global, prev)
    if (savedToast) require.cache[toastPath] = savedToast; else delete require.cache[toastPath]
  }
  return { toasts, sent }
}

test('首亮:只弹「+N 探索值 · 点亮xx」,不被兜底文案覆盖', async () => {
  assert.deepEqual((await tapPoi({ code: 200, data: { participating: false, firstVisit: true, xp: 20 } })).toasts, ['+20 探索值 · 点亮外滩'])
})

test('已点亮过:只弹「已点亮过」', async () => {
  assert.deepEqual((await tapPoi({ code: 200, data: { participating: false, firstVisit: false } })).toasts, ['已点亮过'])
})

test('成功但无记录:给兜底文案', async () => {
  assert.deepEqual((await tapPoi({ code: 200, data: {} })).toasts, ['这个地点暂时没有可记录的信息'])
})

test('业务错:通道已 toast,页面不再补第二声', async () => {
  assert.deepEqual((await tapPoi({ code: 500, msg: 'x' })).toasts, [])
})

test('网络失败:说网络异常,不说「没有信息」', async () => {
  assert.deepEqual((await tapPoi({ netFail: true })).toasts, ['网络异常，请重试'])
})

test('当前位置取实时定位点,不取地图视口中心', async () => {
  const { sent } = await tapPoi({ code: 200, data: { participating: false, firstVisit: false } })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].data.curLat, '31.2001')
  assert.equal(sent[0].data.curLng, '121.4001')
})

test('没开实时定位:不发点亮请求,也不拿 POI 坐标冒充当前位置', async () => {
  const { sent, toasts } = await tapPoi({ code: 200, data: {} }, { gps: false })
  assert.equal(sent.length, 0)
  assert.deepEqual(toasts, ['开启实时定位后才能点亮'])
})

test('在途时连点只发一笔', async () => {
  const { sent } = await tapPoi({ code: 200, data: { participating: false, firstVisit: false } }, { hold: true, taps: 3 })
  assert.equal(sent.length, 1)
})
