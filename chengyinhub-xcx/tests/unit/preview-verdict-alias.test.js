/* L04-032:试玩判打字题时,作者加的「其他可接受写法」也算对(与服务端 AnswerPolicy 一致)。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const pv = require('../../pages/publish/temp/preview-verdict.js')

const advanced = (aliases) => Object.assign({ qa: { enabled: true, mode: 'TYPE', answerText: '外白渡桥' } },
  aliases ? { answerPolicy: { version: 1, normalizationPolicy: 'LEGACY_V1', acceptedAliases: aliases } } : {})
const judge = (cfg, input) => pv.judge(cfg, { type: 'qa' }, 'submit', { mode: 'type', input })

test('原答案照常判对、错答判错', () => {
  assert.equal(judge(advanced(), ' 外白渡桥 '), 'win')
  assert.equal(judge(advanced(), '南浦大桥'), 'fail')
})

test('别名判对', () => {
  assert.equal(judge(advanced(['Garden Bridge', '花园桥']), 'garden bridge'), 'win')
  assert.equal(judge(advanced(['Garden Bridge', '花园桥']), '花园桥'), 'win')
})

test('空别名不放水', () => {
  assert.equal(judge(advanced(['']), ''), 'fail')
})

test('旧的顿号多答案写法仍判对', () => {
  assert.equal(judge({ qa: { mode: 'TYPE', answerText: '外白渡桥、花园桥' } }, '花园桥'), 'win')
})
