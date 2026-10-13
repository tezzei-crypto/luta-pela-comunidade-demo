import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {JSDOM} from 'jsdom';
function ui(t,{write=true,fail=false}={}){
 const dom=new JSDOM('<div id="box"></div>',{url:'https://example.test/professor/',runScripts:'outside-only'}),w=dom.window,ctx=dom.getInternalVMContext(),calls=[],errors=[];t.after(()=>{w.close();assert.deepEqual(errors,[])});dom.virtualConsole.on('jsdomError',e=>errors.push(e.message));w.HTMLElement.prototype.scrollIntoView=function(){};
 const model={fail},data={lesson:{day:'2026-10-13',time:'15:00',label:'Turma Fictícia',cancelled:0},can_write:write,delivery:{held:0,version:0},visitors:[]};
 w.api=async(url,o)=>{calls.push({url,...o});if(!o)return structuredClone(data);if(model.fail)throw Error('Sem conexão. Seus dados continuam no formulário.');if(url==='/quick-intakes'){await new Promise(r=>setTimeout(r,10));data.visitors.push({id:o.data.id,name:o.data.name,present:1,status:'pending',version:1});return {present:true}}if(url.endsWith('/visitors')){const v=data.visitors.find(v=>v.id===o.data.intake_id);v.present=Number(o.data.present);v.version++;return {}}throw Error(url)};
 vm.runInContext(`function el(tag,text,attrs={}){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
 function field(host,label,name,value='',opts={}){const e=el('input',undefined,{name,id:name,type:opts.type||'text'});e.value=value;host.append(el('label',label,{for:name}),e);return e}
 const notice=message=>document.body.dataset.notice=message;`,ctx);
 vm.runInContext(fs.readFileSync(new URL('./dist/portal/action.js',import.meta.url),'utf8'),ctx);vm.runInContext('const action=createPortalAction({notice,el});',ctx);vm.runInContext(fs.readFileSync(new URL('./dist/portal/quick-intake.js',import.meta.url),'utf8').replace('export async','async'),ctx);
 const run=code=>vm.runInContext(code,ctx),flush=()=>new Promise(r=>setTimeout(r,35));return {w,calls,data,model,run,flush,start:()=>run("mountQuickIntake({api,el,field,action,notice},document.getElementById('box'),'fixture-class')")};
}
test('UI rápida: nome obrigatório, opcionais recolhidos, clique duplo salva uma vez e prepara próximo',async t=>{
 const f=ui(t);await f.start();const d=f.w.document,form=d.querySelector('form');assert.equal(form.querySelectorAll('[required]').length,1);assert.equal(form.querySelector('details').open,false);form.elements.name.value='Pessoa <img src=x onerror=alert(1)>';
 form.dispatchEvent(new f.w.SubmitEvent('submit',{cancelable:true}));form.dispatchEvent(new f.w.SubmitEvent('submit',{cancelable:true}));await f.flush();
 assert.equal(f.calls.filter(c=>c.url==='/quick-intakes').length,1);assert.equal(form.elements.name.value,'');assert.equal(d.activeElement,form.elements.name);assert.equal(d.querySelectorAll('img').length,0);assert.match(d.body.textContent,/1 visitante\(s\) com presença/);assert.match(d.body.textContent,/aluno e presença salvos/);
});
test('UI rápida: falha mantém campos, permite tentar novamente com mesmo protocolo e desfazer presença',async t=>{
 const f=ui(t,{fail:true});await f.start();const d=f.w.document,form=d.querySelector('form');form.elements.name.value='Aluno Teste';form.dispatchEvent(new f.w.SubmitEvent('submit',{cancelable:true}));await f.flush();assert.equal(form.elements.name.value,'Aluno Teste');assert.equal(form.elements.name.disabled,false);assert.match(d.body.textContent,/Sem conexão/);
 f.model.fail=false;form.dispatchEvent(new f.w.SubmitEvent('submit',{cancelable:true}));await f.flush();const saves=f.calls.filter(c=>c.url==='/quick-intakes');assert.equal(saves[0].data.id,saves[1].data.id);
 [...d.querySelectorAll('button')].find(b=>b.textContent==='Desfazer presença').click();await f.flush();assert.match(d.body.textContent,/0 visitante\(s\) com presença/);assert.match(d.body.textContent,/pré-cadastro continua salvo/);
});
test('UI rápida: consulta e aula cancelada não apresentam criação ou botões de presença',async t=>{
 const f=ui(t,{write:false});await f.start();assert.equal(f.w.document.querySelector('form'),null);assert.ok(!f.w.document.body.textContent.includes('Salvar aluno e presença'));f.data.can_write=true;f.data.lesson.cancelled=1;await f.start();assert.equal(f.w.document.querySelector('form'),null);
});
