// L07-092:AI 店铺角色选门店位置 —— 选点面板开着、或上一次写入还没回来时,再点不会发第二次写
// 真机顺序:点「选门店位置」→ 系统选点面板盖住页面(onHide)→ 选好回到页面(onShow)→ success 回调 → 写入 → 回读
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function method(name) {
  const src = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/decor/ai-npc/index.js'), 'utf8')
  const m = new RegExp('\\n  ' + name + '\\(\\) \\{([\\s\\S]*?)\\n  \\},').exec(src)
  assert.ok(m, name)
  return m[1]
}

function harness() {
  const picks = []
  const writes = []
  const toasts = []
  const wx = { chooseLocation(o) { picks.push(o) } }
  const fn = new Function('wx', 'toast', 'handleLocationPickFailure', 'return function () {' + method('chooseStorePoint') + '\n}')(
    wx, (t) => toasts.push(t), () => toasts.push('pick-fail'))
  const page = {
    data: { saving: false },
    _request(url, data) { let done; const p = new Promise((r) => { done = r }); writes.push({ url, data, done }); return p },
    _loadStorePoint() { return Promise.resolve() },
    onHide() {}, onShow() {},
  }
  return { page, run: () => fn.call(page), picks, writes, toasts }
}

test('选点面板开着时再点不会再开一个', () => {
  const h = harness()
  h.run(); h.page.onHide()
  h.run()
  assert.equal(h.picks.length, 1)
})

test('写入未回时重选不发第二次写;写完可再选;取消选点也释放', async () => {
  const h = harness()
  h.run(); h.page.onHide(); h.page.onShow()
  h.picks[0].success({ latitude: 31.2, longitude: 121.5, address: '老码头' })
  assert.equal(h.writes.length, 1)
  h.run()
  assert.equal(h.picks.length, 1, '写入在途:不再开选点')
  h.writes[0].done()
  await new Promise((r) => setImmediate(r))
  h.run()
  assert.equal(h.picks.length, 2, '写完可再选')
  h.picks[1].fail({ errMsg: 'chooseLocation:fail cancel' })
  h.run()
  assert.equal(h.picks.length, 3, '取消后可再选')
})
