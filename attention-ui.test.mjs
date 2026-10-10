import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {JSDOM} from 'jsdom';
const settle=()=>new Promise(r=>setTimeout(r,10));
const settings={enabled:true,teacher_email:true,manager_email:true,grace_minutes:720,repeat_hours:24,max_notices:2,quiet_start:20,quiet_end:8,version:0,can_edit:true,mail_configured:true,check_interval_minutes:5};
const issue={id:'a',group_id:'g',class_id:'c',unit:'amavale',label:'Turma fictícia',day:'2026-10-08',start_time:'15:00',end_time:'16:00',expected:31,marked:30,status:'open',within_grace:false,notify_after:'2026-10-09T07:00:00Z',teachers:[],notifications:[],reason:'Chamada incompleta'};
function setup(t,role='admin',module='rollcall-panel.js'){
 const dom=new JSDOM('<div id="workspace"><div><p id="identity"></p></div><input id="draft"><section id="team-area"></section></div>',{url:'https://example.test',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,errors=[];t.after(()=>{w.close();assert.deepEqual(errors,[])});dom.virtualConsole.on('jsdomError',e=>errors.push(e.message));
 let now=0;w.Date.now=()=>now;const timers=new Map();w.setInterval=fn=>{const id=timers.size+1;timers.set(id,fn);return id};w.clearInterval=id=>timers.delete(id);
 const run=s=>vm.runInContext(s,dom.getInternalVMContext());
 run(`function el(tag,text,attrs={}){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e} function field(host,label,name,value,opts={}){const input=el(opts.options?'select':'input',undefined,{name,type:opts.type||'text'});if(opts.options)for(const [v,l]of Object.entries(opts.options))input.append(el('option',l,{value:v}));input.value=value;host.append(input);return input} const action=fn=>async event=>{event?.preventDefault();await fn(event)},notice=()=>{};`);
 w.user={role,email:'test@example.test',units:['amavale']};w.data={issues:[structuredClone(issue)],settings:structuredClone(settings)};w.calls=0;w.opened=[];w.api=async()=>{w.calls++;if(w.delay)return w.delay();if(w.failure)throw Error('offline');return w.data};w.openCall=i=>w.opened.push(i);w.showPanel=id=>w.opened.push(id);
 for(const f of ['attention.js',module])run(fs.readFileSync(new URL('./dist/portal/'+f,import.meta.url),'utf8').replace(/^import .*?;\r?\n/gm,'').replaceAll('export function','function'));
 return {w,run,start(){run((module==='rollcall-panel.js'?'startRollcallPanel':'startAbsenceAttention')+'({api,el,field,action,notice,active:()=>user,showPanel,openCall})');return settle()},async tick(){now+=20000;for(const fn of [...timers.values()])fn();await settle()},async event(type){w.document.dispatchEvent(new w.Event(type));await settle()},timers};
}
for(const role of ['admin','secretary','teacher'])test('Aviso de chamada: '+role+' vê pendência e ação direta; conclusão e cancelamento retiram aviso',async t=>{
 const u=setup(t,role);await u.start();const d=u.w.document,b=d.getElementById('rollcall-banner');assert.equal(b.hidden,false);assert.match(b.textContent,/30\/31/);b.querySelector('button').click();await settle();assert.equal(u.w.opened[0].class_id,'c');
 u.w.data={...u.w.data,issues:[{...issue,status:'resolved',marked:31}]};await u.event('portal:attendance-saved');assert.equal(b.hidden,true);
 u.w.data={...u.w.data,issues:[issue]};await u.tick();assert.equal(b.hidden,false);u.w.data={...u.w.data,issues:[{...issue,status:'cancelled'}]};await u.tick();assert.equal(b.hidden,true);
});
test('Aviso preserva rascunho e regras enquanto outra pessoa conclui; não repete anúncios idênticos',async t=>{
 const u=setup(t);await u.start();const d=u.w.document,live=d.querySelector('.attention-announcer'),original=live.firstChild,form=d.querySelector('#rollcall-area details form');form.elements.grace_hours.value='24';d.getElementById('draft').value='rascunho';d.getElementById('draft').focus();await u.tick();assert.equal(live.firstChild,original);
 u.w.data={...u.w.data,issues:[]};await u.tick();assert.equal(d.getElementById('rollcall-banner').hidden,true);assert.equal(form.elements.grace_hours.value,'24');assert.equal(d.getElementById('draft').value,'rascunho');assert.equal(d.activeElement.id,'draft');
});
test('Aviso dentro das 12 horas não acusa atraso; falha conserva pendência e recuperação atualiza',async t=>{
 const u=setup(t);u.w.data.issues[0].within_grace=true;await u.start();const b=u.w.document.getElementById('rollcall-banner');assert.match(b.textContent,/0 com prazo vencido/);assert.match(b.className,/warning/);u.w.failure=true;await u.tick();assert.equal(b.hidden,false);assert.match(b.textContent,/desatualizado/);u.w.failure=false;u.w.data.issues=[];await u.event('portal:attendance-saved');assert.equal(b.hidden,true);
});
test('Logout descarta resposta atrasada, limpa avisos e para o temporizador',async t=>{
 const u=setup(t);let resolve;u.w.api=()=>new Promise(r=>resolve=r);await u.start();u.w.user=null;await u.event('portal:logout');resolve({issues:[issue],settings});await settle();assert.equal(u.w.document.getElementById('rollcall-banner'),null);assert.equal(u.timers.size,0);
});
test('Perfis sem permissão não solicitam pendências de chamada',async t=>{const u=setup(t,'guardian');await u.start();assert.equal(u.w.calls,0);assert.equal(u.timers.size,0)});
test('Aba oculta pausa consultas; retorno atualiza e chamadas simultâneas são agrupadas',async t=>{
 const u=setup(t);await u.start();Object.defineProperty(u.w.document,'visibilityState',{value:'hidden',configurable:true});const before=u.w.calls;await u.tick();assert.equal(u.w.calls,before);
 Object.defineProperty(u.w.document,'visibilityState',{value:'visible',configurable:true});u.w.data.issues=[];await u.event('visibilitychange');assert.equal(u.w.document.getElementById('rollcall-banner').hidden,true);
 let resolve;u.w.delay=()=>new Promise(r=>resolve=r);u.w.document.dispatchEvent(new u.w.Event('portal:attendance-saved'));u.w.document.dispatchEvent(new u.w.Event('portal:attendance-saved'));assert.equal(u.w.calls,before+2);u.w.user=null;await u.event('portal:logout');resolve(u.w.data);await settle();assert.equal(u.timers.size,0);
});
for(const role of ['admin','secretary','teacher','psychologist','social_worker'])test('Aviso de faltas: '+role+' recebe somente resumo fornecido pelo servidor e some após resolução',async t=>{
 const u=setup(t,role,'absence-attention.js');u.w.data={threshold:3,alerts:[{id:'a',name:'Aluno Fictício',student_id:'UND1_000001',unit:'amavale',label:'Turma Fictícia',streak:3,workflow:'pending',evidence:[{day:'2026-10-08'}]}]};await u.start();const d=u.w.document,b=d.getElementById('absence-banner');assert.equal(b.hidden,false);assert.match(b.textContent,/1 aluno/);assert.match(b.textContent,/3 ou mais/);assert.equal(d.querySelectorAll('#absence-attention-area button').length,role==='teacher'?0:1);
 u.w.data={threshold:3,alerts:[]};await u.event('portal:absence-followup-saved');assert.equal(b.hidden,true);assert.match(d.getElementById('absence-attention-area').textContent,/Nenhum alerta ativo/);
});
