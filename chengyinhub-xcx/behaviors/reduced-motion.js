const { readReducedMotion, subscribeReducedMotion } = require('../utils/motion-preference.js')

// 单测沙箱里没有全局 Behavior:退回原样对象(同 exit-motion.js / sheet-depth.js)
const define = typeof Behavior === 'function' ? Behavior : (o) => o

module.exports = define({
  properties: {
    reducedMotion: { type: Boolean, value: false },
  },
  observers: {
    reducedMotion(value) {
      if (this._syncingReducedMotion) return
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
      if (this._unsubscribeReducedMotion) this._unsubscribeReducedMotion()
      this._unsubscribeReducedMotion = null
    },
  },
  pageLifetimes: {
    show() {
      this._syncReducedMotionPreference(true)
    },
  },
  methods: {
    _syncReducedMotionPreference(fresh) {
      const reducedMotion = this._pageReducedMotion === true || readReducedMotion(undefined, fresh ? { fresh: true } : undefined)
      if (this.data.reducedMotion === reducedMotion) return
      this._syncingReducedMotion = true
      try { this.setData({ reducedMotion }) } finally { this._syncingReducedMotion = false }
    },
  },
})
