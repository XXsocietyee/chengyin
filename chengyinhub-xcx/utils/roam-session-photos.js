const MAX_SESSION_PHOTOS = 8
const MAX_SAVED_SESSIONS = 50
// wx.saveFile 的已保存文件总上限。8 张 × 50 次足迹会撑破 10MB。
const SAVED_FILE_QUOTA_BYTES = 10 * 1024 * 1024

function normalizePhoto(photo) {
  if (typeof photo === 'string') return { path: photo, persisted: false }
  if (!photo || !photo.path) return null
  return {
    path: String(photo.path),
    persisted: photo.persisted === true,
    name: photo.name || '',
  }
}

function retainRecentPhotos(photos, limit) {
  const max = limit || MAX_SESSION_PHOTOS
  return (photos || []).map(normalizePhoto).filter(Boolean).slice(-max)
}

function droppedSavedPhotos(photos, limit) {
  const keptPaths = new Set(retainRecentPhotos(photos, limit)
    .filter((photo) => photo.persisted)
    .map((photo) => photo.path))
  return (photos || []).map(normalizePhoto).filter((photo) => photo && photo.persisted && !keptPaths.has(photo.path))
}

function archivedSessionPhotos(photos) {
  return retainRecentPhotos(photos).filter((photo) => photo.persisted)
}

function callWx(method, payload) {
  return new Promise((resolve, reject) => {
    try {
      method(Object.assign({}, payload, { success: resolve, fail: reject }))
    } catch (error) {
      reject(error)
    }
  })
}

function addPhotoPaths(paths, photos) {
  const list = Array.isArray(photos) ? photos : []
  for (let i = 0; i < list.length; i += 1) {
    const photo = list[i]
    const path = typeof photo === 'string' ? photo : photo && photo.path
    if (typeof path === 'string' && path) paths.add(path)
  }
}

function viewingPaths(hint, tempFilePath) {
  const paths = new Set()
  if (typeof tempFilePath === 'string' && tempFilePath) paths.add(tempFilePath)
  if (typeof hint === 'string') paths.add(hint)
  else if (Array.isArray(hint)) addPhotoPaths(paths, hint)
  else if (hint && typeof hint === 'object') {
    if (typeof hint.viewing === 'string') paths.add(hint.viewing)
    addPhotoPaths(paths, hint.viewing)
  }
  if (typeof getCurrentPages !== 'function') return paths
  try {
    const pages = getCurrentPages()
    const page = Array.isArray(pages) ? pages[pages.length - 1] : null
    if (!page) return paths
    addPhotoPaths(paths, page._sessionPhotos)
    const data = page.data || {}
    addPhotoPaths(paths, data.visit && data.visit.photos)
    addPhotoPaths(paths, data.finish && data.finish.photos)
  } catch (_) { /* 认不出正在看的照片时，下面改删最旧的 */ }
  return paths
}

function fileSize(wxApi, tempFilePath) {
  if (!wxApi || typeof wxApi.getFileInfo !== 'function') return Promise.resolve(null)
  return callWx(wxApi.getFileInfo.bind(wxApi), { filePath: tempFilePath }).then((info) => {
    const size = info && Number(info.size)
    return Number.isFinite(size) && size >= 0 ? size : null
  }, () => null)
}

function savedFileList(wxApi) {
  return callWx(wxApi.getSavedFileList.bind(wxApi), {}).then((res) => {
    const list = res && res.fileList
    return Array.isArray(list) ? list : []
  })
}

function removeSaved(wxApi, filePath) {
  return callWx(wxApi.removeSavedFile.bind(wxApi), { filePath }).then(() => true, () => false)
}

// 满 10MB 时先删最旧的已保存文件，再保存新照片。正在看的路径能认出来就跳过。
async function freeSavedFileRoom(wxApi, incomingSize, protect) {
  const files = await savedFileList(wxApi)
  const incoming = incomingSize == null ? 0 : incomingSize
  if (incoming > SAVED_FILE_QUOTA_BYTES) return false
  const ordered = []
  let used = 0
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i]
    if (!file || typeof file.filePath !== 'string' || !file.filePath) continue
    const bytes = Math.max(0, Number(file.size) || 0)
    used += bytes
    ordered.push({ path: file.filePath, bytes, createTime: Number(file.createTime) || 0, index: i })
  }
  ordered.sort((a, b) => a.createTime - b.createTime || a.index - b.index)
  const removed = new Set()
  for (let i = 0; i < ordered.length; i += 1) {
    if (used + incoming <= SAVED_FILE_QUOTA_BYTES) return true
    const file = ordered[i]
    if (protect.has(file.path) || removed.has(file.path)) continue
    if (typeof wxApi.removeSavedFile !== 'function') return false
    if (await removeSaved(wxApi, file.path)) {
      removed.add(file.path)
      used -= file.bytes
    }
  }
  return used + incoming <= SAVED_FILE_QUOTA_BYTES
}

function persistPhoto(wxApi, tempFilePath, hint) {
  return new Promise((resolve) => {
    if (!tempFilePath || !wxApi || typeof wxApi.saveFile !== 'function') {
      resolve({ path: tempFilePath || '', persisted: false })
      return
    }
    const fallback = () => resolve({ path: tempFilePath, persisted: false })
    const save = () => {
      try { wxApi.saveFile({
        tempFilePath,
        success(res) {
          const savedFilePath = res && res.savedFilePath
          resolve(savedFilePath
            ? { path: savedFilePath, persisted: true }
            : { path: tempFilePath, persisted: false })
        },
        fail: fallback,
      }) } catch (_) { fallback() }
    }
    if (typeof wxApi.getSavedFileList !== 'function') { save(); return }
    const protect = viewingPaths(hint, tempFilePath)
    fileSize(wxApi, tempFilePath).then((size) => freeSavedFileRoom(wxApi, size, protect)).then((room) => {
      if (room) save()
      else fallback()
    }).catch(save)
  })
}

function evictedSavedPhotos(existingSessions, incomingSession, limit) {
  const max = limit || MAX_SAVED_SESSIONS
  // Archive retries replace the same timestamp in place; they do not consume a new slot.
  // Match the page's persisted order before deciding which file references are evicted.
  const sessions = (existingSessions || []).slice()
  const existing = incomingSession && incomingSession.ts != null
    ? sessions.findIndex((session) => session && session.ts === incomingSession.ts) : -1
  if (existing >= 0) sessions[existing] = incomingSession
  else sessions.unshift(incomingSession)
  const kept = new Set()
  sessions.slice(0, max).forEach((session) => {
    retainRecentPhotos(session && session.photos).forEach((photo) => {
      if (photo.persisted) kept.add(photo.path)
    })
  })
  return sessions.slice(max).flatMap((session) => retainRecentPhotos(session && session.photos))
    .filter((photo) => photo.persisted && !kept.has(photo.path))
}

function releaseSavedPhotos(wxApi, photos) {
  if (!wxApi || typeof wxApi.removeSavedFile !== 'function') return
  const released = {}
  retainRecentPhotos(photos, Number.MAX_SAFE_INTEGER).forEach((photo) => {
    if (!photo.persisted || released[photo.path]) return
    released[photo.path] = true
    wxApi.removeSavedFile({ filePath: photo.path })
  })
}

module.exports = {
  MAX_SESSION_PHOTOS,
  MAX_SAVED_SESSIONS,
  SAVED_FILE_QUOTA_BYTES,
  persistPhoto,
  retainRecentPhotos,
  archivedSessionPhotos,
  droppedSavedPhotos,
  evictedSavedPhotos,
  releaseSavedPhotos,
}
