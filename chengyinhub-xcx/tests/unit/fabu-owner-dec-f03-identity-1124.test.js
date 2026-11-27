// Lane DEC-F03(2026-11-24):L03-008 / L03-072 业主默认 A ——
// 判断是否同一人只看账号和操作身份,不再看登录凭证本身;模板结果被丢弃时提示「请重新选择」。
// 服务端仍按归属校验;换账号仍必须拦下保存,且不能把别的账号的草稿带过去。
const { test } = require('node:test')
const assert = require('node:assert/strict')

const PAGE = '../../pages/publish/fabu/index'
const payload = { name: '寒冬', publishMode: 'pro', productType: 1, chapters: [{ nodes: [{ name: '甲' }] }] }
const detail = () => ({ isDraft: true, topic: { id: 501, status: 0, name: '寒冬', configVersion: 3 },
  chapters: [{ id: 101, topicId: 501, cmsTopicNodeList: [{ id: 11, chapterId: 101, topicId: 501, name: '甲' }] }] })

function draftPage() {
  const sent = []
  const toasts = []
  const loading = []
  const stored = {}
  let member = 7
  let token = 'jwt-before-renewal'
  global.wx = {
    getStorageSync: (k) => stored[k], setStorageSync: (k, v) => { stored[k] = v }, removeStorageSync: (k) => { delete stored[k] },
    showToast: (o) => toasts.push(o && o.title), showLoading: () => loading.push('show'), hideLoading: () => loading.push('hide'),
    getSystemInfoSync: () => ({}), getWindowInfo: () => ({}),
  }
  global.getCurrentPages = () => []
  const answerPublishCheck = (o) => { o.success({ code: 200, data: [] }); if (o.complete) o.complete() }
  global.getApp = () => ({ globalData: {}, getUserID: () => member, getAuthorization: () => token,
    getRequestErrorMessage: (r, d) => d,
    sendRequest: (o) => (o.url === '/api/topic/publish-check' ? answerPublishCheck(o) : sent.push(o)) })
  let config
  global.Page = (value) => { config = value }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const page = config
  page.data = { operationScope: '', editingTopicId: '501', editLoaded: true, editIsDraft: true, submitting: false, draftSaving: false,
    draftUuid: 'u-1', draftMemberId: 7, formData: { name: '寒冬', imgUrl: 'media-asset:1', chapters: [] }, pendingMaterials: [] }
  page.setData = (patch, cb) => { Object.assign(page.data, patch); if (cb) cb() }
  page._buildSubmitPayload = () => JSON.parse(JSON.stringify(payload))
  page.applyEditingTopic = function (d) { this.setData({ editIsDraft: d.isDraft === true, editLoaded: true }); this._finishEditingDraftBootstrap(d); return true }
  return { page, sent, toasts, loading, stored,
    renewToken: () => { token = 'jwt-after-silent-renewal' }, switchMember: (id) => { member = id } }
}

test('L03-008 保存草稿途中登录静默续期(同一账号):回包照常处理,遮罩与「保存中」结束', () => {
  const t = draftPage()
  t.page.saveServerDraft()
  assert.equal(t.sent.length, 1)
  assert.equal(t.page.data.draftSaving, true)
  t.renewToken()
  t.sent[0].success({ code: 200, data: 501 })
  assert.equal(t.sent.length, 2, '续期后仍推进到回读,不再丢回包')
  assert.match(t.sent[1].url, /author-saved-detail|edit-detail/)
  t.sent[1].success({ code: 200, data: detail() })
  assert.equal(t.page.data.draftSaving, false, '保存状态结束')
  assert.equal(t.page._serverDraftBusy(), false, '发布不再一直提示「正在保存草稿」')
  assert.equal(t.loading.at(-1), 'hide', '遮罩消失')
})

test('L03-008 续期后再保存复用同一个保存器;只换凭证不重建、不丢在途状态', () => {
  const t = draftPage()
  const first = t.page.getServerDraftSaver()
  t.renewToken()
  assert.equal(t.page.getServerDraftSaver(), first)
})

test('L03-008 读入草稿后换账号再点保存:不发请求,也不把原账号的草稿带给新账号', () => {
  const t = draftPage()
  t.switchMember(8)
  t.page.saveServerDraft()
  assert.equal(t.sent.length, 0, '换账号后保存被拦下')
  assert.equal(t.toasts.at(-1), '登录账号已变化，请重新进入编辑器')
  assert.equal(t.page.data.draftSaving, false)
})

test('L03-008 保存在途时换账号:迟到回包不推进回读或发布,不改新账号的页面', () => {
  const t = draftPage()
  t.page.saveServerDraft()
  t.switchMember(8)
  const before = JSON.stringify(t.page.data)
  t.sent[0].success({ code: 200, data: 501 })
  assert.equal(t.sent.length, 1, '不对另一个账号发回读')
  assert.equal(JSON.stringify(t.page.data), before)
  const second = t.page.getServerDraftSaver()
  assert.notEqual(second, null)
  assert.equal(t.page._serverDraftContext.includes('"7"'), true, '保存器仍绑原草稿所属账号,不会被新账号复用来写')
  t.page.saveServerDraft()
  assert.equal(t.sent.length, 1, '新账号再点保存同样被拦')
})

