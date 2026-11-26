const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveVerificationResult, completionReceiptMessage, classifyVerificationOutcome } = require('../../utils/merchant-verification');

test('首次核销显示成功结果', () => {
  assert.deepEqual(resolveVerificationResult({ code: 200, msg: '核销成功' }, '核销'), {
    state: 'success',
    title: '核销成功',
    message: '核销成功',
    show: true
  });
});

test('优惠券和订单的结构化重复标记都显示重复核销', () => {
  assert.equal(resolveVerificationResult({
    code: 200,
    msg: '该优惠券已核销',
    data: { alreadyUsed: true }
  }, '核销').state, 'duplicate');
  assert.equal(resolveVerificationResult({
    code: 500,
    msg: '该订单已核销',
    data: { alreadyVerified: true }
  }, '验票').state, 'duplicate');
});

test('非重复业务错误显示失败，并保留服务端原因', () => {
  assert.deepEqual(resolveVerificationResult({ code: 500, msg: '二维码已过期' }, '验票'), {
    state: 'failure',
    title: '验票失败',
    message: '二维码已过期',
    show: true
  });
});

test('通关探索值回执只在 earnedXp>0 的首次响应展示', () => {
  assert.equal(resolveVerificationResult({
    code: 200,
    msg: '核销成功',
    data: { completionEarnedXp: 36 }
  }, '核销').message, '核销成功 · 玩家通关 +36 探索值已到账');

  assert.equal(resolveVerificationResult({
    code: 200,
    msg: '核销成功',
    data: { completionEarnedXp: 0 }
  }, '核销').message, '核销成功', '幂等重放不得再次展示奖励');
  assert.equal(completionReceiptMessage({
    code: 200, msg: '核销成功', data: { completionEarnedXp: 36 }
  }, '核销成功'), '核销成功 · 玩家通关 +36 探索值已到账', 'profile toast 复用同一回执口径');
});

test('结构化回执按结构判定，不要求固定文案；裸 200 与无证明的 500 仍待确认', () => {
  const group = { url: '/api/verify/groupcode/redeem', data: { code: 'v1.2.group_v2_3_4.9.1.sig' } };
  const groupData = alreadyVerified => ({ topicId: 2, activityId: 3, leaderMemberId: 4, coopOrderId: 5, alreadyVerified });
  const classify = (response, request) => classifyVerificationOutcome(response, 'success', 200, request).status;
  assert.equal(classify({ code: 200, data: groupData(false) }, group), 'success');
  assert.equal(classify({ code: 200, msg: '别的句子', data: groupData(true) }, group), 'success');
  assert.equal(classify({ code: 200, msg: '核销成功' }, group), 'unknown');
  assert.equal(classify({ code: 200, data: { ...groupData(false), topicId: 9 } }, group), 'unknown');

  const coupon = { url: '/api/coupon/verification', data: { code: 'coupon' } };
  assert.equal(classify({ code: 200, data: { alreadyUsed: true } }, coupon), 'success');
  assert.equal(classify({ code: 200, msg: '核销成功' }, coupon), 'success');
  assert.equal(classify({ code: 200, msg: '核销成功', data: { useTime: 1 } }, coupon), 'unknown');
  assert.equal(classify({ code: 200 }, coupon), 'unknown');

  const chapter = { url: '/api/registration/scan_qr_code_chapter', data: { chapterId: 4 } };
  assert.equal(classify({ code: 200, data: { chapterId: 4, redemptionId: 5 } }, chapter), 'success');
  assert.equal(classify({ code: 200, msg: '核销成功', data: {} }, chapter), 'unknown');

  const ticket = { url: '/api/registration/scan_qr_code', data: { code: 'ticket' } };
  assert.equal(classify({ code: 200, msg: '核销成功', data: null }, ticket), 'success');
  assert.equal(classify({ code: 200 }, ticket), 'unknown');
  assert.equal(classify({ code: 200, data: { alreadyVerified: true } }, ticket), 'unknown');
  assert.equal(classifyVerificationOutcome({ code: 500, data: { alreadyVerified: true } }, 'success', undefined, ticket).status, 'failed');
  assert.equal(classifyVerificationOutcome({ code: 500, msg: '请选择要核销的章节', data: { needChapterChoice: true, chapters: [{ id: 4 }] } }, 'success', undefined, ticket).status, 'failed');
  assert.equal(classifyVerificationOutcome({ code: 500, msg: '已过期', data: { notRedeemed: true } }, 'success', undefined, ticket).status, 'failed');
  assert.equal(classifyVerificationOutcome({ code: 500, msg: '发分失败' }, 'success', undefined, ticket).status, 'unknown');
  assert.equal(classifyVerificationOutcome({ code: 500, data: { alreadyVerified: 'true' } }, 'success', undefined, ticket).status, 'unknown');
  assert.equal(classify({ code: 200, msg: '已经核销', data: null }, ticket), 'success');
  assert.equal(classify({ code: 200, msg: '核销失败', data: null }, ticket), 'success');
  assert.equal(classify({ code: 500, msg: '核销成功' }, ticket), 'unknown');
  assert.equal(classify({ code: 200, msg: '已经核销', errorCode: 'VERIFIED', data: null }, ticket), 'success');
  assert.equal(classify({ code: 200, errorCode: 'VERIFIED', data: null }, ticket), 'success');
  assert.equal(classify({ code: 200, msg: '核销成功', errorCode: 'NEW_MACHINE_CODE' }, ticket), 'unknown');
  assert.equal(classify({ code: 200, msg: '核销成功', errorCode: 'NOT_REDEEMED' }, ticket), 'unknown');
  assert.equal(classify({ code: 500, msg: '核销成功', errorCode: 'VERIFIED', data: { notRedeemed: true } }, ticket), 'unknown');
  assert.equal(classifyVerificationOutcome({ code: 500, msg: '别的原因', errorCode: 'NOT_REDEEMED', data: { notRedeemed: true } }, 'success', undefined, ticket).status, 'failed');
  assert.equal(classifyVerificationOutcome({
    code: 200, data: { chapterId: 4, redemptionId: 5 }, errorCode: 'NEW_MACHINE_CODE'
  }, 'success', 200, chapter).status, 'unknown');
  assert.equal(resolveVerificationResult({ code: 200, msg: '核销成功', errorCode: 'NEW_MACHINE_CODE' }).state, 'unknown');
  assert.equal(resolveVerificationResult({ code: 200, msg: '核销失败', errorCode: 'NOT_REDEEMED' }).state, 'unknown');
  assert.equal(resolveVerificationResult({ code: 201, msg: '核销成功' }).state, 'unknown');
});

test('章节重放只展示原回执，严格布尔标记且不重复展示奖励', () => {
  const replay = {code: 200, msg: '核销成功', data: {replayed: true, redemptionId: 66, completionEarnedXp: 36}};
  assert.deepEqual(resolveVerificationResult(replay), {state: 'duplicate', title: '已核销', message: '该章节已核销，请勿重复提供权益', show: true});
  assert.equal(completionReceiptMessage(replay, '核销成功'), '该章节已核销，请勿重复提供权益');
  assert.equal(resolveVerificationResult({code: 500, msg: '已退款', data: {replayed: true}}).state, 'failure');
  assert.equal(resolveVerificationResult({code: 200, data: {replayed: 'true'}}).state, 'success');
});
