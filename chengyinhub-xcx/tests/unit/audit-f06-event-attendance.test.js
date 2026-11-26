'use strict';
// AUDIT-1122 F06:签到组件回前台不闪空、签到码失败可点重试 (L06-043 L06-044)
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const file=path.resolve(__dirname,'../../pages/activity/components/event-attendance/index.js');
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
function mount(organizer=false,store={}){
 let def,owner='7',serial=0;const requests=[],modals=[],calls=[];
 const app={getUserID:()=>owner,getAuthorization:()=>owner+'token',sendRequest:r=>requests.push(r)};
 const wx={getStorageSync:k=>store[k],setStorageSync:(k,v)=>{store[k]=JSON.parse(JSON.stringify(v));},removeStorageSync:k=>delete store[k],getRandomValues:o=>o.success({randomValues:new Uint8Array(16).fill(++serial).buffer}),makePhoneCall:o=>calls.push(o),scanCode:o=>calls.push(o)};
 const real=createRequire(file);vm.runInNewContext(fs.readFileSync(file,'utf8'),{Component:d=>def=d,getApp:()=>app,wx,setTimeout:()=>1,clearTimeout(){},require:p=>p.endsWith('/modal.js')?{show:o=>modals.push(o)}:real(p)});
 const c={...def.methods,properties:{eventId:'19',organizer},data:JSON.parse(JSON.stringify(def.data)),setData:p=>Object.assign(c.data,p)};
 def.lifetimes.attached.call(c);
 return {c,requests,modals,calls,store,hide:()=>def.pageLifetimes.hide.call(c),show:()=>def.pageLifetimes.show.call(c),switch:()=>{owner='8';},receipt(r,state,data){r.success({code:200,data:{requestId:JSON.parse(r.data).requestId,state,data}});},att(){return requests.filter(r=>/\/attendance(\/manage)?$/.test(r.url)).at(-1);},contact(data){requests.filter(r=>r.url==='/api/play/contact').at(-1).success({code:200,data});},read(){this.att().success({code:200,data:{config:{phone:'123456',role:'值班',dutyStart:1,dutyEnd:2,checkinOpenAt:1,checkinCloseAt:2},configVersion:'1',serverNow:3,dutyState:'ENDED',activeParticipation:true,mine:{},receiving:false}});}};
}

test('L06-043 同一读者回前台保留上次快照直到新读回;换号仍清空',()=>{
 const h=mount();h.read();assert.ok(h.c.data.snapshot);
 h.hide();h.show();assert.ok(h.c.data.snapshot,'回前台不清空快照');
 h.switch();h.hide();h.show();assert.equal(h.c.data.snapshot,null,'换账号必须清空');
});
test('L06-044 签到码领取失败后点「轻点重试」重新领取',async()=>{
 const h=mount();h.read();h.c.showCode();await tick();const claim=h.requests.at(-1);
 assert.equal(JSON.parse(claim.data).action,'attendance-claim');
 h.receipt(claim,'REJECTED',{});await tick();h.read();await tick();
 const before=h.requests.length;h.c.retryCode();await tick();
 const next=h.requests.slice(before).find(r=>r.data&&String(r.data).includes('attendance-claim'));
 assert.ok(next,'重试必须再次发起领取');
});
