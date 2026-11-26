'use strict'
// RECHECK-FIX-1122:VERIFY-E/VERIFY-D 复核后剩余的小程序文案项(PG-063/064/065/066/068/070/071/073/076/089、
// MC-044/047/049、OR-027、PART2 merchant/decor)。只钉「旧说法已撤 / 新说法到位」,不钉排版。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('PG-063 首页预告与漫游面去掉辅助副句', () => {
  assert.doesNotMatch(read('pages/index/index.wxml'), /v3-upreview-desc/)
  const roam = read('pages/roam/index.wxml')
  for (const s of ['你走过的是绿的', '拍一张，传上去', '先写再看：写一句', '已到过、已打卡的节点先不显示', '范围只影响漫游节点']) {
    assert.ok(!roam.includes(s), s)
  }
  assert.doesNotMatch(read('subpackageRoam/session/index.wxml'), /sub="分享已失效"/)
})

test('PG-064 通行证揭晓页、搜索结果与地图搜索去掉说明句', () => {
  assert.doesNotMatch(read('subpackagePass/reveal/index.js'), /价格都是 ¥0/)
  assert.doesNotMatch(read('pages/search2/result/index.js'), /contentFilterNotice|清除类别、日期和价格筛选后/)
  assert.doesNotMatch(read('pages/search2/result/index.wxml'), /contentFilterNotice/)
  const smap = read('pages/searchmap/index.wxml')
  assert.doesNotMatch(smap, /换个关键词试试|无位置，仅列表显示/)
})

test('PG-065 官方活动奖励两行说明撤掉、坐标标签不写 WGS84', () => {
  assert.doesNotMatch(read('pages/activity/official-detail/index.wxml'), /按上方配置发放|以活动结算为准/)
  assert.doesNotMatch(read('pages/activity/components/event-attendance/index.js'), /'WGS84纬度'|'WGS84经度'/)
})

test('PG-066 发布预览不再挂「到店核销」「已收入你的成就墙」副行', () => {
  const wxml = read('pages/publish/temp/index.wxml')
  assert.doesNotMatch(wxml, /cg-pv-coupon-sub|cg-pv-medal-sub/)
})

test('PG-068 合作商家页:无简介不编兜底句、模式介绍只留标题与选项名、分润锁定句撤掉', () => {
  const wxml = read('pages/topic/merchantinfo/merchantinfo.wxml')
  assert.doesNotMatch(wxml, /一条可由商家承接的城市路线/)
  assert.doesNotMatch(wxml, /davidbmtk_top_txt|davidbmtk_box_ly/)
  // 业主 2026-11-24:模式介绍弹层整个删除(承接方式由主题类型固定),不再有那两个选项名
  assert.doesNotMatch(wxml, /路线模式介绍|davidbmtk/)
  assert.doesNotMatch(wxml, /档位按章节在开售时定好/)
  assert.doesNotMatch(read('pages/topic/index/index.wxml'), /购买后可在地图上发起或加入组队/)
})

test('PG-070 / PG-071 合作资产与会员子包副句', () => {
  const mp = read('subpackageA/pages/myproject/index.wxml')
  assert.doesNotMatch(mp, /最多6张，须本人上传|每条内容可申诉一次/)
  assert.doesNotMatch(read('pages/coop/invite-detail/index.wxml'), />已锁价，修改请联系客服</)
  assert.doesNotMatch(read('subpackageP3/pages/badge-wall/index/index.wxml'), /sub="{{partialFail/)
  assert.doesNotMatch(read('subpackageMember/coupon-qr/index.wxml'), /desc="出示给商家扫码核销"/)
  const src = read('subpackageMember/character/index.js')
  const states = /const STATES = \{[\s\S]*?\n\};/.exec(src)[0]
  assert.doesNotMatch(states, /sub: '[^']+'/, 'STATES 只留 title')
})

test('PG-073 中文里的半角括号与省略号改全角', () => {
  const files = ['pages/roam/index.wxml', 'pages/activity/baoming/baoming.js', 'pages/activity/baoming/baoming.wxml',
    'pages/topic/merchantapply/index.js', 'pages/topic/index/index.js', 'pages/gerenziliao/gerenziliao.js',
    'pages/index/index.js', 'pages/publish/fabu/index.wxml', 'pages/publish/temp/index.wxml']
  for (const f of files) {
    const s = read(f)
    assert.doesNotMatch(s, /'(提交中|获取中|检查支付服务)\.\.\.'/, f)
    assert.doesNotMatch(s, />距离 \(公里\)<|>勋章 \(枚\)<|对面是谁\(可空\)|名额上限 \(家\)|更明确的引导/, f)
  }
  assert.doesNotMatch(read('pages/play/index.wxml'), /打开地图 App/)
})

test('PG-076 / PG-089 模板卡不挂「标准玩法」,邀请回执不露编号', () => {
  assert.doesNotMatch(read('pages/templatedetail/templatedetail.wxml'), /· 标准玩法/)
  const invite = read('pages/coop/invite/index.js')
  assert.doesNotMatch(invite, /原请求已创建邀请 #/)
  assert.match(invite, /邀请已创建，等待对方确认/)
})

test('MC-047 / MC-049 / OR-027 / decor', () => {
  assert.doesNotMatch(read('utils/merchant-identity-policy.js'), /个工作日内完成/)
  assert.doesNotMatch(read('pages/club/components/cy/scene-club-edit/index.wxml'), /\(选填\)/)
  assert.doesNotMatch(read('pages/deregister/deregister-flow.js'), /。'/, '提示语句末不带句号')
  assert.doesNotMatch(read('pages/merchant/decor/index.wxml'), /可联系运营/)
})
