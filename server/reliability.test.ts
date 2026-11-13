import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from './store.ts';

async function fixture(){const dir=mkdtempSync(join(tmpdir(),'reliability-'));let now=1_700_000_000_000;const path=join(dir,'test.sqlite');let store=new Store(path,()=>now);const user=await store.createUser('reliable-user','Reliable User','long-enough-password','user','active');return {dir,path,user,get store(){return store},set store(v:Store){store=v},now:()=>now,advance:(ms:number)=>{now+=ms},close(){try{store.db.close()}finally{try{rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100})}catch{}}}}}
const option=(view:any,index=0)=>view.item.options[index].id;

test('repeated attempt polling advances in-memory clock without writing SQLite',async()=>{
 const f=await fixture();try{const {store:s,user:u}=f;const v=s.start(u.id,'tariffs','study',{itemId:s.course('tariffs').items[0].id});const before=s.get('SELECT total_changes() AS n').n;
  let view:any;for(let i=0;i<10;i++){f.advance(1000);view=s.view(u.id,v.id);assert.equal(view.seconds,i+1)}
  assert.equal(s.get('SELECT total_changes() AS n').n,before,'poll-only reads must not update attempt rows');
  const saved=s.get('SELECT data FROM attempts WHERE id=?',v.id);assert.equal(JSON.parse(saved.data).elapsed,0,'polling clock is committed only by meaningful state changes');
 }finally{f.close()}
});

test('pause and timeout state survive database restart and paused time is excluded',async()=>{
 const f=await fixture();try{let s=f.store;const u=f.user;s.run('INSERT INTO access VALUES(?,?,?)',u.id,'regulations','open');let v=s.start(u.id,'regulations','exam');f.advance(12_000);v=s.action(u.id,v.id,'pause');assert.equal(v.seconds,12);const id=v.id;s.db.close();s=new Store(f.path,()=>f.now());f.store=s;f.advance(2_000_000);v=s.view(u.id,id);assert.equal(v.status,'paused');assert.equal(v.seconds,12);v=s.action(u.id,id,'resume');assert.equal(v.status,'active');f.advance(s.course('regulations',v.version).exam.seconds*1000-12_000);v=s.view(u.id,id);assert.equal(v.status,'completed');assert.equal(v.endReason,'timeout');assert.equal(v.seconds,s.course('regulations',v.version).exam.seconds);s.db.close();s=new Store(f.path,()=>f.now());f.store=s;assert.equal(s.view(u.id,id).status,'completed');assert.equal(s.history(u.id)[0].endReason,'timeout');}finally{f.close()}
});

test('answer receipts are opaque and duplicate delivery after advancement cannot regrade or award twice',async()=>{
 const f=await fixture();try{const {store:s,user:u}=f;const bank=s.course('tariffs').items.filter(i=>i.kind==='question');const v=s.start(u.id,'tariffs','study',{ids:bank.slice(0,2).map(i=>i.id)});const first=s.course('tariffs',v.version).items.find(i=>i.id===v.item.id)!;const chosen=v.item.options.find((o:any)=>o.text===first.options[first.correctIndex])!;const answered=s.answer(u.id,v.id,v.item.id,chosen.id);assert.deepEqual(answered.receipts,[{itemId:first.id,optionId:chosen.id}]);assert.equal('correctIndex' in answered.receipts[0],false);assert.equal(answered.feedback.correct,true);const points=answered.points,mastery=s.get('SELECT COUNT(*) n FROM mastery WHERE user_id=? AND course_id=?',u.id,'tariffs').n;const advanced=s.action(u.id,v.id,'next');assert.notEqual(advanced.item.id,first.id);const duplicate=s.answer(u.id,v.id,first.id,chosen.id);assert.equal(duplicate.item.id,advanced.item.id);assert.equal(duplicate.points,points);assert.equal(s.get('SELECT COUNT(*) n FROM mastery WHERE user_id=? AND course_id=?',u.id,'tariffs').n,mastery);assert.equal(duplicate.receipts.filter((r:any)=>r.itemId===first.id).length,1);
 }finally{f.close()}
});
