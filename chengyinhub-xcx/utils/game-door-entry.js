'use strict'

// 小程序码 scene 的统一取值:空 → null;其余解码(已解码的原样)后去首尾空白。主包体积紧,各前缀共用这一份。
function sceneText(scene) {
  if (scene == null || scene === '') return null
  let raw = String(scene)
  try { raw = decodeURIComponent(raw) } catch (e) { /* already decoded */ }
  return raw.trim()
}

// L10-094:各前缀格式收成一张正则表,captureDoorScene 只解码一次再逐表匹配(原来同一个 scene 最多解码六次)。
const HEX32 = /^[0-9a-fA-F]{32}$/
const ID_SCENE = /^(tp|ac|sh)\.(\d{1,18})$/
const RC_SCENE = /^rc\.([1-9]\d{0,17})\.([1-9]\d{0,17})$/

function parseDoorScene(scene) {
  const raw = sceneText(scene)
  return raw != null && HEX32.test(raw) ? raw.toLowerCase() : null
}

function prefixedId(prefix, scene) {
  const m = ID_SCENE.exec(sceneText(scene))
  return m && m[1] === prefix ? m[2] : null
}

function pathForScanEntry(data) {
  if (!data || data.topicId == null || data.topicId === '') return null
  if (data.action === 'play') {
    const query = ['topicId=' + encodeURIComponent(data.topicId)]
    if (data.activityId != null && data.activityId !== '') {
      query.push('activityId=' + encodeURIComponent(data.activityId))
    }
    return '/pages/play/index?' + query.join('&')
  }
  return '/pages/topic/index/index?id=' + encodeURIComponent(data.topicId)
}

/** 小程序码进入：1047 扫码 / 1048 长按识别 / 1049 相册选取。其它 scene 可能仍带着上次的 query。 */
// 走查 v2 R15:主办方「本主题二维码」的 scene 是 tp.<主题id>(后端 /api/topic/host-qrcode),扫了进主题详情
function parseTopicScene(scene) { return prefixedId('tp', scene) }

// 2026-10-31 P-8:官方活动分享卡上的小程序码,scene = ac.<活动id>
function parseActivityScene(scene) { return prefixedId('ac', scene) }

// 第九轮 m1-9:商家主页分享卡上的店铺码,scene = sh.<商家会员ID>
function parseShopScene(scene) { return prefixedId('sh', scene) }

// l-misc(2026-11-10 业主批准):队伍邀请小程序码。后端 /api/team/invite-qrcode 的 scene:
//   tm.<六位加入码或旧 22 位 base64url 邀请码> —— 原样;
//   th.<22 位 base64url>         —— 迁移回填的 32 位十六进制旧码(scene 限 32 字符,放不下前缀 + 32 位),还原成小写十六进制。
// 返回邀请码本身(交给加入页 /api/team/info、/api/team/join 由服务端裁决),认不出就是 null。
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
function b64urlToHex(text) {
  let bits = 0
  let value = 0
  let hex = ''
  for (let i = 0; i < text.length; i++) {
    const v = B64URL.indexOf(text[i])
    if (v < 0) return null
    value = (value << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      hex += ((value >> bits) & 0xff).toString(16).padStart(2, '0')
    }
  }
  return hex
}

// 入参是已解码、已去空白的 scene 文本
function teamCode(text) {
  const short = /^tm\.([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6})$/.exec(text)
  if (short) return short[1]
  const m = /^(tm|th)\.([A-Za-z0-9_-]{22})$/.exec(text)
  if (!m) return null
  if (m[1] === 'tm') return m[2]
  const hex = b64urlToHex(m[2])
  return hex && hex.length === 32 ? hex : null
}

function parseTeamScene(scene) {
  const text = sceneText(scene)
  return text == null ? null : teamCode(text)
}

// P0-3:主办方给开放位置出的「招商码」,scene = rc.<主题id>.<章节id>(后端 /api/topic/recruit-slot-qrcode)。
// 主包体积紧,只留这一个函数:认得出就给招商位置页路径,认不出是 null。
function rcPath(scene) {
  const m = RC_SCENE.exec(sceneText(scene))
  return m ? '/pages/topic/merchantinfo/merchantinfo?id=' + m[1] + '&chapterId=' + m[2] : null
}

function isWxacodeEnter(scene) {
  const n = Number(scene)
  return n === 1047 || n === 1048 || n === 1049
}

function captureDoorScene(e, currentPending) {
  const query = (e && e.query) || {}
  const text = sceneText(query.scene)
  let code = null
  if (text != null) {
    if (HEX32.test(text)) code = text.toLowerCase()
    else if (ID_SCENE.test(text) || teamCode(text) || RC_SCENE.test(text)) code = text
  }
  if (!code || !isWxacodeEnter(e && e.scene)) {
    return currentPending || null
  }
  return code
}

module.exports = { parseDoorScene, parseTopicScene, pathForScanEntry, captureDoorScene, parseActivityScene, parseShopScene, parseTeamScene, rcPath }
