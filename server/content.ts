import type {Course} from '../web/src/learning/courses.ts';
export interface ContentDocument {schemaVersion:1;course:Course;}
/** Internal seed/publishing contract. HTTP import and authoring UI are intentionally absent. */
export function validateContent(input:unknown):ContentDocument {
 const doc=input as ContentDocument,c=doc?.course;
 const fail=(message:string):never=>{throw new Error('Invalid course document: '+message);};
 if(doc?.schemaVersion!==1||!c||typeof c.id!=='string'||!/^[-a-z0-9]+$/.test(c.id))fail('schemaVersion or course id');
 for(const key of ['title','shortTitle','subtitle','edition','sourceUrl','pdf'] as const)if(typeof c[key]!=='string'||!c[key].trim())fail(key);
 if(!Array.isArray(c.topics)||!c.topics.length||!Array.isArray(c.items)||!c.items.length)fail('empty bank');
 const topics=new Set(c.topics.map(t=>t.id));if(topics.size!==c.topics.length)fail('duplicate topic');
 const ids=new Set<string>();
 for(const i of [...c.items,...(c.examItems||[])]){
  if(!i.id||ids.has(i.id)||!topics.has(i.topicId))fail('item identity or topic');ids.add(i.id);
  if(!['question','case'].includes(i.kind)||!['easy','medium','hard'].includes(i.difficulty))fail('item kind or difficulty');
  if(!Array.isArray(i.options)||i.options.length!==4||new Set(i.options).size!==4||!i.options.every(o=>typeof o==='string'&&o.trim()))fail('four distinct text choices required');
  if(!Number.isInteger(i.correctIndex)||i.correctIndex<0||i.correctIndex>3)fail('correctIndex');
  if(typeof i.question!=='string'||!i.question.trim()||typeof i.explanation!=='string'||!i.explanation.trim()||!i.clauseRef||!Number.isInteger(i.sourcePage)||i.sourcePage<1)fail('question, explanation or source');
  if(i.sourceReferences&&(!i.sourceDocument||!Array.isArray(i.sourceReferences)||!i.sourceReferences.length||!i.sourceReferences.every(r=>r&&typeof r.label==='string'&&r.label.trim()&&typeof r.anchor==='string'&&r.anchor.trim()&&typeof r.excerpt==='string'&&r.excerpt.trim())))fail('sourceReferences must include labels, anchors and excerpts');
  if(i.optionReasons&&(!Array.isArray(i.optionReasons)||i.optionReasons.length!==4||!i.optionReasons.every(r=>typeof r==='string'&&r.trim())))fail('optionReasons must match choices');
 }
 for(const t of c.topics)if(!c.items.some(i=>i.topicId===t.id&&i.kind==='question')||!c.items.some(i=>i.topicId===t.id&&i.kind==='case'))fail('every topic requires questions and cases');
 if(c.examEnabled!==false&&(!Number.isInteger(c.exam.count)||c.exam.count<c.topics.length||c.exam.count>(c.examItems||c.items).filter(i=>i.kind==='question').length||c.exam.seconds<=0||c.exam.passPercent<=0||c.exam.passPercent>100))fail('exam settings');
 if(c.examItems&&(!c.examItems.length||c.examItems.some(i=>i.kind!=='question'||!i.optionReasons||!i.sourceReferences?.length||!i.optionKeys||i.optionKeys.length!==4||new Set(i.optionKeys).size!==4)))fail('exam choices and source references');
 if(c.exam.blueprint==='balanced-pairs'){if(c.exam.count%2||c.exam.count<c.topics.length||c.exam.count>2*c.topics.length)fail('balanced exam size');for(const t of c.topics)for(const level of ['medium','hard'])if(!(c.examItems||c.items).some(i=>i.kind==='question'&&i.topicId===t.id&&i.difficulty===level))fail('balanced exam coverage');}
 return doc;
}
