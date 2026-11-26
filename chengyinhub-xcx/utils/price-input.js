// 第十二轮 k1 第 9 项(j1 N2):金额输入框打字时只做「留数字、只留一个小数点、最多两位小数」,保留字符串;
// 受控 input 在中途 Number() 会把刚敲的小数点抹掉(39. → 39),再敲 99 就成了 3999。数值化留到校验与提交。
function typingPrice(raw) {
  let s = String(raw == null ? '' : raw).replace(/[^\d.]/g, '')
  const dot = s.indexOf('.')
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, 2)
  return s
}

// 合法金额:非负,整数或一到两位小数(「39.」「.5」都不算填完)
function isValidPrice(value) {
  return /^\d+(\.\d{1,2})?$/.test(String(value == null ? '' : value).trim())
}

// L03-050 / L04-023(业主 2026-11-24 默认 A):票价上限,与服务端主题票价闸同一个数
const MAX_PRICE = 99999.99

// 填了的票价哪里不对('' 表示没问题;没填由调用方按模式判断):负数、非数字、超过两位小数、超上限
function priceIssue(value) {
  const text = String(value == null ? '' : value).trim()
  if (/^-/.test(text) && Number.isFinite(Number(text))) return '价格不能为负数'
  if (!isValidPrice(text)) return '票价须为数字，最多两位小数'
  if (Number(text) > MAX_PRICE) return '票价不能超过 99999.99'
  return ''
}

// L03-193:合法金额提交前统一成两位小数的字符串(纯字符串补零,不经浮点、不四舍五入);
// 不合法的原样返回,让服务端拒,客户端绝不替作者改价。
function submitPrice(value) {
  const text = String(value == null ? '' : value).trim()
  if (!isValidPrice(text)) return value
  const parts = text.split('.')
  const whole = parts[0].replace(/^0+(?=\d)/, '')
  return whole + '.' + ((parts[1] || '') + '00').slice(0, 2)
}

module.exports = { typingPrice, isValidPrice, priceIssue, submitPrice, MAX_PRICE }
