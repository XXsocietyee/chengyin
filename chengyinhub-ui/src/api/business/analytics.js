import request from '@/utils/request'

export function listFunnel(query) {
  return request({
    url: '/business/analytics/funnel',
    method: 'get',
    params: query
  })
}

// U08-04 / §27.4：完局维护与有效复报（只读即时计算）。
export function getPostGameOutcome(query) {
  return request({
    url: '/business/analytics/post-game-outcome',
    method: 'get',
    params: query,
    rawBusinessError: true
  })
}

// R6：路线购买与游玩漏斗（服务端事实，只读）。
export function getRouteFunnel(query) {
  return request({
    url: '/business/analytics/route-funnel',
    method: 'get',
    params: query
  })
}

// R6：repeat_signup_v1 30 日复购（只读）。
export function getRepeatSignup(query) {
  return request({
    url: '/business/analytics/repeat-signup',
    method: 'get',
    params: query
  })
}

// R7 路线与站点到访报告（只读聚合；<3 为小格子抑制，null 为未知）。
export function getRouteVisitorReport(query) {
  return request({
    url: '/business/analytics/route-visitor',
    method: 'get',
    params: query
  })
}

// 同一份报告的 CSV；控制器只开 GET 只读端点，故用 GET + blob（失败时服务端回 JSON）。
export function exportRouteVisitorReport(query) {
  return request({
    url: '/business/analytics/route-visitor/export',
    method: 'get',
    params: query,
    responseType: 'blob'
  })
}
