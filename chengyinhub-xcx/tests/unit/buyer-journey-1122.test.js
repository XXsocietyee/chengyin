// 买家走查 1122(JOURNEY-BUYER-1122):新玩家从路线详情 → 购买 → 票夹 / 订单 / 礼品 / 失败路径,
// 每一处修复各钉一条:失败要看得见并只给一个下一步;游客能看,写动作才弹登录;文案与去处一致。
// 只钉界面、导航与文案,不碰金额、订单状态机、退款与支付调用。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm') // toast/modal 由本文件自己打桩(见 loadPage)

const ROOT = path.resolve(__dirname, '../..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '')

function loadPage(rel, opts = {}) {
  let definition
  const calls = { navs: [], redirects: [], toasts: [], modals: [], requests: [], logins: [] }
  const base = Object.assign({
    navigateTo: (o) => calls.navs.push(o), redirectTo: (o) => calls.redirects.push(o), navigateBack: () => calls.navs.push({ back: true }),
    switchTab: (o) => calls.navs.push(o), getStorageSync: () => '', getSystemInfoSync: () => ({}), getWindowInfo: () => ({}),
  }, opts.wx || {})
  const wx = new Proxy(base, { get(t, k) { return k in t ? t[k] : () => {} } })
  const appBase = Object.assign({
    globalData: {},
    sendRequest(o) { calls.requests.push(o); return { abort() {} } },
  }, opts.app || {})
  const app = new Proxy(appBase, { get(t, k) { return k in t ? t[k] : () => '' } })
  const toast = (msg) => calls.toasts.push(msg)
  const modal = { show: (o) => calls.modals.push(o), confirm: (o) => calls.modals.push(o) }
  const pageDir = path.dirname(path.join(ROOT, rel))
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), {
    getApp: () => app,
    getCurrentPages: () => opts.pages || [{}],
    Page(page) { definition = page },
    Component() {},
    require(request) {
      if (/\/toast\.js$/.test(request)) return toast
      if (/\/modal\.js$/.test(request)) return modal
      return require(path.resolve(pageDir, request))
    },
    Set, Map, Date, JSON, Promise, Math, Number, String, Object, Array, RegExp, wx,
    setTimeout: () => 0, clearTimeout() {}, console,
  }, { filename: path.join(ROOT, rel) })
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch, cb) { for (const k of Object.keys(patch)) setPath(this.data, k, patch[k]); if (cb) cb() },
  })
  return { page, calls }
}

function setPath(obj, key, value) {
  const parts = key.split('.')
  let o = obj
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {}
  o[parts[parts.length - 1]] = value
}

// ---------- 1. 路线详情 / 结算层 ----------
test('结算层开着时,下单/付款失败原文留在底栏(带重试),不再只闪 toast;结算层没开时仍 toast', () => {
  const { page, calls } = loadPage('pages/topic/index/index.js')
  page.data.selfPlayCheckoutShow = true
  page._showCheckoutFailure('名额已满')
  // AUDIT-1122 L06-077:失败原文进独立的 checkoutError(底栏同一处显示),勾选同意不再冲掉
  assert.equal(page.data.checkoutError, '名额已满')
  page.onSelfPlayConsentChange({ detail: { checked: true } })
  assert.equal(page.data.checkoutError, '名额已满')
  assert.deepEqual(calls.toasts, [])
  page.data.selfPlayCheckoutShow = false
  page._showCheckoutFailure('支付失败')
  assert.deepEqual(calls.toasts, ['支付失败'])
  const js = read('pages/topic/index/index.js')
  assert.match(js, /onOrderFail[\s\S]{0,700}that\._showCheckoutFailure\(res && res\.msg \|\| '下单失败'\)/)
  assert.match(js, /onPayFail[\s\S]{0,500}_payFailReason === 'sdk_fail'[\s\S]{0,180}'支付结果未确认，请到订单查看，勿重复支付'/)
  assert.match(js, /onPayFail[\s\S]{0,700}res && res\.errMsg \|\| '支付失败'/)
  // 取消仍是轻提示:不是失败,不占底栏
  assert.match(js, /onPayCancel[\s\S]{0,200}toast\('已取消支付'\)/)
  // 底栏错误旁的「重试」就是原支付按钮的同一出口
  assert.match(read('pages/topic/components/cy/self-play-checkout/index.wxml'), /\{\{consentError\}\}[\s\S]{0,80}bindtap="onPay"[^>]*>重试</)
})

