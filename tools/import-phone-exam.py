"""Convert the approved Markdown bank; fail on missing keys, explanations or quotes."""
import re, json, hashlib, html, sys, zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1])
docx = Path(sys.argv[2])
text = source.read_text(encoding='utf-8')
assert hashlib.sha256(docx.read_bytes()).hexdigest() in text, 'Source DOCX hash changed'
with zipfile.ZipFile(docx) as z:
    xml = ET.fromstring(z.read('word/document.xml'))
ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
# Include text in paragraphs and table cells.
paragraphs = [''.join(t.text or '' for t in p.findall('.//w:t', ns)) for p in xml.findall('.//w:p', ns)]
sections = {}
for match in re.finditer(r'^### (S\d{2})\. ([^\n]+)\n(.*?)(?=^### S\d{2}\.|^## Приложение B)', text, re.M | re.S):
    code, title, block = match.groups()
    quotes = re.findall(r'^> (.+)$', block, re.M)
    assert quotes and all(q.strip() in {p.strip() for p in paragraphs} for q in quotes), f'Non-verbatim quote in {code}'
    headings = re.findall(r'\*\*Раздел источника:\*\* (.+)', block)
    sections[code] = dict(label=code+' · '+title, anchor='exam-'+code.lower(), excerpt='\n'.join(headings)+'\n\n'+'\n\n'.join(quotes))
assert len(sections) == 19
keys = {i:(letter,topic,level) for i,letter,topic,level in re.findall(r'^\| (phone-exam-\d+) \| ([A-D]) \| `([^`]+)` \| (средняя|высокая) \|', text, re.M)}
items = []
for match in re.finditer(r'^### (phone-exam-\d+)\n(.*?)(?=^### phone-exam-|^## 5\.)', text, re.M | re.S):
    item_id, block = match.groups()
    topic, level = re.search(r'\*\*Тема:\*\* `([^`]+)` · \*\*Сложность:\*\* (средняя|высокая)', block).groups()
    scenario = re.search(r'\*\*Ситуация\.\*\* (.*?)\n\n\*\*Вопрос\.\*\*', block, re.S).group(1)
    question = re.search(r'\*\*Вопрос\.\*\* (.*?)\n\n\*\*A\.', block, re.S).group(1)
    choices = re.findall(r'^\*\*([A-D])\.\*\* (.+)$', block, re.M)
    reasons = re.findall(r'^- \*\*([A-D]) — (.*?)\*\* (.+)$', block, re.M)
    key = re.search(r'\*\*Правильный ответ: ([A-D])\.\*\*', block).group(1)
    refs = re.findall(r'\[(S\d{2})\]', block)
    assert [x[0] for x in choices] == [x[0] for x in reasons] == list('ABCD')
    assert keys[item_id] == (key, topic, level) and refs
    index = 'ABCD'.index(key)
    items.append(dict(id=item_id, topicId=topic, kind='question', difficulty={'средняя':'medium','высокая':'hard'}[level], question=question, wolfContext=scenario, options=[x[1] for x in choices], optionKeys=[item_id+'-'+x[0] for x in choices], correctIndex=index, explanation=reasons[index][2], optionReasons=[x[1]+' '+x[2] for x in reasons], clauseRef='Телефонный стандарт · '+', '.join(refs), sourcePage=1, sourceDocument='phone-exam-sources.html', sourceReferences=[sections[r] for r in refs]))
assert len(items) == len(keys) == 40
dest = root/'web/src/learning/phone-exam.json'
dest.write_text(json.dumps(dict(sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(), items=items), ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
page = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Телефонный стандарт — источники экзамена</title><style>body{max-width:850px;margin:40px auto;padding:20px;font:18px/1.7 system-ui;color:#241616;background:#faf8f4}section{border-top:1px solid #b59769;padding:24px 0}blockquote{white-space:pre-line}</style><h1>Телефонный стандарт — выдержки для экзамена</h1><p>S01–S19 — навигационные метки учебного материала, а не номера разделов исходного DOCX. Каждая цитата сверена с предоставленным документом.</p>'
for ref in sections.values():
    page += '<section id="'+ref['anchor']+'"><h2>'+html.escape(ref['label'])+'</h2><blockquote>'+html.escape(ref['excerpt'])+'</blockquote></section>'
(root/'web/public/phone-exam-sources.html').write_text(page+'</html>', encoding='utf-8')
print('Imported 40 items; all keys and 19 source sections verified against Markdown and DOCX.')
