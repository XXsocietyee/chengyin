const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { buildRoamGoal } = require('../../utils/play-state-contract.js')

const PAGE_MODULE = '../../pages/roam/index.js'
const ROAM_WXML = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxml'), 'utf8')
const ROAM_WXSS = fs.readFileSync(path.resolve(__dirname, '../../pages/roam/index.wxss'), 'utf8')
const TOKENS_WXSS = fs.readFileSync(path.resolve(__dirname, '../../style/tokens.wxss'), 'utf8')

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = ROAM_WXSS.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))
  assert.ok(match, `找不到样式规则 ${selector}`)
  return match[1]
}

function tokenNumber(name) {
  // Dynamic Type(2026-08-22):字阶已包成 calc(NNrpx * var(--cy-type-scale)),取 scale=1 的基准值
  const match = TOKENS_WXSS.match(new RegExp(`--${name}:\\s*(?:calc\\()?([0-9.]+)(?:rpx)?`))
  assert.ok(match, `找不到数值 token --${name}`)
  return Number(match[1])
}

function loadRoamPage() {
  let definition
  const previous = {
    Page: global.Page,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx,
  }
  try {
    global.Page = config => { definition = config }
    global.getApp = () => ({ globalData: { features: {} } })
    global.getCurrentPages = () => []
    global.wx = { getStorageSync: () => undefined }
    delete require.cache[require.resolve(PAGE_MODULE)]
    require(PAGE_MODULE)
  } finally {
    global.Page = previous.Page
    global.getApp = previous.getApp
    global.getCurrentPages = previous.getCurrentPages
    global.wx = previous.wx
  }
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
  })
}

function enumerateGoalActions() {
  const actions = new Set()
  const bools = [false, true]
  for (const visitActive of bools) {
    for (const gpsEnabled of bools) {
      for (const locationError of bools) {
        for (const offline of bools) {
          for (const poiEmpty of bools) {
            for (const nearbyCount of [0, 2]) {
              // 拍板 9-16「漫游打卡不存在失败态」:页面不再向 buildRoamGoal 传 checkinError
              // (visit.checkinErr/checkinRetryable 已随失败浮卡一起删),所以这里不枚举它 ——
              // 'retry-checkin' 这一档在漫游页物理上不可达,由下面的独立断言钉住。
              const goal = buildRoamGoal({
                visitActive,
                poiName: '',
                gpsEnabled,
                locationError,
                offline,
                poiEmpty,
                nearbyCount,
              })
              if (goal.act) actions.add(goal.act)
            }
          }
        }
      }
    }
  }
  return [...actions].sort()
}

test('漫游页不再产生「打卡失败」目标态(拍板:打卡不存在失败态)', () => {
  const roamJs = fs.readFileSync(path.resolve(__dirname, PAGE_MODULE), 'utf8')
  const goalSource = roamJs.slice(roamJs.indexOf('_syncGoal('), roamJs.indexOf('onGoalTap('))
  assert.doesNotMatch(goalSource, /checkinError/, '目标态输入不许再带 checkinError')
  assert.doesNotMatch(roamJs, /retryCheckin/, '失败重试入口(retryCheckin)必须随失败浮卡一起删除')
})

test('buildRoamGoal 的每个非空动作都由 onGoalTap 产生明确且唯一的效果', () => {
  const expectedEffect = {
    discover: 'discover',
    gps: 'gps',
    nearby: 'nearby',
  }
  // util 里 'retry-checkin' 分支留给共享九态合同(play-state-contract.test.js 直接测 util);
  // 漫游页已不产生该输入,故不列入页面动作合同 —— 见上面那条独立断言。
  const declaredActions = [...new Set(
    [...buildRoamGoal.toString().matchAll(/\bact:\s*([^,\n}]+)/g)]
      .flatMap(expression => [...expression[1].matchAll(/'([^']+)'/g)].map(match => match[1])),
  )].filter(act => act !== 'retry-checkin' && act !== 'retry-poi').sort()
  // L05-006(业主默认项 B):漫游页给 buildRoamGoal 的 offline 恒为 false,'retry-poi' 不会产生,页面重试分支已删
  assert.deepEqual(enumerateGoalActions().filter(act => act !== 'retry-poi'), declaredActions, '每个声明的非空 goal.act 都必须可由输入合同产出')
  assert.deepEqual(Object.keys(expectedEffect).sort(), declaredActions, '新增 goal.act 时必须同步补页面动作合同')

  const expectedActions = declaredActions
  for (const act of expectedActions) {
    const page = loadRoamPage()
    const effects = []
    page.data.goal = { act }
    page.goDiscover = () => { effects.push('discover') }
    page.toggleGps = () => { effects.push('gps') }
    page.setData = patch => {
      if (patch.nearbyBanner && patch.nearbyBanner.show === true) effects.push('nearby')
    }

    page.onGoalTap()

    assert.deepEqual(effects, [expectedEffect[act]], `${act} 必须且只能执行一个对应动作`)
  }
})

test('discover 点击只调用一次 goDiscover，规则入口用 catchtap 隔离父级目标点击', () => {
  const page = loadRoamPage()
  let discoverCalls = 0
  page.data.goal = { act: 'discover' }
  page.goDiscover = () => { discoverCalls += 1 }

  page.onGoalTap()

  assert.equal(discoverCalls, 1)
  const goalHead = ROAM_WXML.slice(
    ROAM_WXML.indexOf('<view wx:if="{{goal.act}}" class="pcard__head pcard__head--goal"'),
    ROAM_WXML.indexOf('<view class="pcard__row">'),
  )
  assert.match(goalHead, /bindtap="onGoalTap"/)
  assert.match(goalHead, /class="pcard__rules" catchtap="openRoamRules"/)
  assert.doesNotMatch(goalHead, /class="pcard__rules" bindtap=/)

  const rulesBinding = goalHead.match(/class="pcard__rules"\s+(catch|bind)tap="([^"]+)"/)
  let rulesCalls = 0
  discoverCalls = 0
  page.openRoamRules = () => { rulesCalls += 1 }
  page[rulesBinding[2]]()
  if (rulesBinding[1] !== 'catch') page.onGoalTap()
  assert.deepEqual({ goalCalls: discoverCalls, rulesCalls }, { goalCalls: 0, rulesCalls: 1 })
})

test('没有下一步动作的当前目标不伪装成可点击按钮', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/roam/index.wxml'), 'utf8')
  assert.match(wxml, /wx:if="\{\{goal\.act\}\}"[^>]*bindtap="onGoalTap"[^>]*aria-role="button"/)
  assert.match(wxml, /wx:else[^>]*aria-role="text"/)
})

// L05-006(业主默认项 B):据点读取失败不加新提示;从不生效的 'retry-poi' 长文案布局与重试一并删掉
test('漫游页不产生弱网重试目标，读数卡不再有长文案分支', () => {
  const js = fs.readFileSync(path.join(__dirname, '../../pages/roam/index.js'), 'utf8')
  assert.match(js, /offline: false, \/\/ 据点加载失败不展示离线提示/)
  assert.doesNotMatch(js, /onPoiRetry|'retry-poi'/)
  assert.doesNotMatch(ROAM_WXML, /pcard--long-goal|retry-poi/)
  assert.match(ROAM_WXML, /<view class="pcard" wx:if=/)
})
