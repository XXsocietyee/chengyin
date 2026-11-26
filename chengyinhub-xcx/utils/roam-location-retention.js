'use strict'

const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000
const GEOMETRY = new Set(['lat', 'lng', 'latitude', 'longitude', 'lastLat', 'lastLng', 'lastReportAt',
  'track', 'polyline', 'coordinates', 'center', 'pois', 'foundPois', 'allTiles', 'pendingTiles'])

function stripGeometry(value) {
  if (Array.isArray(value)) return value.map(stripGeometry)
  if (!value || typeof value !== 'object') return value
  const result = {}
  Object.keys(value).forEach(key => { if (!GEOMETRY.has(key)) result[key] = stripGeometry(value[key]) })
  return result
}

function jsonKeys(value) {
  const keys = Object.keys(value)
  const present = []
  for (let i = 0; i < keys.length; i += 1) {
    const item = value[keys[i]]
    if (item !== undefined && typeof item !== 'function') present.push(keys[i])
  }
  return present
}

function sameStored(left, right) {
  if (left === right) return true
  if (typeof left === 'number' && typeof right === 'number' && Number.isNaN(left) && Number.isNaN(right)) return true
  const leftArray = Array.isArray(left)
  const rightArray = Array.isArray(right)
  if (leftArray || rightArray) {
    if (!leftArray || !rightArray || left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) if (!sameStored(left[i], right[i])) return false
    return true
  }
  if (!left || typeof left !== 'object' || !right || typeof right !== 'object') return left === right
  const leftKeys = jsonKeys(left)
  const rightKeys = jsonKeys(right)
  if (leftKeys.length !== rightKeys.length) return false
  for (let i = 0; i < leftKeys.length; i += 1) {
    if (leftKeys[i] !== rightKeys[i] || !sameStored(left[leftKeys[i]], right[rightKeys[i]])) return false
  }
  return true
}

function pruneSessions(sessions, recovery, now = Date.now()) {
  return sessions.map(row => {
    if (!row || typeof row !== 'object') return row
    // A lost finish reply must be checked against the server before expiring an active run.
    if (recovery && Number(recovery.archiveTs) > 0 && recovery.archiveTs === row.ts && !recovery.finishedAt) return row
    const time = Number(row.finishedAt || row.ts)
    if (time > 0 && time <= now && time > now - THIRTY_DAYS) return row
    const stripped = stripGeometry(row)
    return sameStored(stripped, row) ? row : { ...stripped, locationExpired: true }
  })
}

module.exports = { THIRTY_DAYS, stripGeometry, pruneSessions }
