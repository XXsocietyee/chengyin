const { chinaParts } = require('../../../utils/datetime.js')
const { passWindow } = require('./topic-motion.js')

/**
 * P-30(2026-11-02 第三轮):场次卡写「场次」自己的时间(cms_activity 开始–结束),不写主题票的售卖窗口。
 * 按开始时间升序;同日压成「MM-DD HH:mm–HH:mm」,跨日两端全写;最多三场,其余写「等 N 场」。
 * 一场都读不出时间时返回空串,调用方保留原来的票时间。
 */
function sessionWindowsText(activities) {
  const pad = (n) => (n < 10 ? '0' + n : '' + n)
  const rows = (Array.isArray(activities) ? activities : [])
    .map((a) => ({ s: chinaParts(a && a.startDate), e: chinaParts(a && a.endDate) }))
    .filter((r) => r.s)
    .sort((a, b) => (a.s.year - b.s.year) || (a.s.month - b.s.month) || (a.s.day - b.s.day)
      || (a.s.hours - b.s.hours) || (a.s.minutes - b.s.minutes))
  if (!rows.length) return ''
  const day = (p) => pad(p.month) + '-' + pad(p.day)
  const clock = (p) => pad(p.hours) + ':' + pad(p.minutes)
  const one = (r) => {
    const head = day(r.s) + ' ' + clock(r.s)
    if (!r.e) return head
    return day(r.e) === day(r.s) && r.e.year === r.s.year
      ? head + '–' + clock(r.e)
      : head + ' ~ ' + day(r.e) + ' ' + clock(r.e)
  }
  const shown = rows.slice(0, 3).map(one).join(' / ')
  return rows.length > 3 ? shown + ' 等 ' + rows.length + ' 场' : shown
}

function positiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/* 稿 214:384(玩家深色)/ 181:575(商家浅色)封面下面那条**数据条**。
   两端是同一块,只换色板 —— 所以格子必须同一份,不能两页各算各的。
   稿上的五格:评价 / 预计游玩 / 开放时间 / 总里程 / 参与商家。
   ⚠️ 2026-09-10 之前玩家页走的是另一套格子(章节 / 预计用时 / 总里程 / 参与玩家),
      与稿和商家页都对不上:同一条路线,两个身份看到的关键数字不是同一套。
   每格「有就出、没有就整格不出」——「—」占位会让一条真空数据条看着像有内容。 */
/* 有效期天数:与购买弹窗同一个数 —— 都由 topic-motion.passWindow 按北京时间日历天算 */
function validDays(data, now) {
  return Number(passWindow({ topicEnd: data && data.endDate, now: now }).daysText) || 0
}

/* opts.withPlayers(V-23 玩家详情页):城市定向在总里程之后也出「已参加」。
   2026-11-21 业主「不要假 0」:任何格的值为 0 / 空都整格不出,两端同一口径。 */
