const { test } = require('node:test')
const assert = require('node:assert/strict')

// L05-078 / L05-079:分享卡的码只认这一次打开;导出在途时复用同一次。
function mount() {
  let def
  const reqs = []
  const prev = { Component: global.Component, getApp: global.getApp }
  global.Component = d => { def = d }
  global.getApp = () => ({ sendRequest: o => reqs.push(o), getImgUrl: v => v })
  const file = require.resolve('../../subpackageRoam/components/cy/share-card/index.js')
  delete require.cache[file]
  require(file)
  const inst = Object.assign({}, def.methods, { data: Object.assign({}, def.data, { kind: 'theme' }), setData(p) { Object.assign(this.data, p) } })
  return { inst, reqs, restore: () => Object.assign(global, prev) }
}

test('上一次打开的迟到码不落到新卡上;码晚到时作废已导出的图', () => {
  const { inst, reqs, restore } = mount()
  try {
    inst._open = 1; inst._id = '5'
    inst._loadCode()
    inst._open = 2
    reqs[0].success({ code: 200, data: { qrcodeUrl: 'old.png' } })
    assert.notEqual(inst.data.qr, 'old.png')
    inst._image = 'exported-without-qr.png'
    inst._loadCode()
    reqs[1].success({ code: 200, data: { qrcodeUrl: 'new.png' } })
    assert.equal(inst.data.qr, 'new.png')
    assert.equal(inst._image, '')
    assert.equal(reqs[1].autoErrorToast, false)
  } finally { restore() }
})

test('导出在途时第二次调用复用同一次导出', async () => {
  const { inst, restore } = mount()
  try {
    let runs = 0, finish
    inst._exportImageNow = () => { runs += 1; return new Promise(r => { finish = r }) }
    const a = inst._exportImage(); const b = inst._exportImage()
    assert.equal(a, b)
    assert.equal(runs, 1)
    finish('x.png'); await a
    inst._exportImage()
    assert.equal(runs, 2, '结束后可再导出')
  } finally { restore() }
})
