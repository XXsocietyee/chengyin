const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  REDUCED_MOTION_KEY,
  LEGACY_REDUCED_MOTION_KEY,
  readReducedMotion,
  writeReducedMotion,
  noteReducedMotionMayChange,
} = require('../../utils/motion-preference.js')

function memoryStorage(initial) {
  const values = Object.assign({}, initial)
  return {
    values,
    getStorageSync(key) { return values[key] },
    setStorageSync(key, value) { values[key] = value },
  }
}

test('动效偏好使用玩家路径共享键并兼容旧漫游键', () => {
  const current = memoryStorage({ [REDUCED_MOTION_KEY]: true })
  assert.equal(readReducedMotion(current), true)

  const legacy = memoryStorage({ [LEGACY_REDUCED_MOTION_KEY]: true })
  assert.equal(readReducedMotion(legacy), true)

  const explicitCurrent = memoryStorage({
    [REDUCED_MOTION_KEY]: false,
    [LEGACY_REDUCED_MOTION_KEY]: true,
  })
  assert.equal(readReducedMotion(explicitCurrent), false)
})

test('写入动效偏好同时保持旧版本页面兼容', () => {
  const storage = memoryStorage()
  assert.equal(writeReducedMotion(storage, true), true)
  assert.equal(storage.values[REDUCED_MOTION_KEY], true)
  assert.equal(storage.values[LEGACY_REDUCED_MOTION_KEY], true)

  assert.equal(writeReducedMotion(storage, false), false)
  assert.equal(readReducedMotion(storage), false)
})

test('同一次展示的 fresh 只读一次存储,偏好可能变化后才再读', async () => {
  let reads = 0
  const storage = {
    getStorageSync(key) {
      reads += 1
      return key === REDUCED_MOTION_KEY ? true : undefined
    },
    setStorageSync() {},
  }
  assert.equal(readReducedMotion(storage, { fresh: true }), true)
  assert.equal(readReducedMotion(storage, { fresh: true }), true)
  assert.equal(reads, 1)
  noteReducedMotionMayChange()
  assert.equal(readReducedMotion(storage, { fresh: true }), true)
  assert.equal(reads, 2)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(readReducedMotion(storage, { fresh: true }), true)
  assert.equal(reads, 3)
  await new Promise((resolve) => setTimeout(resolve, 0))
})

test('存储不可用时回退为正常动效且不抛错', () => {
  const broken = {
    getStorageSync() { throw new Error('storage unavailable') },
    setStorageSync() { throw new Error('storage unavailable') },
  }
  assert.equal(readReducedMotion(broken), false)
  assert.equal(writeReducedMotion(broken, true), null)
})
