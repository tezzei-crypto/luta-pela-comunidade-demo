import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const source=file=>fs.readFileSync(new URL('./dist/portal/'+file,import.meta.url),'utf8');
const pause=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const tick=()=>new Promise(r=>setImmediate(r));
function fn(file,name){const s=source(file),start=s.indexOf('async function '+name+'('),end=s.indexOf('\n}',start);assert.ok(start>=0&&end>start,name);return s.slice(start,end+2)}
function ui(t,html=''){
 const dom=new JSDOM('<main>'+html+'</main>',{url:'https://example.test/administracao/',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext();t.after(()=>w.close());w.HTMLElement.prototype.scrollIntoView=function(){};
 Object.assign(w,{structuredClone,api:async()=>{throw Error('API não preparada')}});
 const run=s=>vm.runInContext(s,ctx);
 run(`const $=id=>document.getElementById(id);let me={role:'admin',user_id:'admin'},chosen='';const phoneLinksReady=Promise.resolve({attachPhoneField(){}});const notice=()=>{};const scopeUnitNames=()=>({amavale:'Amavale',valparaiso:'Valparaíso'});const classUnits={amavale:'Amavale',valparaiso:'Valparaíso'};const action=fn=>async e=>{e?.preventDefault();return fn(e)};const showPanel=()=>{};const documentChecklist=()=>{};const kinds={photo:'Foto'};`);
 const p=source('portal.js');run(p.slice(p.indexOf('function el('),p.indexOf('function notice(')));run('let fieldSequence=0;'+p.slice(p.indexOf('function field('),p.indexOf('async function detail(')));
 return {w,d:w.document,run,load:(file,name)=>run(fn(file,name))};
}
test('Auditoria: resposta antiga do resumo não substitui a data escolhida nem impede nova consulta',async t=>{
 const f=ui(t,'<input id="operations-date" type="date" value="2026-10-08"><div id="operations-content"></div>');
 f.run(source('operations.js'));const calls=[];f.w.api=url=>{const p=pause();calls.push({url,...p});return p.promise};
 const report=n=>({generated_at:new Date().toISOString(),totals:{held:n},lessons:[],units:[]});
 const a=f.run('loadOperations()');f.d.querySelector('input').value='2026-10-09';const b=f.run('loadOperations()');assert.equal(calls.length,2,'a troca de data precisa iniciar a nova consulta');calls[1].resolve(report(9));await b;calls[0].resolve(report(8));await a;assert.equal(f.d.querySelector('.card strong').textContent,'9');
});
test('Auditoria: pré-cadastros de resposta lenta não entram no núcleo selecionado depois',async t=>{
 const f=ui(t,'<select id="quick-queue-unit"><option value="amavale">Amavale</option><option value="valparaiso">Valparaíso</option></select><div id="quick-queue-list"></div>');f.run(source('operations.js'));
 const calls=[];f.w.api=url=>{const p=pause();calls.push({url,...p});return p.promise};const a=f.run('loadQuickQueue()');f.d.querySelector('select').value='valparaiso';const b=f.run('loadQuickQueue()');calls[1].resolve({intakes:[]});await b;
 calls[0].resolve({intakes:[{id:'a',name:'Pessoa do núcleo anterior',group_label:'Amavale',status:'archived',created_at:new Date().toISOString()}]});await a;assert.doesNotMatch(f.d.querySelector('#quick-queue-list').textContent,/Pessoa do núcleo anterior/);
});
test('Auditoria: contato atrasado não mistura duas fichas de alunos',async t=>{
 const f=ui(t,'<section id="detail" tabindex="-1"></section>'),gate=pause();f.load('portal.js','detail');f.w.contactGate=gate.promise;f.run(`async function showStudentContact(id,box){if(id==='A')await contactGate;box.append(el('p','Contato '+id))}`);
 f.w.api=async url=>url.endsWith('/documents')?{documents:[]}:{student:{id:url.split('/').at(-1),name:'Aluno '+url.split('/').at(-1),age:12,status:'pending',version:1}};
 const a=f.run("detail('A')");await tick();await f.run("detail('B')");gate.resolve();await a;
 assert.match(f.d.querySelector('#detail').textContent,/Aluno B/);assert.match(f.d.querySelector('#detail').textContent,/Contato B/);assert.doesNotMatch(f.d.querySelector('#detail').textContent,/Aluno A|Contato A/);assert.equal(f.d.querySelector('[name=name]').value,'Aluno B');
});
for(const [file,name,id,endpoint,key]of [['teachers.js','teacherDetail','teacher-detail','teachers','teacher'],['professionals.js','professionalDetail','professional-detail','professionals','professional']]){
 test('Auditoria: documentos atrasados não misturam cadastros em '+endpoint,async t=>{
  const f=ui(t,`<section id="${id}" tabindex="-1"></section>`),gate=pause();const s=source(file);f.run(s.slice(0,s.indexOf('async function '+(key==='teacher'?'teacherList':'professionalList')+'(')));f.load(file,name);
  f.w.api=async url=>{if(url.endsWith('/documents')){if(url.includes('/A/'))await gate.promise;return {documents:[{id:url.includes('/A/')?'DOC-A':'DOC-B',kind:'photo',created_at:new Date().toISOString()}]}}return {[key]:{name:url.endsWith('/A')?'Pessoa A':'Pessoa B',units:['amavale'],status:'pending',role:'psychologist',version:1}}};
  const a=f.run(name+"('A')");await tick();await f.run(name+"('B')");gate.resolve();await a;
  assert.equal(f.d.querySelector('[name=name]').value,'Pessoa B');assert.equal(f.d.querySelectorAll('input[type=file]').length,1,'não deve anexar o formulário de documentos da outra pessoa');assert.doesNotMatch(f.d.querySelector('#'+id).textContent,/Pessoa A/);
 });
}
test('Auditoria: mudança de núcleo descarta turma que ainda estava carregando professores',async t=>{
 const f=ui(t,'<select id="groups-unit"><option value="amavale">Amavale</option><option value="valparaiso">Valparaíso</option></select><section id="group-detail"></section>'),gate=pause();f.run("const weekdayNames=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];");f.load('groups.js','groupDetail');
 f.w.api=async url=>url==='/teachers'?(await gate.promise,{teachers:[]}):{group:{unit:'amavale',label:'Turma anterior',weekdays:[2],students:[],active:true}};
 const a=f.run("groupDetail('A')");await tick();f.d.querySelector('select').value='valparaiso';f.d.querySelector('#group-detail').hidden=true;gate.resolve();await a;assert.equal(f.d.querySelector('#group-detail').hidden,true);assert.equal(f.d.querySelector('#group-detail [name=label]'),null);
});
test('Auditoria: revisão de candidato respeita o último cadastro escolhido',async t=>{
 const f=ui(t,'<section id="registration-detail"></section>'),calls=[];f.run("const unitNames={amavale:'Amavale'},decisionNames={approved:'Aprovado'};const phoneContact=text=>el('p',text);const registrationUploader=()=>{};const registrationReviewSummary=()=>{};");f.load('admin.js','review');f.w.api=url=>{const p=pause();calls.push(p);return p.promise};
 const a=f.run("review('A')"),b=f.run("review('B')"),r=name=>({registration:{id:name,student_name:'Candidato '+name,unit:'amavale',status:'approved',documents:[]}});calls[1].resolve(r('B'));await b;calls[0].resolve(r('A'));await a;assert.match(f.d.querySelector('#registration-detail').textContent,/Candidato B/);assert.doesNotMatch(f.d.querySelector('#registration-detail').textContent,/Candidato A/);
});
test('Auditoria: frequência da equipe não reabre aula do núcleo anterior após trocar filtro',async t=>{
 const f=ui(t,'<select id="workforce-unit"><option value="amavale">Amavale</option><option value="valparaiso">Valparaíso</option></select><section id="workforce-detail" hidden></section>'),gate=pause();f.load('workforce.js','workforceDetail');f.w.api=()=>gate.promise;
 f.run("const workforceDrafts=new Map(),attendanceNames={present:'Presente',absent:'Faltou',unmarked:'Não marcado'};");const a=f.run("workforceDetail('a')");f.d.querySelector('select').value='valparaiso';gate.resolve({lesson:{unit:'amavale',day:'2026-10-08'},people:[]});await a;assert.equal(f.d.querySelector('#workforce-detail').hidden,true);assert.equal(f.d.querySelector('#workforce-detail').textContent,'');
});
for(const [file,name,select,list,key]of [['attendance.js','classList','class-unit','class-list','classes'],['groups.js','groupList','groups-unit','groups-list','groups'],['workforce.js','workforceList','workforce-unit','workforce-list','sessions']]){
 test('Auditoria: '+name+' ignora respostas antigas inclusive ao voltar para o mesmo núcleo',async t=>{
  const f=ui(t,`<select id="${select}"><option value="amavale">Amavale</option><option value="valparaiso">Valparaíso</option></select><div id="${list}"></div>`),calls=[];
  f.run("const weekdayNames=['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];");f.run(source(file).split('\n').find(line=>line.startsWith('async function '+name+'(')));f.w.api=url=>{const p=pause();calls.push(p);return p.promise};
  const a=f.run(name+'()');f.d.querySelector('select').value='valparaiso';const b=f.run(name+'()');f.d.querySelector('select').value='amavale';const c=f.run(name+'()');calls[2].resolve({[key]:[]});await c;const expected=f.d.querySelector('#'+list).textContent;
  const row={id:'old',label:'Resultado obsoleto',day:'2026-10-08',weekdays:[2],active:true};calls[0].resolve({[key]:[row]});calls[1].resolve({[key]:[row]});await Promise.all([a,b]);assert.equal(f.d.querySelector('#'+list).textContent,expected);
 });
}
