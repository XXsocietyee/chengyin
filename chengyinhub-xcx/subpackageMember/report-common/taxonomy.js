'use strict'
// 举报原因字典是静态的:同一账号的副本 10 分钟内复用(L09-110)。
// 按 app 实例和账号分开缓存;读失败不缓存,换号另读。回调式(命中缓存时同步回调),cb(labels|null)。
const view = require('./view.js')
const { isBizOk } = require('../../utils/response-shape.js')
const TTL = 10 * 60 * 1000
const cache = new WeakMap()

function accountId(app) {
  if (!app || typeof app.getUserID !== 'function') return ''
  try {
    const id = app.getUserID()
    return id == null || id === '' ? '' : String(id)
  } catch (e) { return '' }
}

function readTaxonomyLabels(app, cb) {
  const who = accountId(app)
  let bucket = cache.get(app)
  if (!bucket) { bucket = new Map(); cache.set(app, bucket) }
  const hit = bucket.get(who)
  if (hit && hit.waiters) { hit.waiters.push(cb); return }
  if (hit && Date.now() - hit.at < TTL) { cb(hit.labels); return }
  const entry = { waiters: [cb] }
  bucket.set(who, entry)
  const done = (labels) => {
    const waiters = entry.waiters
    entry.waiters = null
    if (labels) { entry.labels = labels; entry.at = Date.now() }
    else if (bucket.get(who) === entry) bucket.delete(who)
    waiters.forEach((w) => w(labels))
  }
  app.sendRequest({
    url: '/api/community-trust/reports/taxonomy', method: 'GET', hideLoading: true, autoErrorToast: false,
    success(res) { done(isBizOk(res) ? view.reasonLabelMap(res.data) : null) },
    fail() { done(null) },
    successStatusAbnormal() { done(null) },
  })
}

module.exports = { readTaxonomyLabels }
