export const API=import.meta.env.VITE_API_URL||'http://localhost:8080';
let csrf='';
export async function request(path:string,body?:any,method?:string){
 try {
  const r=await fetch(API+'/api/v1'+path,{method:method||(body?'POST':'GET'),credentials:'include',signal:AbortSignal.timeout(20000),headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf&&(body||method)&&method!=='GET'?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});
  const data=r.headers.get('content-type')?.includes('application/json')?await r.json():{error:'Сервис временно недоступен. Повторите запрос.'};
  if(!r.ok){const error=Object.assign(new Error(data.error||'Ошибка запроса'),{status:r.status});if(r.status===401&&!path.startsWith('/auth/'))window.dispatchEvent(new Event('academy-session-expired'));throw error;}
  if(data.csrf)csrf=data.csrf;return data;
 } catch(error:any) {
  if(error.name==='TimeoutError'||error.name==='AbortError')throw new Error('Сервер не ответил за 20 секунд. Проверьте соединение и повторите запрос.');
  if(error instanceof TypeError)throw new Error('Нет связи с сервером. Проверьте соединение и повторите запрос.');
  throw error;
 }
}
