/**
 * utils/location/last-location.js —— 定位兜底:上次成功位置 → 固定坐标
 *
 * 取代页面里写死的上海坐标。只存经纬度(不含地址/时间序列),仅在用户主动定位成功后写入。
 * resolve() 永远返回可用坐标,并用 located=false 告诉页面显示「未获取定位」提示。
 */
const KEY = 'cy_last_location'
const FIXED = { latitude: 31.230416, longitude: 121.473701 }

function coordinate(value) {
  // Preserve numeric-string compatibility without coercing missing values,
  // booleans, arrays or objects into plausible coordinates such as zero.
  if (typeof value !== 'number' && typeof value !== 'string') return NaN
  if (typeof value === 'string' && value.trim() === '') return NaN
  return Number(value)
}

function valid(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const latitude = coordinate(p.latitude)
  const longitude = coordinate(p.longitude)
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
    && !(latitude === 0 && longitude === 0)
}

// L05-031/065(业主默认项 A):最后位置按账号分开存(cy_last_location:<会员号>),换账号不带走上一个人的位置;
// 未登录用无后缀的键。退出登录时 clearStorageForLogout 会连同这些键一起删。
function keyFor() {
  let id = ''
  try {
    const app = typeof getApp === 'function' ? getApp() : null
    id = app && typeof app.getUserID === 'function' ? String(app.getUserID() || '') : ''
  } catch (e) { id = '' }
  return /^[1-9]\d{0,18}$/.test(id) ? KEY + ':' + id : KEY
}

function load(env) {
  const w = env || (typeof wx !== 'undefined' ? wx : null)
  try {
    const v = w && w.getStorageSync(keyFor())
    return valid(v) ? { latitude: Number(v.latitude), longitude: Number(v.longitude) } : null
  } catch (e) { return null }
}

function save(res, env) {
  const w = env || (typeof wx !== 'undefined' ? wx : null)
  if (!valid(res)) return false
  try {
    w.setStorageSync(keyFor(), { latitude: Number(res.latitude), longitude: Number(res.longitude) })
    return true
  } catch (e) { return false }
}

/** @returns {{latitude:number, longitude:number, source:'last'|'fixed', hint:string}} */
function resolve(env) {
  const last = load(env)
  if (last) return Object.assign({ source: 'last', hint: '未获取定位，当前显示上次所在位置' }, last)
  return Object.assign({ source: 'fixed', hint: '未获取定位，当前显示默认位置' }, FIXED)
}

module.exports = { KEY, FIXED, valid, load, save, resolve }
