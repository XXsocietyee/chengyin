'use strict'
// L09-064
// 战报榜单:队伍探测回来只补页签,口径没变就不重读同一张榜;刚探测过的队伍榜直接用,不再发同一请求。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const vm = require('node:vm')

const ROOT = path.resolve(__dirname, '../..')
const FILE = path.join(ROOT, 'subpackageJourney/components/rank-board/index.js')

function mount(props) {
  const calls = []
  let resolveProbe
  const api = {
    ok: (r) => !!r && Number(r.code) === 200,
    teamRanking: () => { calls.push('teamRanking'); return calls.filter((c) => c === 'teamRanking').length === 1 ? new Promise((r) => { resolveProbe = r }) : Promise.resolve({ code: 200, data: [] }) },
    teamDetail: () => { calls.push('teamDetail'); return new Promise(() => {}) },
    rank: () => { calls.push('rank'); return new Promise(() => {}) },
  }
  const view = require(path.join(ROOT, 'subpackageJourney/utils/journey-view.js'))
  let def
  const sandbox = {
    getApp: () => ({}), setTimeout, clearTimeout, console, Promise, Date,
    Component: (d) => { def = d },
    require: (n) => n.endsWith('journey-api.js') ? new Proxy(api, { get: (t, k) => (k in t ? t[k] : () => { calls.push(String(k)); return new Promise(() => {}) }) })
      : n.endsWith('journey-view.js') ? view : n.endsWith('reduced-motion.js') ? {} : { haptic() {} },
  }
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE })
  const ctx = Object.assign({ data: Object.assign(JSON.parse(JSON.stringify(def.data)), { reducedMotion: true }, props) }, def.methods)
  ctx.setData = function (p) { Object.assign(this.data, p) }
  def.lifetimes.attached.call(ctx)
  return { ctx, calls, probe: (rows) => resolveProbe({ code: 200, data: rows }) }
}

test('L09-064 队伍探测回来口径未变时不重读同一张榜', async () => {
  const h = mount({ topicId: '7', active: true })
  const before = h.calls.filter((c) => c !== 'teamRanking').length
  assert.ok(before >= 1, '首读一次')
  h.probe([{ teamId: 1, name: 'A', rank: 1 }])
  await new Promise((r) => setImmediate(r))
  assert.equal(h.calls.filter((c) => c !== 'teamRanking').length, before, '探测补页签不再重读')
  assert.ok(h.ctx.data.tabs.some((t) => t.key === 'teams') || h.ctx.data.more.some((t) => t.key === 'teams'))
  const teamCalls = h.calls.filter((c) => c === 'teamRanking').length
  h.ctx.onScope({ detail: { key: 'teams' } })
  await new Promise((r) => setImmediate(r))
  assert.equal(h.calls.filter((c) => c === 'teamRanking').length, teamCalls, '刚探测过的队伍榜直接用')
  assert.notEqual(h.ctx.data.state, 'loading')
  h.ctx.onScope({ detail: { key: 'teams' } })
  assert.equal(h.calls.filter((c) => c === 'teamRanking').length, teamCalls + 1, '用过一次后再切回照常重读')
})
