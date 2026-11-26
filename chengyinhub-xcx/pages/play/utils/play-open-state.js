/**
 * 营业态换算的单一真源:businessTime / openStatus → 展示用 openText / openState。
 *
 * 为什么抽出来:2026-08-14 自审实证——`normNode()` 产出的是 `businessTime` 和
 * `openStatus`,**从来不产 `openText`**;而 poiCard(index.js:470)、mode2 六宫格瓦片
 * 和新的商家权益页都在读 `n.openText || ''`,于是那几处营业信息**永久不显示**。
 * 真正的换算逻辑当时只长在 `openSheet()` 内部,别的调用方拿不到 ⇒ 抄一份就多一处会漂的副本。
 *
 * 规则(与原 openSheet 内联逻辑逐条一致,行为不变):
 *   1. 后端三态 `openStatus`(营业中/即将打烊/已打烊)优先;
 *   2. 后端没给,用 `businessTime` 走客户端两态兜底;
 *   3. 都解析不出 ⇒ openText 为空,调用方据此整行不渲染(不编「营业时间未知」)。
 */
const geo = require('../../../utils/geo.js');
const { chinaParts } = require('../../../utils/datetime.js');

// 只出状态记号(L02-085):open 营业中 / soon 即将打烊 / off 已打烊;'' = 不显示。
// 颜色由 pages/play/index.wxss 的 .od--* / .od-text--* 给,JS 不再拼 CSS 值。

/**
 * @param {object} node 至少含 businessTime / openStatus
 * @param {number} [nowMinutes] 当天分钟数;不传取当前时刻(便于测试注入固定时刻)
 * @returns {{openText: string, openState: ''|'open'|'soon'|'off'}} openText 为空表示「不显示这一行」
 */
function resolveOpenState(node, nowMinutes) {
  if (!node) return { openText: '', openState: '' };
  const status = node.openStatus;
  if (status) {
    if (status === '营业中') return { openText: status, openState: 'open' };
    if (status === '即将打烊') return { openText: status, openState: 'soon' };
    return { openText: status, openState: 'off' };
  }
  // 全天开放(街面点位、纪念碑这类)没有「营业」可言,挂「营业中」反而像一家店(实走 A32)
  if (/^\s*0?0:00\s*[-~—–至]\s*(23:59|24:00)\s*$/.test(String(node.businessTime || ''))) return { openText: '', openState: '' };
  const minutes = typeof nowMinutes === 'number'
    ? nowMinutes
    : (function () { const d = chinaParts(Date.now()); return d.hours * 60 + d.minutes; }());
  const inWindow = geo.bizWindowState(node.businessTime, minutes);
  if (inWindow === true) return { openText: '营业中', openState: 'open' };
  if (inWindow === false) return { openText: '已打烊', openState: 'off' };
  // null:businessTime 解析不出 —— 保持空,让调用方整行不渲染
  return { openText: '', openState: '' };
}

module.exports = { resolveOpenState };
