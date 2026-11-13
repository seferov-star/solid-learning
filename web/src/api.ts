export const API=import.meta.env.VITE_API_URL||'http://localhost:8080';
let csrf='';
const sessionKey='solid-learning.session:'+API;
let token=sessionStorage.getItem(sessionKey)||'';
function forget(){token='';csrf='';sessionStorage.removeItem(sessionKey);}
const authHeaders=():Record<string,string>=>token?{Authorization:'Bearer '+token}:{};
const label=(path:string)=>path==='/courses'?'список учебных тем':path==='/attempts'?'историю прохождений':path==='/me'?'профиль':path.startsWith('/admin/users')?'список пользователей':path.startsWith('/admin/results')?'результаты':path.startsWith('/admin/audit')?'журнал действий':'данные';
export class NetworkError extends Error {network=true;}
export interface RequestOptions {signal?:AbortSignal;attempts?:number;timeoutMs?:number;}
export async function request(path:string,body?:any,method?:string,options:RequestOptions={}){
 const verb=method||(body?'POST':'GET'),tries=options.attempts??(verb==='GET'?2:1);
 for(let attempt=0;attempt<tries;attempt++){
  const controller=new AbortController(),abort=()=>controller.abort();
  if(options.signal?.aborted)throw new DOMException('Request cancelled','AbortError');
  options.signal?.addEventListener('abort',abort,{once:true});
  const timeout=setTimeout(abort,options.timeoutMs??(verb==='GET'?7000:15000));
  try {
   const r=await fetch(API+'/api/v1'+path,{method:verb,credentials:'omit',signal:controller.signal,headers:{...authHeaders(),...(path==='/auth/login'?{'X-Session-Transport':'bearer'}:{}),...(body?{'Content-Type':'application/json'}:{}),...(csrf&&verb!=='GET'?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});
   if(!r.headers.get('content-type')?.includes('application/json'))throw Object.assign(new NetworkError('Сервис вернул неожиданный ответ. Проверьте соединение.'),{status:r.status});
   const data=await r.json();
   if(options.signal?.aborted)throw new DOMException('Request cancelled','AbortError');
   if(!r.ok){const error=Object.assign(new Error(data.error||'Ошибка запроса'),{status:r.status});if(r.status===401&&!path.startsWith('/auth/')){forget();window.dispatchEvent(new Event('academy-session-expired'));}throw error;}
   if(data.sessionToken){token=data.sessionToken;sessionStorage.setItem(sessionKey,token);}if(data.csrf)csrf=data.csrf;if(path==='/auth/logout'||path==='/auth/password')forget();return data;
  } catch(error:any) {
   if(options.signal?.aborted)throw new DOMException('Request cancelled','AbortError');
   const network=controller.signal.aborted||error.name==='AbortError'||error instanceof TypeError||error instanceof SyntaxError||error instanceof NetworkError;
   if(network&&attempt+1<tries)continue;
   if(network)throw new NetworkError(verb==='GET'?`Не удалось обновить ${label(path)}. Проверьте соединение.`:'Сервер не подтвердил выполнение действия. Проверьте соединение и обновите состояние.');
   throw error;
  } finally {clearTimeout(timeout);options.signal?.removeEventListener('abort',abort);}
 }
}
export async function downloadCsv(path:string){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{const r=await fetch(API+'/api/v1'+path,{headers:authHeaders(),credentials:'omit',signal:controller.signal});if(!r.ok)throw new Error('Не удалось выгрузить результаты');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download='results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}finally{clearTimeout(timer);}
}
