export const API=import.meta.env.VITE_API_URL||'http://localhost:8080';
let csrf='';
export async function request(path:string,body?:any,method?:string){const r=await fetch(API+'/api/v1'+path,{method:method||(body?'POST':'GET'),credentials:'include',headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error||'РћС€РёР±РєР° Р·Р°РїСЂРѕСЃР°');if(data.csrf)csrf=data.csrf;return data;}
