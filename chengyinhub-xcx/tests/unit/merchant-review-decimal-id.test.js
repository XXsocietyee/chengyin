const test = require('node:test');
const assert = require('node:assert/strict');
const { decimalId: positiveId, positiveId: legacyPositiveId, parseReviewRouteOptions, shapePage } = require('../../pages/merchant/reviews/view-model');
test('decimal Long boundary, safe-number compatibility and invalid input rejection', () => {
  for (const id of ['1', '9007199254740991', '9007199254740992', '9007199254740993', '9223372036854775807']) {
    assert.equal(positiveId(id), id); assert.equal(parseReviewRouteOptions({ merchantRowId: id }).merchantRowId, id);
  }
  assert.equal(positiveId(7), '7');
  for (const id of [9007199254740992, 9223372036854775807, '9223372036854775808', '0', '-1', '01', '1e3', ' 7 ', {}, true, null]) assert.equal(positiveId(id), null);
});
test('legacy shared finance and registration parser retains previous numeric contract', () => {
  assert.equal(legacyPositiveId('1'), 1); assert.equal(legacyPositiveId(' 02 '), 2);
  assert.equal(legacyPositiveId('9007199254740993'), null);
});
test('list rejects already-rounded numeric IDs and accepts exact strings', () => {
  const payload = id => ({ mode: 'manage', pageNum: 1, pageSize: 20, total: 1, hasMore: false,
    items: [{ id, version: 1, rating: 5, imageUrls: [], status: 'VISIBLE', verifiedRedemption: true, canReply: true, canReport: true }] });
  assert.equal(shapePage(payload(9007199254740992), 'manage'), null);
  assert.equal(shapePage(payload('9223372036854775808'), 'manage'), null);
  assert.equal(shapePage(payload('9007199254740993'), 'manage').items[0].id, '9007199254740993');
});

// L07-081/144:资金工具不再为一个 id 判据去引评价页 view-model;评价页只用 decimalId,不再起别名
test('merchant-finance 依赖在文件头且不引评价 view-model;评价页不再把 decimalId 叫成 positiveId', () => {
  const fs = require('node:fs')
  const p = require('node:path')
  const finance = fs.readFileSync(p.resolve(__dirname, '../../pages/merchant/utils/merchant-finance.js'), 'utf8')
  assert.doesNotMatch(finance, /reviews\/view-model/)
  assert.ok(finance.indexOf("require('../../../utils/response-shape.js')") < finance.indexOf('module.exports'))
  const page = fs.readFileSync(p.resolve(__dirname, '../../pages/merchant/reviews/index.js'), 'utf8')
  assert.doesNotMatch(page, /decimalId: positiveId|\bpositiveId\(/)
})
