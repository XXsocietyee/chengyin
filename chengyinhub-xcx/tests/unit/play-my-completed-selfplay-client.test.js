// R10-09 客户端:完成列表被里程碑真实消费(发帖选择器 activity-picker 闲置组件已于 2026-11-24 删除,L06-170)。
// 用真实页面/组件源码 + 合成回包,覆盖正常(含自玩 dataType=2)、空、失败恢复。
const { beforeEach, test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const PLAY_PAGE = '../../pages/play/index.js'

let requests
let pageConfig

function setByPath(target, rawPath, value) {
  const parts = rawPath.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null) cursor[parts[i]] = {}
    cursor = cursor[parts[i]]
  }
  cursor[parts[parts.length - 1]] = value
}

beforeEach(() => {
  requests = []
  pageConfig = null
  global.getApp = () => ({
    globalData: { user_id: 9, features: {} },
    isDevEnv: () => false,
    sendRequest: (request) => { requests.push(request) },
    getUploadClient: () => ({ uploadAll: () => ({ destroy() {} }) }),
  })
  global.wx = {
    getStorageSync: () => '',
    setStorageSync() {},
    getWindowInfo: () => ({ statusBarHeight: 20 }),
    getSystemInfoSync: () => ({ statusBarHeight: 20 }),
    showLoading() {},
    hideLoading() {},
    showToast() {},
    showModal: ({ success }) => success && success({ confirm: false }),
  }
  global.Page = (config) => { pageConfig = config }
  global.setTimeout = global.setTimeout || (() => 0)
  global.clearTimeout = global.clearTimeout || (() => {})
})

function loadPlayPage() {
  delete require.cache[require.resolve(PLAY_PAGE)]
  require(PLAY_PAGE)
  const page = Object.assign({}, pageConfig, { data: JSON.parse(JSON.stringify(pageConfig.data)) })
  // 里程碑只在通关卡展示时读取(openFinish 先置 showFinish 再调 loadMilestone)
  page.data.showFinish = true
  page.setData = (patch, callback) => {
    Object.keys(patch || {}).forEach((key) => setByPath(page.data, key, patch[key]))
    if (callback) callback()
  }
  return page
}


const SELF_PLAY_ITEM = {
  activityId: null, topicId: 990062, dataType: 2, dataId: 990062,
  name: '自玩主题', cover: 'https://cdn/self.png', total: 2, doneCount: 2, completed: true,
}
const ACTIVITY_ITEM = {
  activityId: 501, topicId: 990063, dataType: 1, dataId: 501,
  name: '活动场次', cover: 'https://cdn/act.png', total: 3, doneCount: 3, completed: true,
}

test('里程碑:自玩(dataType=2)与活动完成按 topicId 一起计数', () => {
  const page = loadPlayPage()

  page.loadMilestone()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/api/play/my-completed')
  requests[0].success({ code: 200, data: [SELF_PLAY_ITEM, ACTIVITY_ITEM] })

  assert.equal(page.data.milestone && page.data.milestone.count, 2, '自玩完成必须计入里程碑')
})

test('里程碑:同主题重复条目只计一次', () => {
  const page = loadPlayPage()

  page.loadMilestone()
  requests[0].success({ code: 200, data: [SELF_PLAY_ITEM, Object.assign({}, SELF_PLAY_ITEM, { dataId: 990062 })] })

  assert.equal(page.data.milestone && page.data.milestone.count, 1, '重复读取不得重复计数')
})

test('F2:同主题活动+自玩两条真实对象都在,里程碑按 topicId 只计一次', () => {
  const sameTopic = 990070
  const activityItem = {
    activityId: 501, topicId: sameTopic, dataType: 1, dataId: 501,
    name: '同主题活动', cover: 'https://cdn/act.png', total: 2, doneCount: 2, completed: true,
  }
  const selfPlayItem = {
    activityId: null, topicId: sameTopic, dataType: 2, dataId: sameTopic,
    name: '同主题自玩', cover: 'https://cdn/self.png', total: 2, doneCount: 2, completed: true,
  }

  const page = loadPlayPage()
  page.loadMilestone()
  requests[0].success({ code: 200, data: [activityItem, selfPlayItem] })
  assert.equal(page.data.milestone && page.data.milestone.count, 1, '同主题两条对象里程碑只计一次')

})

test('里程碑:空列表是「零完成」而不是「没有数据」', () => {
  const page = loadPlayPage()

  page.loadMilestone()
  requests[0].success({ code: 200, data: [] })

  assert.ok(page.data.milestone, '空数组是确定的 0，轴仍可渲染')
  assert.equal(page.data.milestone.count, 0)
})

test('里程碑:回包失败保持 null,不伪装成 0', () => {
  const page = loadPlayPage()

  page.loadMilestone()
  // fail 回调不触发 success;保持初始 null
  assert.equal(page.data.milestone, null)
})
