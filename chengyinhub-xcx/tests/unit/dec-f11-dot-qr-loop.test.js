'use strict'
// L02-119(业主 2026-11-24):入场码彩色波放满两整轮(2 × 6 色 × 2000 ms)就停在静止墨色码(_draw(-1));
// 点码或页面重新显示再放。用 node:test 的假时钟推进 Date 与 rAF。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const ROOT = path.join(__dirname, '../..')
const CYCLE_MS = 6 * 2000

for (const rel of ['pages/play/components/cy/dot-qr/index.js', 'subpackageMember/components/cy/dot-qr/index.js']) {
  test(rel + ':两整轮后停在静止墨色码,点码 / 页面显示再放', (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 })
    let config = null
    global.Component = (c) => { config = c }
    global.wx = { getStorageSync: () => '', getSystemInfoSync: () => ({}), getAppBaseInfo: () => ({}) }
    global.getApp = () => ({ globalData: {} })
    const file = path.join(ROOT, rel)
    delete require.cache[require.resolve(file)]
    require(file)
    const draws = []
    let rafCount = 0
    const cv = {
      requestAnimationFrame(fn) { rafCount += 1; return setTimeout(fn, 16) },
      cancelAnimationFrame(id) { clearTimeout(id) },
    }
    const comp = Object.assign({ data: { reducedMotion: false, fallback: false }, properties: {} }, config.methods)
    comp._cv = cv; comp._ctx = {}; comp._m = { n: 21, cells: new Uint8Array(441), hole: 0 }
    comp._draw = (x) => draws.push(x)
    const pageShow = config.pageLifetimes.show.bind(comp)
    const pageHide = config.pageLifetimes.hide.bind(comp)

    comp._start()
    assert.ok(comp._raf, '开始播放')
    t.mock.timers.tick(CYCLE_MS)
    assert.ok(comp._raf, '一轮后仍在播')
    t.mock.timers.tick(CYCLE_MS + 100)
    assert.equal(comp._raf, 0, '两整轮后停下')
    assert.equal(draws.at(-1), -1, '最后一帧是静止墨色码')
    assert.ok(draws.slice(0, -1).every((x) => x >= 0 && x < 2 * CYCLE_MS), '动画帧都落在两轮内')
    const stoppedAt = rafCount
    t.mock.timers.tick(10_000)
    assert.equal(rafCount, stoppedAt, '停下后不再申请帧')

    comp.onTap()
    assert.ok(comp._raf, '点码再放')
    t.mock.timers.tick(5_000)
    const before = rafCount
    comp.onTap()
    assert.equal(rafCount, before, '播放中点码不重开')
    t.mock.timers.tick(2 * CYCLE_MS)
    assert.equal(comp._raf, 0)
    assert.equal(draws.at(-1), -1)

    pageHide(); pageShow()
    assert.ok(comp._raf, '页面重新显示再放')
    t.mock.timers.tick(2 * CYCLE_MS + 100)
    assert.equal(comp._raf, 0)
    assert.equal(draws.at(-1), -1)
  })
}

test('入场码点按接到 onTap', () => {
  const fs = require('fs')
  for (const rel of ['pages/play/components/cy/dot-qr/index.wxml', 'subpackageMember/components/cy/dot-qr/index.wxml']) {
    assert.match(fs.readFileSync(path.join(ROOT, rel), 'utf8'), /<view class="dq"[^>]*bindtap="onTap"/)
  }
})
