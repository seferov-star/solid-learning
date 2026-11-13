import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {COURSES,makeDeck,type Item} from '../web/src/learning/courses.ts';
import phoneExam from '../web/src/learning/phone-exam.json' with {type:'json'};
import {Store} from './store.ts';
import {validateContent} from './content.ts';

const phone=COURSES.find(c=>c.id==='phone')!;
const answerId=(v:any,item:Item)=>v.item.options.find((o:any)=>o.text===item.options[item.correctIndex])!.id;

test('phone exam decks balance 30 unique exam-only questions across 19 topics and preserve shuffled answer mappings',()=>{
 assert.equal(phone.items.length,57);
 assert.equal(phone.items.filter(i=>i.kind==='question').length,19);
 assert.equal(phone.examItems?.length,40);
 const examById=new Map(phone.examItems!.map(i=>[i.id,i]));
 for(let n=0;n<1000;n++){
  const deck=makeDeck(phone,'exam');assert.equal(deck.length,30);assert.equal(new Set(deck.map(i=>i.id)).size,30);
  const topics=new Map<string,number>();let medium=0,hard=0;
  for(const i of deck){assert.ok(examById.has(i.id));topics.set(i.topicId,(topics.get(i.topicId)||0)+1);if(i.difficulty==='medium')medium++;else if(i.difficulty==='hard')hard++;else assert.fail('exam contains non-medium/hard item');
   const original=examById.get(i.id)!;assert.equal(i.options.length,4);assert.ok(i.optionKeys?.length===4);assert.ok(i.optionReasons?.length===4);
   const letters=i.optionKeys!.map(k=>k.slice(-1));assert.deepEqual([...letters].sort(),['A','B','C','D']);
   for(let j=0;j<4;j++){const old='ABCD'.indexOf(letters[j]);assert.equal(i.options[j],original.options[old]);assert.equal(i.optionReasons![j],original.optionReasons![old]);}
   assert.equal(letters[i.correctIndex],'ABCD'[original.correctIndex]);
  }
  assert.equal(medium,15);assert.equal(hard,15);assert.equal(topics.size,19);assert.ok([...topics.values()].every(x=>x===1||x===2));
 }
});

test('exam bank is excluded from training gate and malformed balanced blueprints reject',()=>{
 const dir=mkdtempSync(join(tmpdir(),'phone-exam-')),s=new Store(join(dir,'test.sqlite'));
 try{const uId='gate-user';s.run('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)',uId,'gate-user','Gate User','x','user','active',0,Date.now());
  const a=s.access(uId,'phone');assert.equal(a.remainingQuestions,19);assert.equal(a.remainingCases,38);assert.equal(a.allowed,false);
  for(const i of phone.items)s.run('INSERT INTO mastery VALUES(?,?,?)',uId,i.id,'phone');assert.equal(s.access(uId,'phone').allowed,true);
  const badCount={...phone,exam:{...phone.exam,count:29}};assert.throws(()=>validateContent({schemaVersion:1,course:badCount}));
  const missingHard={...phone,examItems:phone.examItems!.filter(i=>!(i.topicId===phone.topics[0].id&&i.difficulty==='hard'))};assert.throws(()=>validateContent({schemaVersion:1,course:missingHard}));
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('phone exam hides answers and source data until completion, then reviews unanswered items with citations',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'phone-exam-')),s=new Store(join(dir,'test.sqlite'));
 try{const u=await s.createUser('phone-learner','Phone Learner','long-enough-password','user','active');
  s.run('INSERT INTO access VALUES(?,?,?)',u.id,'phone','open');let v=s.start(u.id,'phone','exam');
  const original=s.course('phone',v.version),first=original.examItems!.find(i=>i.id===v.item.id)!;
  assert.equal(v.course.examItems,undefined);assert.equal(v.course.items,undefined);assert.equal(v.item.correctIndex,undefined);assert.equal(v.item.optionKeys,undefined);assert.equal(v.item.sourceReferences,undefined);assert.equal(v.feedback,null);
  const expectedQuestion=v.item.question;const expectedSources=first.sourceReferences;
  const changed={...original,title:'Updated published title'};s.run('INSERT INTO versions VALUES(?,?,?)','phone-new-version','phone',JSON.stringify(changed));s.run('UPDATE courses SET version=? WHERE id=?','phone-new-version','phone');
  v=s.answer(u.id,v.id,v.item.id,answerId(v,first));assert.equal(v.feedback,null);assert.equal(v.item.correctIndex,undefined);assert.equal(v.item.sourceReferences,undefined);assert.equal(s.get('SELECT COUNT(*) n FROM mastery WHERE user_id=? AND course_id=?',u.id,'phone').n,0);
  v=s.action(u.id,v.id,'finish');assert.equal(v.status,'completed');assert.equal(v.length,30);assert.equal(v.total,30);assert.equal(v.course.title,original.title);assert.equal(v.review.length,30);assert.equal(v.review[0].question,expectedQuestion);assert.equal(v.review[0].options[v.review[0].correctIndex].text,first.options[first.correctIndex]);assert.deepEqual(v.review[0].sourceReferences,expectedSources);assert.ok(v.review.every((r:any)=>r.sourceReferences?.length));assert.equal(v.review.filter((r:any)=>r.selected===-1).length,29);assert.ok(v.review.slice(1).every((r:any)=>r.correct===false));
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});
