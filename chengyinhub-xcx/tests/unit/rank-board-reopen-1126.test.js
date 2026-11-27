'use strict'
// L09-064:同一局这次停留里,关掉榜单再打开用已经读到的名次,不再请求。
// 换一张榜、换一局、换一页,或者读失败,仍要重新请求。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const FILE = path.join(ROOT, 'subpackageJourney/components/rank-board/index.js')

function harness() {
  const calls = []
  let page = {}
  let failRank = false
  const view = require(path.join(ROOT, 'subpackageJourney/utils/journey-view.js'))
  const api = {
    ok: (r) => !!r && Number(r.code) === 200,
    rank: (_app, query) => {
      calls.push({ kind: 'rank', query })
      if (failRank) {
        failRank = false
        return Promise.resolve({ code: 500, msg: '榜单暂未加载' })
      }
      return Promise.resolve({
        code: 200,
        data: {
          scope: query.scope,
          scopeId: String(query.scopeId || ''),
          period: query.period,
          entries: [{ rank: 1, memberId: 9, nickname: '阿兰', score: 3 }],
          me: { rank: 1, score: 3 },
          coverage: { rankedMembers: 6 },
          scoreBasis: 'COMPLETED_NODES',
        },
      })
    },
    teamRanking: () => { calls.push({ kind: 'teamRanking' }); return Promise.resolve({ code: 200, data: [] }) },
    teamDetail: () => { calls.push({ kind: 'teamDetail' }); return new Promise(() => {}) },
  }
  let def
  const sandbox = {
    getApp: () => ({}), setTimeout, clearTimeout, console, Promise, Date,
    getCurrentPages: () => [page],
    Component: (d) => { def = d },
    require: (n) => n.endsWith('journey-api.js') ? api
      : n.endsWith('journey-view.js') ? view
        : n.endsWith('reduced-motion.js') ? {}
          : { haptic() {} },
  }
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE })
  function mount(props) {
    const ctx = Object.assign({ data: Object.assign(JSON.parse(JSON.stringify(def.data)), { reducedMotion: true }, props) }, def.methods)
    ctx.setData = function (p) { Object.assign(this.data, p) }
    def.lifetimes.attached.call(ctx)
    return ctx
  }
  return {
    mount,
    calls,
    rankCount: () => calls.filter((c) => c.kind === 'rank').length,
    detach: (ctx) => def.lifetimes.detached.call(ctx),
    newVisit: () => { page = {} },
    failNext: () => { failRank = true },
  }
}

test('L09-064 关掉再打开同一张榜不再请求,名次还在', async () => {
  const h = harness()
  const first = h.mount({ topicId: '7', activityId: '8', active: true })
  await new Promise((r) => setImmediate(r))
  assert.equal(h.rankCount(), 1)
  assert.equal(first.data.state, 'ready')
  assert.equal(first.data.rank.entries[0].name, '阿兰')
  h.detach(first)

  const again = h.mount({ topicId: '7', activityId: '8', active: true })
  assert.equal(h.rankCount(), 1, '同一局再打开不请求')
  assert.equal(again.data.state, 'ready')
  assert.equal(again.data.rank.entries[0].name, '阿兰')
  assert.equal(again.data.rank.entries.length, 1)

  again.onPeriod({ detail: { key: 'week' } })
  await new Promise((r) => setImmediate(r))
  assert.equal(h.rankCount(), 2, '换成本周仍要读')
  assert.equal(h.calls.filter((c) => c.kind === 'rank').pop().query.period, 'week')

  h.detach(again)
  const back = h.mount({ topicId: '7', activityId: '8', active: true })
  assert.equal(h.rankCount(), 2, '再打开仍是累计那张,不再请求')
  assert.equal(back.data.period, 'all')
  assert.equal(back.data.rank.entries[0].name, '阿兰')

  h.detach(back)
  const other = h.mount({ topicId: '9', activityId: '8', active: true })
  await new Promise((r) => setImmediate(r))
  assert.equal(h.rankCount(), 3, '换一局要重新读')
  assert.equal(other.data.rank.entries[0].name, '阿兰')

  h.newVisit()
  const visit = h.mount({ topicId: '9', activityId: '8', active: true })
  await new Promise((r) => setImmediate(r))
  assert.equal(h.rankCount(), 4, '下一次进入页面要重新读')
  assert.equal(visit.data.state, 'ready')
})

test('L09-064 没读到的榜再打开仍会请求', async () => {
  const h = harness()
  h.failNext()
  const apiFail = h.mount({ topicId: '7', active: true })
  await new Promise((r) => setImmediate(r))
  assert.equal(apiFail.data.state, 'error')
  assert.equal(h.rankCount(), 1)
  h.detach(apiFail)
  const again = h.mount({ topicId: '7', active: true })
  await new Promise((r) => setImmediate(r))
  assert.equal(h.rankCount(), 2)
  assert.equal(again.data.state, 'ready')
  assert.equal(again.data.rank.entries[0].name, '阿兰')
})
