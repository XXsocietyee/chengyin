// l-pass 通行证开通编排(从视图模块拆出,台账按调用点归属写接口)。
// 「已开通」只认服务端订单状态 PAID;requestVirtualPayment 的成功回调不算已付。
// 2026-11-13:通行证只走虚拟支付(wx.requestVirtualPayment),不再有普通 JSAPI 支付。
'use strict'

function orderPaid(order) { return !!(order && order.status === 'PAID') }

// 回查间隔必须能在离页时清掉。stopped 拦住已经排上的下一跳;stop 同时 resolve 当前等待,避免悬挂。
function pollGate() {
  let stopped = false
  let timer = null
  let finishWait = null
  return {
    stopped() { return stopped },
    stop() {
      stopped = true
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
      if (finishWait) finishWait()
    },
    wait(ms) {
      return new Promise((resolve) => {
        if (stopped) { resolve(); return }
        finishWait = () => { finishWait = null; resolve() }
        timer = setTimeout(() => {
          timer = null
          const done = finishWait
          finishWait = null
          if (done) done()
        }, ms)
      })
    }
  }
}

function attachCancel(task, stop) {
  task.cancel = stop
  return task
}

function bizOk(res) { return res && String(res.code) === '200' && res.data }

function newRequestId() {
  return 'pp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

/**
 * 开通流程。返回 Promise<{ state: 'paid'|'pending'|'cancelled'|'failed', order?, orderNo?, message? }>。
 * 只走虚拟支付(XPAY),不再有 JSAPI 分支。opts.requestId:同一次购买意图重试沿用同一个,服务端按它幂等。
 * deps: { request(opts)->Promise<res>, wx }
 */
function purchase(deps, planCode, channel, opts) {
  const request = deps.request
  const requestId = (opts && opts.requestId) || newRequestId()
  const gate = pollGate()
  if (channel !== 'XPAY') return attachCancel(Promise.resolve({ state: 'failed', message: '当前设备暂不支持开通' }), gate.stop)
  const task = request({ url: '/api/platform-pass/orders', method: 'POST', write: true, data: { planCode, channel, requestId } })
    .then((res) => {
      if (gate.stopped()) return { state: 'pending' }
      if (!bizOk(res)) return { state: 'failed', message: res && res.msg }
      return proceed(deps, res.data, gate)
    }, () => (gate.stopped() ? { state: 'pending' } : { state: 'failed' }))
  return attachCancel(task, gate.stop)
}

/** 已有订单继续:PAID 直接返回;待支付再拉起支付;其他状态只回查,不再支付。 */
function resume(deps, orderNo, canPay) {
  const sendRequest = deps.request
  const gate = pollGate()
  const task = sendRequest({ url: '/api/platform-pass/orders/' + encodeURIComponent(orderNo), method: 'GET' }).then((res) => {
    if (gate.stopped()) return { state: 'pending', orderNo }
    if (!bizOk(res)) return { state: 'failed', orderNo, message: res && res.msg }
    const order = res.data
    if (orderPaid(order)) return { state: 'paid', order, orderNo }
    if (order.status !== 'PENDING') return { state: 'closed', order, orderNo }
    if (!canPay || order.channel !== 'XPAY') return { state: 'pending', order, orderNo }
    return proceed(deps, order, gate)
  }, () => (gate.stopped() ? { state: 'pending', orderNo } : { state: 'failed', orderNo }))
  return attachCancel(task, gate.stop)
}

function proceed(deps, order, gate) {
  const request = deps.request
  const sendRequest = deps.request // 轮询读单:与 app.sendRequest 同形(GET 权限矩阵按调用点登记)
  const wxApi = deps.wx
  const session = gate || pollGate()
  const pollTimes = deps.pollTimes || 4
  const wait = deps.wait || ((ms) => session.wait(ms))
  const orderNo = order.orderNo

  function poll(n) {
    if (session.stopped()) return Promise.resolve({ state: 'pending', orderNo })
    return sendRequest({ url: '/api/platform-pass/orders/' + orderNo, method: 'GET' }).then((res) => {
      const o = bizOk(res) ? res.data : null
      if (orderPaid(o)) return { state: 'paid', order: o, orderNo }
      if (n <= 1 || session.stopped()) return { state: 'pending', order: o, orderNo }
      return wait(1500).then(() => (session.stopped() ? { state: 'pending', order: o, orderNo } : poll(n - 1)))
    }, () => (n <= 1 || session.stopped() ? { state: 'pending', orderNo } : wait(1500).then(() => (session.stopped() ? { state: 'pending', orderNo } : poll(n - 1)))))
  }

  function payXpay(vp) {
    return new Promise((resolve) => {
      if (!wxApi.requestVirtualPayment) { resolve('fail'); return }
      wxApi.requestVirtualPayment({
        mode: vp.mode, signData: vp.signData, paySig: vp.paySig, signature: vp.signature,
        success: () => resolve('ok'),
        fail: (e) => resolve(e && (Number(e.errCode) === -2 || /cancel/.test(String(e.errMsg || ''))) ? 'cancel' : 'fail')
      })
    })
  }

  function login() {
    return new Promise((resolve) => wxApi.login({ success: (r) => resolve(r && r.code), fail: () => resolve('') }))
  }

  return login()
    .then((jsCode) => request({ url: '/api/platform-pass/orders/' + orderNo + '/pay', method: 'POST', write: true, data: jsCode ? { jsCode } : {} }))
    .then((payRes) => {
      if (!bizOk(payRes)) return { state: 'failed', orderNo, message: payRes && payRes.msg }
      const d = payRes.data
      return (d.virtualPayment ? payXpay(d.virtualPayment) : Promise.resolve('fail')).then((r) => {
        // 取消支付只是这一次没付,订单与已有会员都不动
        if (r === 'cancel') return { state: 'cancelled', orderNo }
        // 失败也回查一次:SDK 失败不等于没扣款;成功也必须等服务端 PAID
        return request({ url: '/api/platform-pass/orders/' + orderNo + '/confirm', method: 'POST', write: true })
          .then((c) => (bizOk(c) && orderPaid(c.data) ? { state: 'paid', order: c.data, orderNo } : null), () => null)
          .then((done) => done || (r === 'ok' ? poll(pollTimes) : poll(1).then((x) => (x.state === 'paid' ? x : { state: 'failed', orderNo }))))
      })
    }, () => ({ state: 'failed', orderNo }))
}

module.exports = { purchase, resume, newRequestId, orderPaid }
