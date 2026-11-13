import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from './store.ts';
import {createApp} from './app.ts';

const origin='http://localhost:5173', password='long-enough-password';
test('HTTP authorization, account controls, access and CSV export',async()=>{
 const s=new Store(':memory:'); const admin=await s.createUser('admin','Admin',password,'admin','active');
 const user=await s.createUser('learner','=Learner',password,'user','active');
 const pending=await s.createUser('pending','Pending',password);
 const server=createApp(s).listen(0); await new Promise<void>(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/v1`;
 type Session={cookie:string,csrf:string};
 async function request(path:string,method='GET',body?:any,session?:Session,headers:Record<string,string>={}) {
  const res=await fetch(url+path,{method,headers:{...(method!=='GET'?{origin,'content-type':'application/json'}:{}),...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const content=await res.text(); let data:any; try {data=JSON.parse(content)} catch {data=content}; return {res,data};
 }
 async function login(login:string,pass=password):Promise<Session> {const x=await request('/auth/login','POST',{login,password:pass}); assert.equal(x.res.status,200,JSON.stringify(x.data));return {cookie:x.res.headers.get('set-cookie')!.split(';')[0],csrf:x.data.csrf};}
 try {
  assert.equal((await request('/auth/login','POST',{login:'pending',password})).res.status,403);
  assert.equal((await request('/auth/login','POST',{login:'learner',password},undefined,{origin:'http://evil.test'})).res.status,403);
  const a=await login('admin'), u=await login('learner');
  assert.equal((await request('/admin/users','GET',undefined,u)).res.status,403);
  assert.equal((await request('/attempts','POST',{courseId:'tariffs',mode:'study'},u,{'x-csrf-token':'bad'})).res.status,403);
  const attempt=await request('/attempts','POST',{courseId:'tariffs',mode:'study'},u); assert.equal(attempt.res.status,201);
  assert.equal((await request(`/attempts/${attempt.data.id}`,'GET',undefined,a)).res.status,404);
  assert.equal((await request(`/attempts/${attempt.data.id}/action`,'POST',{action:'finish'},a)).res.status,404);
  assert.equal((await request(`/admin/users/${user.id}/courses/phone/access`,'PATCH',{mode:'open'},a)).res.status,400);
  assert.equal((await request(`/admin/users/${user.id}/courses/tariffs/access`,'PATCH',{mode:'open'},u)).res.status,403);
  const open=await request(`/admin/users/${user.id}/courses/tariffs/access`,'PATCH',{mode:'open'},a); assert.equal(open.data.allowed,true);
  const closed=await request(`/admin/users/${user.id}/courses/tariffs/access`,'PATCH',{mode:'closed'},a); assert.equal(closed.data.allowed,false);
  const csv=await request('/admin/export','GET',undefined,a); assert.equal(csv.res.status,200); assert.match(csv.res.headers.get('content-type')!,/text\/csv/); assert.match(csv.data,/'=Learner/);
  const reset=await request(`/admin/users/${user.id}/reset-password`,'POST',{},a); assert.equal(reset.res.status,200);
  assert.equal((await request('/me','GET',undefined,u)).res.status,401);
  const temp=await login('learner',reset.data.password); assert.equal((await request('/me','GET',undefined,temp)).data.user.force_change,1);
  assert.equal((await request('/courses','GET',undefined,temp)).res.status,403);
  assert.equal((await request('/auth/password','POST',{currentPassword:reset.data.password,password:'new-long-password'},temp)).res.status,200);
  assert.equal((await request('/me','GET',undefined,temp)).res.status,401);
  const changed=await login('learner','new-long-password');
  assert.equal((await request(`/admin/users/${user.id}`,'PATCH',{role:'admin'},a)).res.status,200);
  assert.equal((await request('/me','GET',undefined,changed)).res.status,401);
  const promoted=await login('learner','new-long-password'); assert.equal((await request('/admin/users','GET',undefined,promoted)).res.status,200);
  assert.equal((await request(`/admin/users/${user.id}`,'PATCH',{status:'blocked'},a)).res.status,200);
  assert.equal((await request('/me','GET',undefined,promoted)).res.status,401);
  assert.equal((await request('/auth/login','POST',{login:'learner',password:'new-long-password'})).res.status,403);
  assert.equal((await request(`/admin/users/${pending.id}`,'PATCH',{status:'active'},a)).res.status,200); assert.ok(await login('pending'));
 } finally {await new Promise<void>((r,reject)=>server.close(e=>e?reject(e):r())); s.db.close();}
});

test('bearer sessions support cross-origin web clients without cookies',async()=>{
 const s=new Store(':memory:'); await s.createUser('bearer-admin','Bearer Admin',password,'admin','active');
 const server=createApp(s,{origin:'https://client.example',secure:true}).listen(0); await new Promise<void>(r=>server.once('listening',r));
 const url=`http://127.0.0.1:${(server.address() as any).port}/api/v1`,origin='https://client.example';
 async function request(path:string,method='GET',body?:any,headers:Record<string,string>={},requestOrigin=origin){
  const res=await fetch(url+path,{method,headers:{origin:requestOrigin,...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await res.text();let data:any;try{data=JSON.parse(text)}catch{data=text};return {res,data};
 }
 try {
  const login=await request('/auth/login','POST',{login:'bearer-admin',password},{'X-Session-Transport':'bearer'});
  assert.equal(login.res.status,200);assert.equal(login.res.headers.get('set-cookie'),null);assert.equal(typeof login.data.sessionToken,'string');assert.ok(login.data.sessionToken.length>20);
  const auth={Authorization:`Bearer ${login.data.sessionToken}`};
  const me=await request('/me','GET',undefined,auth);assert.equal(me.res.status,200);assert.equal(me.data.user.login,'bearer-admin');
  const csv=await request('/admin/export','GET',undefined,auth);assert.equal(csv.res.status,200);assert.match(csv.res.headers.get('content-type')!,/text\/csv/);
  assert.equal((await request('/attempts','POST',{courseId:'tariffs',mode:'study'},auth)).res.status,403);
  const attempt=await request('/attempts','POST',{courseId:'tariffs',mode:'study'}, {...auth,'X-CSRF-Token':login.data.csrf});assert.equal(attempt.res.status,201);
  const preflight=await request('/admin/export','OPTIONS',undefined,{ 'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,content-type' });
  assert.equal(preflight.res.status,204);assert.match(preflight.res.headers.get('access-control-allow-headers')||'',/Authorization/i);assert.equal(preflight.res.headers.get('access-control-allow-origin'),origin);
  assert.equal((await request('/admin/export','OPTIONS',undefined,{ 'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization' },'https://evil.example')).res.status,403);
  const logout=await request('/auth/logout','POST',undefined,{...auth,'X-CSRF-Token':login.data.csrf});assert.equal(logout.res.status,200);
  assert.equal((await request('/me','GET',undefined,auth)).res.status,401);
 } finally {await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
