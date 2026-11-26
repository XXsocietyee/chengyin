// L07-170:旧台账视图(订单筛选/期间标题/结算色调等)已无调用方,只留结算去向文案这一个被
// pages/coop/components/settlement-detail/view-model.js 使用的函数。
function resolveSettlementPayee(payeeType) {
  const type = payeeType == null ? '' : String(payeeType).trim().toLowerCase();
  if (type === 'club') return '俱乐部分润';
  if (type === '' || type === 'merchant') return '商家分润';
  return '';
}

module.exports = { resolveSettlementPayee };
