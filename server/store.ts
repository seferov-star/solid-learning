import Database from 'better-sqlite3';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import argon2 from 'argon2';
import {COURSES,makeDeck, type Item, type Course, type Mode} from '../web/src/learning/courses.ts';
export class Problem extends Error { constructor(public status:number, message:string){super(message);} }
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export class Store {
 db:Database.Database;
 constructor(path:string,public now=()=>Date.now()) {
  this.db=new Database(path);this.db.pragma('journal_mode = WAL');this.db.pragma('foreign_keys = ON');this.db.pragma('busy_timeout = 5000');
  this.db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,login TEXT UNIQUE,name TEXT,password TEXT,role TEXT,status TEXT,force_change INTEGER DEFAULT 0,created INTEGER);
  CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),csrf TEXT,expires INTEGER);
  CREATE TABLE IF NOT EXISTS courses(id TEXT PRIMARY KEY,version TEXT);
  CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,course_id TEXT,payload TEXT);
  CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),course_id TEXT,version TEXT REFERENCES versions(id),mode TEXT,status TEXT,data TEXT,created INTEGER,updated INTEGER);
  CREATE UNIQUE INDEX IF NOT EXISTS one_active ON attempts(user_id) WHERE status IN ('active','paused');
  CREATE TABLE IF NOT EXISTS mastery(user_id TEXT,item_id TEXT,course_id TEXT,PRIMARY KEY(user_id,item_id,course_id));
  CREATE TABLE IF NOT EXISTS bookmarks(user_id TEXT,item_id TEXT,course_id TEXT,PRIMARY KEY(user_id,item_id,course_id));
  CREATE TABLE IF NOT EXISTS access(user_id TEXT,course_id TEXT,mode TEXT,PRIMARY KEY(user_id,course_id));
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,actor TEXT,action TEXT,target TEXT,details TEXT,created INTEGER);
  PRAGMA user_version=1;`);
  for(const course of COURSES){const payload=JSON.stringify(course),version=hash(payload);this.db.prepare('INSERT OR IGNORE INTO versions VALUES(?,?,?)').run(version,course.id,payload);this.db.prepare('INSERT OR IGNORE INTO courses VALUES(?,?)').run(course.id,version);}
 }
 run(sql:string,...args:any[]){return this.db.prepare(sql).run(...args);}
 get(sql:string,...args:any[]):any{return this.db.prepare(sql).get(...args);}
 all(sql:string,...args:any[]):any[]{return this.db.prepare(sql).all(...args);}
 log(actor:string,action:string,target:string,details:any={}){this.run('INSERT INTO audit(actor,action,target,details,created) VALUES(?,?,?,?,?)',actor,action,target,JSON.stringify(details),this.now());}
 user(id:string){const u=this.get('SELECT id,login,name,role,status,force_change,created FROM users WHERE id=?',id);if(!u)throw new Problem(404,'Пользователь не найден');return u;}
 async createUser(login:string,name:string,password:string,role='user',status='pending',force=false){
  login=String(login||'').normalize('NFKC').toLowerCase().trim();name=String(name||'').trim();
  if(!/^[a-z0-9_.-]{3,32}$/.test(login)||!name||name.length>120)throw new Problem(400,'Логин: 3–32 латинских символа, цифры, _, точка или дефис. Укажите имя.');
  if(typeof password!=='string'||password.length<12||password.length>128)throw new Problem(400,'Пароль должен содержать от 12 до 128 символов');
  const passwordHash=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});const id=randomUUID();
  try{this.run('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)',id,login,name,passwordHash,role,status,Number(force),this.now());}catch(e:any){if(e.code?.includes('CONSTRAINT'))throw new Problem(409,'Этот логин уже занят');throw e;}
  return this.user(id);
 }
 async login(login:string,password:string){const row=this.get('SELECT * FROM users WHERE login=?',String(login).normalize('NFKC').trim().toLowerCase());if(!row||typeof password!=='string'||password.length>128||!await argon2.verify(row.password,password))throw new Problem(401,'Неверный логин или пароль');if(row.status!=='active')throw new Problem(403,row.status==='pending'?'Учётная запись ожидает одобрения':'Доступ к учётной записи закрыт');const token=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');this.run('INSERT INTO sessions VALUES(?,?,?,?)',hash(token),row.id,csrf,this.now()+7*86400000);return {token,csrf,user:this.user(row.id)};}
 authenticate(token:string){const s=this.get('SELECT * FROM sessions WHERE id=? AND expires>?',hash(token||''),this.now());if(!s)throw new Problem(401,'Войдите в систему');const user=this.user(s.user_id);if(user.status!=='active')throw new Problem(401,'Доступ прекращён');return {...s,user};}
 async password(id:string,password:string){if(typeof password!=='string'||password.length<12||password.length>128)throw new Problem(400,'Пароль должен содержать от 12 до 128 символов');const h=await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});this.db.transaction(()=>{this.run('UPDATE users SET password=?,force_change=0 WHERE id=?',h,id);this.run('DELETE FROM sessions WHERE user_id=?',id);}) ();}
 course(id:string,version?:string):Course {const row=version?this.get('SELECT payload FROM versions WHERE id=? AND course_id=?',version,id):this.get('SELECT payload FROM versions JOIN courses ON courses.version=versions.id WHERE courses.id=?',id);if(!row)throw new Problem(404,'Тема не найдена');return JSON.parse(row.payload);}
 mastered(user:string,course:string){return new Set(this.all('SELECT item_id FROM mastery WHERE user_id=? AND course_id=?',user,course).map(x=>x.item_id));}
 access(user:string,courseId:string){const c=this.course(courseId),known=this.mastered(user,courseId),remaining=c.items.filter(i=>!known.has(i.id));const mode=this.get('SELECT mode FROM access WHERE user_id=? AND course_id=?',user,courseId)?.mode||'auto';return {mode,available:c.examEnabled!==false,allowed:c.examEnabled!==false&&(mode==='open'||(mode==='auto'&&remaining.length===0)),remainingQuestions:remaining.filter(i=>i.kind==='question').length,remainingCases:remaining.filter(i=>i.kind==='case').length};}
 catalog(user:string){return this.all('SELECT id,version FROM courses').map(({id,version})=>{const c=this.course(id),known=this.mastered(user,id);return {...c,items:undefined,version,questionCount:c.items.filter(i=>i.kind==='question').length,caseCount:c.items.filter(i=>i.kind==='case').length,correctQuestions:c.items.filter(i=>i.kind==='question'&&known.has(i.id)).length,correctCases:c.items.filter(i=>i.kind==='case'&&known.has(i.id)).length,access:this.access(user,id)};});}
 unresolved(user:string,course:string){const known=this.mastered(user,course),wrong=new Set<string>();for(const row of this.all("SELECT data FROM attempts WHERE user_id=? AND course_id=? AND mode!='exam'",user,course)){for(const a of JSON.parse(row.data).answers)if(!a.correct)wrong.add(a.item.id);}return this.course(course).items.filter(i=>!known.has(i.id)).map(i=>({id:i.id,question:i.question,kind:i.kind,topicId:i.topicId,difficulty:i.difficulty,trainingStatus:wrong.has(i.id)?'incorrect':'unanswered'}));}

 start(user:string,courseId:string,mode:Mode,options:any={}){
  const c=this.course(courseId);if(!['study','blitz','cases','timed','exam'].includes(mode))throw new Problem(400,'Неизвестный режим');if(mode==='exam'&&!this.access(user,courseId).allowed)throw new Problem(403,'Экзамен закрыт: выполните условия допуска');
  if(this.get("SELECT id FROM attempts WHERE user_id=? AND status IN ('active','paused')",user))throw new Problem(409,'Сначала продолжите или завершите текущую попытку');
  let ids=options.ids;
  if(options.filter==='unresolved')ids=this.unresolved(user,courseId).map(i=>i.id);
  if(options.filter==='bookmarks')ids=this.all('SELECT item_id FROM bookmarks WHERE user_id=? AND course_id=?',user,courseId).map(i=>i.item_id);
  if(options.filter==='wrong')ids=this.unresolved(user,courseId).map(i=>i.id).filter(id=>this.all("SELECT data FROM attempts WHERE user_id=? AND course_id=? AND mode!='exam'",user,courseId).some(r=>JSON.parse(r.data).answers.some((a:any)=>a.item.id===id&&!a.correct)));
  if(options.itemId)ids=[options.itemId];
  if(ids!==undefined&&(!Array.isArray(ids)||!ids.every(i=>typeof i==='string')))throw new Problem(400,'Некорректная выборка');
  const deck=makeDeck(c,mode,options.topic||'all',options.level||'all',ids).map(i=>({...i,optionIds:i.options.map(()=>randomUUID())}));if(!deck.length)throw new Problem(400,'В этой выборке нет заданий');
  const now=this.now(),id=randomUUID(),version=this.get('SELECT version FROM courses WHERE id=?',courseId).version;
  const data={deck,index:0,answers:[],lives:3,hints:3,hidden:[],streak:0,best:0,points:0,elapsed:0,questionElapsed:0,last:now,responseLimit:[45,60,90].includes(options.responseLimit)?options.responseLimit:60,events:[]};
  this.run('INSERT INTO attempts VALUES(?,?,?,?,?,?,?,?,?)',id,user,courseId,version,mode,'active',JSON.stringify(data),now,now);return this.view(user,id);
 }
 load(user:string,id:string){const r=this.get('SELECT * FROM attempts WHERE id=? AND user_id=?',id,user);if(!r)throw new Problem(404,'Попытка не найдена');r.data=JSON.parse(r.data);this.tick(r);return r;}
 save(r:any){this.run('UPDATE attempts SET status=?,data=?,updated=? WHERE id=?',r.status,JSON.stringify(r.data),this.now(),r.id);}
 tick(r:any){const d=r.data,now=this.now();if(r.status==='active'){const delta=Math.max(0,now-d.last);d.elapsed+=delta;if(!d.answers.some((a:any)=>a.item.id===d.deck[d.index].id))d.questionElapsed+=delta;}d.last=now;
  if(r.status==='active'&&r.mode==='exam'&&d.elapsed>=this.course(r.course_id,r.version).exam.seconds*1000){r.status='completed';d.endReason='timeout';}
  if(r.status==='active'&&r.mode==='timed'&&d.questionElapsed>=d.responseLimit*1000&&!d.answers.some((a:any)=>a.item.id===d.deck[d.index].id))this.record(r,null);
  this.save(r);
 }
 record(r:any,optionId:string|null){const d=r.data,item=d.deck[d.index],selected=optionId===null?-1:item.optionIds.indexOf(optionId);if(optionId!==null&&(selected<0||d.hidden.includes(selected)))throw new Problem(400,'Недоступный вариант');const correct=selected===item.correctIndex;d.streak=correct?d.streak+1:0;d.best=Math.max(d.best,d.streak);const reward=correct?Math.round(({easy:5000,medium:12000,hard:25000}[item.difficulty] as number)*(1+Math.min(d.streak,10)*.1)):0;d.points+=reward;if(!correct&&r.mode==='blitz')d.lives--;d.answers.push({item,selected,correct,reward,elapsed:d.questionElapsed,at:this.now()});if(correct&&r.mode!=='exam')this.run('INSERT OR IGNORE INTO mastery VALUES(?,?,?)',r.user_id,item.id,r.course_id);}
 answer(user:string,id:string,itemId:string,optionId:string){return this.db.transaction(()=>{const r=this.load(user,id),d=r.data;if(d.answers.some((a:any)=>a.item.id===itemId))return this.view(user,id);if(r.status!=='active')throw new Problem(409,'Попытка не активна');if(d.deck[d.index].id!==itemId)throw new Problem(409,'Задание уже изменилось');this.record(r,optionId);this.save(r);return this.view(user,id);}) ();}
 action(user:string,id:string,action:string){return this.db.transaction(()=>{const r=this.load(user,id),d=r.data;if(!['active','paused'].includes(r.status))return this.view(user,id);
  if(action==='finish'){r.status='completed';d.endReason='manual';}
  else if(action==='pause'&&r.status==='active'){r.status='paused';d.events.push({type:'pause',at:this.now()});}
  else if(action==='resume'&&r.status==='paused'){r.status='active';d.events.push({type:'resume',at:this.now()});}
  else if(action==='next'&&r.status==='active'){if(!d.answers.some((a:any)=>a.item.id===d.deck[d.index].id))throw new Problem(409,'Сначала ответьте');if(d.index+1===d.deck.length||d.lives<=0){r.status='completed';d.endReason=d.lives<=0?'lives':'all';}else{d.index++;d.questionElapsed=0;d.hidden=[];}}
  else if(action==='hint'&&r.status==='active'){if(['exam','timed'].includes(r.mode)||!d.hints||d.hidden.length||d.answers.some((a:any)=>a.item.id===d.deck[d.index].id))throw new Problem(400,'Подсказка недоступна');d.hints--;d.hidden=d.deck[d.index].options.map((_:any,i:number)=>i).filter((i:number)=>i!==d.deck[d.index].correctIndex).slice(0,2);d.events.push({type:'hint',itemId:d.deck[d.index].id,at:this.now()});}
  else throw new Problem(409,'Действие сейчас недоступно');this.save(r);return this.view(user,id);
 }) ();}
 view(user:string,id:string){const r=this.load(user,id),d=r.data,item=d.deck[d.index],a=d.answers.find((x:any)=>x.item.id===item.id),done=!['active','paused'].includes(r.status),reveal=done||r.mode!=='exam';
  const clean=(i:any)=>({id:i.id,topicId:i.topicId,kind:i.kind,difficulty:i.difficulty,question:i.question,wolfContext:i.wolfContext,options:i.options.map((text:string,n:number)=>({id:i.optionIds[n],text}))});
  const feedback=(x:any)=>({...clean(x.item),correctIndex:x.item.correctIndex,explanation:x.item.explanation,optionReasons:x.item.optionReasons,sourcePage:x.item.sourcePage,clauseRef:x.item.clauseRef,sourceExcerpt:x.item.sourceExcerpt,sourceAnchor:x.item.sourceAnchor,selected:x.selected,correct:x.correct,elapsed:x.elapsed,at:x.at});
  const snapshot=this.course(r.course_id,r.version);const {items,...course}=snapshot;return {course,id:r.id,courseId:r.course_id,version:r.version,mode:r.mode,status:r.status,created:r.created,index:d.index,length:d.deck.length,seconds:Math.floor(d.elapsed/1000),remaining:r.mode==='timed'?Math.max(0,d.responseLimit-Math.floor(d.questionElapsed/1000)):Math.max(0,this.course(r.course_id,r.version).exam.seconds-Math.floor(d.elapsed/1000)),item:clean(item),answered:!!a,feedback:a&&reveal?feedback(a):null,lives:r.mode==='exam'&&!done?undefined:d.lives,hints:d.hints,hidden:d.hidden,points:r.mode==='exam'&&!done?undefined:d.points,streak:r.mode==='exam'&&!done?undefined:d.streak,correct:done?d.answers.filter((x:any)=>x.correct).length:undefined,total:done?(r.mode==='exam'?d.deck.length:d.answers.length):undefined,endReason:d.endReason,review:done?d.deck.filter((i:any)=>r.mode==='exam'||d.answers.some((x:any)=>x.item.id===i.id)).map((i:any)=>feedback(d.answers.find((x:any)=>x.item.id===i.id)||{item:i,selected:-1,correct:false})):undefined};
 }
 history(user:string){return this.all('SELECT id FROM attempts WHERE user_id=? ORDER BY created DESC',user).map(r=>{const a=this.view(user,r.id);return {id:a.id,courseId:a.courseId,mode:a.mode,status:a.status,created:a.created,correct:a.correct,total:a.total,seconds:a.seconds};});}
 adminUpdate(actor:string,id:string,patch:any){return this.db.transaction(()=>{const old=this.user(id);if(id===actor&&(patch.status&&patch.status!=='active'||patch.role&&patch.role!=='admin'))throw new Problem(400,'Нельзя заблокировать себя или снять свою роль');if(old.role==='admin'&&old.status==='active'&&(patch.role==='user'||['blocked','archived'].includes(patch.status))&&this.get("SELECT COUNT(*) n FROM users WHERE role='admin' AND status='active'").n<=1)throw new Problem(400,'Нельзя удалить последнего администратора');const role=patch.role??old.role,status=patch.status??old.status,name=patch.name??old.name;if(!['user','admin'].includes(role)||!['pending','active','blocked','archived'].includes(status)||typeof name!=='string'||!name.trim()||name.length>120)throw new Problem(400,'Некорректные параметры');this.run('UPDATE users SET name=?,role=?,status=? WHERE id=?',name.trim(),role,status,id);if(status!=='active'||role!==old.role)this.run('DELETE FROM sessions WHERE user_id=?',id);if(status!=='active'){for(const a of this.all("SELECT id FROM attempts WHERE user_id=? AND status IN ('active','paused')",id)){const r=this.load(id,a.id);r.status='abandoned';r.data.endReason='account_blocked';this.save(r);}}this.log(actor,'user.update',id,{before:old,after:this.user(id)});return this.user(id);})();}
}
