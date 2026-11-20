import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const source=file=>fs.readFileSync(new URL('./dist/portal/'+file,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,20));
const clone=value=>JSON.parse(JSON.stringify(value));
function ui(t,{role='psychologist',history=[]}={}){
 const dom=new JSDOM('<div id="notice"></div><section id="attendance-alert-detail" tabindex="-1"></section>',{url:'https://example.test/administracao/',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext();
 t.after(()=>w.close());w.HTMLElement.prototype.scrollIntoView=function(){};
 const row={id:'fixture-alert',name:'Aluno fictício',student_id:'UND1_000001',unit:'amavale',label:'Turma fictícia',streak:5,signal:'active',workflow:'pending',version:0,evidence:[],contact:{},notifications:[],next_contact:'',history:clone(history)};
 const model={row,posts:[],failSave:false,failReport:false,refreshes:0};
 w.api=async(url,options)=>{if(options){model.posts.push(clone(options.data));if(model.saveGate)await model.saveGate;if(model.failSave)throw Error('Sem conexão. Tente novamente.');if(options.data.version!==row.version)throw Error('O acompanhamento foi alterado. Reabra antes de salvar.');Object.assign(row,{workflow:options.data.workflow,next_contact:options.data.next_contact,version:row.version+1,owner_email:'equipe@example.test'});row.history.push({...options.data,id:'event-'+row.version,created_at:'2026-11-20T18:39:00Z',actor_email:'equipe@example.test'});return {alert:clone(row),message:'Acompanhamento registrado. Nenhuma mensagem foi enviada à família.'}}return {alert:clone(row)}};
 vm.runInContext(`const $=id=>document.getElementById(id);const classUnits={amavale:'Amavale'};let me={role:${JSON.stringify(role)}};const todayBR=()=> '2026-11-20';const notice=text=>$('notice').textContent=text;const phoneContact=text=>el('p',text);`,ctx);
 const p=source('portal.js');vm.runInContext(p.slice(p.indexOf('function el('),p.indexOf('function notice(')),ctx);vm.runInContext('let fieldSequence=0;'+p.slice(p.indexOf('function field('),p.indexOf('async function detail(')),ctx);
 const teachers=source('teachers.js');vm.runInContext(teachers.slice(teachers.indexOf('function longField('),teachers.indexOf('async function teacherList(')),ctx);
 vm.runInContext(source('action.js')+'\nconst action=createPortalAction({notice,el});',ctx);vm.runInContext(source('attendance-insights.js'),ctx);
 w.loadAttendanceReport=async()=>{model.refreshes++;if(model.failReport)throw Error('Falha ao atualizar relatório')};
 return {w,d:w.document,model,open:()=>w.attendanceAlertDetail(row.id),async submit(){const form=w.document.querySelector('#attendance-alert-detail form');form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick()},fill(){const f=w.document.querySelector('#attendance-alert-detail form');Object.assign(f.elements.workflow,{value:'contacted'});f.elements.channel.value='whatsapp';f.elements.outcome.value='reached';f.elements.note.value='Contato fictício realizado. Retorno combinado com a família.\nRevisar na próxima semana.';f.elements.next_contact.value='2026-11-23';return f}};
}

for(const role of ['psychologist','social_worker','secretary','admin'])test('Acompanhamento '+role+': texto, WhatsApp, resultado e revisão continuam visíveis após salvar e reabrir',async t=>{
 const f=ui(t,{role});await f.open();const form=f.fill(),note=form.elements.note.value;await f.submit();
 const check=()=>{const saved=f.d.querySelector('[data-latest-followup]');assert.ok(saved,'O acompanhamento salvo precisa ficar visível');assert.match(saved.textContent,/WhatsApp/);assert.match(saved.textContent,/Conseguiu conversar/);assert.match(saved.textContent,/23\/11\/2026/);assert.ok(saved.textContent.includes(note));assert.equal(f.d.querySelector('[data-new-followup]').open,false);assert.equal(f.d.querySelector('form').elements.channel.value,'whatsapp')};
 check();await f.open();check();assert.equal(f.model.posts.length,1);assert.equal(f.model.row.history.length,1);
});

test('Falha ao salvar mantém os campos e a mensagem junto do formulário',async t=>{
 const f=ui(t);await f.open();const form=f.fill(),note=form.elements.note.value;f.model.failSave=true;await f.submit();assert.equal(form.elements.note.value,note);assert.equal(form.elements.channel.value,'whatsapp');assert.equal(form.elements.outcome.value,'reached');assert.equal(form.elements.next_contact.value,'2026-11-23');assert.match(form.querySelector('[role=alert]').textContent,/Sem conexão/);assert.equal(f.model.row.history.length,0);
});

test('Relatório indisponível depois do POST não apaga nem oferece reenviar contato já salvo',async t=>{
 const f=ui(t);await f.open();f.fill();f.model.failReport=true;await f.submit();assert.ok(f.d.querySelector('[data-latest-followup]'));assert.equal(f.d.querySelector('[data-new-followup]').open,false);assert.match(f.d.querySelector('[data-report-feedback]').textContent,/salvo.*relatório/i);assert.equal(f.model.row.history.length,1);assert.equal(f.d.querySelector('form [role=alert]'),null);
});

test('Duplo clique salva uma vez; novo acompanhamento exige nova anotação e preserva o anterior',async t=>{
 const f=ui(t);await f.open();f.fill();let release;f.model.saveGate=new Promise(r=>release=r);const first=f.submit(),second=f.submit();assert.equal(f.model.posts.length,1);release();await Promise.all([first,second]);f.model.saveGate=null;
 const details=f.d.querySelector('[data-new-followup]');details.open=true;const form=details.querySelector('form');assert.equal(form.elements.note.value,'');assert.equal(form.elements.channel.value,'whatsapp');assert.equal(form.checkValidity(),false);form.elements.note.value='Segundo contato fictício com retorno combinado.';form.elements.channel.value='email';await f.submit();assert.equal(f.model.row.history.length,2);assert.match(f.d.querySelector('[data-latest-followup]').textContent,/Email/);assert.match(f.d.querySelector('[data-followup-history]').textContent,/WhatsApp/);
});
