// L07-134/135:账本两张详情页共用的收尾与失败判据
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const load = require('../../pages/merchant/utils/finance-detail-load.js')

test('记录不存在：先认 404,再认服务端原话;其它错误不算', () => {
  assert.equal(load.isMissingRecordResponse({ code: 404, msg: 'Not Found' }), true)
  assert.equal(load.isMissingRecordResponse({ statusCode: 404 }), true)
  assert.equal(load.isMissingRecordResponse({ code: 500, msg: '记录不存在' }), true)
  assert.equal(load.isMissingRecordResponse({ code: 500, msg: '服务繁忙' }), false)
  assert.equal(load.isMissingRecordResponse(null), false)
})

test('settleLoad 只让当前一轮收尾并收起下拉', () => {
  let stopped = 0
  const api = { stopPullDownRefresh() { stopped += 1 } }
  const page = { _loadEpoch: 2, _loading: true }
  assert.equal(load.settleLoad(page, 1, api), false)
  assert.equal(page._loading, true)
  assert.equal(load.settleLoad(page, 2, api), true)
  assert.equal(page._loading, false)
  assert.equal(stopped, 1)
})

test('两张详情页不再各自定义这些判据', () => {
  for (const rel of ['order-detail/index.js', 'batch-detail/index.js']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/ledger', rel), 'utf8')
    assert.doesNotMatch(src, /^function (stopPullDownRefresh|settleLoad|isTransportFailure|isMissingRecordResponse|hasValue)\(/m, rel)
  }
})
