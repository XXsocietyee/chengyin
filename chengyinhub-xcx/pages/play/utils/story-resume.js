/**
 * pages/play/utils/story-resume.js —— 故事流「中途退出能回到原处」(2026-09-24 用户:前 6 条都修)
 *
 * 本地存三样,按账号 + 场次/主题隔离(与暂停计时同一把 key,预览/缺身份时 key 为空 = 不存不读):
 *   pos        读到哪一段 {chapterId, i, nodeId}
 *   gates      看过开场门的章节 id
 *   openNodeId 退出时正开着的那个玩法
 *   trails     读过收尾文字的章节 id → true(P-29:换章前先读完本章收尾,读过的重进不再停)
 * 以及玩法里填了一半的草稿(draftKey,由玩法组件自己存取)。存不上 / 读不出都当没有,不打断游玩。
 */
const { pausedRunStorageKey } = require('./play-run-session.js');

const PREFIX = 'cy_story_resume:';

function keyOf(scope) {
  const base = pausedRunStorageKey(scope);
  const runId = runIdOf(scope);
  return base && runId ? PREFIX + base + ':r' + runId : '';
}

/** E-C2:续玩状态属于哪一局(routeSessionId)。记录上盖着局号,换了新一局就当没有,不把上一局的开场 / 章节门 / finished / 草稿带进来。
 *  局号未确定时不读写，旧的仅按主题保存的状态不能让新一局跳过开场。 */
function runIdOf(scope) {
  return String((scope && scope.routeSessionId) == null ? '' : scope.routeSessionId).trim();
}

// L02-106: 读到哪一段(pos)每读一段就变,同步写存储最多每 POS_WRITE_MS 一次;
// 还没落盘的那一份留在内存里,read 会合进去,其它字段写入时一并落盘。
const POS_WRITE_MS = 2000;
const pendingPos = {};
const lastPosWrite = {};
const posTimers = {};
const pruned = {};

function readStored(key, runId) {
  try {
    const value = wx.getStorageSync(key);
    if (!value || typeof value !== 'object') return {};
    if (String(value.runId || '') !== runId) return {};
    return value;
  } catch (e) { return {}; }
}

function read(scope) {
  const key = keyOf(scope);
  if (!key) return {};
  const value = readStored(key, runIdOf(scope));
  return pendingPos[key] ? Object.assign({}, value, { pos: pendingPos[key] }) : value;
}

function write(key, runId, fields) {
  const merged = Object.assign(readStored(key, runId), fields, runId ? { runId } : {});
  if (pendingPos[key] && !('pos' in fields)) merged.pos = pendingPos[key];
  delete pendingPos[key];
  clearTimeout(posTimers[key]); delete posTimers[key];
  try { wx.setStorageSync(key, merged); } catch (e) { /* 存不上就算了 */ }
  prune(key);
}

/** L02-106: 换了新一局,同一账号同一路线上一局留下的续玩键清掉(只清一次)。 */
function prune(key) {
  if (pruned[key]) return;
  pruned[key] = true;
  const base = key.slice(0, key.lastIndexOf(':r') + 2);
  try {
    const keys = (wx.getStorageInfoSync && wx.getStorageInfoSync().keys) || [];
    keys.forEach((k) => { if (k !== key && k.indexOf(base) === 0 && k.indexOf(':n', base.length) < 0) wx.removeStorageSync(k); });
  } catch (e) { /* 清不掉下次再清 */ }
}

function patch(scope, fields) {
  const key = keyOf(scope);
  if (!key) return;
  const runId = runIdOf(scope);
  const keys = Object.keys(fields || {});
  if (keys.length === 1 && keys[0] === 'pos') {
    const now = Date.now();
    if (now - (lastPosWrite[key] || 0) >= POS_WRITE_MS) { lastPosWrite[key] = now; write(key, runId, fields); return; }
    pendingPos[key] = fields.pos;
    if (!posTimers[key]) {
      posTimers[key] = setTimeout(() => { delete posTimers[key]; lastPosWrite[key] = Date.now(); if (pendingPos[key]) write(key, runId, { pos: pendingPos[key] }); }, POS_WRITE_MS - (now - lastPosWrite[key]));
    }
    return;
  }
  write(key, runId, fields);
}

/** 新一局 / 通关收尾时清掉这一局的续玩状态。 */
function clear(scope) {
  const key = keyOf(scope);
  if (!key) return;
  delete pendingPos[key]; clearTimeout(posTimers[key]); delete posTimers[key];
  try { wx.removeStorageSync(key); } catch (e) { /* 清不掉就算了,下一局的局号对不上也读不到 */ }
}

/** 玩法草稿的 key:同一局同一站一份。没有身份时返回空串,组件据此不存。 */
function draftKey(scope, nodeId) {
  const key = keyOf(scope);
  if (!key || nodeId == null) return '';
  return key + ':n' + nodeId;
}

module.exports = { read, patch, clear, draftKey };
