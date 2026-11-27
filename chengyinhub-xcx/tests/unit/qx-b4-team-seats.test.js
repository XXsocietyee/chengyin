// qx-b4 U06-01:席位/邀请/阻塞码只翻译 B6 投影;已撤回字段不读;未知不写 0。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = require('../../pages/team/utils/team-seats.js');

test('席位行:票已失效、待审申请只在 >0 时出现;缺字段整行不画', () => {
  const rows = s.seatRows({ capacity: 4, occupied: 2, available: 2, paidOccupied: 0, paidTicketMissing: 2, pendingApplications: 1 });
  assert.deepEqual(rows.map(r => [r.label, r.value]), [['持有效票', '0'], ['票已失效', '2'], ['待审申请', '1'], ['还可加入', '2']]);
  assert.equal(rows.find(r => r.key === 'missing').bad, true);
  assert.deepEqual(s.seatRows({ paidTicketMissing: 0, pendingApplications: 0 }), []);
  assert.deepEqual(s.seatRows(null), []);
  // 已撤回字段即使出现也不读
  assert.deepEqual(s.seatRows({ claimable: 3, reservedApplications: 1, unpaidOccupied: 2 }), []);
});

test('邀请期限只回放 expiresAt;失效以服务端为准', () => {
  assert.match(s.inviteText({ available: true, expired: false, expiresAt: '2026-11-12T21:01:53.000+08:00' }), /^11月12日 \d\d:\d\d 到期$/);
  assert.equal(s.inviteText({ available: false, expired: true, expiresAt: '2026-11-12T21:01:53.000+08:00' }), '邀请已失效');
  assert.equal(s.inviteText({ available: true, expired: false }), '');
  assert.equal(s.inviteText(null), '');
});

test('阻塞码按服务端码分支,不解析中文', () => {
  assert.deepEqual(s.blockerText({ joinBlockers: ['TICKET_REQUIRED'] }, 'join'), { code: 'TICKET_REQUIRED', text: '需要先买这一场的票' });
  assert.deepEqual(s.blockerText({ joinBlockers: ['ALREADY_JOINED'] }, 'join'), { code: '', text: '' });
  assert.equal(s.blockerText({ applyBlockers: ['TEAM_FULL'] }, 'apply').text, '队伍已满');
  assert.equal(s.blockerText(undefined, 'join').text, '');
});

test('加入按钮仍由 /join 回包裁决:阻塞提示不禁用按钮', () => {
  const wxml = fs.readFileSync(path.join(__dirname, '../../pages/team/join/index.wxml'), 'utf8');
  assert.match(wxml, /joinHint && !joined/);
  assert.doesNotMatch(wxml, /joinHint[^}]*disabled/);
});

function loadMemberCount() {
  const src = fs.readFileSync(path.join(__dirname, '../../pages/team/utils/member-count.wxs'), 'utf8');
  const sandbox = { module: { exports: {} } };
  new Function('module', src)(sandbox.module);
  return sandbox.module.exports;
}

function assertMemberHeader(wxml) {
  assert.doesNotMatch(wxml, /joinedCount\s*\|\|\s*0/);
  assert.doesNotMatch(wxml, /maxMembers\s*\|\|\s*0/);
  assert.doesNotMatch(wxml, /activeCount/);
  assert.match(wxml, /<wxs src="\.\.\/utils\/member-count\.wxs" module="memberCount" \/>/);
  assert.match(wxml, /wx:if="\{\{memberCount\.text\(team\)\}\}"/);
  assert.match(wxml, /\{\{memberCount\.text\(team\)\}\}/);
  assert.match(wxml, /当前成员/);
}

test('页头当前成员只显示有限数字:真实 0 保留,缺一侧不编 0/0', () => {
  const { text } = loadMemberCount();
  assert.equal(text({ joinedCount: 2, maxMembers: 4 }), '2 / 4');
  assert.equal(text({ joinedCount: 0, maxMembers: 0 }), '0 / 0');
  assert.equal(text({ joinedCount: 0, maxMembers: 4 }), '0 / 4');
  assert.equal(text({ joinedCount: 0 }), '0');
  assert.equal(text({ maxMembers: 0 }), '0');
  assert.equal(text({ joinedCount: 3 }), '3');
  assert.equal(text({ maxMembers: 6 }), '6');
  assert.equal(text({}), '');
  assert.equal(text({ joinedCount: null, maxMembers: null }), '');
  assert.equal(text({ joinedCount: undefined, maxMembers: undefined }), '');
  assert.equal(text(null), '');
  assert.equal(text({ joinedCount: NaN, maxMembers: 4 }), '4');
  assert.equal(text({ joinedCount: Infinity, maxMembers: 4 }), '4');
  assert.equal(text({ joinedCount: '2', maxMembers: '4' }), '');
  assert.equal(text({ joinedCount: '', maxMembers: false }), '');
});

test('详情和加入页头不把缺人数编成 0,席位空位仍只认服务端', () => {
  const detail = fs.readFileSync(path.join(__dirname, '../../pages/team/detail/index.wxml'), 'utf8');
  const join = fs.readFileSync(path.join(__dirname, '../../pages/team/join/index.wxml'), 'utf8');
  assertMemberHeader(detail);
  assertMemberHeader(join);
  assert.deepEqual(s.openSeats({ maxMembers: null, joinedCount: 2 }, {}), []);
  assert.deepEqual(s.seatChips({}), []);
  const broken = detail.replace(/memberCount\.text\(team\)/g, '(team.joinedCount || 0) + " / " + (team.maxMembers || 0)');
  assert.notEqual(broken, detail, '负控必须命中页头绑定');
  assert.throws(() => assertMemberHeader(broken), /joinedCount/);
});
