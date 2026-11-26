'use strict'
// L05-105:漫游分包内几处各抄一份的小工具,收成一处。
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
function nonNegativeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}
/** 接口给的毫秒有效期 → 倒计时秒数;不足 1 秒或不是数字都算 0 */
function ttlSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 ? Math.floor(value / 1000) : 0
}
/** 空 / 非数字 → null;其余转数字 */
function num(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** 去空白;后端偶发的字面 'null' 当空 */
function text(v) {
  if (v == null) return ''
  const s = String(v).trim()
  return s === 'null' ? '' : s
}
module.exports = { WEEK, nonNegativeNumber, ttlSeconds, num, text }
