// L02-182: 千分位(走路 / 计步共用一份)。步数不读成一长串编号;负数与非数字给 0,不画倒扣。
function groupThousands(value) {
  const n = Math.max(0, Math.floor(Number(value) || 0));
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
module.exports = { groupThousands };
