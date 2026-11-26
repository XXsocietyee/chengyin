// L07-151:商家「合作」页帖文流 —— 旧一轮请求迟到的失败不许把新一轮标成失败(与 talent/list 同口径)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function feedSources(page, app) {
  const src = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/relation/index.js'), 'utf8')
  const body = /\n  _feedSources\(\) \{([\s\S]*?)\n  \},/.exec(src)[1]
  return new Function('app', 'community', 'isRecord', 'isRecordList', 'discoverFeed', 'FEED_PAGE_SIZE', 'return function () {' + body + '\n}')(
    app, { request(o) { app.requests.push(o) } }, () => true, () => true, {}, 20).call(page)
}

test('旧一轮的失败迟到不记到新一轮上;当前一轮的失败照常记', () => {
  const app = { requests: [], sendRequest(o) { this.requests.push(o) }, canUseCommunity: () => true, getUserID: () => 1 }
  const fails = []
  const page = { _feedRequestId: 1, _feedCtx: { requestId: 1 }, _onFeedFail(ctx, res) { fails.push([ctx.requestId, res.msg]) } }
  const sources = feedSources(page, app)
  sources[0].fetch().catch(() => {})
  sources[1].fetch().catch(() => {})
  page._feedRequestId = 2
  page._feedCtx = { requestId: 2 }
  app.requests[0].fail({ msg: 'old club' })
  app.requests[1].fail({ msg: 'old community' })
  assert.deepEqual(fails, [], '旧请求失败不能标记新一轮')
  const fresh = feedSources(page, app)
  fresh[0].fetch().catch(() => {})
  app.requests[2].fail({ msg: 'new club' })
  assert.deepEqual(fails, [[2, 'new club']])
})

// L07-153:俱乐部名单只在 JS 归一化时过滤一次(没名字的行在 normalizeDiscoveryItem 就丢了),模板不再重复过滤
test('合作页俱乐部列表模板直接渲染 clubs', () => {
  const wxml = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/relation/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /<wxs module="relation">|relation\.valid/)
  assert.match(wxml, /wx:for="\{\{clubs\}\}" wx:key="id" style=/)
  const js = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/relation/index.js'), 'utf8')
  assert.match(js, /if \(!displayName \|\| displayName === '—'\) return null;/)
})

// L07-152:成员关系(/api/club/my)同账号 5 分钟内只读一次
test('合作页帖文流刷新不重复拉成员关系', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/relation/index.js'), 'utf8')
  const body = /\n  _loadMemberClubs\(ctx\) \{([\s\S]*?)\n  \},/.exec(src)[1]
  const requests = []
  const app = { getUserID: () => 7, sendRequest(o) { requests.push(o) } }
  const fn = new Function('app', 'isRecord', 'memberClubIds', 'markRepostable', 'return function (ctx) {' + body + '\n}')(
    app, () => true, () => ({ 3: true }), (rows) => rows)
  const page = { _feedRequestId: 1, data: { feed: [] }, setData() {} }
  fn.call(page, { requestId: 1 })
  requests[0].success({ code: 200, data: { owned: [], joined: [] } })
  fn.call(page, { requestId: 1 })
  assert.equal(requests.length, 1, '5 分钟内不重拉')
  page._memberClubsAt.at -= 5 * 60 * 1000 + 1
  fn.call(page, { requestId: 1 })
  assert.equal(requests.length, 2, '过期重拉')
})
