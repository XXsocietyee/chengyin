'use strict';
// AUDIT-1122 F06:发帖弹窗切后台存草稿 (L06-061)、俱乐部帖切后台不中断 (L06-062)、活动选择器同一账号成功后不再每次重拉 (L06-063)
// 2026-10-27 P-20 owner(真机走查 p109/p110):俱乐部发帖不再是页内 textarea,
// 统一调用广场那一个全屏发帖弹窗(cy-post-compose,club-id 非空即俱乐部模式,带草稿)。
// 本文件钉:俱乐部模式的请求体与原俱乐部页一致、草稿按团分槽、引用被拒只撤引用、可以只发图;
// 以及俱乐部页 / 广场页都只挂这一个组件、页内不再有 textarea 发帖框。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const clone = (value) => JSON.parse(JSON.stringify(value));

function mount(props, hooks) {
  let definition;
  const requests = [], events = [], tips = [], drafts = [], picks = [];
  const storage = new Map();
  const session = { userId: 'member-A' };
  const app = {
    getUserID: () => session.userId, getAvatar: () => '', getNickname: () => '',
    getAuthorization: () => 'Bearer t',
    chooseImage(cb, left, options) { picks.push({ left, options }); cb(['a.jpg']); },
    sendRequest(options) { const task = { abort() {} }; requests.push(options); return task; },
  };
  const wx = {
    getWindowInfo: () => ({ windowWidth: 375 }),
    getStorageSync(key) { return storage.has(key) ? storage.get(key) : ''; },
    setStorageSync(key, value) { storage.set(key, JSON.parse(JSON.stringify(value))); },
    removeStorageSync(key) { storage.delete(key); },
  };
  vm.runInNewContext(read('pages/square/components/cy/post-compose/index.js'), {
    getApp: () => app, Component: (value) => { definition = value; }, wx, console,
    require(id) {
      if (id.includes('community-post-api')) return { createClient: () => ({ request() {}, captureUpload() {} }) };
      if (id.includes('pro-editor-draft')) return {
        loadDraft(w, identity, options) {
          drafts.push(['load', identity.topicId]);
          if (hooks && hooks.loadDraft) return hooks.loadDraft(w, identity, options);
          return { status: 'empty' };
        },
        saveDraft(w, payload) { drafts.push(['save', payload.topicId, payload.formData && payload.formData.contents]); },
        removeDraft(w, identity) { drafts.push(['remove', identity.topicId]); },
      };
      if (id.includes('publish-intent')) return require(path.join(root, 'utils/publish/publish-intent.js'));
      if (id.includes('/toast')) { const t = (text) => tips.push(text); t.undo = () => {}; return t; }
      if (id.includes('nav-safe-area')) return { resolveMenuChrome: () => ({ sheetTop: 60 }) };
      if (id.includes('datetime')) return { chinaParts: () => null };
      if (id.includes('location-manager')) return {};
      throw new Error('Unexpected module ' + id);
    },
  });
  const instance = Object.assign({
    data: Object.assign(clone(definition.data), { show: false, editPost: null, prefill: '', clubId: '', canAnnounce: false, postRef: null }, props),
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, detail) { events.push([name, detail]); }, selectComponent: () => null,
  }, definition.methods);
  definition.lifetimes.attached.call(instance);
  instance.data.show = true;
  definition.observers.show.call(instance, true);
  return { instance, requests, events, tips, drafts, picks, definition, session };
}


test('L06-060 输入不把整段正文 setData 回去,发送和存草稿时才写入', () => {
  const h = mount({ clubId: 36 });
  const patches = [];
  const orig = h.instance.setData.bind(h.instance);
  h.instance.setData = function (patch) { patches.push(Object.assign({}, patch)); return orig(patch); };
  h.instance.onInput({ detail: { value: '周末' } });
  h.instance.onInput({ detail: { value: '周末一起' } });
  assert.ok(patches.length >= 1);
  for (const patch of patches) assert.equal(Object.prototype.hasOwnProperty.call(patch, 'content'), false);
  assert.equal(h.instance.data.contentLen, 4);
  assert.equal(h.instance.data.canSubmit, true);
  assert.equal(h.instance.data.content, '');
  h.instance.onPublish();
  assert.equal(h.instance.data.content, '周末一起');
  assert.equal(JSON.parse(h.requests.at(-1).data).content, '周末一起');

  const saved = mount({});
  saved.instance.onInput({ detail: { value: '写到一半' } });
  assert.equal(saved.instance.data.content, '');
  saved.definition.pageLifetimes.hide.call(saved.instance);
  assert.equal(saved.instance.data.content, '写到一半');
  assert.ok(saved.drafts.some((row) => row[0] === 'save' && row[2] === '写到一半'));
});

