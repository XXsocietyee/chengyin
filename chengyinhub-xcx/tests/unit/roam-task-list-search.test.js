const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-110 / L05-111:任务列表搜索防抖一次 setData;ISO 带时区时间在倒计时里可解析。
function mount() {
  let def
  const prev = { Component: global.Component, getApp: global.getApp }
  global.Component = d => { def = d }
  global.getApp = () => ({ globalData: {}, getUserID: () => '', sendRequest() {} })
  const file = require.resolve('../../subpackageRoam/components/cy/scene-roam-task-list/index.js')
  delete require.cache[file]
  require(file)
  Object.assign(global, prev)
  const writes = []
  const inst = Object.assign({}, def.methods, { data: JSON.parse(JSON.stringify(def.data)), setData(p, cb) { writes.push(p); Object.assign(this.data, p); if (cb) cb() } })
  return { inst, writes }
}

test('连续打字只在停下后过滤一次', async () => {
  const { inst, writes } = mount()
  inst.data.all = [{ title: '外滩夜行', _live: true }, { title: '老城厢', _live: true }]
  for (const v of ['外', '外滩', '外滩夜']) inst.onKeyword({ detail: { value: v } })
  assert.equal(writes.length, 0)
  await new Promise(r => setTimeout(r, 200))
  assert.equal(writes.length, 1)
  assert.equal(writes[0].keyword, '外滩夜')
  assert.equal(writes[0].events.length, 1)
})
