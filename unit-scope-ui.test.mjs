import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

function ui(t,role='admin'){
 const dom=new JSDOM('<main><div id="staff-account-list"></div><div id="staff-account-detail"></div><button id="staff-account-new"></button><form id="member-form"></form></main>',{url:'https://example.test',runScripts:'outside-only'}),w=dom.window,requests=[];
 const errors=[],run=code=>vm.runInContext(code,dom.getInternalVMContext());dom.virtualConsole.on('jsdomError',e=>errors.push(e.message));
 t.after(()=>{w.close();assert.deepEqual(errors,[])});w.HTMLElement.prototype.scrollIntoView=function(){};
 run(`let me={role:${JSON.stringify(role)},user_id:'admin'},classUnits={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'},labels={admin:'Administrador',secretary:'Secretaria'};
 const $=id=>document.getElementById(id),el=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e};
 let sequence=0;function field(host,label,name,value='',opts={}){const id='field-'+(++sequence),input=el(opts.options?'select':'input',undefined,{id,name,...(opts.type?{type:opts.type}:{})});if(opts.options)for(const [value,label]of Object.entries(opts.options))input.append(el('option',label,{value}));input.value=value??'';host.append(el('label',label,{for:id}),input);return input}
 const action=fn=>async e=>{e?.preventDefault();await fn(e)},notice=()=>{},loadMembers=async()=>{};
 `);
 w.api=async(route,opts)=>{requests.push({route,...opts});if(route==='/me')return {role:'admin',user_id:'admin'};return opts?{account:{...opts.data,user_id:'saved',version:1},message:'Cadastro salvo'}:{accounts:[]}};
 run(fs.readFileSync(new URL('./dist/portal/staff-accounts.js',import.meta.url),'utf8'));
 return {w,requests,run};
}
test('Interface: conta de secretaria começa sem núcleos selecionados e envia seleção explícita',async t=>{
 const {w,requests,run}=ui(t);run('staffAccountForm()');
 const boxes=[...w.document.querySelectorAll('input[name=units]')];assert.equal(boxes.length,3);assert.ok(boxes.every(b=>!b.checked));
 const form=w.document.querySelector('#staff-account-detail form');form.elements.name.value='Pessoa Fictícia';form.elements.email.value='person@example.test';form.elements.phone.value='24999999999';boxes[0].checked=true;boxes[2].checked=true;
 form.dispatchEvent(new w.Event('submit',{cancelable:true}));await new Promise(r=>setImmediate(r));
 assert.deepEqual(Array.from(requests.find(r=>r.method==='POST').data.units),['amavale','vale-do-carangola']);
 assert.match(w.document.body.textContent,/Núcleos permitidos/);
});
test('Interface: administrador global oculta seleção e edição da secretaria restaura os núcleos',t=>{
 const {w,run}=ui(t);run("staffAccountForm({user_id:'someone',name:'Fictício',email:'x@example.test',phone:'24999999999',role:'secretary',active:true,version:2,units:['valparaiso']})");
 assert.equal(w.document.querySelector('input[value=valparaiso]').checked,true);
 const role=w.document.querySelector('select[name=role]');role.value='admin';role.dispatchEvent(new w.Event('change'));
 assert.equal(w.document.querySelector('fieldset').hidden,true);assert.match(w.document.body.textContent,/acesso completo aos três núcleos/);
 role.value='secretary';role.dispatchEvent(new w.Event('change'));assert.equal(w.document.querySelector('fieldset').hidden,false);
});
test('Interface: secretaria não inicializa painel de concessão de permissões',t=>{
 const {w,requests}=ui(t,'secretary');w.document.dispatchEvent(new w.Event('portal:loaded'));assert.equal(requests.length,0);assert.equal(w.document.querySelector('#staff-accounts'),null);
});
