/**
 * pages/playkit/utils/kit-draft.js —— 玩法里填了一半的草稿(2026-09-24 存档修复)
 * key 由页面按「账号 + 场次/主题 + 站」给(pages/play/utils/story-resume.js#draftKey);空 key = 不存不读。
 * 提交成功(服务端 done)后由组件自己清掉。本地存不上 / 读不出都当没有草稿。
 */
function read(key) {
  if (!key) return {};
  try {
    const value = wx.getStorageSync('cy_kit_draft:' + key);
    return value && typeof value === 'object' ? value : {};
  } catch (e) { return {}; }
}
function write(key, value) {
  if (!key) return;
  try { wx.setStorageSync('cy_kit_draft:' + key, value); } catch (e) { /* 存不上就算了 */ }
}
function clear(key) {
  if (!key) return;
  try { wx.removeStorageSync('cy_kit_draft:' + key); } catch (e) { /* 没有就算了 */ }
}
// L02-040
const DEBOUNCE_MS = 400;
function writeSoon(owner, key, value) {
  if (!owner || !key) return;
  if (owner._draftTimer) clearTimeout(owner._draftTimer);
  owner._draftPending = { key, value };
  owner._draftTimer = setTimeout(() => flush(owner), DEBOUNCE_MS);
}
function flush(owner) {
  if (!owner) return;
  if (owner._draftTimer) { clearTimeout(owner._draftTimer); owner._draftTimer = null; }
  const pending = owner._draftPending;
  owner._draftPending = null;
  if (pending) write(pending.key, pending.value);
}
function drop(owner) {
  if (!owner) return;
  if (owner._draftTimer) { clearTimeout(owner._draftTimer); owner._draftTimer = null; }
  owner._draftPending = null;
}
module.exports = { read, write, clear, writeSoon, flush, drop, DEBOUNCE_MS };
