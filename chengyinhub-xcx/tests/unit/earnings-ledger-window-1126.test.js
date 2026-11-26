'use strict'
// L09-045:分析页近 6 个月柱图。/api/user/balance/list 在 includeExternalClubIncome 下
// 按 create_time desc, id desc 返回。整页都早于窗口就停,不再把整本流水读进内存。
// 时间读不出来时不猜顺序,继续翻页。
// L09-046:收益场景隐藏后再回来,同一账号已经显示的余额和本月明细留在屏上,
// 不因为 hide 重拉 /api/user/info。换号或这次没读成,仍然重读。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')

const ROOT = path.resolve(__dirname, '../..')

function stamp(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
}

function income(id, when, amount) {
  return { id, changeType: 1, eventType: 1, changeBalance: amount, changeReason: '主题分润', createTime: when }
}

function mountAnalysis() {
  const file = path.join(ROOT, 'subpackageA/pages/assetcenter/analysis/index.js')
  let definition
  const requests = []
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Page: (value) => { definition = value },
    getApp: () => ({
      globalData: { statusBarHeight: 20, navBarHeight: 44 },
      getUserID: () => '7',
      sendRequest: (req) => requests.push(req),
    }),
    require: createRequire(file),
    console,
  }, { filename: file })
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) })
  page.setData = (patch) => Object.assign(page.data, patch)
  return { page, requests }
}

function monthTotal(page, date) {
  const key = date.getFullYear() + '-' + (date.getMonth() + 1)
  const bucket = page.data.series.find((item) => item.key === key)
  return bucket ? bucket.totalText : null
}

test('L09-045 最新页已在 6 个月窗口内、下一整页更早时不再读后面的账本', () => {
  const h = mountAnalysis()
  const now = new Date()
  const recent = new Date(now.getFullYear(), now.getMonth(), 15, 12, 0, 0)
  const edge = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 1)
  const older = new Date(now.getFullYear(), now.getMonth() - 8, 1, 12, 0, 0)
  h.page.load()
  assert.equal(h.requests[0].data.pageSize, 200)
  h.requests[0].success({
    code: '200',
    data: { total: 800, rows: [income(1, stamp(recent), 30), income(2, stamp(edge), 4)] },
  })
  assert.equal(h.page.data.state, 'loading')
  assert.equal(h.requests[1].data.pageNum, 2)
  h.requests[1].success({
    code: '200',
    data: { total: 800, rows: [income(3, stamp(older), 99), income(4, stamp(older), 1)] },
  })
  assert.equal(h.requests.length, 2)
  assert.equal(h.page.data.state, 'ready')
  assert.equal(h.page.data.series.length, 6)
  assert.equal(monthTotal(h.page, recent), '30.00')
  assert.equal(monthTotal(h.page, edge), '4.00')
  assert.equal(monthTotal(h.page, older), null)
})

test('L09-045 最新一页已经整页早于窗口时直接画空柱,不再翻页', () => {
  const h = mountAnalysis()
  const now = new Date()
  const older = new Date(now.getFullYear(), now.getMonth() - 8, 2, 8, 0, 0)
  h.page.load()
  h.requests[0].success({
    code: '200',
    data: { total: 900, rows: [income(1, stamp(older), 40), income(2, stamp(older), 5)] },
  })
  assert.equal(h.requests.length, 1)
  assert.equal(h.page.data.state, 'ready')
  assert.deepEqual(h.page.data.series.map((item) => item.totalText), ['0.00', '0.00', '0.00', '0.00', '0.00', '0.00'])
})

test('L09-045 同一页还有窗口内流水,或有读不出的时间时继续翻页', () => {
  const now = new Date()
  const recent = new Date(now.getFullYear(), now.getMonth(), 2, 9, 0, 0)
  const older = new Date(now.getFullYear(), now.getMonth() - 8, 2, 9, 0, 0)

  const mixed = mountAnalysis()
  mixed.page.load()
  mixed.requests[0].success({
    code: '200',
    data: { total: 5, rows: [income(1, stamp(recent), 1), income(2, stamp(older), 9)] },
  })
  assert.equal(mixed.page.data.state, 'loading')
  assert.equal(mixed.requests.length, 2)
  assert.equal(mixed.requests[1].data.pageNum, 2)

  const unreadable = mountAnalysis()
  unreadable.page.load()
  unreadable.requests[0].success({
    code: '200',
    data: { total: 400, rows: [income(1, stamp(older), 9), income(2, '', 8)] },
  })
  assert.equal(unreadable.page.data.state, 'loading')
  assert.equal(unreadable.requests.length, 2)
  assert.equal(unreadable.requests[1].data.pageNum, 2)
})

