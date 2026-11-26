// AUDIT-1122 F06:点位表单模板读失败给错误态 (L06-031),回前台只在去创建过玩法后重拉 (L06-032c)
const test = require('node:test')
const assert = require('node:assert/strict')

function mount() {
  let def
  const requests = []
  global.getApp = () => ({ globalData: {}, sendRequest: o => requests.push(o), getUserID: () => 1 })
  global.Component = v => { def = v }
  global.wx = { getWindowInfo: () => ({ windowHeight: 800, statusBarHeight: 20 }), navigateTo() {} }
  const file = require.resolve('../../pages/topic/components/cy/chapter-node-form/index.js')
  delete require.cache[file]
  require(file)
  const c = Object.assign({}, def.methods, {
    data: Object.assign(JSON.parse(JSON.stringify(def.data)), { show: true, formMode: 'apply', defaultAddress: '店址' }),
    setData(p, cb) { Object.entries(p).forEach(([k, v]) => { if (!k.includes('.')) this.data[k] = v }); if (cb) cb() },
    triggerEvent() {},
  })
  return { c, def, requests }
}
const myList = r => r.url === '/api/template/my-list'

test('L06-031 模板列表读失败显示错误而不是「还没有玩法」', () => {
  const { c, requests } = mount()
  c.loadMyTemplates()
  const req = requests.find(myList)
  req.success({ code: 500, msg: '系统繁忙' }); req.complete()
  assert.equal(c.data.templatesError, '系统繁忙')
})

test('L06-032 地图选点回来不重拉模板;去创建玩法回来才重拉', () => {
  const { c, def, requests } = mount()
  c.loadMyTemplates()
  const first = requests.find(myList)
  first.success({ code: '200', data: { rows: [] } }); first.complete()
  def.pageLifetimes.show.call(c)
  assert.equal(requests.filter(myList).length, 1)
  c.goCreateTemplate()
  def.pageLifetimes.show.call(c)
  assert.equal(requests.filter(myList).length, 2)
})

// AUDIT-1122 pass 2
test('L06-121 逐字输入只写改动的那一格;改地址时一并清掉坐标', () => {
  const { c } = mount()
  const patches = []
  c.setData = function (p, cb) {
    patches.push(p)
    Object.entries(p).forEach(([k, v]) => {
      const parts = k.split('.'); let o = this.data
      parts.slice(0, -1).forEach((x) => { o = o[x] })
      o[parts[parts.length - 1]] = v
    })
    if (cb) cb()
  }
  c.data.form.longitude = '121.4'; c.data.form.latitude = '31.2'; c.data.locationReady = true
  c.onInput({ currentTarget: { dataset: { key: 'name' } }, detail: { value: '夜场' } })
  assert.deepEqual(Object.keys(patches[0]), ['form.name'])
  assert.equal(c.data.form.name, '夜场')
  c.onInput({ currentTarget: { dataset: { key: 'address' } }, detail: { value: '新地址' } })
  const addr = patches.find((p) => 'form.address' in p)
  assert.deepEqual(Object.keys(addr).sort(), ['form.address', 'form.latitude', 'form.longitude', 'locationReady'])
  assert.equal(c.data.form.longitude, ''); assert.equal(c.data.locationReady, false)
  assert.ok(!patches.some((p) => 'form' in p), '不再整份 form 写回')
})
