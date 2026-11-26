'use strict'

const PM = require('./roam-place-map.js')
const inFlight = new Map()
function manifestPath(key) {
  return typeof key === 'string' && /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(?:jpg|png|webp)$/.test(key)
    ? '/profile/' + key.replace(/\.[^.]+$/, '.gallery.json') : ''
}
function applyManifest(row, data) {
  const key = row.cover || row.coverImg || row.cover_img
  if (!data || String(data.poiId) !== String(row.id == null ? row.poiId : row.id) || data.coverKey !== key || typeof data.credit !== 'string' || !data.credit.trim()) {
    return Object.assign({}, row, { cover: '', coverImg: '', cover_img: '', gallery: [], galleryJson: '[]' })
  }
  const directory = key.slice(0, key.lastIndexOf('/') + 1)
  const images = Array.isArray(data.images) && data.images.length <= 6 ? data.images : []
  const gallery = images.filter(item => item && Number.isInteger(item.width) && Number.isInteger(item.height)
    && Math.max(item.width, item.height) >= 1600 && Math.min(item.width, item.height) >= 800)
    .map(item => item.key).filter(k => typeof k === 'string' && k.startsWith(directory) && manifestPath(k))
  return Object.assign({}, row, { photoCredit: data.credit, gallery: PM.galleryKeys(row).length ? PM.galleryKeys(row) : gallery })
}
// L10-001:清单是静态文件 —— 成功结果按 URL 缓存(TTL),并发封顶,避免每次重取 POI 都把几百个 GET 排在玩家写请求前面。
const cache = new Map()
const CACHE_TTL = 10 * 60 * 1000, CACHE_MAX = 600, MAX_ACTIVE = 4
const queue = []
let active = 0, generation = 0
function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const gen = generation
    active++
    queue.shift()(() => { if (gen === generation) { active--; pump() } })
  }
}
// L10-012:/profile/** 由静态资源处理器原样返回;兼容 AjaxResult 包裹与裸 JSON 两种形态,校验仍由 applyManifest 负责。
function manifestBody(res) {
  if (res && Number(res.code) === 200) return res.data
  return res && typeof res === 'object' && res.poiId != null && res.coverKey ? res : null
}
/** 目录图片先读同源许可清单，再交给界面；许可未确认或清单不可读时不闪现照片。 */
function resolvePlaceMedia(app, rows) {
  return Promise.all(rows.map(row => {
    const key = row && (row.cover || row.coverImg || row.cover_img)
    const url = manifestPath(key)
    if (!url || !PM.hasSeedTag(row)) return row
    const hit = cache.get(url)
    if (hit && Date.now() - hit.at < CACHE_TTL) return applyManifest(row, hit.data)
    let pending = inFlight.get(url)
    if (!pending) {
      pending = new Promise(resolve => queue.push(release => {
        let settled = false
        const done = data => { if (settled) return; settled = true; clearTimeout(timer); release(); resolve(data) }
        const timer = setTimeout(() => done(null), 4000)
        try { app.sendRequest({ url, method: 'GET', auth: false, hideLoading: true, silentError: true,
          success: res => done(manifestBody(res)),
          successStatusAbnormal: () => done(null), fail: () => done(null) }) }
        catch (_) { done(null) }
      }))
      pump()
      inFlight.set(url, pending)
      pending.then(data => {
        if (inFlight.get(url) === pending) inFlight.delete(url)
        if (data) {
          if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
          cache.set(url, { at: Date.now(), data })
        }
      })
    }
    return pending.then(data => applyManifest(row, data))
  }))
}
function resetPlaceMediaCache() { cache.clear(); inFlight.clear(); queue.length = 0; active = 0; generation++ }
module.exports = { manifestPath, applyManifest, resolvePlaceMedia, resetPlaceMediaCache }
