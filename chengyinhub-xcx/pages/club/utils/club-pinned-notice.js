/**
 * pages/club/utils/club-pinned-notice.js —— 俱乐部置顶公告(帖子 tab 顶部「公告 · 新人先看」)
 *
 * 数据来自已有的 /api/club/post/list(type=2 为公告,isPinned 为置顶),不新增接口。
 * 已读只存本机(按 clubId + 账号分桶,留最近 50 个)。L08-112:旧版 clubId 桶在本账号无记录时沿用一次。
 */
const KEY_PREFIX = 'cy_club_notice_read_'
const MAX_SHOWN = 2
const MAX_KEPT = 50

function isPinnedNotice(p) {
  return !!p && Number(p.type) === 2 && (p.isPinned === true || Number(p.isPinned) === 1)
}

// L08-112:按数字分量排序,空格与 ISO 两种格式都行(iOS 不认「2026/01/01T10:00」)
function ts(p) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(p && p.createTime || ''))
  if (!m) return 0
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
}

function storageKey(clubId, memberId) {
  return KEY_PREFIX + clubId + (memberId ? '_m' + memberId : '')
}

function loadRead(clubId, env, memberId) {
  const w = env || (typeof wx !== 'undefined' ? wx : null)
  try {
    let v = w && w.getStorageSync(storageKey(clubId, memberId))
    if ((v === undefined || v === null || v === '') && memberId) v = w.getStorageSync(storageKey(clubId))
    return Array.isArray(v) ? v.map(String) : []
  } catch (e) { return [] }
}

function markRead(clubId, postId, env, memberId) {
  const w = env || (typeof wx !== 'undefined' ? wx : null)
  if (!clubId || postId === undefined || postId === null || postId === '') return false
  const list = loadRead(clubId, env, memberId).filter((x) => x !== String(postId))
  list.push(String(postId))
  try {
    w.setStorageSync(storageKey(clubId, memberId), list.slice(-MAX_KEPT))
    return true
  } catch (e) { return false }
}

/** 取最新的 ≤2 条置顶公告,附 unread / summary(单行摘要) */
function pick(posts, clubId, env, memberId) {
  const read = loadRead(clubId, env, memberId)
  return (Array.isArray(posts) ? posts : [])
    .filter(isPinnedNotice)
    .sort((a, b) => ts(b) - ts(a))
    .slice(0, MAX_SHOWN)
    .map((p) => ({
      id: p.id,
      summary: String(p.contents || p.content || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      unread: read.indexOf(String(p.id)) < 0,
    }))
}

module.exports = { MAX_SHOWN, isPinnedNotice, loadRead, markRead, pick }
