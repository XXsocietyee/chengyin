'use strict'
// AUDIT-1122 F06:广场详情本人写操作后回前台不整帖重拉 (L06-056),评论框失焦可再次聚焦、回前台不自动弹键盘 (L06-057)

const assert = require('node:assert/strict')
const fs = require('node:fs')
const { createRequire } = require('node:module')
const path = require('node:path')
const test = require('node:test')
const vm = require('../helpers/ui-sandbox-vm.js') // node:vm + 沙箱里装真 utils/toast.js·loading.js

const ROOT = path.resolve(__dirname, '../..')

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

function setByPath(target, dotted, value) {
  const parts = dotted.replace(/\[(\d+)\]/g, '.$1').split('.')
  let cursor = target
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {}
    cursor = cursor[part]
  })
  cursor[parts[parts.length - 1]] = value
}

function loadPage(relativePath) {
  const requests = []
  const requestTasks = []
  const toasts = []
  let pullStops = 0
  let definition
  const absolutePath = path.join(ROOT, relativePath)
  const app = {
    canUseCommunity: () => true, // Current-account server-open fixture.
    globalData: { statusBarHeight: 20, navBarHeight: 44 },
    getAvatar: () => '',
    getNickname: () => '',
    getPageSize: () => 10,
    getRequestErrorMessage: (res, fallback) => (res && res.msg) || fallback,
    getTotalPage: (total, size) => Math.ceil(Number(total || 0) / size),
    getUserID: () => 7,
    sendRequest(options) {
      requests.push(options)
      const task = { aborted: false, abort() { this.aborted = true } }
      requestTasks.push(task)
      return task
    },
    tips(message) { toasts.push(message) },
  }
  const wxApi = {
    getSystemInfoSync: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ bottom: 64 }),
    hideTabBar() {},
    navigateBack() {},
    navigateTo() {},
    pageScrollTo() {},
    reLaunch() {},
    showToast(options) { toasts.push(options && options.title) },
    stopPullDownRefresh() { pullStops += 1 },
  }
  vm.runInNewContext(read(relativePath), {
    console,
    getApp: () => app,
    Page: (config) => { definition = config },
    require: (id) => id.includes('community-post-api') ? require('../helpers/community-page-seam') : createRequire(absolutePath)(id),
    setTimeout() {},
    clearTimeout() {},
    wx: wxApi,
  }, { filename: absolutePath })

  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, done) {
      Object.entries(patch).forEach(([key, value]) => setByPath(this.data, key, value))
      if (done) done.call(this)
    },
  })
  return {
    app,
    page,
    requests,
    requestTasks,
    toasts,
    get pullStops() { return pullStops },
  }
}


test('L06-056 本人点赞成功后回前台不重拉帖子与评论;已有内容时刷新不闪骨架', () => {
  const event = { currentTarget: { dataset: { index: 0, type: 1 } } }
  const h = loadPage('pages/square/detail/index.js')
  Object.assign(h.page.data, { id: 3, detailState: 'ready', info: { id: 3, memberId: 8, isLiked: 0, likeCount: 4 } })
  h.page.lickClick(event)
  const like = h.requests.at(-1)
  // 社区适配层对写操作会推进全局版本
  h.app.globalData.squareListDirtyVersion = 5 // 社区适配层对写操作推进全局版本
  like.success({ code: '200', data: { isLiked: 1, likeCount: 5, version: 2 } })
  const before = h.requests.length
  h.page.onShow()
  assert.equal(h.requests.length, before, '自己的写已就地生效,回前台不应再拉')
  h.page.getData()
  assert.equal(h.page.data.detailState, 'ready', '有内容时静默刷新,不换骨架')
})

test('L06-057 失焦后再次点评论能重新聚焦;回前台不再自动弹键盘', () => {
  const h = loadPage('pages/square/detail/index.js')
  Object.assign(h.page.data, { id: 3, commentFocus: true })
  h.page._autoFocusComment = true
  h.page._commentFocused = true
  h.page.onCommentBlur()
  assert.equal(h.page.data.commentFocus, false)
  h.page.onShow()
  assert.equal(h.page.data.commentFocus, false)
})

test('L06-183 确认删除后上下文已变化:解除组件忙碌态而不是一直转', () => {
  const h = loadPage('pages/square/detail/index.js')
  let failed = ''
  h.page.selectComponent = () => ({ deleteFailed(t) { failed = t } })
  Object.assign(h.page.data, { id: 3, info: { id: 3, memberId: 7 } })
  h.page._actionContext = { id: '3', owner: '999' } // 换号后的旧上下文
  h.page.onPostAction({ detail: { id: '3', action: 'delete' } })
  assert.ok(failed, '必须调 deleteFailed')
})

test('L06-180 回复按钮只带下标,按下标取评论', () => {
  const h = loadPage('pages/square/detail/index.js')
  Object.assign(h.page.data, { id: 3, list: [{ id: 41 }, { id: 42 }] })
  h.page.msgClick({ currentTarget: { dataset: { index: 1 } } })
  assert.equal(h.page.data.replyId, 42)
  assert.equal(h.page.data.popShow, true)
})
