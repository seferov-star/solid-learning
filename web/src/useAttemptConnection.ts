import {useCallback,useEffect,useRef,useState} from 'react';
import {API,NetworkError,request} from './api';

type Pending={attemptId:string;itemId:string;optionId:string};
type AnswerState='idle'|'saving'|'checking'|'unconfirmed';
class UnconfirmedAnswer extends Error {answerPending=true;}
const terminal=(v:any)=>v&&['completed','abandoned'].includes(v.status);
function checked(v:any,id?:string){if(!v||typeof v.id!=='string'||(id&&v.id!==id)||!['active','paused','completed','abandoned'].includes(v.status)||typeof v.item?.id!=='string'||!Array.isArray(v.item.options)||!Array.isArray(v.course?.topics))throw new NetworkError('Некорректное состояние попытки');return v;}
const receipt=(v:any,p:Pending)=>v?.receipts?.some((r:any)=>r.itemId===p.itemId)||(v?.item?.id===p.itemId&&v.answered);

/** Server remains authoritative. Local state only holds an unacknowledged delivery. */
export function useAttemptConnection(userId:string|undefined,busy:boolean){
 const [attempt,put]=useState<any>(null),[pending,P]=useState<Pending|null>(null),[answerState,AS]=useState<AnswerState>('idle'),[connection,C]=useState(''),[working,W]=useState(false);
 const epoch=useRef(0),poll=useRef<AbortController|null>(null),wake=useRef(()=>{}),current=useRef<any>(null),pendingRef=useRef<Pending|null>(null),sending=useRef(false);
 const owner=useRef(userId);
 const key=userId?'solid-learning.pending:'+API+':'+userId:'';
 const cancel=useCallback(()=>{++epoch.current;poll.current?.abort();poll.current=null;},[]);
 const receive=useCallback((v:any)=>{current.current=v;put(v);},[]);
 const setAttempt=useCallback((v:any)=>{cancel();receive(v?checked(v):null);C('');},[cancel,receive]);
 const keep=useCallback((p:Pending|null)=>{pendingRef.current=p;P(p);if(key){if(p)sessionStorage.setItem(key,JSON.stringify(p));else sessionStorage.removeItem(key);}},[key]);

 useEffect(()=>{
  const previous=owner.current;owner.current=userId;
  cancel();if(!userId||(previous&&previous!==userId))receive(null);C('');AS('idle');
  let saved:Pending|null=null;
  try{const raw=key&&sessionStorage.getItem(key);if(raw){const v=JSON.parse(raw);if(['attemptId','itemId','optionId'].every(k=>typeof v[k]==='string'))saved=v;}}
  catch{if(key)sessionStorage.removeItem(key);}
  pendingRef.current=saved;P(saved);if(saved)AS('unconfirmed');
 },[userId,key,cancel,receive]);

 const run=useCallback(async(fn:()=>Promise<any>)=>{
  cancel();const n=epoch.current;W(true);
  try{const v=checked(await fn());if(n===epoch.current){receive(v);C('');}return v;}
  finally{W(false);}
 },[cancel,receive]);

 const deliver=useCallback(async(p:Pending,readFirst:boolean)=>{
  if(sending.current)return; sending.current=true;
  try{return await run(async()=>{
   const read=async()=>checked(await request('/attempts/'+p.attemptId,undefined,'GET',{attempts:1,timeoutMs:5000}),p.attemptId);
   const resolved=(v:any)=>receipt(v,p)||terminal(v)||v.item?.id!==p.itemId;
   const confirmed=(v:any)=>{keep(null);AS('idle');return current.current&&current.current.id!==p.attemptId&&!terminal(current.current)?current.current:v;};
   try{
    if(navigator.onLine===false)throw new NetworkError('Offline');
    if(readFirst){AS('checking');const v=await read();if(resolved(v))return confirmed(v);if(v.status!=='active'){keep(null);AS('idle');return v;}}
    for(let retry=0;retry<2;retry++){
     AS('saving');
     try{
      const v=checked(await request('/attempts/'+p.attemptId+'/answer',{itemId:p.itemId,optionId:p.optionId},'POST',{attempts:1,timeoutMs:8000}),p.attemptId);
      if(resolved(v))return confirmed(v);
     }catch(e:any){
      if(!e.network&&!(e.status>=500)){
       if(e.status!==401){keep(null);AS('idle');try{receive(await read());}catch{}}
       throw e;
      }
     }
     // A lost response does not mean the write failed. Read before replaying the same IDs.
     AS('checking');const v=await read();
     if(resolved(v))return confirmed(v);
     if(v.status!=='active'){keep(null);AS('idle');return v;}
    }
    throw new NetworkError('No acknowledgement');
   }catch(e:any){
    if(e.network||e.status>=500){AS('unconfirmed');throw new UnconfirmedAnswer('Ответ пока не подтверждён');}
    throw e;
   }
  });}finally{sending.current=false;}
 },[run,keep,receive]);

 const sendAnswer=useCallback(async(optionId:string)=>{
  if(pendingRef.current||!current.current)return;
  const p={attemptId:current.current.id,itemId:current.current.item.id,optionId};
  keep(p);AS('saving');return deliver(p,false);
 },[keep,deliver]);
 const retryAnswer=useCallback(async()=>{const p=pendingRef.current;if(p)return deliver(p,true);},[deliver]);

 // Read a recovered attempt first; a confirmed answer survives a reload without replaying the POST.
 useEffect(()=>{
  if(!pending||!attempt||attempt.id!==pending.attemptId||working||busy)return;
  if(receipt(attempt,pending)||terminal(attempt)||attempt.item?.id!==pending.itemId){keep(null);AS('idle');}
 },[attempt,pending,working,busy,keep]);

 useEffect(()=>{
  if(!userId||!attempt||terminal(attempt)||working||busy||pending)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>,inFlight=false,delay=attempt.status==='paused'?30000:10000;
  const schedule=()=>{if(!stopped)timer=setTimeout(cycle,delay);};
  async function cycle(){
   if(stopped||inFlight)return;
   if(document.visibilityState==='hidden'){delay=30000;schedule();return;}
   if(navigator.onLine===false){C('Нет связи с сервером. Состояние обновится после подключения.');delay=30000;schedule();return;}
   inFlight=true;const controller=new AbortController(),n=epoch.current;poll.current=controller;
   try{
    const v=checked(await request('/attempts/'+attempt.id,undefined,'GET',{signal:controller.signal,attempts:1,timeoutMs:6000}),attempt.id);
    if(!stopped&&n===epoch.current){receive(v);C('');delay=attempt.status==='paused'?30000:10000;}
   }catch(e:any){
    if(!stopped&&n===epoch.current&&e.name!=='AbortError'){C('Не удалось обновить состояние. Отправка ответа проверяется отдельно.');delay=Math.min(delay*2,60000);}
   }finally{inFlight=false;if(poll.current===controller)poll.current=null;schedule();}
  }
  const refresh=()=>{if(!stopped&&!inFlight&&document.visibilityState!=='hidden'){clearTimeout(timer);void cycle();}};
  wake.current=refresh;
  window.addEventListener('online',refresh);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  schedule();
  return()=>{stopped=true;clearTimeout(timer);poll.current?.abort();wake.current=()=>{};window.removeEventListener('online',refresh);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[userId,attempt?.id,attempt?.status,working,busy,!!pending,receive]);

 useEffect(()=>{
  if(!pending||answerState!=='unconfirmed'||working||busy)return;
  let stopped=false;
  const recover=()=>{if(!stopped&&navigator.onLine!==false&&document.visibilityState!=='hidden')void retryAnswer().catch(()=>{});};
  const timer=setTimeout(recover,15000);
  window.addEventListener('online',recover);window.addEventListener('focus',recover);
  return()=>{stopped=true;clearTimeout(timer);window.removeEventListener('online',recover);window.removeEventListener('focus',recover);};
 },[pending,attempt?.id,answerState,working,busy,retryAnswer]);

 const [now,N]=useState(()=>performance.now()),anchor=useRef(performance.now());
 useEffect(()=>{anchor.current=performance.now();N(anchor.current);if(!attempt||attempt.status!=='active'||terminal(attempt))return;const timer=setInterval(()=>N(performance.now()),250);return()=>clearInterval(timer);},[attempt]);
 const delta=attempt?.status==='active'?Math.max(0,now-anchor.current)/1000:0;
 const seconds=Math.floor((attempt?.seconds||0)+delta),remaining=Math.max(0,Math.ceil((attempt?.remaining||0)-(attempt?.mode==='timed'&&attempt.answered?0:delta)));
 const expired=useRef('');
 useEffect(()=>{if(!attempt||busy||working||pending||attempt.status!=='active'||!['exam','timed'].includes(attempt.mode)||(attempt.mode==='timed'&&attempt.answered)||remaining>0)return;const id=attempt.id+':'+attempt.item.id;if(expired.current!==id){expired.current=id;wake.current();}},[attempt,remaining,busy,working,pending]);

 return {working,attempt,setAttempt,run,sendAnswer,retryAnswer,pending,answerState,connection,seconds,remaining};
}
