'use strict'

// 第九轮 m1 第 3 项:地点卡。数据就是地图上那一枚点(名字 / 照片 / 地址 / 距离),
// 评分沿用据点详情原来的读接口(/api/city/nodes/{id} 的 averageRating / ratingCount),不另开一份。正文仍在原来的详情里,点卡片本身进去。
const app = typeof getApp === 'function' ? getApp() : null
const { normalizeTrack } = require('../../../utils/roam-track-simplify.js')

const { isBizOk: ok } = require('../../../utils/response-shape.js') // L05-105
function ratingText(avg, count) {
  const a = Number(avg)
  if (!Number.isFinite(a) || a <= 0) return ''
  if (count != null && !(Number(count) > 0)) return ''
  return a.toFixed(1)
}

const ratingCache = new Map()
function placeKey(p) {
  if (!p || !p.name) return ''
  return [p.id == null ? '' : p.id, p.shareKind || '', p.shareId == null ? '' : p.shareId, p.name].join('|')
}

Component({
  properties: {
    place: { type: Object, value: null, observer(p) { this._onPlace(p) } },
    top: { type: Number, value: 150 },
    originY: { type: Number, value: 270 },
    reducedMotion: { type: Boolean, value: false },
  },
  data: { show: false, shown: false, rating: '', ratingError: false },
  lifetimes: {
    detached() { this._seq = (this._seq || 0) + 1; if (this._inTimer) clearTimeout(this._inTimer) },
  },
  methods: {
    _onPlace(p) {
      // L05-072
      const key = placeKey(p)
      if (key && key === this._placeKey && this.data.show) return
      this._placeKey = key
      const seq = this._seq = (this._seq || 0) + 1
      if (this._inTimer) { clearTimeout(this._inTimer); this._inTimer = null }
      if (!p || !p.name) { this.setData({ show: false, shown: false, rating: '', ratingError: false }); return }
      this.setData({ show: true, shown: !!this.data.reducedMotion, rating: '', ratingError: false })
      if (!this.data.reducedMotion) this._inTimer = setTimeout(() => { if (seq === this._seq) this.setData({ shown: true }) }, 20)
      this._loadRating(p, seq)
    },
    _loadRating(p, seq) {
      if (!app || typeof app.sendRequest !== 'function') return
      const done = (avg, count) => { if (seq === this._seq) this.setData({ rating: ratingText(avg, count) }) }
      if (p.shareKind === 'poi' && p.shareId) {
        const cacheKey = String(p.shareId)
        if (ratingCache.has(cacheKey)) { const c = ratingCache.get(cacheKey); done(c.avg, c.count); return }
        app.sendRequest({ url: '/api/city/nodes/' + p.shareId, method: 'GET', hideLoading: true, autoErrorToast: false,
          // 评分只是卡上的一格:读不到时这一格显示「—」(ratingError),不弹错,卡上其余内容照常
          success: (res) => {
            const d = ok(res) && res.data
            if (d) { ratingCache.set(cacheKey, { avg: d.averageRating, count: d.ratingCount }); done(d.averageRating, d.ratingCount) } else if (seq === this._seq) this.setData({ ratingError: true })
          },
          successStatusAbnormal: () => { if (seq === this._seq) this.setData({ ratingError: true }) },
          fail: () => { if (seq === this._seq) this.setData({ ratingError: true }) } })
      }
    },
    onOpen() { this.triggerEvent('open', { id: this.data.place && this.data.place.id }) },
    onClose() { this.triggerEvent('close') },
    onNavigate() {
      const p = this.data.place || {}
      const point = normalizeTrack([p])[0]
      if (!point) return
      const latitude = point.lat, longitude = point.lng
      wx.openLocation({ latitude, longitude, name: p.name || '', address: p.address || '', scale: 17 })
    },
  },
})

module.exports = { ratingText, placeKey }
