// P1-8 退款审核中提醒、P2-3 核销成功页的脱敏昵称与本店剩余名额。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveVerificationResult, verificationSheetView, classifyVerificationOutcome } = require('../../utils/merchant-verification.js');
const { deskReceiptView, REFUND_UNDER_REVIEW } = require('../../pages/merchant/utils/desk-receipt.js');

const receipt = (patch, msg) => ({ code: 200, msg: msg || '核销成功', data: Object.assign({ redemptionId: 9, chapterId: 5, chapterName: '第1章 咖啡' }, patch) });
const sheet = (response) => {
  const result = resolveVerificationResult(response, '验票');
  return deskReceiptView(response, result, verificationSheetView(result));
};

test('成功页显示脱敏昵称与本店剩余名额;没有这两个字段时与原来逐字一致', () => {
  assert.deepEqual(sheet(receipt({ perkName: '美式一杯', playerName: '小*', remainingQuota: 4 })),
    { kind: 'success', sub: '第1章 咖啡 · 小* · 本店剩余 4 份', pill: '请提供：美式一杯', meta: '', why: '' });
  assert.equal(sheet(receipt({ remainingQuota: 0 })).sub, '第1章 咖啡 · 本店剩余 0 份');
  assert.deepEqual(sheet(receipt({ perkName: '美式一杯' })), { kind: 'success', sub: '第1章 咖啡', pill: '请提供：美式一杯', meta: '', why: '' });
});

test('不限名额或字段不可信时不显示剩余名额,不编数字', () => {
  for (const remainingQuota of [null, undefined, -1, 1.5, '3']) {
    assert.equal(sheet(receipt({ remainingQuota })).sub, '第1章 咖啡');
  }
  assert.equal(sheet(receipt({ playerName: '  ' })).sub, '第1章 咖啡');
});

test('退款审核中:成功与重放回执都在提示行给出提醒,且排在他日场次提醒之前;false 不显示', () => {
  assert.equal(REFUND_UNDER_REVIEW, '退款审核中');
  assert.equal(sheet(receipt({ refundUnderReview: true })).meta, '退款审核中');
  assert.equal(sheet(receipt({ refundUnderReview: true, sessionNotToday: true, sessionDate: '11月12日' })).meta,
    '退款审核中 · 这张票是 11月12日 的场次');
  assert.equal(sheet(receipt({ refundUnderReview: false })).meta, '');
  const replay = sheet(receipt({ replayed: true, refundUnderReview: true, playerName: '小*', remainingQuota: 3 }, '该章节已核销，请勿重复提供权益'));
  assert.equal(replay.kind, 'fail');
  assert.equal(replay.meta, '退款审核中');
  assert.equal(replay.sub, '第1章 咖啡', '重放不是本次核销,不重复摆昵称与名额');
});

test('回执多了这几个字段仍被写闸认作成功;选章预览带提醒字段仍是「未核销、待选章」', () => {
  const request = { url: '/api/registration/scan_dynamic_code', data: { code: 'v1.9.activity.1.2.sig' } };
  assert.equal(classifyVerificationOutcome(receipt({ refundUnderReview: true, playerName: '小*', remainingQuota: 4 }), 'success', 200, request).status, 'success');
  const choice = { code: 500, msg: '请选择要核销的章节', data: { needChapterChoice: true, chapterIds: [5, 6],
    chapters: [{ id: 5, name: 'A' }, { id: 6, name: 'B' }], refundUnderReview: true } };
  assert.equal(classifyVerificationOutcome(choice, 'success', 200, request).status, 'failed');
});

test('未核销 / 待确认的回包不加任何补充;工作台结果面板走这层补充', () => {
  const rejected = { code: 500, msg: '核销码无效', data: { notRedeemed: true, refundUnderReview: true, playerName: '小*' } };
  const result = resolveVerificationResult(rejected, '验票');
  assert.deepEqual(deskReceiptView(rejected, result, verificationSheetView(result)), verificationSheetView(result));
  const js = fs.readFileSync(path.join(__dirname, '../../pages/merchant/index/index.js'), 'utf8');
  assert.match(js, /Object\.assign\(result, deskReceiptView\(response, result, verificationSheetView\(result\)\)\)/);
});