function mountScene() {
  const file = path.join(ROOT, 'subpackageA/components/scene-asset-earnings/index.js')
  const realRequire = createRequire(file)
  let definition
  const requests = []
  const motions = []
  let member = 1
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Component: (value) => { definition = value },
    getApp: () => ({
      globalData: { userInfo: null },
      getUserID: () => member,
      getUserRole: () => 'player',
      getUserType: () => 1,
      sendRequest: (req) => requests.push(req),
    }),
    require: (name) => {
      if (name.includes('page-motion')) {
        return { countMoney(page, key) {
          const stops = page._pmCounters || (page._pmCounters = {})
          if (stops[key]) stops[key]()
          const run = { stopped: false }
          motions.push(run)
          page.setData({ [key]: 0 })
          stops[key] = () => { run.stopped = true }
        } }
      }
      return realRequire(name)
    },
    console,
  }, { filename: file })
  const ctx = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    properties: { theme: 'player' },
  })
  ctx.setData = function (patch) { Object.assign(this.data, patch) }
  return {
    ctx, requests, motions,
    setMember: (id) => { member = id },
    hide: () => definition.pageLifetimes.hide.call(ctx),
    show: () => definition.pageLifetimes.show.call(ctx),
    infoCount: () => requests.filter((req) => req.url === '/api/user/info').length,
  }
}

function showBalance(amount) {
  const h = mountScene()
  h.ctx.load(true)
  h.requests[0].success({ code: 200, data: { balance: amount } })
  return h
}

test('L09-046 同一账号隐藏再回来保留已显示余额,不重拉用户信息', () => {
  const h = showBalance(12.5)
  assert.equal(h.ctx.data.balance, '12.50')
  assert.equal(h.ctx.data.balanceK, 0)
  h.hide()
  assert.equal(h.ctx.data.state, 'ready')
  assert.equal(h.ctx.data.balance, '12.50')
  assert.equal(h.ctx.data.balanceK, null)
  assert.equal(h.motions[0].stopped, true)
  h.show()
  assert.equal(h.infoCount(), 1)
  assert.equal(h.ctx.data.balance, '12.50')
  assert.equal(h.ctx.data.state, 'ready')
})

test('L09-046 同一账号的 0 余额隐藏后再回来也不清掉、不重拉', () => {
  const h = showBalance(null)
  assert.equal(h.ctx.data.balance, '0.00')
  h.hide()
  h.show()
  assert.equal(h.infoCount(), 1)
  assert.equal(h.ctx.data.balance, '0.00')
  assert.equal(h.ctx.data.state, 'ready')
})

test('L09-046 换号或还没读成时,隐藏后再回来会清掉并重读', () => {
  const switched = showBalance(12.5)
  switched.hide()
  switched.setMember(2)
  switched.show()
  assert.equal(switched.ctx.data.balance, '')
  assert.equal(switched.ctx.data.state, 'loading')
  assert.equal(switched.infoCount(), 2)
  assert.equal(switched.requests[1].data.member_id, 2)

  const pending = mountScene()
  pending.ctx.load(true)
  pending.hide()
  assert.equal(pending.ctx.data.balance, '')
  pending.requests[0].success({ code: 200, data: { balance: 88 } })
  assert.equal(pending.ctx.data.balance, '')
  pending.show()
  assert.equal(pending.infoCount(), 2)
  pending.requests[1].success({ code: 200, data: { balance: 3 } })
  assert.equal(pending.ctx.data.balance, '3.00')

  const failed = mountScene()
  failed.ctx.load(true)
  failed.requests[0].fail({}, 500)
  assert.equal(failed.ctx.data.state, 'error')
  failed.hide()
  failed.show()
  assert.equal(failed.infoCount(), 2)
  assert.equal(failed.ctx.data.state, 'loading')
})

