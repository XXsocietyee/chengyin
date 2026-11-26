'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function mount(initialUid) {
 const file=path.resolve(__dirname,'../../subpackageRoam/nearby/index.js'); let def,uid=initialUid;
 const requests=[];const app={globalData:{authorization:'a'},getUserID:()=>uid,sendRequest:r=>requests.push(r),
 firstLogin:()=>{uid=7;return Promise.resolve({ok:true});}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{getApp:()=>app,Page:d=>{def=d;},require:createRequire(file),wx:{}});
 const page=Object.assign({},def,{data:JSON.parse(JSON.stringify(def.data)),setData(d){Object.assign(this.data,d);}});
 return {page,requests,switchUid:v=>{uid=v;},app};
}
// L05-117:P6 半屏(登录入口 / 行 / 空态)已删,附近页只留角控件计数 myTeamsN;读数是否完整记在 _myLoaded。
test('游客不请求私有列表，计数为0且不当作已读完',()=>{
 const h=mount('');h.page.loadMyTeams();assert.equal(h.requests.length,0);
 assert.equal(h.page.data.myTeamsN,0);assert.equal(h.page._myLoaded,false);
 assert.equal(typeof h.page.loginForMyTeams,'undefined');
});
test('我的队伍401/403立即把计数清零，其余失败不是无队伍',()=>{
 for(const callback of ['success','fail','successStatusAbnormal']) for(const code of [401,403,500]){
  const h=mount(7);h.page._myReadOwner=h.page._myIdentity();h.page.data.myTeamsN=3;h.page.loadMyTeams();
  for(const req of h.requests) req[callback]({code},callback==='success'?undefined:code);
  assert.equal(h.page._myLoaded,false);
  assert.equal(h.page.data.myTeamsN,code===500?3:0);
 }
});
test('账号切换后旧双请求不能覆盖新计数',()=>{
 const h=mount(7);h.page.loadMyTeams();const old=h.requests.slice();
 h.switchUid(8);h.page.refresh=()=>{};h.page.onShow();assert.equal(h.requests.length,4);
 old[0].success({code:200,data:[]});old[1].fail({code:403},403);assert.equal(h.page._myLoaded,false);
 for(const req of h.requests.slice(2))req.success({code:200,data:[{id:1,title:'t',joinedCount:1,maxMembers:4,status:0}]});
 assert.equal(h.page._myLoaded,true);assert.equal(h.page.data.myTeamsN,1);
});
test('只读到一个列表不当作完整，计数归零；卸载后迟到回包不写',()=>{
 const h=mount(7);h.page.loadMyTeams();h.requests[0].success({code:200,data:[]});h.requests[1].fail();
 assert.equal(h.page._myLoaded,false);assert.equal(h.page.data.myTeamsN,0);
 const g=mount(7);g.page.loadMyTeams();g.page.onUnload();
 for(const req of g.requests)req.success({code:200,data:[{id:1,title:'t',joinedCount:1,maxMembers:4,status:0}]});
 assert.equal(g.page.data.myTeamsN,0);
});
