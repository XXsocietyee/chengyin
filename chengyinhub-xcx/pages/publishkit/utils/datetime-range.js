/**
 * pages/publishkit/utils/datetime-range.js —— 「起止时刻」(带日期的区间)的纯计算层(2026-08-27)
 *
 * 为什么要有它:创建优惠券原先用 **4 个滚轮**拼一个区间
 * (开始日期 + 开始时刻 + 结束日期 + 结束时刻),分两个面板选,中间看不到对方的值,
 * 也没有任何地方显示这段有多长。
 *
 * ⚠️ 本文件**不重复**已有的两支:
 *   · 日期的闰年/跨年/首日偏移 → utils/calendar.js
 *   · 时刻的解析与跨度        → utils/timerange.js
 * 这里只做它们都没有的一件事:**把日期和时刻拼成一个时刻、再按时刻比大小**。
 *
 * 存储格式沿用券接口现有的 'YYYY-MM-DD HH:mm:ss',
 * 不新造格式 —— 换格式要动后端契约,那是另一件事。
 */

const cal = require('../../../utils/calendar.js')
const tr = require('../../../utils/timerange.js')

/**
 * calendar.parse 只认长相(\d{4}-\d{2}-\d{2}),不认日历:'2026-13-01'、'2026-02-30' 都能过。
 * 那对月历组件够用(它的日期是自己生成的),但这里的输入来自存储和后端,必须真判一次。
 */
function realDate(date) {
  const p = cal.parse(date)
  if (!p) return null
  if (p.month < 1 || p.month > 12) return null
  if (p.day < 1 || p.day > cal.monthDays(p.year, p.month)) return null
  return p
}

/** 'YYYY-MM-DD HH:mm[:ss]' → { date, time };非法返回 null。time 归一化成 'HH:mm' */
function split(value) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})(?::\d{2})?$/.exec(String(value == null ? '' : value).trim())
  if (!m) return null
  if (!realDate(m[1])) return null
  const minutes = tr.toMinutes(m[2])
  if (minutes < 0) return null
  return { date: m[1], time: tr.fromMinutes(minutes) }
}

/** 日期 + 时刻 → 'YYYY-MM-DD HH:mm:ss';任一非法返回 '' */
function join(date, time) {
  if (!realDate(date)) return ''
  const minutes = tr.toMinutes(time)
  if (minutes < 0) return ''
  return date + ' ' + tr.fromMinutes(minutes) + ':00'
}

/** 归一化成可直接按字典序比大小的 'YYYY-MM-DD HH:mm:ss';非法返回 '' */
function normalize(value) {
  const p = split(value)
  return p ? join(p.date, p.time) : ''
}

/**
 * 两个时刻相差多少分钟(end - start)。
 * ⚠️ 必须按「日期 + 时刻」一起比,不能只比时刻 ——
 * 9/1 22:00 → 9/2 02:00 是 4 小时,只看时刻会算成 -20 小时。
 * @returns 分钟数;任一非法返回 null(不是 0 —— 0 是「同一时刻」这个合法答案)
 */
function spanMinutes(start, end) {
  const a = split(start)
  const b = split(end)
  if (!a || !b) return null
  return cal.daysBetween(a.date, b.date) * 1440 + (tr.toMinutes(b.time) - tr.toMinutes(a.time))
}

/**
 * 'N 天 M 小时 K 分';不足一天退回 timerange 的 '小时/分钟' 说法。
 * ⚠️ 跨天时不把分钟抹掉:分钟是用户自己滚出来的,摘要里悄悄舍掉就是在报一个不对的数
 * (实测 8/28 22:00 → 8/31 02:30 会被说成「2 天 4 小时」,少了 30 分)。
 */
function formatSpan(minutes) {
  if (!(minutes > 0)) return ''
  const days = Math.floor(minutes / 1440)
  const rest = minutes % 1440
  if (!days) return tr.formatSpan(rest)
  return days + ' 天' + (rest ? ' ' + tr.formatSpan(rest) : '')
}

/**
 * 校验。**只判定,不修改** —— 结束不晚于开始就把真实跨度原样返回,由调用方决定文案。
 * (唯一调用方不设跨度上下限与时刻边界,原先那几支判定不可达,已删,L04-104)
 * @returns { ok, minutes, reason }  reason: 'invalid' | 'not-after'
 */
function validate(start, end) {
  const a = normalize(start)
  const b = normalize(end)
  if (!a || !b) return { ok: false, minutes: null, reason: 'invalid' }
  const minutes = spanMinutes(a, b)
  if (!(minutes > 0)) return { ok: false, minutes: minutes, reason: 'not-after' }
  return { ok: true, minutes: minutes, reason: '' }
}

module.exports = {
  split,
  join,
  spanMinutes,
  formatSpan,
  validate,
}
