// AUDIT-1122 F06:模板 tab 玩家回前台不拉发布能力 (L06-048),商家权限短时内不重复拉 (L06-161)
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const FILE = path.resolve(__dirname, '../../pages/template/index.js')

function mount(role) {
  let def
  const requests = []
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44, menuButtonInfo: {} },
    getUserRole: () => role, getUserType: () => (role === 'merchant' ? 2 : 1), getUserID: () => 'm7',
    sendRequest: o => requests.push(o),
  }
  const wx = { hideTabBar() {}, getWindowInfo: () => ({ windowWidth: 375 }), getStorageSync: () => '', showToast() {} }
  const real = createRequire(FILE)
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), {
    Page: v => { def = v }, getApp: () => app, wx, console, setTimeout, clearTimeout,
    require: id => id.includes('merchant-theme') ? { merchantPageShow() {}, merchantPageRestore() {} }
      : id.includes('identity-policy') ? { isMerchantView: v => v.role === 'merchant' }
      : id.includes('motion-preference') ? { readReducedMotion: () => false }
      : id.includes('font-scale') ? { readPageStyle: () => '' }
      : real(id),
  })
  const page = Object.assign({}, def, { data: JSON.parse(JSON.stringify(def.data)) })
  page.setData = function (p) { Object.entries(p).forEach(([k, v]) => { if (k.includes('.')) return; this.data[k] = v }) }
  return { page, requests }
}

test('L06-048 玩家回到模板 tab 不再请求 /api/publish/home', () => {
  const { page, requests } = mount('player')
  page.onLoad({})
  page.onShow(); page.onShow()
  assert.equal(requests.filter(r => r.url === '/api/publish/home').length, 0)
})

test('L06-161 商家视角 60 秒内回前台不重复拉 /api/merchant/access/me;失败后照常重拉', () => {
  const { page, requests } = mount('merchant')
  page.onLoad({ mode: 'merchant' })
  page.onShow()
  const access = () => requests.filter(r => r.url === '/api/merchant/access/me')
  access()[0].success({ code: '200', data: { canManageProjects: true } })
  page.onShow()
  assert.equal(access().length, 1)
  page.data.merchantAccessError = true
  page.onShow()
  assert.equal(access().length, 2)
})
