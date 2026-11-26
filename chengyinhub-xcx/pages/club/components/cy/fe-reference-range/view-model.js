// P1-10 自由探索参考结算的日期范围与导出(线下对账用)。本文件在 pages/merchant 与 pages/club 两个分包各有一份,
// 内容逐字相同(tests/unit/fe-reference-range.test.js 钉住),不放主包。
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function day(value) { return typeof value === 'string' && DAY.test(value) ? value : ''; }

/** 列表与导出共用的查询参数;起止颠倒时按先后对调,不发一个必被服务端拒绝的请求。 */
function rangeQuery(from, to) {
  let start = day(from);
  let end = day(to);
  if (start && end && start > end) { const swap = start; start = end; end = swap; }
  return Object.assign({}, start ? { from: start } : {}, end ? { to: end } : {});
}

/** 导出回包 {fileName, content} → 可落盘的文件;不合合同返回 null(不写出一份来路不明的文件)。 */
function exportFile(response) {
  if (!response || ![200, '200'].includes(response.code) || !response.data || typeof response.data !== 'object') return null;
  const fileName = response.data.fileName;
  const content = response.data.content;
  if (typeof fileName !== 'string' || !/^[A-Za-z0-9_-]{1,80}\.csv$/.test(fileName)
      || typeof content !== 'string' || !content) return null;
  return { fileName, content };
}

module.exports = { rangeQuery, exportFile };
