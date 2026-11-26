// AUDIT-1122 F06 L06-129:开始监听成功前就关浮层,回调里立刻停掉传感器
const test = require('node:test')
const assert = require('node:assert/strict')

test('L06-129 监听尚未开始成功就关闭:成功回调里停止监听', () => {
  let def, startOpts, stopped = 0
  global.Component = v => { def = v }
  global.wx = {
    startDeviceMotionListening: o => { startOpts = o },
    stopDeviceMotionListening: () => { stopped += 1 },
    onDeviceMotionChange() {}, offDeviceMotionChange() {},
  }
  delete require.cache[require.resolve('../../pages/topic/components/cy/theme-badge/index.js')]
  require('../../pages/topic/components/cy/theme-badge/index.js')
  const c = Object.assign({ data: {}, setData(p) { Object.assign(this.data, p) } }, def.methods)
  c._startMotion()
  c._stopMotion() // 用户关掉
  startOpts.success()
  assert.equal(stopped, 1)
  assert.equal(c._listening, false)
})
