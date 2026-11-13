import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from './store.ts';

const password = 'long-enough-password';
async function fixture() {
 const dir=mkdtempSync(join(tmpdir(),'solid-learning-')); let time=1_700_000_000_000;
 const path=join(dir,'test.sqlite'); const store=new Store(path,()=>time);
 const admin=await store.createUser('admin','Admin',password,'admin','active');
 const user=await store.createUser('learner','Learner',password);
 return {store,admin,user,path,advance:(ms:number)=>{time+=ms;},close(){this.store.db.close();rmSync(dir,{recursive:true,force:true});}};
}
function answerId(s:Store, view:any, correct=true) {
 const original=s.course(view.courseId,view.version).items.find(i=>i.id===view.item.id)!;
 const text=original.options[original.correctIndex];
 return view.item.options.find((o:any)=>(o.text===text)===correct).id;
}
function throwsStatus(fn:()=>unknown,status:number) { assert.throws(fn,(e:any)=>e.status===status); }

test('registration, approval, block, role and password reset invalidate sessions',async()=>{
 const f=await fixture(); try {const {store:s,user:u,admin:a}=f;
 await assert.rejects(s.login('learner',password),(e:any)=>e.status===403);
 s.adminUpdate(a.id,u.id,{status:'active'}); const first=await s.login('Learner',password); assert.equal(s.authenticate(first.token).user.id,u.id);
 s.adminUpdate(a.id,u.id,{role:'admin'}); throwsStatus(()=>s.authenticate(first.token),401);
 const second=await s.login('learner',password); s.adminUpdate(a.id,u.id,{status:'blocked'}); throwsStatus(()=>s.authenticate(second.token),401);
 await assert.rejects(s.login('learner',password),(e:any)=>e.status===403);
 s.adminUpdate(a.id,u.id,{status:'active',role:'user'}); const third=await s.login('learner',password);
 await s.password(u.id,'replacement-password'); throwsStatus(()=>s.authenticate(third.token),401);
 await assert.rejects(s.login('learner',password),(e:any)=>e.status===401); assert.equal((await s.login('learner','replacement-password')).user.id,u.id);
 } finally {f.close();}
});

test('mastery is per learner and course, permanent after a mistake, and gates all item kinds',async()=>{
 const f=await fixture(); try {const {store:s,user:u,admin:a}=f; const c=s.course('tariffs');
 assert.ok(c.items.some(i=>i.kind==='question')&&c.items.some(i=>i.kind==='case'));
 assert.equal(s.access(u.id,c.id).allowed,false); assert.equal(s.unresolved(u.id,c.id).length,c.items.length);
 const item=c.items.find(i=>i.kind==='question')!; let v=s.start(u.id,c.id,'study',{itemId:item.id});
 v=s.answer(u.id,v.id,item.id,answerId(s,v)); assert.equal(v.feedback.correct,true); const points=v.points;
 v=s.answer(u.id,v.id,item.id,answerId(s,v,false)); assert.equal(v.points,points); assert.equal(s.unresolved(u.id,c.id).some(i=>i.id===item.id),false);
 s.action(u.id,v.id,'finish'); v=s.start(u.id,c.id,'study',{itemId:item.id}); s.answer(u.id,v.id,item.id,answerId(s,v,false)); s.action(u.id,v.id,'finish');
 assert.equal(s.unresolved(u.id,c.id).some(i=>i.id===item.id),false); assert.equal(s.unresolved(a.id,c.id).length,c.items.length);
 const caseItem=c.items.find(i=>i.kind==='case')!;
 for(const i of c.items.filter(i=>i.id!==caseItem.id)) s.run('INSERT OR IGNORE INTO mastery VALUES(?,?,?)',u.id,i.id,c.id);
 assert.equal(s.access(u.id,c.id).remainingCases,1); assert.equal(s.access(u.id,c.id).allowed,false);
 v=s.start(u.id,c.id,'cases',{itemId:caseItem.id}); s.answer(u.id,v.id,caseItem.id,answerId(s,v)); s.action(u.id,v.id,'finish');
 assert.equal(s.access(u.id,c.id).allowed,true); assert.equal(s.access(u.id,'regulations').allowed,false);
 } finally {f.close();}
});

