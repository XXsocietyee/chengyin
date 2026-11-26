'use strict'
// 金额显示的唯一入口(打磨第 3 轮 §4-9 / §4-20;2026-11-22 业主定稿一位小数):
//   · 一位小数:29.9 → ¥29.9,39 → ¥39.0,1200 → ¥1200.0
//   · 第二位小数非零时保留两位,绝不显示错金额:0.01 → ¥0.01,12.35 → ¥12.35
//   · 负数写成「−¥15.44」(U+2212 减号在 ¥ 前),不再出现「¥-15.44」
//   · signed:正数带「+」(收入明细行用),零不带符号
// 取代旧的「一律两位小数」与 OR-046「不补零」两条口径(复核 OR-021)。只改显示,不改存储与计算。
// 读不出数字返回 null,由调用方决定显示「待定」「—」还是不显示。

const MINUS = '−'

function amount(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// 两位小数的数字串(保留负号),给需要原值的地方(排序、颜色判断、提交)
function fixed2(value) {
  const n = amount(value)
  return n === null ? null : n.toFixed(2)
}

// 显示用数字串(不带 ¥,保留负号 '-'):一位小数,第二位非零才两位
function decimalText(value) {
  const n = amount(value)
  if (n === null) return null
  const cents = Math.round(Math.abs(n) * 100)
  if (cents === 0) return '0.0'
  const abs = cents % 10 === 0 ? (cents / 100).toFixed(1) : (cents / 100).toFixed(2)
  return (n < 0 ? '-' : '') + abs
}

function yuan(value, options) {
  const text = decimalText(value)
  if (text === null) return null
  if (text === '0.0') return '¥0.0'
  if (text.charAt(0) === '-') return MINUS + '¥' + text.slice(1)
  return (options && options.signed ? '+' : '') + '¥' + text
}

// 旧 OR-046「不补零」入口,已被 2026-11-22 一位小数口径取代;保留名字给既有调用方,输出同 yuan。
function yuanTrim(value) {
  return yuan(value)
}

module.exports = { MINUS, amount, fixed2, decimalText, yuan, yuanTrim }
