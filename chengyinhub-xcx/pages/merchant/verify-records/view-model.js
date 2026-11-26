// 商家核销记录(只读)。M-03(2026-11-02 走查):与「核销与退款」同一真源
// POST /api/merchant/finance/redemptions(redemption 行,按商家归属取),不再读玩家节点作答的
// cms_registration_scan —— 那张表的 status 不是核销事实,5 笔真核销曾显示成「已核销 0 · 未核销 10」。
// 行字段只用 MerchantRedemptionView 已有的:recordKey / recordId / chapterName / topicName / storeName /
// fulfillmentState(ACTIVE|REVERSED) / occurredAt。
const { chinaParts } = require('../../../utils/datetime');

const STATUS_TABS = [
  { key: 'VERIFIED', label: '已核销' },
  { key: 'REVERSED', label: '已撤销' },
];

function text(value) {
  return value == null ? '' : String(value).trim();
}

function shapeRecord(row) {
  if (!row || typeof row !== 'object') return null;
  const id = text(row.recordKey) || text(row.recordId);
  if (!id) return null;
  const occurredAt = text(row.occurredAt);
  const reversed = text(row.fulfillmentState) === 'REVERSED';
  return {
    id,
    nameText: text(row.chapterName) || text(row.storeName) || '本店站点',
    subText: text(row.topicName),
    statusKey: reversed ? 'REVERSED' : 'VERIFIED',
    statusText: reversed ? '已撤销' : '已核销',
    statusTone: reversed ? 'neutral' : 'success',
    dateKey: occurredAt.slice(0, 10),
    timeText: occurredAt.slice(11, 16),
  };
}

/** 接受分页载荷 {rows,total};返回 null 表示载荷不可信。 */
function shapeRecordList(data) {
  const rows = data && typeof data === 'object' && !Array.isArray(data) ? data.rows : null;
  if (!Array.isArray(rows)) return null;
  return rows.map(shapeRecord).filter(Boolean);
}

function countByStatus(items) {
  const counts = { VERIFIED: 0, REVERSED: 0 };
  (items || []).forEach((item) => { counts[item.statusKey] += 1; });
  return counts;
}

function groupRecords(items, statusKey) {
  const groups = [];
  const byKey = {};
  (items || []).forEach((item) => {
    if (item.statusKey !== statusKey) return;
    const key = item.dateKey || 'unknown';
    if (!byKey[key]) {
      byKey[key] = { key, label: item.dateKey || '时间未知', items: [] };
      groups.push(byKey[key]);
    }
    byKey[key].items.push(item);
  });
  return groups;
}

// 页顶「今天」:POST /api/merchant/desk/arrivals/today 的展示模型。
// 载荷 {date, redeemedCount, redeemed:[{redemptionId, topicId, topicName, activityId, activityName,
//   chapterId, chapterName, redeemedAt}]}(本店今天的有效核销,服务端按商家归属取,倒序)。
// 按主题分组,主题内再按场次分组;分组顺序跟随服务端倒序(最近核销的主题 / 场次在前)。
function pad2(value) { return value < 10 ? '0' + value : String(value); }

function shapeTodayRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = text(row.redemptionId);
  if (!id) return null;
  const at = chinaParts(row.redeemedAt);
  return {
    id,
    topicKey: text(row.topicId) || 'unknown',
    topicText: text(row.topicName) || '自由探索',
    sessionKey: text(row.activityId),
    sessionText: text(row.activityName),
    nameText: text(row.chapterName) || '本店站点',
    timeText: at ? pad2(at.hours) + ':' + pad2(at.minutes) : '',
  };
}

/** 返回 null = 载荷不可信(由页面在「今天」区内显示加载失败)。 */
function todayView(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.redeemed)) return null;
  const topics = [];
  const byTopic = {};
  let total = 0;
  data.redeemed.forEach((raw) => {
    const row = shapeTodayRow(raw);
    if (!row) return;
    total += 1;
    let topic = byTopic[row.topicKey];
    if (!topic) {
      topic = byTopic[row.topicKey] = { key: row.topicKey, title: row.topicText, count: 0, sessions: [], _bySession: {} };
      topics.push(topic);
    }
    topic.count += 1;
    const sessionKey = row.sessionKey || 'none';
    let session = topic._bySession[sessionKey];
    if (!session) {
      session = topic._bySession[sessionKey] = { key: topic.key + ':' + sessionKey, title: row.sessionText, count: 0, items: [] };
      topic.sessions.push(session);
    }
    session.count += 1;
    session.items.push({ id: row.id, nameText: row.nameText, timeText: row.timeText });
  });
  topics.forEach((topic) => { delete topic._bySession; });
  return { total, topics };
}

module.exports = {
  STATUS_TABS,
  shapeRecord,
  shapeRecordList,
  countByStatus,
  groupRecords,
  todayView,
};