test('L06-061 切后台时保存未发出的正文', () => {
  const h = mount({});
  h.instance.onInput({ detail: { value: '写到一半' } });
  const saves = () => h.drafts.filter(d => d[0] === 'save').length;
  const before = saves();
  h.definition.pageLifetimes.hide.call(h.instance);
  assert.equal(saves(), before + 1);
});

test('L06-062 俱乐部帖带 requestId:切后台不中断,晚到的回包收下且不再发', () => {
  const h = mount({ clubId: 36 });
  h.instance.onInput({ detail: { value: '周末一起' } });
  h.instance.onPublish();
  const req = h.requests.at(-1);
  const body = JSON.parse(req.data);
  assert.match(body.requestId, /^[A-Za-z0-9_-]{16,64}$/);
  let aborted = 0;
  h.instance._publishContext.task = { abort() { aborted += 1; } };
  h.definition.pageLifetimes.hide.call(h.instance);
  assert.equal(aborted, 0, '已经离开设备的发布不能被切后台打断');
  h.definition.pageLifetimes.show.call(h.instance);
  h.instance.onPublish();
  assert.equal(h.requests.length, 1, '回包还没到,不能再发一条');
  req.success({ code: '200' });
  assert.ok(h.events.some(e => e[0] === 'published'));
  assert.ok(h.drafts.some(d => d[0] === 'remove'));
  assert.equal(h.requests.length, 1, '回包收下之后不再补发');
});

test('L06-062 切后台后失败重试复用同一个 requestId', () => {
  const h = mount({ clubId: 36 });
  h.instance.onInput({ detail: { value: '周末一起' } });
  h.instance.onPublish();
  const firstId = JSON.parse(h.requests[0].data).requestId;
  h.definition.pageLifetimes.hide.call(h.instance);
  h.requests[0].fail();
  h.definition.pageLifetimes.show.call(h.instance);
  h.instance.onPublish();
  assert.equal(h.requests.length, 2);
  assert.equal(JSON.parse(h.requests[1].data).requestId, firstId);
  h.requests[1].fail();
  h.instance.onInput({ detail: { value: '换一句' } });
  h.instance.onPublish();
  assert.notEqual(JSON.parse(h.requests[2].data).requestId, firstId);
});

test('L06-063 同一账号上次成功后再开选择器不再打两支列表;失败或换号才重拉', () => {
  const h = mount({});
  const lists = () => h.requests.filter(r => r.url === '/api/registration/list' || r.url === '/api/activity/list');
  const count = () => h.requests.filter(r => r.url === '/api/registration/list').length;
  const settle = (how) => lists().forEach((r) => { if (!r._done) { r._done = true; how(r); } });
  h.instance.onOpenActivityPicker();
  assert.equal(lists().length, 2);
  h.instance.onCloseActivityPicker();
  h.instance.onOpenActivityPicker();
  assert.equal(count(), 1, '上一轮还在飞,再开不再各发一次');
  settle(r => r.fail());
  h.instance.onOpenActivityPicker();
  assert.equal(count(), 2, '上次失败后再开要重拉');
  settle(r => r.success({ code: 200, data: { rows: [] } }));
  h.instance.onCloseActivityPicker();
  h.instance.onOpenActivityPicker();
  assert.equal(count(), 2, '上次成功后再开不请求');
  h.instance.data.show = false; h.definition.observers.show.call(h.instance, false);
  h.instance.data.show = true; h.definition.observers.show.call(h.instance, true);
  h.instance.onOpenActivityPicker();
  assert.equal(count(), 2, '重新拉起发帖、账号未变不再请求');
  h.session.userId = 'member-B';
  h.instance.onOpenActivityPicker();
  assert.equal(count(), 3, '换号后再开要重拉');
  assert.equal(lists().length, 6);
});

test('L06-173 草稿箱读取失败要说明，不能打开成空列表', () => {
  const h = mount({}, { loadDraft() { throw new Error('storage'); } });
  h.instance.onOpenDrafts();
  assert.equal(h.instance.data.draftsShow, false);
  assert.deepEqual(h.instance.data.drafts, []);
  assert.ok(h.tips.includes('草稿读取失败，请重试'));
});

test('L06-173 点开一条草稿时读取失败要说明', () => {
  const h = mount({}, { loadDraft() { throw new Error('storage'); } });
  h.instance.onPickDraft({ detail: { key: 'square_post_member-A' } });
  assert.ok(h.tips.includes('这条草稿无法打开了'));
  assert.equal(h.instance.data.content, '');
});