test('exam access overrides preserve the disabled-course guard and exam answers do not count as training mastery',async()=>{
 const f=await fixture(); try {const {store:s,user:u}=f;
 const disabled={...s.course('regulations'),id:'disabled-fixture',examEnabled:false};
 s.run('INSERT INTO versions VALUES(?,?,?)','disabled-fixture-v1','disabled-fixture',JSON.stringify(disabled));s.run('INSERT INTO courses VALUES(?,?)','disabled-fixture','disabled-fixture-v1');
 for(const mode of ['auto','open','closed']) {s.run('INSERT OR REPLACE INTO access VALUES(?,?,?)',u.id,'disabled-fixture',mode); assert.equal(s.access(u.id,'disabled-fixture').allowed,false); throwsStatus(()=>s.start(u.id,'disabled-fixture','exam'),403);}
 s.run('INSERT OR REPLACE INTO access VALUES(?,?,?)',u.id,'tariffs','open'); assert.equal(s.access(u.id,'tariffs').allowed,true);
 let v=s.start(u.id,'tariffs','exam'); const id=v.item.id; v=s.answer(u.id,v.id,id,answerId(s,v)); assert.equal(v.feedback,null); s.action(u.id,v.id,'finish');
 assert.ok(s.unresolved(u.id,'tariffs').some(i=>i.id===id));
 s.run('UPDATE access SET mode=? WHERE user_id=? AND course_id=?','closed',u.id,'tariffs'); assert.equal(s.access(u.id,'tariffs').allowed,false); throwsStatus(()=>s.start(u.id,'tariffs','exam'),403);
 } finally {f.close();}
});

test('active attempts, pause and server timers survive reopening the database',async()=>{
 const f=await fixture(); try {let {store:s}=f; const u=f.user; const timed={...s.course('regulations'),id:'timed-fixture',timedPractice:true};
 s.run('INSERT INTO versions VALUES(?,?,?)','timed-fixture-v1',timed.id,JSON.stringify(timed));
 s.run('INSERT INTO courses VALUES(?,?)',timed.id,'timed-fixture-v1');
 let v=s.start(u.id,timed.id,'timed',{responseLimit:45});
 throwsStatus(()=>s.start(u.id,'tariffs','study'),409); f.advance(20000); v=s.action(u.id,v.id,'pause'); assert.equal(v.remaining,25);
 f.advance(120000); v=s.view(u.id,v.id); assert.equal(v.remaining,25); v=s.action(u.id,v.id,'resume'); f.advance(25000); v=s.view(u.id,v.id); assert.equal(v.answered,true); assert.equal(v.feedback.correct,false);
 const id=v.id,version=v.version; s.db.close(); s=new Store(f.path,()=>1_700_000_165_000); f.store=s;
 const reopened=s.view(u.id,id); assert.equal(reopened.version,version); assert.equal(reopened.answered,true); assert.equal(s.db.pragma('user_version',{simple:true}),1);
 s.action(u.id,id,'finish'); assert.equal(s.history(u.id)[0].id,id);
 } finally {f.close();}
});


test('exam timeout is enforced on the server and pause excludes elapsed time',async()=>{
 const f=await fixture(); try {const {store:s,user:u}=f;
 s.run('INSERT INTO access VALUES(?,?,?)',u.id,'tariffs','open'); let v=s.start(u.id,'tariffs','exam');
 f.advance(5000); v=s.action(u.id,v.id,'pause'); f.advance(2_000_000); v=s.view(u.id,v.id); assert.equal(v.status,'paused'); assert.equal(v.seconds,5);
 s.action(u.id,v.id,'resume'); f.advance(s.course('tariffs').exam.seconds*1000-5000); v=s.view(u.id,v.id);
 assert.equal(v.status,'completed'); assert.equal(v.endReason,'timeout'); assert.equal(v.total,v.length); assert.ok(v.review.every((i:any)=>typeof i.correctIndex==='number'));
 } finally {f.close();}
});

test('attempts retain the original course version when the current course changes',async()=>{
 const f=await fixture(); try {const {store:s,user:u}=f; const v=s.start(u.id,'tariffs','study'); const original=s.course('tariffs',v.version);
 const changed={...original,title:'New edition'}; const version='test-new-version';
 s.run('INSERT INTO versions VALUES(?,?,?)',version,'tariffs',JSON.stringify(changed)); s.run('UPDATE courses SET version=? WHERE id=?',version,'tariffs');
 assert.equal(s.course('tariffs').title,'New edition'); assert.equal(s.view(u.id,v.id).version,v.version); assert.equal(s.course('tariffs',v.version).title,original.title);
 } finally {f.close();}
});
