import {mkdirSync} from 'node:fs';
import {Store} from './store.ts';
import {createApp} from './app.ts';
mkdirSync('data',{recursive:true});const store=new Store(process.env.DB_PATH||'data/app.sqlite');
const origin=process.env.WEB_ORIGIN||'http://localhost:5173';
createApp(store,{origin,secure:origin.startsWith('https:')}).listen(Number(process.env.PORT||8080),'0.0.0.0',()=>console.log('Academy API listening'));