test('剧情付费墙「已购？去票夹」进票夹(开玩只从票夹进),不再指向我的订单', () => {
  const wxml = read('pages/topic/index/index.wxml')
  assert.match(wxml, /topic-story-paywall__orders" bindtap="goJoinedPlay"[^>]*>已购？去票夹<\/view>/)
  assert.doesNotMatch(wxml, /去「我的订单」找回/)
  const { page, calls } = loadPage('pages/topic/index/index.js')
  page.data.id = 42
  page.goJoinedPlay()
  assert.match(calls.navs[0].url, /^\/subpackageMember\/signup\/index\?stype=0/)
})

test('补资料提示不说内部词「建单」', () => {
  const js = read('pages/topic/index/index.js')
  assert.match(js, /content: '下单需要真实姓名和手机号'/)
  assert.doesNotMatch(js, /content: '建单要用/)
})

// ---------- 2. 场次结算:支付结果待确认 ----------
test('场次结算支付结果待确认:有单号时唯一按钮「查看订单」直达原单;无单号只「知道了」', () => {
  const withId = loadPage('pages/activity/baoming/baoming.js')
  withId.page._regId = 77
  withId.calls.modals.push(withId.page._paymentUnknownDialog('请勿重复支付，稍后到订单中查看结果'))
  const m = withId.calls.modals[0]
  assert.equal(m.title, '支付结果待确认')
  assert.equal(m.showCancel, false)
  assert.equal(m.confirmText, '查看订单')
  m.success({ confirm: true })
  assert.equal(withId.calls.redirects[0].url, '/subpackageMember/orderinfo/orderinfo?id=77&from=signup')

  const noId = loadPage('pages/activity/baoming/baoming.js')
  noId.calls.modals.push(noId.page._paymentUnknownDialog('x'))
  assert.equal(noId.calls.modals[0].confirmText, '知道了')
  noId.calls.modals[0].success({ confirm: true })
  assert.equal(noId.calls.redirects.length, 0)
  const js = read('pages/activity/baoming/baoming.js')
  assert.equal((js.match(/modal\.show\(that\._paymentUnknownDialog\(/g) || []).length, 2, 'onPayUnknown 与重复点击两处都走同一出口')
  assert.doesNotMatch(js, /我的-订单/)
})

// ---------- 3. 票夹空态 ----------
test('票夹空态给一个「去探索」,不是一句话的死胡同', () => {
  const wxml = read('subpackageMember/signup/index.wxml')
  assert.match(wxml, /walletState === 'empty'[\s\S]{0,200}title="还没有票" primary="去探索"[^>]*bind:primary="goExplore"/)
})

// ---------- 4. 好友领取礼品 ----------
test('礼品领取页:游客能看到礼品,点「领取」才弹登录且不发请求;登录后原地继续', () => {
  const wxml = strip(read('subpackageMember/market/gift/index.wxml'))
  assert.doesNotMatch(wxml, /cy-access-gate/)
  assert.equal(JSON.parse(read('subpackageMember/market/gift/index.json')).usingComponents['cy-access-gate'], undefined)
  let resume = null
  const { page, calls } = loadPage('subpackageMember/market/gift/index.js', {
    app: { ensureLoginFor: (reason, fn) => { calls.logins.push(reason); resume = fn; return false } },
  })
  page._token = 'tok'
  page.claim()
  assert.deepEqual(calls.logins, ['登录后即可领取礼品'])
  assert.equal(calls.requests.length, 0)
  assert.equal(typeof resume, 'function')
})

test('礼品领取失败(已被领取/过期)给一个「返回」,不再只剩一句原因', () => {
  const wxml = strip(read('subpackageMember/market/gift/index.wxml'))
  assert.match(wxml, /gf__bar" wx:if="\{\{state === 'failed'\}\}">\s*<cy-btn[^>]*bindtap="goBack">返回<\/cy-btn>/)
})

// ---------- 5. 通行证详情 / 礼品链接 ----------
test('通行证:商品被服务端明确拒绝(下架/不存在)给「返回」,网络失败才「重试」', () => {
  const a = loadPage('subpackageMember/market/pass/index.js', { pages: [{}, {}] })
  a.page._id = '9'
  a.page.load()
  a.calls.requests[0].success({ code: 200, reasonCode: 'PRODUCT_NOT_FOUND' })
  assert.equal(a.page.data.state, 'error')
  assert.equal(a.page.data.errorCta, '返回')
  a.page.onErrorCta()
  assert.deepEqual(a.calls.navs, [{ back: true }])

  const b = loadPage('subpackageMember/market/pass/index.js')
  b.page._id = '9'
  b.page.load()
  b.calls.requests[0].fail()
  assert.equal(b.page.data.errorCta, '重试')
  b.page.onErrorCta()
  assert.equal(b.calls.requests.length, 2, '重试 = 重新读商品')

  const c = loadPage('subpackageMember/market/pass/index.js', { pages: [{}, {}] })
  c.page.load()
  assert.equal(c.page.data.errorCta, '返回')
  assert.match(read('subpackageMember/market/pass/index.wxml'), /retry="\{\{errorCta\}\}" bind:retry="onErrorCta"/)
})

test('通行证:报价没取到给「重试」按钮,不让底栏只剩一句话', () => {
  const { page, calls } = loadPage('subpackageMember/market/pass/index.js', {
    app: { getAuthorization: () => 'Bearer x', getUserID: () => '1', globalData: { token: 'x' } },
  })
  page._id = '9'
  page.quote = page.quote.bind(page)
  // 只验报价失败分支落 requote 态:直接驱动 setData 路径
  page.setData({ buy: { state: 'requote', reason: '报价暂不可用', payModes: [] } })
  const wxml = read('subpackageMember/market/pass/index.wxml')
  assert.match(wxml, /wx:if="\{\{buy\.state === 'requote'\}\}" variant="primary" bindtap="retryQuote">重试<\/cy-btn>/)
  const js = read('subpackageMember/market/pass/index.js')
  assert.match(js, /fail: \(\) => \{[\s\S]{0,260}buy: \{ state: 'requote', reason: '报价暂不可用', payModes: \[\] \}/)
  assert.doesNotMatch(js, /报价暂不可用，请稍后重试/)
  let quoted = 0
  page.quote = () => { quoted++ }
  page.retryQuote()
  assert.equal(quoted, 1)
  assert.equal(calls.redirects.length, 0)
})

test('通行证礼品:领取链接只出现一次 —— 没发出去就关面板先确认;发过再关直接走', () => {
  const wxml = read('subpackageMember/market/pass/index.wxml')
  assert.match(wxml, /<cy-sheet show="\{\{giftSheet\}\}"[^>]*dirty="\{\{!giftShared\}\}" bind:requestclose="closeGiftSheet">/)
  const a = loadPage('subpackageMember/market/pass/index.js')
  a.page.setData({ giftSheet: true })
  a.page.closeGiftSheet()
  assert.equal(a.calls.redirects.length, 0)
  const m = a.calls.modals[0]
  assert.equal(m.title, '礼品还没发给好友')
  assert.equal(m.cancelText, '去发送')
  m.success({ confirm: false })
  assert.equal(a.calls.redirects.length, 0, '选「去发送」留在面板')
  m.success({ confirm: true })
  assert.equal(a.calls.redirects[0].url, '/subpackageMember/market/passes/index?tab=gifts')

  const b = loadPage('subpackageMember/market/pass/index.js')
  b.page._id = '9'
  b.page._giftToken = 'tok'
  b.page.data.card = { name: '城瘾30天通行证' }
  const share = b.page.onShareAppMessage()
  assert.match(share.path, /market\/gift\/index\?token=tok$/)
  assert.equal(b.page.data.giftShared, false, '打开分享菜单还不是成功分享')
  b.page.closeGiftSheet()
  assert.equal(b.calls.modals.length, 1, '没成功分享不能提前清掉离开确认')
  assert.equal(b.calls.modals[0].title, '礼品还没发给好友')
  assert.equal(b.calls.redirects.length, 0)
})

test('通行证列表:加座不进「可购买」;礼品行写出送的是哪张', () => {
  const js = read('subpackageMember/market/passes/index.js')
  assert.match(js, /products: cards\.filter\(\(c\) => !c\.isExtraSeat\)/)
  assert.match(js, /mv\.giftRow\(g, 'bought', nameById\)/)
  assert.match(js, /mv\.giftRow\(g, 'received', nameById\)/)
  const mv = require(path.join(ROOT, 'subpackageMember/utils/market-view.js'))
  const row = mv.giftRow({ giftId: 1, status: 0, productId: 5 }, 'bought', { 5: '城瘾30天通行证' })
  assert.equal(row.name, '城瘾30天通行证')
  assert.equal(row.state, '待领取 · 领取前你和对方都不能游玩')
  assert.equal(mv.giftRow({ giftId: 2, status: 1 }, 'received').name, '')
  const wxml = read('subpackageMember/market/passes/index.wxml')
  assert.equal((wxml.match(/mk-row__title">\{\{item\.name \|\| item\.state\}\}/g) || []).length, 2)
})

// ---------- 6. 订单列表 / 详情 ----------
test('订单详情读失败(断网/后端拒绝)不再留白:原因原样 + 一个「重试」;参数/权限仍走结果半屏', () => {
  const wxml = strip(read('subpackageMember/components/cy/scene-member-order-detail/index.wxml'))
  assert.match(wxml, /<cy-empty class="order-load-failed" wx:if="\{\{\(loadState==='failed_network' \|\| loadState==='failed_business'\) && !loadFailureVisible\}\}"[^>]*title="\{\{loadErrorText\}\}" cta="重试" bind:cta="reloadOrder" \/>/)
  assert.match(wxml, /<cy-result-sheet show="\{\{loadFailureVisible\}\}"/)
  assert.match(read('subpackageMember/components/cy/scene-member-order-detail/index.wxss'), /\.order-load-failed\s*\{/)
})

test('订单列表首屏读失败给「订单加载失败 · 重试」;登录/无权不再重复一句副文案', () => {
  const wxml = strip(read('subpackageMember/components/cy/scene-member-order-history/index.wxml'))
  const tag = wxml.match(/<cy-error class="cy-fade-in"\s+wx:elif="\{\{errorMsg && list\.length==0\}\}"[\s\S]*?\/>/)
  assert.ok(tag, '首屏错误态必须在')
  assert.doesNotMatch(tag[0], /load-failure|sub=/)
  assert.match(tag[0], /'订单加载失败'/)
  assert.match(tag[0], /bind:retry="retryList"/)
})

test('退款相关用语一致:列表与详情同叫「取消并退款」;已退款标题与药丸同为「退款成功」', () => {
  const list = read('subpackageMember/components/cy/scene-member-order-history/index.wxml')
  assert.doesNotMatch(list, /'申请退款'/)
  assert.match(list, /item\.isFreeOrder \? '取消报名' : '取消并退款'/)
  const detail = read('subpackageMember/components/cy/scene-member-order-detail/index.js')
  assert.match(detail, /refunded: '退款成功'/)
  assert.match(read('utils/order-status.js'), /退款成功/)
})

test('订单页没有下拉刷新,文案不再许诺「下拉刷新」', () => {
  for (const rel of ['subpackageMember/components/cy/scene-member-order-history/index.js',
    'subpackageMember/components/cy/scene-member-order-detail/index.js']) {
    assert.doesNotMatch(read(rel), /下拉刷新/, rel)
  }
  assert.notEqual(JSON.parse(read('subpackageMember/order/order.json')).enablePullDownRefresh, true)
})

test('L09-034 付款回查在途时离页:迟到的 PAID 不再 redirectTo 顶掉当前页', () => {
  const { page, calls } = loadPage('subpackageMember/market/pass/index.js', { pages: [{}, {}] })
  page._verify('ORD1', 0)
  const req = calls.requests.at(-1)
  page.onUnload()
  req.success({ code: 200, data: { orderNo: 'ORD1', statusLabel: 'PAID' } })
  assert.equal(calls.redirects.length, 0)
  page._verify('ORD1', 1)
  assert.equal(calls.requests.length, 1, '卸载后重试计时器触发也不再查')
})

test('L09-106 礼品页光圈只在待领取且可见时转', () => {
  const { page, calls } = loadPage('subpackageMember/market/gift/index.js', { app: { ensureLoginFor: () => true } })
  page.onLoad({ token: 'tok' }); page.onShow()
  assert.ok(page._glow, '待领取时转')
  page.onHide(); assert.equal(page._glow, null, '切走就停')
  page.onShow(); assert.ok(page._glow)
  page.claim()
  calls.requests.at(-1).success({ code: 200, data: { registrationId: 1 } })
  assert.equal(page._glow, null, '领到后停')
})

test('L09-102 会员页「确认中」去订单页回来后重读开通状态并清掉旧提示', () => {
  const { page, calls } = loadPage('subpackageMember/market/membership/index.js')
  page.load(); page._overview = { plans: [] }
  page._confirmOrderNo = 'PO1'; page.setData({ buyError: '确认中' })
  const before = calls.requests.length
  page.onShow()
  assert.equal(page.data.buyError, '')
  assert.equal(calls.requests.length, before + 1)
  page.onShow()
  assert.equal(calls.requests.length, before + 1, '没有待确认单就不重读')
})

test('L09-041 卡券中心回来只重读可能变了的数据', () => {
  const { page } = loadPage('subpackageMember/market/passes/index.js')
  const hits = []
  const realLoad = page.load
  page.load = function (q) { hits.push('list'); realLoad.call(this, q) }; page.loadMember = () => hits.push('member'); page.loadPoints = () => hits.push('points')
  page._loaded = true; page._loadedAt = Date.now()
  page.onShow(); hits.length = 0; page._loaded = true // 首次对齐身份(真实场景由回包置 _loaded)
  page._loadedAt = Date.now()
  page.onShow()
  assert.deepEqual(hits, [], '同身份、刚读过、没去别处 ⇒ 不重读')
  page.goPoints(); page.onShow()
  assert.deepEqual(hits, ['points'], '只去了积分页 ⇒ 只重读积分')
  hits.length = 0
  page._navigating = false; page.openProduct({ currentTarget: { dataset: { id: 'p1' } } }); page.onShow()
  assert.deepEqual(hits, ['list', 'member', 'points'], '去过购买页 ⇒ 列表、会员、积分')
  hits.length = 0
  page._loadedAt = Date.now() - 31000; page.onShow()
  assert.deepEqual(hits, ['list', 'member', 'points'], '超过 30 秒 ⇒ 全部')
})