const STAGES = {
  pendingSettlement: '1.00', disputed: '0', withdrawable: '2.00', complaintPeriod: [], amountsKnown: true,
}

function mountOverview(merchant) {
  const file = path.join(ROOT, 'subpackageA/components/earnings-overview/index.js')
  let definition
  const requests = []
  let member = 7
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    Component: (value) => { definition = value },
    getApp: () => ({
      globalData: {},
      getUserID: () => member,
      getUserRole: () => 'player',
      getUserType: () => 1,
      sendRequest: (req) => requests.push(req),
    }),
    require: createRequire(file),
    console,
    Date,
  }, { filename: file })
  const comp = Object.assign({}, definition.methods, {
    data: JSON.parse(JSON.stringify(definition.data)),
    properties: { merchant: !!merchant },
  })
  comp.setData = function (patch) { Object.assign(this.data, patch) }
  definition.lifetimes.attached.call(comp)
  return {
    comp, requests,
    setMember: (id) => { member = id },
    hide: () => definition.pageLifetimes.hide.call(comp),
    show: () => definition.pageLifetimes.show.call(comp),
  }
}

function settlePlayer(h) {
  const now = new Date()
  const when = stamp(new Date(now.getFullYear(), now.getMonth(), 10, 9, 0, 0))
  h.requests.find((req) => req.url === '/api/user/balance/list').success({
    code: '200',
    data: { rows: [income('b1', when, 10)] },
  })
  h.requests.find((req) => req.url === '/api/wallet/stages').success({ code: 200, data: STAGES })
}

test('L09-046 本月明细读齐后,同一账号隐藏再回来不重拉也不清空', () => {
  const h = mountOverview(false)
  assert.deepEqual(h.requests.map((req) => req.url), ['/api/user/balance/list', '/api/wallet/stages'])
  settlePlayer(h)
  assert.equal(h.comp.data.month.ready, true)
  assert.equal(h.comp.data.month.items.length, 1)
  assert.equal(h.comp.data.assets.length, 2)
  const before = h.requests.length
  h.hide()
  h.show()
  assert.equal(h.requests.length, before)
  assert.equal(h.comp.data.month.ready, true)
  assert.equal(h.comp.data.month.items[0].key, 'b1')
  assert.equal(h.comp.data.assets[0].key, 'withdrawable')

  h.setMember(8)
  h.show()
  assert.ok(h.requests.length > before)
  assert.equal(h.comp.data.month.ready, false)
  assert.equal(h.comp.data.assets.length, 0)
})

test('L09-046 本月明细没读成,或俱乐部计酬失败,隐藏后再回来会重读', () => {
  const failed = mountOverview(false)
  failed.requests.find((req) => req.url === '/api/user/balance/list').fail()
  failed.requests.find((req) => req.url === '/api/wallet/stages').success({ code: 200, data: STAGES })
  assert.equal(failed.comp.data.monthError, true)
  const before = failed.requests.length
  failed.hide()
  failed.show()
  assert.ok(failed.requests.length > before)
  assert.equal(failed.comp.data.month.ready, false)

  const denied = mountOverview(true)
  denied.requests.find((req) => req.url === '/api/club-direct-merchant/merchant').successStatusAbnormal({ code: 403 })
  const now = new Date()
  denied.requests.find((req) => req.url === '/api/user/balance/list').success({
    code: '200',
    data: { rows: [income('b1', stamp(new Date(now.getFullYear(), now.getMonth(), 10, 9, 0, 0)), 10)] },
  })
  denied.requests.find((req) => req.url === '/api/wallet/stages').success({ code: 200, data: STAGES })
  assert.equal(denied.comp.data.clubError, false)
  const held = denied.requests.length
  denied.hide()
  denied.show()
  assert.equal(denied.requests.length, held)

  const clubFailed = mountOverview(true)
  clubFailed.requests.find((req) => req.url === '/api/club-direct-merchant/merchant').fail({}, 500)
  const clubBefore = clubFailed.requests.length
  clubFailed.hide()
  clubFailed.show()
  assert.ok(clubFailed.requests.length > clubBefore)
})
