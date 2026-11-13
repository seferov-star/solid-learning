/** Explicit publication of a built-in course; never silently replace a published version on startup. */
import {Store} from './store.ts';
import {COURSES} from '../web/src/learning/courses.ts';
const [id,expected]=process.argv.slice(2);
const course=COURSES.find(c=>c.id===id);
if(!course||!expected)throw new Error('Usage: publish.ts COURSE EXPECTED_CURRENT_VERSION');
const s=new Store(process.env.DB_PATH||'data/app.sqlite');
try{
 const current=s.get('SELECT version FROM courses WHERE id=?',id)?.version;
 if(current!==expected)throw new Error('Published course changed; inspect current content before retrying');
 const actor=s.get("SELECT id FROM users WHERE login='admin' AND role='admin' AND status='active'");
 if(!actor)throw new Error('Owner administrator unavailable');
 const version=s.publishContent({schemaVersion:1,course},actor.id);
 console.log(JSON.stringify({course:id,before:current,version}));
}finally{s.db.close();}
