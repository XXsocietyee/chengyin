// 柜台核销结果面板的补充信息(只属于商家工作台,不进主包):
// P1-8 这张票有退款申请待审核 → 提示行「退款审核中」(只提醒,服务端不拦核销);
// P2-3 本次核销成功 → 副标题带脱敏玩家昵称与本店该权益剩余名额(不走名额的供给服务端不给这个字段)。
const REFUND_UNDER_REVIEW = '退款审核中';
const record = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/** response = 核销回包;result = resolveVerificationResult 的结果;view = verificationSheetView(result)。返回补充后的 view。 */
function deskReceiptView(response, result, view) {
  const out = Object.assign({}, view);
  const ok = record(response) && (response.code === 200 || response.code === '200') && record(response.data);
  if (!ok) return out;
  const d = response.data;
  if (d.refundUnderReview === true) out.meta = [REFUND_UNDER_REVIEW, out.meta].filter(Boolean).join(' · ');
  if (record(result) && result.state === 'success') {
    const player = typeof d.playerName === 'string' ? d.playerName.trim() : '';
    const remaining = Number.isInteger(d.remainingQuota) && d.remainingQuota >= 0 ? '本店剩余 ' + d.remainingQuota + ' 份' : '';
    out.sub = [out.sub, player, remaining].filter(Boolean).join(' · ');
  }
  return out;
}

module.exports = { deskReceiptView, REFUND_UNDER_REVIEW };
