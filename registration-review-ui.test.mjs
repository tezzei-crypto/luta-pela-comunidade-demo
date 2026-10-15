import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {JSDOM} from 'jsdom';
const src=f=>fs.readFileSync(new URL('./dist/portal/'+f,import.meta.url),'utf8'),id='00000000-0000-4000-8000-000000000001',second='00000000-0000-4000-8000-000000000002',tick=()=>new Promise(r=>setTimeout(r,25));
const record=(key=id)=>({id:key,student_name:'Candidato fictício '+key.slice(-1),guardian_name:'Responsável fictício',guardian_email:'guardian@example.test',guardian_phone:'24999999999',relationship:'Mãe',age:9,birth_date:'2017-01-01',unit:'amavale',status:'pending',version:1,source:'website',consent_version:'2026-10-07-portal',created_at:'2026-10-14T17:42:00Z',documents:[{id:'doc',kind:'student_document'}],readiness:{online_consent:true,missing:['Atestado médico','Foto de registro'],ready:false},notification:{state:'pending'}});
function ui(t,{hash='',role='admin'}={}){
 const dom=new JSDOM('<section id="registrations-area"><h2>Candidatos</h2><label for="registration-status">Situação</label><select id="registration-status"><option value="approved">Aprovadas</option></select><section id="registration-detail" tabindex="-1"></section></section><div id="notice"></div>',{url:'https://example.test/administracao/'+hash,runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext(),calls=[],model={fail:false,record:record()};t.after(()=>w.close());w.HTMLElement.prototype.scrollIntoView=function(){};
 const run=s=>vm.runInContext(s,ctx);w.api=async(url,o)=>{calls.push({url,o});if(model.fail)throw Error('Inscrição não localizada.');return {registration:model.record}};
 run(`const $=id=>document.getElementById(id);let me={role:${JSON.stringify(role)}},students=[];const unitNames={amavale:'Amavale'},decisionNames={pending:'Aguardando análise',approved:'Aprovada'},kinds={photo:'Foto',student_document:'Documento do aluno',guardian_document:'Documento do responsável',consent:'Autorização',report_card:'Boletim escolar',medical_certificate:'Atestado médico'};const notice=text=>$('notice').textContent=text;const phoneContact=text=>el('p',text),download=()=>{},showPanel=()=>{};`);
 const p=src('portal.js');run(p.slice(p.indexOf('function el('),p.indexOf('function notice(')));run('let fieldSequence=0;'+p.slice(p.indexOf('function field('),p.indexOf('async function detail(')));run(src('action.js')+';const action=createPortalAction({notice,el});');
 const detail=src('student-details.js');run(detail.slice(detail.indexOf('function documentChecklist('),detail.indexOf('function setupManualRegistration(')));
 const admin=src('admin.js');run(admin.slice(admin.indexOf('function setupRegistrationSearch('),admin.indexOf('async function audit('))+';setupRegistrationSearch();');
 return {w,d:w.document,run,calls,model,search:async(value)=>{w.document.querySelector('#registration-protocol').value=value;w.document.querySelector('#registration-protocol-search').requestSubmit();await tick()}};
}

test('Revisão: link do email abre após autenticação e mostra autorização, pendências e filtro independente',async t=>{
 const f=ui(t,{hash:'#registrations-area?protocol='+id});await tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/registrations/'+id);
 const box=f.d.querySelector('#registration-detail');assert.match(box.textContent,/Declarações.*aceitas no formulário/);assert.doesNotMatch(box.textContent,/Autorização — Ainda não enviado/);assert.match(box.textContent,/faltam: Atestado médico, Foto de registro/);assert.match(box.textContent,/Boletim escolar \(opcional/);
 assert.equal(box.querySelector('option[value=approved]').disabled,true);assert.equal(f.d.querySelector('#registration-status').value,'approved');assert.equal(f.d.querySelector('#registration-protocol').maxLength,80);
 assert.equal(box.querySelector('[name=checked]').checked,false);assert.match(box.textContent,/esta decisão não envia mensagem automaticamente/);
});

test('Revisão: resultado anterior sai imediatamente, erro mantém protocolo e nenhuma decisão fica acessível',async t=>{
 const f=ui(t);await f.search(id);assert.match(f.d.querySelector('#registration-detail').textContent,/Candidato fictício/);
 let reject;f.w.api=()=>new Promise((_,r)=>reject=r);const pending=f.run(`review('${second}')`);assert.equal(f.d.querySelector('#registration-detail form'),null);assert.match(f.d.querySelector('#registration-detail').textContent,/Carregando/);
 reject(Error('Inscrição não localizada.'));await assert.rejects(pending);assert.equal(f.d.querySelector('#registration-detail').hidden,true);
 f.model.fail=true;f.w.api=async()=>{throw Error('Inscrição não localizada.')};await f.search(second);assert.equal(f.d.querySelector('#registration-protocol').value,second);assert.match(f.d.querySelector('[role=alert]').textContent,/não localizada/);assert.equal(f.d.querySelector('#registration-protocol-search button').disabled,false);
});

test('Revisão: resposta e erro antigos não substituem a ficha escolhida depois nem anunciam falso sucesso',async t=>{
 const f=ui(t),pending=[];f.w.api=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));
 const a=f.run(`review('${id}')`),b=f.run(`review('${second}')`);pending[1].resolve({registration:record(second)});assert.equal(await b,true);pending[0].reject(Error('Falha antiga'));assert.equal(await a,false);
 assert.match(f.d.querySelector('#registration-detail h3').textContent,/2$/);assert.equal(f.d.querySelector('#registration-protocol').value,second);
 const c=f.run(`review('${id}')`),d=f.run(`review('${second}')`);pending[3].resolve({registration:record(second)});await d;pending[2].resolve({registration:record(id)});assert.equal(await c,false);assert.match(f.d.querySelector('#registration-detail h3').textContent,/2$/);
});

test('Revisão: somente ficha completa libera opção; cadastro existente é explícito e não selecionado automaticamente',async t=>{
 const f=ui(t);f.model.record.readiness={online_consent:true,missing:[],ready:true};f.run(`students=[{id:'UND1_000011',name:'Candidato fictício 1',birth_date:'2017-01-01',status:'approved'}]`);await f.search(id);
 assert.equal(f.d.querySelector('option[value=approved]').disabled,false);assert.match(f.d.querySelector('#registration-detail').textContent,/já existe cadastro com o mesmo nome/);assert.equal(f.d.querySelector('[name=existing_student_id]').value,'');
});

test('Revisão: link não consulta inscrições sem perfil autorizado',async t=>{
 for(const role of ['teacher','guardian','social_worker','psychologist']){const f=ui(t,{hash:'#registrations-area?protocol='+id,role});await tick();assert.equal(f.calls.length,0);assert.equal(f.d.querySelector('#registration-protocol-search'),null);}
});
