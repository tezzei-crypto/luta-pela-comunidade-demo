import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {JSDOM} from 'jsdom';
function ui(t,role='admin'){
 const dom=new JSDOM('<section id="import-area"></section>',{url:'https://example.test',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,c=dom.getInternalVMContext();const source=fs.readFileSync(new URL('./dist/portal/portal.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('function el('),source.indexOf('function notice(')),c);
 vm.runInContext('let fieldSequence=0;'+source.slice(source.indexOf('function field('),source.indexOf('async function detail(')),c);
 w.calls=[];w.errors=[];w.labels=[];w.api=async(route,o)=>{w.calls.push({route,...o});return {message:'1 pré-cadastro importado',records:[{id:'fake-protocol',name:'Criança Fictícia'}]}};w.notice=x=>w.labels.push(x);w.load=async()=>{};w.review=async id=>w.labels.push(id);w.$=id=>w.document.getElementById(id);w.me={role};w.scopeUnitNames=()=>({'vale-do-carangola':'Vale do Carangola'});w.phoneLinksReady=Promise.resolve({attachPhoneField(){}});w.action=fn=>async e=>{e?.preventDefault();try{await fn(e)}catch(error){w.errors.push(error.message)}};
 const code=fs.readFileSync(new URL('./dist/portal/student-details.js',import.meta.url),'utf8');vm.runInContext(code.slice(code.indexOf('function setupDraftImport()')),c);vm.runInContext('setupDraftImport()',c);
 const file=data=>Object.defineProperty(w.document.querySelector('input[type=file]'),'files',{configurable:true,value:[{size:100,text:async()=>typeof data==='string'?data:JSON.stringify(data)}]});
 const settle=()=>new Promise(r=>setImmediate(r));return {w,file,settle};
}
test('Importação: prévia explícita por núcleo, erro conserva arquivo, confirmação e protocolos sem aprovação automática',async t=>{
 const f=ui(t),form=f.w.document.querySelector('form');f.file('{invalid');form.dispatchEvent(new f.w.Event('submit',{cancelable:true}));await f.settle();assert.match(f.w.errors[0],/JSON válido/);assert.equal(f.w.calls.length,0);
 f.file({unit:'vale-do-carangola',rows:[{student_name:'Criança Fictícia',birth_date:'2018-01-02',photo:{}}]});form.dispatchEvent(new f.w.Event('submit',{cancelable:true}));await f.settle();assert.match(f.w.document.body.textContent,/1 pré-cadastros · Vale do Carangola/);assert.equal(f.w.calls.length,0);
 const button=[...f.w.document.querySelectorAll('button')].find(b=>b.textContent==='Importar pré-cadastros sem aprovar');button.click();await f.settle();assert.equal(f.w.calls.length,1);assert.equal(f.w.calls[0].route,'/registration-drafts/import');assert.match(f.w.document.body.textContent,/fake-protocol/);assert.ok(f.w.calls.every(c=>!c.route.includes('/review')));
 f.w.document.dispatchEvent(new f.w.Event('portal:logout'));assert.equal(f.w.document.querySelector('#draft-import'),null);
});
test('Importação: secretarias não recebem interface de importação geral',t=>{const f=ui(t,'secretary');assert.equal(f.w.document.querySelector('#draft-import'),null)});
