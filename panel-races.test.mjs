import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';
import {createSyncController} from './dist/portal/sync-controller.js';

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
 const a=f.run("review('A')"),b=f.run("review('B')"),r=name=>({registration:{id:name,student_name:'Candidato '+name,unit:'amavale',status:'approved',documents:[]}});assert.equal(f.d.querySelector('#registration-detail').dataset.registrationId,'B','mantém o protocolo enquanto a consulta está em andamento');calls[1].resolve(r('B'));await b;calls[0].resolve(r('A'));await a;assert.match(f.d.querySelector('#registration-detail').textContent,/Candidato B/);assert.doesNotMatch(f.d.querySelector('#registration-detail').textContent,/Candidato A/);
});

test('Inscrição mobile: sincronização mantém a ficha aberta entre anexos e decisão, e retoma ao sair do painel',async t=>{
 const f=ui(t,'<section id="registrations-area" class="is-current"><section id="registration-detail"><form><input type="file" name="file"></form><form><select name="decision"><option>Conferir</option></select></form></section></section>');
 const sourceText=source('portal.js'),start=sourceText.indexOf("import('/portal/system-sync.js')"),end=sourceText.indexOf("import('/portal/absence-attention.js')",start);assert.ok(start>=0&&end>start);
 f.run("const token='fixture';async function load(){};");f.w.api=async()=>({role:'secretary',units:['amavale']});
 f.run(sourceText.slice(start,end).replace("import('/portal/system-sync.js')","Promise.resolve({startSystemSync:options=>window.syncOptions=options})"));await tick();
 let revision='initial',refreshes=0;const config=f.w.syncOptions,controller=createSyncController({readRevision:async()=>({revision}),isActive:config.active,isEditing:config.hasDraft,refresh:async()=>{refreshes++;await config.refresh()}});
 await controller.poll();
 for(const change of ['photo-uploaded','certificate-uploaded','other-staff-change']){revision=change;await controller.poll();assert.equal(refreshes,0);assert.equal(f.d.querySelector('#registration-detail').hidden,false);assert.equal(f.d.querySelectorAll('#registration-detail form').length,2);}
 f.d.querySelector('#registrations-area').classList.remove('is-current');await controller.poll();assert.equal(refreshes,1);assert.equal(f.d.querySelector('#registration-detail').hidden,true);
});

test('Inscrição mobile: resultado aprovado continua visível após sincronização e não reabre após trocar de painel',async t=>{
 const f=ui(t,'<section id="registrations-area"><section id="registration-detail" data-registration-id="ficticio">ID vinculado: UND1_000011</section></section>'),sourceText=source('portal.js'),start=sourceText.indexOf("import('/portal/system-sync.js')"),end=sourceText.indexOf("import('/portal/absence-attention.js')",start);
 f.run("const token='fixture';let currentPanel='registrations-area';async function load(){};async function review(id){window.reviewed=id;const box=$('registration-detail');box.hidden=false;box.textContent='ID vinculado: UND1_000011';}review.request=Symbol();");f.w.api=async()=>({role:'secretary',units:['amavale']});
 f.run(sourceText.slice(start,end).replace("import('/portal/system-sync.js')","Promise.resolve({startSystemSync:options=>window.syncOptions=options})"));await tick();
 const config=f.w.syncOptions;assert.equal(config.hasDraft(),false);await config.refresh();assert.equal(f.w.reviewed,'ficticio');assert.equal(f.d.querySelector('#registration-detail').hidden,false);assert.match(f.d.querySelector('#registration-detail').textContent,/UND1_000011/);
 f.w.reviewed=null;const gate=pause();f.w.api=()=>gate.promise;const pending=config.refresh();f.run("currentPanel='students-area'");gate.resolve({role:'secretary'});await pending;assert.equal(f.w.reviewed,null);
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

test('Professor sem email: interface permite nome e telefone e edição posterior do email sem documentos ou acesso',async t=>{
 const f=ui(t,'<section id="teacher-detail" tabindex="-1"></section>'),s=source('teachers.js');f.run(s.slice(0,s.indexOf('async function teacherList(')));f.load('teachers.js','teacherDetail');
 f.w.api=async()=>({teacher:{name:'Docente Fictício',phone:'24999999999',email:'',email_pending:true,units:['amavale'],status:'pending',version:1}});
 await f.run("teacherDetail('DRAFT')");assert.equal(f.d.querySelector('[name=email]').required,false);assert.equal(f.d.querySelector('[name=email]').readOnly,false);assert.equal(f.d.querySelector('[name=name]').required,true);assert.equal(f.d.querySelector('[name=phone]').required,true);assert.equal(f.d.querySelector('input[type=file]'),null);assert.match(f.d.body.textContent,/sem conta de acesso/);
});
