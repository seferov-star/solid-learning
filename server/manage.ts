import {Store} from './store.ts';
import {mkdirSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
mkdirSync('data',{recursive:true});const s=new Store(process.env.DB_PATH||'data/app.sqlite');
if(process.argv[2]==='bootstrap'){
 if(s.get("SELECT id FROM users WHERE role='admin'"))throw Error('Administrator already exists');
 const password=randomBytes(20).toString('base64url');await s.createUser('admin','Администратор',password,'admin','active',true);
 writeFileSync('data/bootstrap.txt','Логин: admin\nПароль: '+password+'\nОбязательно смените пароль при первом входе.\n',{mode:0o600});console.log('Bootstrap credentials written to data/bootstrap.txt');
}else if(process.argv[2]==='backup'){
 mkdirSync('data/backups',{recursive:true});const date=new Date().toISOString().slice(0,10);
 await s.db.backup('data/backups/daily-'+date+'.sqlite');if(new Date().getUTCDay()===0)await s.db.backup('data/backups/weekly-'+date+'.sqlite');
 for(const [prefix,keep] of [['daily-',14],['weekly-',4]] as const){const files=readdirSync('data/backups').filter(f=>f.startsWith(prefix)&&f.endsWith('.sqlite')).sort().reverse();for(const name of files.slice(keep))unlinkSync('data/backups/'+name);}
 console.log('Backup complete');
}else throw Error('Expected bootstrap or backup');s.db.close();
