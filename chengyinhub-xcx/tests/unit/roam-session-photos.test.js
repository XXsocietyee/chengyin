const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  MAX_SESSION_PHOTOS,
  SAVED_FILE_QUOTA_BYTES,
  persistPhoto,
  retainRecentPhotos,
  archivedSessionPhotos,
  droppedSavedPhotos,
  evictedSavedPhotos,
} = require('../../utils/roam-session-photos.js')

test('裁剪后的漫游照片保存为可跨重启读取的本地路径', async () => {
  const photo = await persistPhoto({
    saveFile({ tempFilePath, success }) {
      assert.equal(tempFilePath, '/tmp/crop.jpg')
      success({ savedFilePath: 'wxfile://roam/crop.jpg' })
    },
  }, '/tmp/crop.jpg')

  assert.deepEqual(photo, { path: 'wxfile://roam/crop.jpg', persisted: true })
})

test('本地保存失败时保留当前会话可展示的临时照片，但不标记为已归档', async () => {
  const photo = await persistPhoto({
    saveFile({ fail }) { fail() },
  }, '/tmp/crop.jpg')

  assert.deepEqual(photo, { path: '/tmp/crop.jpg', persisted: false })
})

test('会话照片只保留最新八张，淘汰会话只释放未被保留会话引用的已保存文件', () => {
  const photos = Array.from({ length: MAX_SESSION_PHOTOS + 2 }, (_, index) => ({
    path: `wxfile://current/${index}`,
    persisted: true,
  }))
  assert.deepEqual(retainRecentPhotos(photos).map((photo) => photo.path), [
    'wxfile://current/2', 'wxfile://current/3', 'wxfile://current/4', 'wxfile://current/5',
    'wxfile://current/6', 'wxfile://current/7', 'wxfile://current/8', 'wxfile://current/9',
  ])
  assert.deepEqual(droppedSavedPhotos(photos).map((photo) => photo.path), [
    'wxfile://current/0', 'wxfile://current/1',
  ])
  assert.deepEqual(archivedSessionPhotos([
    { path: 'wxfile://session/persisted', persisted: true },
    { path: '/tmp/session-only', persisted: false },
  ]), [{ path: 'wxfile://session/persisted', persisted: true, name: '' }])

  const sessions = Array.from({ length: 50 }, (_, index) => ({
    photos: [{ path: `wxfile://session/${index}`, persisted: true }],
  }))
  const incoming = { photos: [{ path: 'wxfile://session/new', persisted: true }] }

  assert.deepEqual(evictedSavedPhotos(sessions, incoming).map((photo) => photo.path), [
    'wxfile://session/49',
  ])
})

function quotaWx({ files, incoming, removed, events }) {
  return {
    getSavedFileList({ success }) {
      events.push('list')
      success({ fileList: files })
    },
    getFileInfo({ success }) { success({ size: incoming }) },
    removeSavedFile({ filePath, success }) {
      events.push('remove:' + filePath)
      removed.push(filePath)
      success({})
    },
    saveFile({ success }) {
      events.push('save')
      success({ savedFilePath: 'wxfile://saved.jpg' })
    },
  }
}

test('已保存照片加上新照片超过 10MB 时，先删最旧的再保存', async () => {
  const removed = []
  const events = []
  const photo = await persistPhoto(quotaWx({
    files: [
      { filePath: 'wxfile://old.jpg', size: 6 * 1024 * 1024, createTime: 1 },
      { filePath: 'wxfile://newer.jpg', size: 5 * 1024 * 1024, createTime: 2 },
    ],
    incoming: 2 * 1024 * 1024,
    removed,
    events,
  }), '/tmp/crop.jpg')
  assert.equal(6 * 1024 * 1024 + 5 * 1024 * 1024 + 2 * 1024 * 1024 > SAVED_FILE_QUOTA_BYTES, true)
  assert.deepEqual(removed, ['wxfile://old.jpg'])
  assert.deepEqual(events, ['list', 'remove:wxfile://old.jpg', 'save'])
  assert.deepEqual(photo, { path: 'wxfile://saved.jpg', persisted: true })
})

test('认得出正在看的照片时不删它，否则删最旧的', async () => {
  const files = [
    { filePath: 'wxfile://open.jpg', size: 6 * 1024 * 1024, createTime: 1 },
    { filePath: 'wxfile://next.jpg', size: 5 * 1024 * 1024, createTime: 2 },
  ]
  const viewed = []
  const viewedEvents = []
  const kept = await persistPhoto(quotaWx({
    files, incoming: 2 * 1024 * 1024, removed: viewed, events: viewedEvents,
  }), '/tmp/crop.jpg', { viewing: ['wxfile://open.jpg'] })
  assert.deepEqual(viewed, ['wxfile://next.jpg'])
  assert.deepEqual(kept, { path: 'wxfile://saved.jpg', persisted: true })

  const only = []
  const blocked = await persistPhoto({
    getSavedFileList({ success }) {
      success({ fileList: [{ filePath: 'wxfile://open.jpg', size: 9 * 1024 * 1024, createTime: 1 }] })
    },
    getFileInfo({ success }) { success({ size: 2 * 1024 * 1024 }) },
    removeSavedFile({ filePath, success }) { only.push(filePath); success({}) },
    saveFile() { throw new Error('should not save') },
  }, '/tmp/crop.jpg', { viewing: 'wxfile://open.jpg' })
  assert.deepEqual(only, [])
  assert.deepEqual(blocked, { path: '/tmp/crop.jpg', persisted: false })
})

test('屏幕上这份足迹照片不会为了腾额度被删掉', async () => {
  const removed = []
  global.getCurrentPages = () => [{
    _sessionPhotos: [{ path: 'wxfile://open.jpg', persisted: true }],
    data: {},
  }]
  try {
    const photo = await persistPhoto({
      getSavedFileList({ success }) {
        success({ fileList: [
          { filePath: 'wxfile://open.jpg', size: 6 * 1024 * 1024, createTime: 1 },
          { filePath: 'wxfile://next.jpg', size: 5 * 1024 * 1024, createTime: 2 },
        ] })
      },
      getFileInfo({ success }) { success({ size: 2 * 1024 * 1024 }) },
      removeSavedFile({ filePath, success }) { removed.push(filePath); success({}) },
      saveFile({ success }) { success({ savedFilePath: 'wxfile://saved.jpg' }) },
    }, '/tmp/crop.jpg')
    assert.deepEqual(removed, ['wxfile://next.jpg'])
    assert.deepEqual(photo, { path: 'wxfile://saved.jpg', persisted: true })
  } finally {
    delete global.getCurrentPages
  }
})
