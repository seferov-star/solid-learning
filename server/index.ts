import {mkdirSync} from 'node:fs';
import {Store} from './store.ts';
import {createApp} from './app.ts';
mkdirSync('data',{recursive:true});const store=new Store(process.env.DB_PATH||'data/app.sqlite');
const origin=process.env.WEB_ORIGIN||'http://localhost:5173';
createApp(store,{origin,secure:origin.startsWith('https:')}).listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Academy API listening'));

// Resolve expired attempts even when no learner reconnects.
setInterval(()=>{for(const r of store.all("SELECT id,user_id FROM attempts WHERE status='active' AND mode IN ('exam','timed')")){try{store.load(r.user_id,r.id);}catch(e){console.error('Attempt timer failed',r.id);}}},1000).unref();
