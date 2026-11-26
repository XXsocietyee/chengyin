const REDUCED_MOTION_KEY = 'play_reduced_motion'
const LEGACY_REDUCED_MOTION_KEY = 'roam_reduced_motion'
const listeners = new Set()

function resolveStorage(storage) {
  if (storage) return storage
  return typeof wx !== 'undefined' ? wx : null
}

// L10-038/055/083:组件 attached 时按存储对象缓存读到的值(每个组件实例不再各自同步读 1–2 次 Storage);
// 页面 show 时用 { fresh: true } 重读一次并刷新缓存,别处直接改了存储也能在回到页面时生效;writeReducedMotion 同步刷新。
const cache = typeof WeakMap === 'function' ? new WeakMap() : null

function readReducedMotion(storage, options) {
  const target = resolveStorage(storage)
  if (!target || typeof target.getStorageSync !== 'function') return false
  const fresh = !!(options && options.fresh)
  if (!fresh && cache && cache.has(target)) return cache.get(target)
  let value
  try {
    const current = target.getStorageSync(REDUCED_MOTION_KEY)
    value = current === true || current === false ? current : target.getStorageSync(LEGACY_REDUCED_MOTION_KEY) === true
  } catch (e) {
    return false
  }
  if (cache) cache.set(target, value)
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
}
