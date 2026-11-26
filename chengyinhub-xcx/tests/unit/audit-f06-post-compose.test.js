'use strict';
// AUDIT-1122 F06:发帖弹窗切后台存草稿 (L06-061)、俱乐部帖切后台不中断 (L06-062)、活动选择器同次发帖只拉一次 (L06-063)
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

function mount(props) {
  let definition;
  const requests = [], events = [], tips = [], drafts = [], picks = [];
  const app = {
    getUserID: () => 'member-A', getAvatar: () => '', getNickname: () => '',
    getAuthorization: () => 'Bearer t',
    chooseImage(cb, left, options) { picks.push({ left, options }); cb(['a.jpg']); },
    sendRequest(options) { const task = { abort() {} }; requests.push(options); return task; },
  };
  const wx = { getWindowInfo: () => ({ windowWidth: 375 }) };
  vm.runInNewContext(read('pages/square/components/cy/post-compose/index.js'), {
    getApp: () => app, Component: (value) => { definition = value; }, wx, console,
    require(id) {
      if (id.includes('community-post-api')) return { createClient: () => ({ request() {}, captureUpload() {} }) };
      if (id.includes('pro-editor-draft')) return {
        loadDraft(w, identity) { drafts.push(['load', identity.topicId]); return { status: 'empty' }; },
        saveDraft(w, payload) { drafts.push(['save', payload.topicId]); },
        removeDraft(w, identity) { drafts.push(['remove', identity.topicId]); },
      };
      if (id.includes('publish-intent')) return { begin() { return { key: 'k' }; }, settle() {}, discard() {} };
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
  return { instance, requests, events, tips, drafts, picks, definition };
}


test('L06-061 切后台时保存未发出的正文', () => {
  const h = mount({});
  h.instance.onInput({ detail: { value: '写到一半' } });
  const saves = () => h.drafts.filter(d => d[0] === 'save').length;
  const before = saves();
  h.definition.pageLifetimes.hide.call(h.instance);
  assert.equal(saves(), before + 1);
});

test('L06-062 俱乐部帖发布中切后台:不中断请求,回包照常收尾并删草稿', () => {
  const h = mount({ clubId: 36 });
  h.instance.onInput({ detail: { value: '周末一起' } });
  let aborted = 0;
  h.instance.publishClubPost('周末一起');
  const req = h.requests.at(-1);
  h.instance._publishContext.task = { abort() { aborted += 1; } };
  h.definition.pageLifetimes.hide.call(h.instance);
  assert.equal(aborted, 0, '无幂等键的俱乐部帖不得被中断');
  req.success({ code: '200' });
  assert.ok(h.events.some(e => e[0] === 'published'));
  assert.ok(h.drafts.some(d => d[0] === 'remove'));
});

test('L06-063 同一次发帖内重复打开活动选择器只拉一次;重新拉起发帖再拉', () => {
  const h = mount({});
  const count = () => h.requests.filter(r => r.url === '/api/registration/list').length;
  h.instance.onOpenActivityPicker();
  h.requests.filter(r => r.url === '/api/registration/list' || r.url === '/api/activity/list').forEach(r => r.success({ code: 200, data: { rows: [] } }));
  h.instance.onCloseActivityPicker();
  h.instance.onOpenActivityPicker();
  assert.equal(count(), 1);
  h.instance.data.show = false; h.definition.observers.show.call(h.instance, false);
  h.instance.data.show = true; h.definition.observers.show.call(h.instance, true);
  h.instance.onOpenActivityPicker();
  assert.equal(count(), 2);
});
