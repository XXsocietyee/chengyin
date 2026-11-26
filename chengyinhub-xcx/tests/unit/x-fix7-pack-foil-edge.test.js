const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const zlib = require('node:zlib')

// x-fix7 P-6：卡包膜 PNG 的边缘不得留半透明白毛边（alpha 1..199 的像素），否则深色底上显出一圈毛边。
function decodePngAlpha(buf) {
  let off = 8, w = 0, h = 0, ct = 0, bd = 0, trns = null; const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9] }
    if (type === 'IDAT') idat.push(data)
    if (type === 'tRNS') trns = data
    off += 12 + len
  }
  // 2026-11-24 L02-120:改成无损 8 位调色板(alpha 在 tRNS 里),RGBA 与调色板两种都读
  assert.equal(bd, 8); assert.ok(ct === 6 || ct === 3, 'RGBA or palette')
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = ct === 6 ? 4 : 1, stride = w * bpp
  const out = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = out.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c) }
      cur[i] = v & 255
    }
    prev = cur
  }
  if (ct === 3) return { w, h, alpha: (x, y) => { const i = out[y * stride + x]; return trns && i < trns.length ? trns[i] : 255 } }
  return { w, h, alpha: (x, y) => out[y * stride + x * 4 + 3] }
}

test('pack-foil.png 没有半透明毛边像素，且尺寸仍是 330×577', () => {
  const img = decodePngAlpha(fs.readFileSync(path.join(__dirname, '../../pages/play/assets/pack-foil.png')))
  assert.deepEqual([img.w, img.h], [330, 577])
  let fringe = 0
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) { const a = img.alpha(x, y); if (a > 0 && a < 200) fringe++ }
  assert.equal(fringe, 0)
})
