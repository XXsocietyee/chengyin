const test = require('node:test')
const assert = require('node:assert/strict')
const { loadFailureEventVisibility } = require('../../scripts/uiaudit/build-action-ledger')

// load-failure 不再铺空白占位。调用方传入的原因留在界面上,重试保持可点,
// 所以这些事件留在可操作清单里,也不再记一条「会被空白盖住」的条件。
const visible = { excluded: false, condition: null }

test('load-failure keeps the caller error and its retry in the actionable inventory', () => {
  for (const component of ['components/cy/error/index', 'components/cy/inline-error/index']) {
    for (const [tag, attrs] of [
      ['<cy-error load-failure bind:retry="retry" />', {}],
      ['<cy-error load-failure="{{true}}" />', { 'load-failure': '{{true}}' }],
      ['<cy-error load-failure="true" />', { 'load-failure': 'true' }],
      ['<cy-error bind:retry="retry" />', {}],
      ['<cy-error load-failure="{{false}}" />', { 'load-failure': '{{false}}' }],
      ['<cy-error data-load-failure />', {}],
    ]) assert.deepEqual(loadFailureEventVisibility(component, tag, attrs), visible)
  }
  assert.deepEqual(loadFailureEventVisibility('components/cy/custom-error/index',
    '<cy-error load-failure />', {}), visible)
  assert.deepEqual(loadFailureEventVisibility(null, '<view load-failure />', {}), visible)
})

test('dynamic load-failure stays tappable and does not record a blank condition', () => {
  const condition = '{{!loadErrorIsOperation}}'
  assert.deepEqual(loadFailureEventVisibility('components/cy/error/index',
    '<cy-error load-failure="{{!loadErrorIsOperation}}" bind:retry="retrySubmit" />',
    { 'load-failure': condition }), visible)
  assert.deepEqual(loadFailureEventVisibility('components/cy/error/index',
    '<cy-error load-failure = "{{permissionDenied}}" />',
    { 'load-failure': '{{permissionDenied}}' }), visible)
  assert.deepEqual(loadFailureEventVisibility('components/cy/inline-error/index',
    '<cy-inline-error load-failure="{{!loadErrorIsOperation}}" bind:action="retry" />',
    { 'load-failure': condition }), visible)
})
