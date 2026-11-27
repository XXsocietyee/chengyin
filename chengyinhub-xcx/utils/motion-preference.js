const REDUCED_MOTION_KEY = 'play_reduced_motion'
const LEGACY_REDUCED_MOTION_KEY = 'roam_reduced_motion'
const listeners = new Set()

function resolveStorage(storage) {
  if (storage) return storage
  return typeof wx !== 'undefined' ? wx : null
}

// L10-038/055/083:同一存储对象缓存读到的值,挂载时只有第一次未命中才读 Storage。
// { fresh: true } 只在页面首次展示,或离开后偏好可能已变时使用;同一轮 show 的多个组件共享这一次重读。
// 偏好未变的再次 show 走缓存。noteReducedMotionMayChange 让下一轮 fresh 不再复用这一轮结果。
// writeReducedMotion 同步刷新缓存并通知订阅。
const cache = typeof WeakMap === 'function' ? new WeakMap() : null
const freshBurstHit = typeof WeakMap === 'function' ? new WeakMap() : null
let freshBurst = 0
let freshBurstOpen = false

function closeFreshBurst(current) {
  if (freshBurst === current) freshBurstOpen = false
}

function openFreshBurst() {
  if (freshBurstOpen) return freshBurst
  freshBurstOpen = true
  freshBurst += 1
  const current = freshBurst
  if (typeof Promise === 'function') Promise.resolve().then(() => closeFreshBurst(current))
  else freshBurstOpen = false
  return current
}

function noteReducedMotionMayChange() {
  freshBurst += 1
  freshBurstOpen = false
}

function readReducedMotion(storage, options) {
  const target = resolveStorage(storage)
  if (!target || typeof target.getStorageSync !== 'function') return false
  const fresh = !!(options && options.fresh)
  if (cache && cache.has(target)) {
    if (!fresh) return cache.get(target)
    if (freshBurstHit && freshBurstHit.get(target) === openFreshBurst()) return cache.get(target)
  }
  let value
  try {
    const current = target.getStorageSync(REDUCED_MOTION_KEY)
    value = current === true || current === false ? current : target.getStorageSync(LEGACY_REDUCED_MOTION_KEY) === true
  } catch (e) {
    return false
  }
  if (cache) cache.set(target, value)
  if (fresh && freshBurstHit) freshBurstHit.set(target, openFreshBurst())
  return value
}

function subscribeReducedMotion(listener) {
  if (typeof listener === 'function') listeners.add(listener)
  return () => listeners.delete(listener)
}

// null 表示主键未保存；false 是已保存的“恢复动态效果”。
function writeReducedMotion(storage, value) {
  const enabled = value === true
  const target = resolveStorage(storage)
  if (!target || typeof target.setStorageSync !== 'function') return null
  try {
    target.setStorageSync(REDUCED_MOTION_KEY, enabled)
  } catch (e) {
    return null
  }
  if (cache) cache.set(target, enabled)
  // 读取优先主键；兼容键写失败不能把已保存的主键伪报为失败。
  try {
    target.setStorageSync(LEGACY_REDUCED_MOTION_KEY, enabled)
  } catch (e) {}
  Array.from(listeners).forEach((listener) => {
    try { listener(enabled) } catch (e) {}
  })
  return enabled
}

module.exports = {
  REDUCED_MOTION_KEY,
  LEGACY_REDUCED_MOTION_KEY,
  readReducedMotion,
  writeReducedMotion,
  subscribeReducedMotion,
  noteReducedMotionMayChange,
}
