const test = require('node:test');
const assert = require('node:assert/strict');
const proStory = require('../../pages/publish/utils/publish/pro-editor-story.js');
const advanced = require('../../pages/publish/utils/publish/advanced-game-config.js');

test('E4-12: cap open/end blocks preserve narration voice field across materialize -> toPayloadChapter', () => {
  const input = {
    name: '第一章',
    nodes: [],
    blocks: [
      { key: 'cap-open', type: 'cap', cap: 'open', content: '开场旁白', voice: 'media-asset:1001' },
      { key: 'b1', type: 'text', content: '正文段落', voice: 'media-asset:1002' },
      { key: 'cap-end', type: 'cap', cap: 'end', content: '结语旁白', voice: 'media-asset:1003' },
    ],
  };
  const mat = proStory.materializeChapter(input);
  assert.equal(mat._capOpenVoice, 'media-asset:1001');
  assert.equal(mat._capEndVoice, 'media-asset:1003');
  const payload = proStory.toPayloadChapter(mat);
  const open = payload.blocks.find(b => b.type === 'cap' && b.cap === 'open');
  const body = payload.blocks.find(b => b.type === 'text');
  const end = payload.blocks.find(b => b.type === 'cap' && b.cap === 'end');
  assert.equal(open.voice, 'media-asset:1001');
  assert.equal(body.voice, 'media-asset:1002');
  assert.equal(end.voice, 'media-asset:1003');
});

test('E4-27: QA PICK with evidence table allows 2..12 options, regular PICK remains capped at 4', () => {
  const sixOptions = Array.from({ length: 6 }, (_, i) => ({
    id: 'r' + (i + 1), label: '条目' + (i + 1), correct: i === 2, fb: '',
  }));
  const withTable = advanced.parse({
    schemaVersion: 1,
    qa: {
      enabled: true, mode: 'PICK', title: '核对证据表', lead: '找出唯一吻合的记录',
      options: sixOptions,
      table: { columns: ['编号', '说明'], rows: sixOptions.map(o => ({ id: o.id, cells: [o.id, o.label] })) },
    },
  });
  assert.equal(withTable.error, '');
  assert.equal(advanced.validate(withTable.value), '');

  const withoutTable = advanced.parse({
    schemaVersion: 1,
    qa: {
      enabled: true, mode: 'PICK', title: '普通单选', lead: '六选一',
      options: sixOptions,
    },
  });
  assert.match(advanced.validate(withoutTable.value), /2 至 4/);
});
