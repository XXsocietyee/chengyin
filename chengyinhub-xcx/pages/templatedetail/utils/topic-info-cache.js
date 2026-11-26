// L06-053:主题模板预览页已读到的 /api/template/topic-template/info,30 秒内交给「查看详情」直接用,
// 不再为同一 id 再读一次;直开/分享进详情页时没有缓存,照常请求。按账号隔离,取一次即失效。
const TTL_MS = 30 * 1000;
let entry = null;

function ownerOf() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return String((app && app.getUserID && app.getUserID()) || '');
}

function put(id, info) {
  if (!id || !info || typeof info !== 'object') return;
  entry = { id: String(id), owner: ownerOf(), info, at: Date.now() };
}

function take(id) {
  const hit = entry;
  entry = null;
  if (!hit || hit.id !== String(id) || hit.owner !== ownerOf() || Date.now() - hit.at > TTL_MS) return null;
  return hit.info;
}

module.exports = { put, take };
