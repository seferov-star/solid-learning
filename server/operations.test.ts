import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {Store} from './store.ts';
import {createApp} from './app.ts';
const password='load-test-password';

test('20 concurrent HTTP learners maintain isolated attempts and mastery',async()=>{
 const s=new Store(':memory:'); const users=await Promise.all(Array.from({length:20},(_,i)=>s.createUser('load'+i,'Load '+i,password,'user','active')));
 const server=createApp(s).listen(0); await new Promise<void>(r=>server.once('listening',r)); const url=`http://127.0.0.1:${(server.address() as any).port}/api/v1`,origin='http://localhost:5173';
 async function req(path:string,method='GET',body?:any,auth?:{cookie:string,csrf:string}){const r=await fetch(url+path,{method,headers:{...(method!=='GET'?{origin,'content-type':'application/json'}:{}),...(auth?{cookie:auth.cookie,'x-csrf-token':auth.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.ok(r.ok,`${r.status}: ${JSON.stringify(data)}`);return {r,data};}
 try {
  const results=await Promise.all(users.map(async(u,i)=>{
   const login=await req('/auth/login','POST',{login:'load'+i,password});const auth={cookie:login.r.headers.get('set-cookie')!.split(';')[0],csrf:login.data.csrf};
   const v=(await req('/attempts','POST',{courseId:'tariffs',mode:'study'},auth)).data;
   const item=s.course('tariffs',v.version).items.find(x=>x.id===v.item.id)!;const correct=item.options[item.correctIndex];const option=v.item.options.find((x:any)=>x.text===correct);
   const answer=(await req('/attempts/'+v.id+'/answer','POST',{itemId:v.item.id,optionId:option.id},auth)).data;
   const duplicate=(await req('/attempts/'+v.id+'/answer','POST',{itemId:v.item.id,optionId:option.id},auth)).data;
   assert.equal(answer.feedback.correct,true);assert.equal(duplicate.points,answer.points);
   await req('/attempts/'+v.id+'/action','POST',{action:'finish'},auth);return {id:v.id,user:u.id,item:item.id};
  }));
  assert.equal(new Set(results.map(r=>r.id)).size,20);for(const r of results){assert.equal(s.mastered(r.user,'tariffs').has(r.item),true);assert.equal(s.history(r.user).length,1);}
 } finally {await new Promise<void>((r,reject)=>server.close(e=>e?reject(e):r()));s.db.close();}
});

test('SQLite backup restores users and progress and preserves selected course version across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'solid-backup-')),db=join(dir,'source.sqlite'),backup=join(dir,'backup.sqlite');let s=new Store(db);
 try {const u=await s.createUser('backup','Backup',password,'user','active');const v=s.start(u.id,'tariffs','study');const item=s.course('tariffs').items.find(x=>x.id===v.item.id)!;s.answer(u.id,v.id,item.id,v.item.options.find((o:any)=>o.text===item.options[item.correctIndex]).id);s.action(u.id,v.id,'finish');
  const old=s.course('tariffs'),custom={...old,title:'Restored edition'},version='published-test-version';s.run('INSERT INTO versions VALUES(?,?,?)',version,'tariffs',JSON.stringify(custom));s.run('UPDATE courses SET version=? WHERE id=?',version,'tariffs');
  await s.db.backup(backup);s.db.close();s=new Store(backup);assert.equal(s.course('tariffs').title,'Restored edition');assert.equal(s.get('SELECT version FROM courses WHERE id=?','tariffs').version,version);assert.equal(s.mastered(u.id,'tariffs').has(item.id),true);assert.equal(s.history(u.id)[0].id,v.id);assert.equal((await s.login('backup',password)).user.id,u.id);assert.equal(s.db.pragma('integrity_check',{simple:true}),'ok');
 } finally {s.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('bootstrap writes usable credentials to a file without printing the secret',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'solid-bootstrap-'));const manage=resolve('server/manage.ts'),tsx=resolve('node_modules/tsx/dist/cli.mjs');
 try {const output=execFileSync(process.execPath,[tsx,manage,'bootstrap'],{cwd:dir,encoding:'utf8'});const content=readFileSync(join(dir,'data/bootstrap.txt'),'utf8');const secret=content.match(/Пароль: ([^\r\n]+)/)?.[1];assert.ok(secret);assert.equal(output.includes(secret),false);const s=new Store(join(dir,'data/app.sqlite'));try {const logged=await s.login('admin',secret);assert.equal(logged.user.role,'admin');assert.equal(logged.user.force_change,1);}finally{s.db.close();}}
 finally {rmSync(dir,{recursive:true,force:true});}
});

test('unresolved status, active admin review and notes restriction during exam',async()=>{
 const s=new Store(':memory:');const admin=await s.createUser('admin','Admin',password,'admin','active');const user=await s.createUser('student','Student',password,'user','active');
 const server=createApp(s).listen(0);await new Promise<void>(r=>server.once('listening',r));const url=`http://127.0.0.1:${(server.address() as any).port}/api/v1`,origin='http://localhost:5173';
 async function req(path:string,method='GET',body?:any,auth?:any){const r=await fetch(url+path,{method,headers:{...(method!=='GET'?{origin,'content-type':'application/json'}:{}),...(auth?{cookie:auth.cookie,'x-csrf-token':auth.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return {r,data:await r.json()};}
 async function login(name:string){const x=await req('/auth/login','POST',{login:name,password});assert.equal(x.r.status,200);return {cookie:x.r.headers.get('set-cookie')!.split(';')[0],csrf:x.data.csrf};}
 try {const a=await login('admin'),u=await login('student');const item=s.course('tariffs').items.find(i=>i.kind==='question')!;
  assert.equal((await req('/courses/tariffs/unresolved','GET',undefined,u)).data.find((i:any)=>i.id===item.id).trainingStatus,'unanswered');
  const attempt=(await req('/attempts','POST',{courseId:'tariffs',mode:'study',itemId:item.id},u)).data;
  await req('/attempts/'+attempt.id+'/action','POST',{action:'hint'},u);const active=s.view(user.id,attempt.id);const wrong=active.item.options.find((o:any,i:number)=>o.text!==item.options[item.correctIndex]&&!active.hidden.includes(i));
  const answered=await req('/attempts/'+attempt.id+'/answer','POST',{itemId:item.id,optionId:wrong.id},u);assert.equal(answered.data.feedback.correct,false);
  assert.equal((await req('/courses/tariffs/unresolved','GET',undefined,u)).data.find((i:any)=>i.id===item.id).trainingStatus,'incorrect');
  const detail=await req('/admin/results/'+attempt.id,'GET',undefined,a);assert.equal(detail.r.status,200);assert.equal(detail.data.status,'active');assert.equal(detail.data.review.length,1);assert.equal(detail.data.review[0].correct,false);assert.ok(detail.data.events.some((e:any)=>e.type==='hint'));
  await req('/attempts/'+attempt.id+'/action','POST',{action:'finish'},u);s.run('INSERT INTO access VALUES(?,?,?)',user.id,'tariffs','open');
  const exam=await req('/attempts','POST',{courseId:'tariffs',mode:'exam'},u);assert.equal(exam.r.status,201);assert.equal((await req('/courses/tariffs/notes','GET',undefined,u)).r.status,403);await req('/attempts/'+exam.data.id+'/action','POST',{action:'pause'},u);assert.equal((await req('/courses/regulations/notes','GET',undefined,u)).r.status,403);await req('/attempts/'+exam.data.id+'/action','POST',{action:'finish'},u);assert.equal((await req('/courses/tariffs/notes','GET',undefined,u)).r.status,200);
 } finally {await new Promise<void>((r,reject)=>server.close(e=>e?reject(e):r()));s.db.close();}
});