function buildTopicStatBar(info, opts) {
  const data = info || {}
  const withPlayers = !!(opts && opts.withPlayers)
  const cells = []

  const rating = positiveNumber(data.averageRating)
  if (rating) {
    cells.push({
      key: 'rating', label: '评价',
      // 稿写的是 4.8,不是 5 —— 星星取整,评分本身不取整
      value: String(Math.round(rating * 10) / 10),
      // 数组不是数字:wx:for 只遍历数组,给个 count 会静默什么都不渲染
      starList: Array.from({ length: Math.max(0, Math.min(5, Math.round(rating))) }, (v, i) => i),
    })
  }

  /* v13(业主 2026-10-22):自由探索没有路线与时长,数据条讲有效期 / 参与商家 / 路线不限 / 已参加 */
  if (Number(data.productType) === 2) {
    const days = validDays(data)
    if (days) cells.push({ key: 'valid', label: '有效期', value: String(days), sub: '天' })
    const shops = Math.floor(positiveNumber(data.registrationMerchantCount))
    if (shops) cells.push({ key: 'merchant', label: '参与商家', value: String(shops), sub: '家' })
    cells.push({ key: 'route', label: '路线', value: '不限', sub: '任意顺序' })
    const players = Math.floor(positiveNumber(data.playerCount))
    if (players) cells.push({ key: 'players', label: '已参加', value: players.toLocaleString('en-US'), sub: '人' })
    return cells
  }

  const hours = positiveNumber(data.totalTime) / 3600
  if (hours >= 0.1) {
    const rounded = hours % 1 === 0 ? hours : Math.round(hours * 10) / 10
    cells.push({ key: 'hour', label: '预计游玩', value: rounded + '+', sub: '小时' })
  }

  const start = String(data.showStartDate || '').trim()
  const end = String(data.showEndDate || '').trim()
  /* CU-M-88:这一格的值是**起止日期区间**(7.4-7.29),副标签原来固定写「总时长」,
     把一段日期说成了时长 —— 而真正的时长是上一格「预计游玩 · 小时」,两格语义撞车。
     日期区间不需要副标签,删掉它(wxml 的 wx:elif 缺 sub 时整行不出)。 */
  if (start && end) cells.push({ key: 'open', label: '开放时间', value: start + '-\u200b' + end })   // x-fix2 P-12:窄格里只在连字符后折行,不把「10.13」劈成「10. / 13」

  const mileage = positiveNumber(data.totalMileage)
  if (mileage) cells.push({ key: 'mileage', label: '总里程', value: String(mileage), sub: '公里' })

  const merchants = Math.floor(positiveNumber(data.registrationMerchantCount))
  if (merchants) cells.push({ key: 'merchant', label: '参与商家', value: String(merchants), sub: '家' })

  if (withPlayers) {
    const players = Math.floor(positiveNumber(data.playerCount))
    if (players) cells.push({ key: 'players', label: '已参加', value: players.toLocaleString('en-US'), sub: '人' })
  }

  return cells
}

/* L06-091/068:主题页与商家页原来各有一份(时长文案已漂成「2时30分」与「2小时30分钟」),统一在这里 */
function buildContentIncludes(data) {
  const d = data || {};
  const out = [];
  const chapters = Number(d.totalChapterCount);
  if (Number.isFinite(chapters) && chapters > 0) out.push(chapters + ' 个章节');
  // 服务端实时整条路线总站点数（含未解锁节点的数量）；chaptersList 只是当前可见子集。
  // 0 是权威值，不能用可见节点数覆盖，也不能从子集推测缺失的总数。
  // 首章试看、分支 teaser 与商家单站承接都可能返回少于总数的节点。
  // 总数只是数量，不授予读取未揭示节点、模板或路线的权限。
  // 缺失值不生成站点条目；章节局部节点标签继续反映各自可见内容。
  const stations = Number(d.locationCount);
  if (Number.isFinite(stations) && stations > 0) out.push(stations + ' 个节点');
  const plays = Number(d.templateCount);
  if (Number.isFinite(plays) && plays > 0) out.push(plays + ' 个玩法');
  if (d.audioUrl) {
    const mins = Math.round(Number(d.audioDuration) / 60);
    out.push(Number.isFinite(mins) && mins > 0 ? ('语音导览 ' + mins + ' 分钟') : '语音导览');
  }
  // 勋章名可以为空(后端默认「主题名 · 通关」),所以判据是**有没有配**,不是名字非空
  if (d.finishMedalName || d.finishMedalImg) {
    out.push('通关勋章：' + (d.finishMedalName || (d.name ? d.name + ' · 通关' : '通关纪念')));
  }
  // 只知道配了券、拿不到券名(TopicInfoVO 没有这个字段)—— 就只说配了,不编一个名字
  if (d.completeRewardCouponId) out.push('通关后可领一张优惠券');
  return out;
}

/* 秒数 → 「2小时30分钟」「45分钟」「小于1分钟」;空或非法为空串 */
function durationText(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return ''
  const sec = Number(seconds)
  if (isNaN(sec) || sec < 0) return ''
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  if (hours === 0) return minutes === 0 ? '小于1分钟' : minutes + '分钟'
  return minutes === 0 ? hours + '小时' : hours + '小时' + minutes + '分钟'
}

module.exports = { buildTopicStatBar, sessionWindowsText, buildContentIncludes, durationText }
