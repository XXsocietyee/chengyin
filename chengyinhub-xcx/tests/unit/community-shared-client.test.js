'use strict';
// L10-010:同一 App 上的列表和详情必须共用一份帖文缓存,点赞才不会各认各的。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient } = require('../../utils/community-post-api');

function bundle(liked) {
  return {
    post: {
      id: 56, authorId: 7, authorNickname: '甲', body: '内容', audience: 'PUBLIC',
      postType: 'MOMENT', commentPolicy: 'EVERYONE', locationPrecision: 'NONE',
      version: 1, lifecycle: 'PUBLISHED', viewerLiked: liked ? 1 : 0, viewerBookmarked: 0,
      likeCount: liked ? 1 : 0,
    },
    media: [], references: [], viewerFollowing: false, viewerIsAuthor: false, topicCodes: [], mentions: [],
  };
}

function harness(user) {
  const calls = [];
  let actor = user;
  const app = {
    globalData: {},
    getUserID: () => actor,
    getAuthorization: () => 'tok-' + actor,
    sendRequest(options) {
      calls.push({ url: options.url, method: options.method });
      const liked = options.method === 'POST';
      options.success({ code: 200, data: bundle(liked) });
      return { abort() {} };
    },
  };
  return { app, calls, client: createClient(app, {}), setActor(id) { actor = id; } };
}

function request(client, url, data) {
  return new Promise(resolve => client.request({ url, data, success: resolve }));
}

test('L10-010:列表点赞后详情看到的是已赞,再点是取消', async () => {
  const h = harness('7');
  const detail = createClient(h.app, {});
  assert.equal(h.client, detail);
  await request(h.client, '/api/creativesquare/info', { id: 56 });
  await request(detail, '/api/creativesquare/like', { id: 56, type: 1 });
  await request(h.client, '/api/creativesquare/like', { id: 56, type: 1 });
  const likes = h.calls.filter(call => call.url.includes('/actions'));
  assert.equal(likes[0].method, 'POST');
  assert.equal(likes[1].method, 'DELETE');
  assert.match(likes[1].url, /\/actions\/LIKE$/);
});

test('另一个账号的客户端看不到这份点赞', async () => {
  const a = harness('7');
  const b = harness('8');
  assert.notEqual(a.client, b.client);
  await request(a.client, '/api/creativesquare/info', { id: 56 });
  await request(a.client, '/api/creativesquare/like', { id: 56, type: 1 });
  await request(b.client, '/api/creativesquare/info', { id: 56 });
  await request(b.client, '/api/creativesquare/like', { id: 56, type: 1 });
  assert.equal(b.calls.filter(call => call.url.includes('/actions'))[0].method, 'POST');
});

test('换号后共用客户端不再沿用上个账号的赞', async () => {
  const h = harness('7');
  const otherPage = createClient(h.app, {});
  await request(h.client, '/api/creativesquare/info', { id: 56 });
  await request(h.client, '/api/creativesquare/like', { id: 56, type: 1 });
  h.setActor('9');
  const res = await request(otherPage, '/api/creativesquare/like', { id: 56, type: 1 });
  assert.equal(res.code, 409);
  assert.match(res.msg, /刷新/);
});
