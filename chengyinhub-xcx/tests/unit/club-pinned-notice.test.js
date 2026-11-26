const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const n = require('../../pages/club/utils/club-pinned-notice.js')

const mem = () => { const m = {}; return { getStorageSync: (k) => m[k], setStorageSync: (k, v) => { m[k] = v } } }
const post = (id, type, pinned, t) => ({ id, type, isPinned: pinned, createTime: t, contents: '内容' + id })

test('只挑置顶公告,按时间倒序,最多 2 条', () => {
  const posts = [
    post(1, 2, 1, '2026-10-01 10:00:00'), post(2, 2, 1, '2026-10-03 10:00:00'),
    post(3, 2, 1, '2026-10-02 10:00:00'), post(4, 0, 1, '2026-10-09 10:00:00'), post(5, 2, 0, '2026-10-09 10:00:00'),
  ]
  assert.deepEqual(n.pick(posts, 'c1', mem()).map((x) => x.id), [2, 3])
  assert.deepEqual(n.pick(null, 'c1', mem()), [])
})

test('已读按俱乐部本地保存,pick 反映 unread', () => {
  const env = mem()
  const posts = [post(7, 2, true, '2026-10-01 10:00:00')]
  assert.equal(n.pick(posts, 'c1', env)[0].unread, true)
  assert.equal(n.markRead('c1', 7, env), true)
  assert.equal(n.pick(posts, 'c1', env)[0].unread, false)
  assert.equal(n.pick(posts, 'c2', env)[0].unread, true)
})

test('markRead 只留最近 50 个;storage 抛错不崩', () => {
  const env = mem()
  for (let i = 0; i < 60; i++) n.markRead('c', i, env)
  assert.equal(n.loadRead('c', env).length, 50)
  const bad = { getStorageSync() { throw new Error('x') }, setStorageSync() { throw new Error('x') } }
  assert.deepEqual(n.loadRead('c', bad), [])
  assert.equal(n.markRead('c', 1, bad), false)
})

test('页面接入:帖子 tab 顶部挂公告块,loadPosts(接口)与已读后刷新', () => {
  const root = path.join(__dirname, '../..')
  const wxml = fs.readFileSync(path.join(root, 'pages/club/detail/index.wxml'), 'utf8')
  assert.ok(wxml.indexOf("activeTab === 'posts'") < wxml.indexOf('cy-club-pinned-notice'))
  assert.ok(wxml.indexOf('cy-club-pinned-notice') < wxml.indexOf('post-composer-collapsed'))
  const js = fs.readFileSync(path.join(root, 'pages/club/detail/index.js'), 'utf8')
  assert.equal((js.match(/pinnedNotices: clubPinnedNotice\.pick/g) || []).length, 3) // 接口 + 已读后刷新 + 置顶就地更新(PG-023 演示分支已删)
})

// AUDIT-1122 L08-112
test('L08-112 同机换账号各看各的已读;旧版只按俱乐部存的已读首次沿用', () => {
  const env = mem()
  const posts = [post(7, 2, 1, '2026-01-01 10:00:00')]
  env.setStorageSync('cy_club_notice_read_c1', ['7'])
  assert.equal(n.pick(posts, 'c1', env, '101')[0].unread, false, '升级后不把已读清空')
  n.markRead('c1', 7, env, '101')
  const fresh = mem()
  n.markRead('c1', 7, fresh, 'A')
  assert.equal(n.pick(posts, 'c1', fresh, 'A')[0].unread, false)
  assert.equal(n.pick(posts, 'c1', fresh, 'B')[0].unread, true, 'B 看不到 A 的已读')
})

test('L08-112 ISO 与空格两种时间格式都能排序,不依赖 Date.parse 认斜杠 T', () => {
  const picked = n.pick([
    post(1, 2, 1, '2026-01-01T09:00:00'),
    post(2, 2, 1, '2026-01-02 08:00:00'),
    post(3, 2, 1, '2026-01-01T23:59:59'),
  ], 'c', mem())
  assert.deepEqual(picked.map((p) => p.id), [2, 3])
})
