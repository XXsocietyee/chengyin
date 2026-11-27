const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const play = require('../../pages/play/utils/playkit-questo.js');
const kit = require('../../pages/playkit/utils/playkit-questo.js');

test('反馈句只去掉段首一个手写标记', () => {
  for (const strip of [play.stripLeadingHandMark, kit.stripLeadingHandMark]) {
    assert.equal(strip('[手写] 恭喜你解开了'), '恭喜你解开了');
    assert.equal(strip('[手写]恭喜你解开了'), '恭喜你解开了');
    assert.equal(strip('[手写]\u3000下一句'), '下一句');
    assert.equal(strip('[手写][手写]再留一个'), '[手写]再留一个');
    assert.equal(strip('她说[手写]不算'), '她说[手写]不算');
    assert.equal(strip(''), '');
  }
});

test('逐字猜词通关句和问答反馈在渲染时去掉段首手写标记', () => {
  const hangmanJs = fs.readFileSync(require.resolve('../../pages/playkit/components/playkit-hangman/index.js'), 'utf8');
  const hangmanWxml = fs.readFileSync(require.resolve('../../pages/playkit/components/playkit-hangman/index.wxml'), 'utf8');
  const qaJs = fs.readFileSync(require.resolve('../../pages/playkit/components/playkit-qa/index.js'), 'utf8');
  assert.match(hangmanJs, /passShown = stripLeadingHandMark\(value\)/);
  assert.match(hangmanWxml, /hm__pass[\s\S]*\{\{passShown\}\}/);
  assert.doesNotMatch(hangmanWxml, /hm__pass[\s\S]*\{\{feedback\}\}/);
  assert.match(qaJs, /function qaFeedback\(text\) \{ return stripLeadingHandMark\(text\); \}/);
  assert.match(qaJs, /feedback: qaFeedback\(/);
});

test('游玩页里的克隆语音播放标出合成来源', () => {
  const wxml = fs.readFileSync(require.resolve('../../pages/play/index.wxml'), 'utf8');
  const ops = wxml.slice(wxml.indexOf('class="fx-msg__ops"'), wxml.indexOf('class="fx-msg__ops"') + 700);
  assert.match(ops, /item\.audioUrl/);
  assert.match(ops, /AI 合成语音/);
});
