// OR-027(业主 2026-11-22):小程序自己写的轻提示 / 内联报错一律不带句末「。」。
// 只扫前端字面量;后端 msg 原样透传,不在这里改写。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '../..')
const SKIP = new Set(['node_modules', 'tests', 'artifacts', 'scripts', 'docs', 'miniprogram_npm'])

// wx.showToast({ title: '…。' }) / toast('…。') / toast.error('…。') / cyToast('…。') / app.tips('…。')
const TOAST = /(?:showToast\(\{[^}]*?title:\s*|[tT]oast(?:\.(?:success|error|info))?\(|\.tips\()(['"`])([^'"`\n]*?)\1/g
// 内联报错的 data 键:xxxError / errorMsg / errorText 等直接赋字面量
const INLINE = /\b(?:\w*Error\w*|error(?:Msg|Text)?):\s*(['"`])([^'"`\n]*?)\1/g

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const full = path.join(dir, name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) walk(full, out)
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

function offenders(source, file) {
  const hits = []
  for (const re of [TOAST, INLINE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(source))) {
      if (m[2].endsWith('。')) hits.push(path.relative(ROOT, file) + ': ' + m[0])
    }
  }
  return hits
}

test('OR-027 轻提示与内联报错字面量不以「。」结尾', () => {
  const hits = walk(ROOT, []).flatMap(f => offenders(fs.readFileSync(f, 'utf8'), f))
  assert.deepEqual(hits, [])
})

test('OR-027 负控:带句号的 showToast / toast / 内联报错会被抓到', () => {
  const f = path.join(ROOT, 'x.js')
  assert.equal(offenders("wx.showToast({ title: '已保存。', icon: 'none' })", f).length, 1)
  assert.equal(offenders("toast('没有保存成功，请再试一次。')", f).length, 1)
  assert.equal(offenders("toast.error('网络异常。')", f).length, 1)
  assert.equal(offenders("this.setData({ saveErrorText: '请重试。' })", f).length, 1)
  assert.equal(offenders("toast('已保存'); this.setData({ loadError: '请重试' })", f).length, 0)
})
