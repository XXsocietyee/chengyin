'use strict'
/* l-after(2026-11-10)游戏主题库的数据口(业主批准 proto/game ps-library):
 * 列表读现有的公开目录 POST /api/public-catalog/list(真实接口,城市定向 / 自由探索按 product_type 1 / 2 筛)。
 * 「¥0 可玩」只在服务端给了通行证覆盖事实时出(行上的 passCovered === true,由 l-pass 的通行证接口补);
 * 没有这个事实就不画价签,不把未知写成 0。换接口时只改这一个文件。
 * L09-097
 * 原 public-catalog.js 只剩这里用到的查询参数与读回两段,并入本文件;城市合集页那套卡片/筛选/分享/详情已随页面下线(F14c)。 */

function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v) }
function num(v) {
  if (v == null || v === '' || typeof v === 'boolean') return NaN
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

const KINDS = [
  { key: 'all', label: '全部', productType: '' },
  { key: 'city', label: '城市定向', productType: '1' },
  { key: 'free', label: '自由探索', productType: '2' }
]
const PAGE_SIZE = 100 // 主题库一次读满一页,只有这一个调用方

function kindByKey(key) { return KINDS.find((k) => k.key === key) || KINDS[0] }

function query(kindKey, pageNum) {
  const k = kindByKey(kindKey)
  const selected = k.productType ? { product_type: k.productType } : {}
  const q = { locale: 'zh-CN', sort: 'NEWEST' }
  if (selected.product_type) q.product_type = String(selected.product_type)
  q.pageNum = pageNum > 0 ? pageNum : 1
  q.pageSize = PAGE_SIZE
  return q
}

// 列表读回:{code,data:{rows,total}}
function readPage(response) {
  if (!response || response.code != 200 || !isRecord(response.data) || !Array.isArray(response.data.rows)) return null
  const total = num(response.data.total)
  return { rows: response.data.rows, total: total >= 0 ? total : null }
}

// 通行证覆盖:只认服务端明确的 true;其余(缺字段 / false / 字符串)都不出价签
function coveredByPass(row) {
  return !!row && typeof row === 'object' && row.passCovered === true
}

function minutesText(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n <= 0) return ''
  return '约 ' + Math.max(1, Math.round(n / 60)) + ' 分钟'
}

/* 保留现有卡片布局,读取公开目录逐主题的 passCovered；响应级持有状态不能代替主题覆盖。 */
function passLibraryCard(row) {
  if (!row || typeof row !== 'object' || row.id == null || row.id === '' || !row.name) return null
  const pt = Number(row.productType)
  const kind = pt === 1 ? '城市定向' : (pt === 2 ? '自由探索' : '')
  const city = row.cityName ? String(row.cityName) : ''
  return {
    id: String(row.id),
    title: String(row.name),
    cover: row.imgUrl || '',
    city,
    kind,
    data: [kind, minutesText(row.totalTime)].filter(Boolean).join(' · '),
    free: coveredByPass(row),
    tags: [kind, city].filter(Boolean)
  }
}
function passLibraryList(rows) {
  return (Array.isArray(rows) ? rows : []).map(passLibraryCard).filter(Boolean)
}

module.exports = { KINDS, PAGE_SIZE, kindByKey, query, coveredByPass, passLibraryCard, passLibraryList, readPage }
