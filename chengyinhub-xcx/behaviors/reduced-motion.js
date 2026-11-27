const { readReducedMotion, subscribeReducedMotion, noteReducedMotionMayChange } = require('../utils/motion-preference.js')

// 单测沙箱里没有全局 Behavior:退回原样对象(同 exit-motion.js / sheet-depth.js)
const define = typeof Behavior === 'function' ? Behavior : (o) => o

module.exports = define({
  properties: {
    reducedMotion: { type: Boolean, value: false },
  },
  observers: {
    reducedMotion(value) {
      if (this._syncingReducedMotion || this._reducedMotionDetached) return
      this._pageReducedMotion = value === true
      this._syncReducedMotionPreference()
    },
  },
  lifetimes: {
    attached() {
      if (typeof this._pageReducedMotion !== 'boolean') this._pageReducedMotion = this.data.reducedMotion === true
      this._unsubscribeReducedMotion = subscribeReducedMotion(() => this._syncReducedMotionPreference())
      this._syncReducedMotionPreference()
    },
    detached() {
      this._reducedMotionDetached = true
      const unsubscribe = this._unsubscribeReducedMotion
      this._unsubscribeReducedMotion = null
      if (unsubscribe) unsubscribe()
    },
  },
  pageLifetimes: {
    show() {
      // 首次展示要读到挂载之后才写入的偏好;离开页面后才可能再变。偏好未变的再次 show 不再读 Storage。
      if (this._reducedMotionDetached) return
      const reread = this._reducedMotionShown !== true || this._reducedMotionStale === true
      this._reducedMotionShown = true
      this._reducedMotionStale = false
      this._syncReducedMotionPreference(reread)
    },
    hide() {
      if (this._reducedMotionDetached) return
      this._reducedMotionStale = true
      if (typeof noteReducedMotionMayChange === 'function') noteReducedMotionMayChange()
    },
  },
  methods: {
    _syncReducedMotionPreference(fresh) {
      if (this._reducedMotionDetached || !this.data) return
      const reducedMotion = this._pageReducedMotion === true || readReducedMotion(undefined, fresh ? { fresh: true } : undefined)
      if (this._reducedMotionDetached || !this.data || this.data.reducedMotion === reducedMotion) return
      this._syncingReducedMotion = true
      try { this.setData({ reducedMotion }) } finally { this._syncingReducedMotion = false }
    },
  },
})
