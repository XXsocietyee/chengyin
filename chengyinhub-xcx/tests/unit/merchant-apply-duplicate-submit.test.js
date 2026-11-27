'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const uiSandbox = require('../helpers/ui-sandbox-vm.js')

const ROOT = path.resolve(__dirname, '../..')
const JS_PATH = path.join(ROOT, 'pages/merchant/apply/index.js')
const DUPLICATE = '已提交过商家入驻申请，请勿重复提交'

function loadPage() {
  const requests = []
  let definition
  const app = {
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getUserID() { return 9 },
    getAuthorization() { return 'token-a' },
    sendRequest(options) { requests.push(options) },
  }
  const wx = {
    showModal() {},
    showToast() {},
    navigateBack() {},
    switchTab() {},
    navigateTo() {},
    chooseLocation() {},
    openSetting() {},
    nextTick() {},
    setStorageSync() {},
    getStorageSync() { return '' },
    removeStorageSync() {},
  }
  const sandbox = {
    Array,
    Date,
    Math,
    Object,
    RegExp,
    String,
    getApp: () => app,
    Page(config) { definition = config },
    wx,
    require(request) {
      if (request.endsWith('roleGuard.js')) {
        return {
          load() {},
          isClubLeader() { return false },
          hasSnapshot() { return true },
          ownedClubs() { return [] },
          clear() {},
        }
      }
      if (request.endsWith('merchant-theme.js')) {
        return { merchantPageShow() {}, merchantPageRestore() {} }
      }
      if (request.endsWith('merchant-identity-policy.js')) {
        return require(path.join(ROOT, 'utils/merchant-identity-policy.js'))
      }
      if (request.endsWith('merchant-business-hours.js')) {
        return require(path.join(ROOT, 'pages/merchant/utils/merchant-business-hours.js'))
      }
      if (request.endsWith('time-picker-options.js')) {
        return require(path.join(ROOT, 'utils/time-picker-options.js'))
      }
      if (request.endsWith('merchant-industry.js')) {
        return require(path.join(ROOT, 'pages/merchant/utils/merchant-industry.js'))
      }
      if (request.endsWith('motion-preference.js')) {
        return require(path.join(ROOT, 'utils/motion-preference.js'))
      }
      if (request.endsWith('wizard-morph.js') || request.endsWith('publisher-identity.js')) {
        const rel = request.endsWith('wizard-morph.js') ? 'pages/merchant/utils/wizard-morph.js' : 'utils/publisher-identity.js'
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        const mod = { exports: {} }
        const context = Object.assign({}, sandbox, { module: mod, exports: mod.exports })
        context.require = (dep) => (dep.startsWith('.')
          ? require(path.join(ROOT, 'utils', dep.replace(/^\.\//, '')))
          : require(dep))
        vm.runInNewContext(src, context, { filename: rel })
        return mod.exports
      }
      if (uiSandbox.isUiModule(request)) return uiSandbox.loadUiModule(request, sandbox)
      if (request.endsWith('/utils/session/login-reload.js')) return require('../../utils/session/login-reload.js')
      if (request.endsWith('/utils/form-state.js')) return require('../../utils/form-state.js')
      throw new Error(`unexpected require: ${request}`)
    },
  }
  vm.runInNewContext(fs.readFileSync(JS_PATH, 'utf8'), sandbox, { filename: JS_PATH })
  const page = Object.assign({}, definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = function (patch, callback) {
    Object.assign(this.data, patch)
    if (callback) callback.call(this)
  }
  return { page, requests }
}

function fillForm(page, extra) {
  Object.assign(page.data, {
    bootstrapState: 'ready',
    mode: 'form',
    step: 4,
    canNext: true,
    identityRegistered: true,
    name: '河畔咖啡',
    phone: '13800138000',
    address: '滨江路 8 号',
    businessTime: '周一至周日 10:00-22:00',
    businessLicense: 'license.jpg',
    idCard: '',
    apply: null,
  }, extra || {})
}

function applicationInfo() {
  return {
    code: 200,
    data: {
      id: 21,
      status: 0,
      accountStatus: 0,
      name: '服务端店名',
      phone: '13900000000',
      idCard: '11010519491231002X',
    },
  }
}

test('新申请遇到已提交过时，读到已有申请就按刚填的名字和电话收口', () => {
  const { page, requests } = loadPage()
  fillForm(page)
  page.submit()
  assert.equal(JSON.parse(requests[0].data).id, null)
  requests[0].success({ code: 500, msg: DUPLICATE })
  assert.equal(page.data.submitting, true)
  assert.equal(page.data.step, 4)
  assert.equal(requests[1].url, '/api/merchant/info')
  assert.equal(requests[1].method, 'POST')

  requests[1].success(applicationInfo())
  assert.equal(page.data.step, 5)
  assert.equal(page.data.submitting, false)
  assert.equal(page.data.submitError, '')
  assert.deepEqual(
    JSON.parse(JSON.stringify(page.data.submissionReceipt)),
    { name: '河畔咖啡', phone: '13800138000' },
  )
  assert.equal(page.data.idCard, '')
  assert.equal(page.data.apply, null)
  assert.equal(page.data.name, '河畔咖啡')
  assert.equal(JSON.stringify(page.data.submissionReceipt).includes('11010519491231002X'), false)
})

test('已提交过但读不到申请时，仍显示原错误且表单还在', () => {
  const misses = [
    (request) => request.fail({ errMsg: 'request:fail timeout' }),
    (request) => request.success({ code: 200, data: null, applicationState: 'NONE' }),
  ]
  for (const miss of misses) {
    const { page, requests } = loadPage()
    fillForm(page)
    page.submit()
    requests[0].success({ code: 500, msg: DUPLICATE })
    miss(requests[1])
    assert.equal(page.data.submitError, DUPLICATE)
    assert.equal(page.data.step, 4)
    assert.equal(page.data.submissionReceipt, null)
    assert.equal(page.data.name, '河畔咖啡')
    assert.equal(page.data.phone, '13800138000')
    assert.equal(page.data.address, '滨江路 8 号')
    assert.equal(page.data.businessLicense, 'license.jpg')

    page.retrySubmit()
    assert.equal(requests.length, 3)
    assert.equal(requests[2].url, '/api/merchant/merchant_registration')
  }
})

test('驳回后带 id 的更新遇到同一句，不装成已提交', () => {
  const { page, requests } = loadPage()
  fillForm(page, { apply: { id: 42, status: 2 } })
  page.submit()
  assert.equal(JSON.parse(requests[0].data).id, 42)
  requests[0].success({ code: 500, msg: DUPLICATE })
  assert.equal(requests.length, 1)
  assert.equal(page.data.step, 4)
  assert.equal(page.data.submitError, DUPLICATE)
  assert.equal(page.data.submissionReceipt, null)
  assert.equal(page.data.name, '河畔咖啡')
  assert.equal(page.data.submitting, false)
})
