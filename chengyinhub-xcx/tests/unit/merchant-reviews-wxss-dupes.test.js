// L07-176:口碑页样式里同一选择器不再先定一个值、后面又改掉(结果样式不变,只去掉互相覆盖)
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

function declarations(css) {
  const out = {}
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const decls = m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => d.split(':')[0].trim())
    for (const sel of selectors) for (const prop of decls) (out[sel + ' ' + prop] = out[sel + ' ' + prop] || []).push(prop)
  }
  return out
}

test('评价卡/作者行/动作行/加图/加载更多不再自相覆盖', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../pages/merchant/reviews/index.wxss'), 'utf8')
  const d = declarations(css)
  for (const key of ['.review-card margin-top', '.review-author align-items', '.review-author display', '.review-actions display',
    '.review-actions align-items', '.review-image-add transition', '.review-load-more transition', '.review-load-more color']) {
    assert.ok(d[key], key + ' 仍在')
    assert.equal(d[key].length, 1, key + ' 只定义一次')
  }
  assert.match(css, /\.review-card \{ margin-top: 24rpx; \}/)
  assert.match(css, /\.review-author \{ display: flex; align-items: flex-start; gap: 20rpx; \}/)
})
