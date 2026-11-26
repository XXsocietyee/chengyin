'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const f = require('../../utils/roam-poi-filter.js')

function memStorage() {
  const box = {}
  return {
    box,
    getStorageSync(k) { return box[k] },
    setStorageSync(k, v) { box[k] = v },
  }
}

test('BL-01 默认 3km、全部节点;非法值回落默认', () => {
  assert.deepEqual(f.normalizeFilter(null), { radiusM: 3000, unvisitedOnly: false })
  assert.deepEqual(f.normalizeFilter({ radiusM: 7000, unvisitedOnly: 'yes' }), { radiusM: 3000, unvisitedOnly: false })
  assert.deepEqual(f.normalizeFilter({ radiusM: '1000', unvisitedOnly: true }), { radiusM: 1000, unvisitedOnly: true })
})

test('BL-01 按账号持久化 roam_filter_v1,无账号不落盘', () => {
  const s = memStorage()
  assert.equal(f.writeFilter('42', { radiusM: 5000, unvisitedOnly: true }, s), true)
  assert.deepEqual(s.box['roam_filter_v1:42'], { radiusM: 5000, unvisitedOnly: true })
  assert.deepEqual(f.readFilter('42', s), { radiusM: 5000, unvisitedOnly: true })
  assert.deepEqual(f.readFilter('43', s), { radiusM: 3000, unvisitedOnly: false })
  assert.equal(f.writeFilter('', { radiusM: 1000 }, s), false)
  assert.equal(f.writeFilter('0', { radiusM: 1000 }, s), false)
  const broken = { getStorageSync() { throw new Error('x') } }
  assert.deepEqual(f.readFilter('42', broken), { radiusM: 3000, unvisitedOnly: false })
})

test('BL-01 只看未到过:藏 passed/done,保留待核销与当前目标', () => {
  const on = { radiusM: 3000, unvisitedOnly: true }
  assert.equal(f.hiddenByFilter({ state: 'passed' }, on, 'candidate'), true)
  assert.equal(f.hiddenByFilter({ state: 'done' }, on, 'completed'), true)
  assert.equal(f.hiddenByFilter({ state: 'pendingRedeem' }, on, 'redeem-pending'), false)
  assert.equal(f.hiddenByFilter({ state: 'seen' }, on, 'actionable'), false)
  assert.equal(f.hiddenByFilter({ state: 'done' }, on, 'target'), false)
  assert.equal(f.hiddenByFilter({ state: 'passed' }, { radiusM: 3000, unvisitedOnly: false }, 'candidate'), false)
})

// L05-043(业主默认项 A):筛选半屏早已没有入口,删掉;页面不再读旧的本机筛选设置,统一用默认 3 公里
test('L05-043 漫游页不再有筛选半屏,也不再按旧筛选改请求半径或藏点位', () => {
  const root = path.join(__dirname, '../..')
  const js = fs.readFileSync(path.join(root, 'pages/roam/index.js'), 'utf8')
  const wxml = fs.readFileSync(path.join(root, 'pages/roam/index.wxml'), 'utf8')
  assert.match(js, /const radiusM = ROAM_POI_RADIUS_M;/)
  assert.doesNotMatch(js, /roam-poi-filter|_poiFilterState|hiddenByFilter|openPoiFilter/)
  assert.doesNotMatch(wxml, /roam-poi-filter|筛选节点/)
})