// ===== L03-072 模板采用 / 选择 =====
function adoptionPage() {
  let config
  let member = '7'
  let auth = 'a'
  const storage = {}
  const sent = []
  const toasts = []
  global.wx = { getStorageSync: (k) => storage[k], setStorageSync: (k, v) => { storage[k] = v }, removeStorageSync: (k) => { delete storage[k] },
    getSystemInfoSync: () => ({}), showToast: (o) => toasts.push(o.title) }
  global.getApp = () => ({ globalData: {}, getUserID: () => member, getAuthorization: () => auth, sendRequest: (o) => sent.push(o),
    getRequestErrorMessage: (r, f) => r.msg || f })
  global.Page = (c) => { config = c }
  delete require.cache[require.resolve(PAGE)]
  require(PAGE)
  const p = { ...config, data: structuredClone(config.data) }
  p.setData = (v, cb) => {
    for (const [key, value] of Object.entries(v)) {
      const parts = key.split('.')
      let o = p.data
      for (const part of parts.slice(0, -1)) o = o[part]
      o[parts.at(-1)] = value
    }
    if (cb) cb()
  }
  Object.assign(p.data, { draftMemberId: '7', draftUuid: 'draft-a', editingTopicId: '501', operationScope: '',
    selectedTempSource: 'public', selectedTempId: 11, nodesForm: { name: '原稿', templateId: 5 } })
  p._templateSupportReason = () => ''
  let bound = null
  p._bindNodeTemplate = (v) => { bound = v; return true }
  return { p, sent, storage, toasts, bound: () => bound, realBind: config._bindNodeTemplate, renew: () => { auth = 'b' }, switchMember: () => { member = '8' } }
}
const source = { id: '9007199254740993', title: '来源' }
const version = 'a'.repeat(64)
const draftId = '9007199254740995'
const adopted = { id: draftId, title: '采用稿', advancedConfigJson: '{}' }
function startAdoption(h) {
  h.p._adoptPublicTemplate(source)
  h.sent[0].success({ code: 200, data: { originalTemplateId: source.id, sourceVersion: version, title: source.title } })
  return h.sent[1]
}
function receipt(h) {
  const r = Object.values(h.storage)[0]
  return { code: 200, data: { requestId: r.requestId, originalTemplateId: source.id, sourceVersion: version, status: 'COMPLETED', draftId } }
}

test('L03-072 采用公共模板途中登录续期(同一账号):照常绑定,不再点了没反应', () => {
  const h = adoptionPage()
  const write = startAdoption(h)
  h.renew()
  write.success(receipt(h))
  h.sent.at(-1).success({ code: 200, data: adopted })
  assert.deepEqual(h.bound(), adopted)
  assert.equal(h.toasts.includes('请重新选择'), false)
})

test('L03-072 采用途中为打开浮层隐藏页面:照常绑定,不再点了没反应', () => {
  const h = adoptionPage()
  const write = startAdoption(h)
  h.p.onHide()
  write.success(receipt(h))
  h.sent.at(-1).success({ code: 200, data: adopted })
  assert.deepEqual(h.bound(), adopted)
  assert.equal(h.toasts.includes('请重新选择'), false)
})

test('L03-072 采用途中换账号:结果被丢弃、不绑定,并提示「请重新选择」', () => {
  const h = adoptionPage()
  const write = startAdoption(h)
  h.switchMember()
  write.success(receipt(h))
  assert.equal(h.bound(), null)
  assert.equal(h.p.data.nodesForm.templateId, 5)
  assert.equal(h.toasts.at(-1), '请重新选择')
})

test('L03-072 选「我的玩法」读详情途中续期或打开浮层照常绑定;换节点后被丢弃时提示「请重新选择」', () => {
  for (const change of ['renew', 'hide', 'node']) {
    const h = adoptionPage()
    h.p._bindNodeTemplate = h.realBind
    h.p._openNodePlanEndings = () => {}
    h.p._bindNodeTemplate({ id: 77, title: '我的玩法' })
    const read = h.sent.find((r) => r.url === '/api/template/author-myinfo')
    assert.ok(read, change)
    if (change === 'renew') h.renew()
    else if (change === 'hide') h.p.onHide()
    else h.p.data.nodesForm = { name: '另一节点', templateId: 9 }
    read.success({ code: 200, data: { id: 77, title: '我的玩法', advancedConfigJson: '{}' } })
    if (change === 'renew' || change === 'hide') {
      assert.equal(h.p.data.nodesForm.templateId, 77, '续期或藏页开浮层不是换人')
      assert.equal(h.toasts.includes('请重新选择'), false)
    } else {
      assert.equal(h.p.data.nodesForm.templateId, 9)
      assert.equal(h.toasts.at(-1), '请重新选择')
    }
  }
})
