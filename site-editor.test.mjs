import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import sharp from 'sharp';import {parse} from 'parse5';import {once} from 'node:events';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';import {handleContact} from './contact-handler.mjs';
import {catalogFor,editorPages,validEditorLink} from './site-editor-template.mjs';import {prepareSiteImage} from './site-editor.mjs';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-editor-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'editor-test-only-'.repeat(3),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',RESEND_API_KEY:'fake',MAIL_FROM:'fake@example.test',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false'};
 const transport=async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'fake'})};let store=createSqliteStore(env,{transport});const admin=(await store.members())[0].user_id;
 t.after(()=>{store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-editor-')));fs.rmSync(dir,{recursive:true,force:true})});
 return {dir,env,admin,get store(){return store},reopen(){store.close();store=createSqliteStore(env,{transport})},async token(email='admin@example.test'){await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token}};
}
const edit=(d,f,value)=>({version:d.version,data:{schema_hash:d.schema_hash,values:[{id:f.id,value}]}});
test('Editor: catálogo cobre páginas reais, formulários e imagens dos núcleos sem código executável',()=>{
 assert.equal(editorPages.length,9);
 for(const p of editorPages){const c=catalogFor(p.page);assert.ok(c.fields.length>10);assert.equal(new Set(c.fields.map(f=>f.id)).size,c.fields.length);assert.ok(!c.fields.some(f=>f.value.includes('function renderTraining')||f.value.includes('addEventListener')))}
 assert.ok(catalogFor('/inscricao/').fields.some(f=>f.value.includes('Nome completo do aluno')));
 assert.ok(catalogFor('/agendamento/').fields.some(f=>f.value==='Central de agendamento'));
 assert.ok(catalogFor('/patrocinar/').fields.some(f=>f.value.toLowerCase().includes('patroc')));
 assert.equal(catalogFor('/unidades/amavale/').fields.filter(f=>f.kind==='image'&&f.value.includes('/amavale-')).length,4);
 for(const p of ['/administracao/','/portal/','/../portal/','/unidades/inventado/'])assert.throws(()=>catalogFor(p),{status:404});
});
test('Editor: rascunho isolado, publicação renderizada, restauração e persistência auditada',async t=>{
 const f=await fixture(t);let d=await f.store.editorDocument(f.admin,'/');const title=d.fields.find(x=>x.kind==='title'),original=f.store.editorPublicHtml('/');
 d=await f.store.saveEditorDraft(f.admin,'/',edit(d,title,'Título editado — Teste <seguro>'));
 assert.equal(f.store.editorPublicHtml('/'),original);
 const preview=await f.store.editorPreview(f.admin,'/',{data:d.draft});assert.match(preview.html,/Título editado/);assert.doesNotMatch(preview.html,/<script\b/);assert.doesNotMatch(preview.html,/<a[^>]+href=/);
 d=await f.store.publishEditor(f.admin,'/',{version:d.version,reason:'Teste de publicação do título'});assert.match(f.store.editorPublicHtml('/'),/Título editado — Teste &lt;seguro&gt;/);assert.equal(d.history.length,1);
 d=await f.store.restoreEditor(f.admin,'/',{version:d.version,revision:d.history[0].id});assert.match(f.store.editorPublicHtml('/'),/Título editado/);assert.equal(d.draft.values.length,0);
 await f.store.publishEditor(f.admin,'/',{version:d.version,reason:'Restaurar conteúdo anterior'});f.reopen();assert.equal(f.store.editorPublicHtml('/'),original);assert.ok((await f.store.auditLog()).some(r=>r.action==='editor.restore_draft:/'));
});
test('Editor: versões concorrentes, estrutura alterada e validação não sobrescrevem rascunhos',async t=>{
 const f=await fixture(t),other=createSqliteStore(f.env);let d=await f.store.editorDocument(f.admin,'/'),field=d.fields.find(x=>x.kind==='text');
 const saved=await f.store.saveEditorDraft(f.admin,'/',edit(d,field,'Texto protegido'));
 await assert.rejects(other.saveEditorDraft(f.admin,'/',edit(d,field,'Edição concorrente')),{status:409});other.close();
 await assert.rejects(f.store.saveEditorDraft(f.admin,'/',{version:saved.version,data:{...saved.draft,schema_hash:'antiga'}}),{status:409});
 await assert.rejects(f.store.saveEditorDraft(f.admin,'/',{version:saved.version,data:{...saved.draft,values:[{id:'script',value:'alert(1)'}]}}),{status:400});
 await assert.rejects(f.store.publishEditor(f.admin,'/',{version:saved.version,reason:'x'}),{status:400});assert.deepEqual((await f.store.editorDocument(f.admin,'/')).draft,saved.draft);
});
test('Editor: links e imagens impedem scripts, destinos privados e conteúdo arbitrário',async t=>{
 for(const v of ['javascript:alert(1)','data:text/html,a','//bad.test','/\\bad.test','https://user:pass@example.test','https://example.test\nX'])assert.equal(validEditorLink(v),false,v);
 for(const v of ['/inscricao/','https://example.test/x?q=1','#unidades','mailto:test@example.test','tel:+5524999999999'])assert.equal(validEditorLink(v),true,v);
 const f=await fixture(t),d=await f.store.editorDocument(f.admin,'/');
 await assert.rejects(f.store.saveEditorDraft(f.admin,'/',edit(d,d.fields.find(x=>x.kind==='link'),'javascript:alert(1)')),{status:400});
 await assert.rejects(f.store.saveEditorDraft(f.admin,'/',edit(d,d.fields.find(x=>x.kind==='image'),'/api/portal/documents/private')),{status:400});
});
test('Editor: imagens são decodificadas, mantêm transparência e removem metadados',async t=>{
 const f=await fixture(t),png=await sharp({create:{width:32,height:40,channels:4,background:{r:20,g:30,b:40,alpha:.4}}}).png().withExif({IFD0:{Copyright:'Private-test'}}).toBuffer();
 const file=new File([png],'nome-privado.png',{type:'image/png'}),bytes=await prepareSiteImage(file),meta=await sharp(bytes).metadata();assert.equal(meta.format,'webp');assert.equal(meta.hasAlpha,true);assert.equal(meta.exif,undefined);
 await assert.rejects(prepareSiteImage(new File(['<svg></svg>'],'a.png',{type:'image/png'})),{status:400});
 await assert.rejects(prepareSiteImage({size:9*1024*1024,arrayBuffer(){throw Error()}}),{status:400});
 await assert.rejects(f.store.addEditorMedia(f.admin,file,{alt:'Imagem de teste',authorized:false}),{status:400});
 const m=await f.store.addEditorMedia(f.admin,file,{alt:'Imagem de teste',authorized:true}),d=await f.store.editorDocument(f.admin,'/');
 const saved=await f.store.saveEditorDraft(f.admin,'/',edit(d,d.fields.find(x=>x.kind==='image'),m.url));await f.store.publishEditor(f.admin,'/',{version:saved.version,reason:'Imagem de teste publicada'});assert.ok(f.store.editorPublicHtml('/').includes(m.url));assert.equal(f.store.editorPublicMedia(m.id).mime,'image/webp');assert.throws(()=>f.store.editorPublicMedia('not-found'),{status:404});
});
test('Editor: perguntas, ordenação, opções desativadas, mensagem atual e restauração',async t=>{
 const f=await fixture(t);let d=await f.store.editorDocument(f.admin,'contact'),data=structuredClone(d.draft);data.title='Atendimento editado';data.question='Qual assunto?';data.options.reverse();data.options[0].label='Responsáveis';data.options[0].message='Mensagem editada';data.options[1].enabled=false;data.options.push({id:'novo-assunto',label:'Nova opção',message:'Texto novo',enabled:true});
 d=await f.store.saveEditorDraft(f.admin,'contact',{version:0,data});assert.notEqual(f.store.publicConversation().question,'Qual assunto?');
 const preview=await f.store.editorPreview(f.admin,'contact',{data});assert.match(preview.html,/Responsáveis/);assert.match(preview.html,/disabled/);assert.doesNotMatch(preview.html,/<script\b/);
 d=await f.store.publishEditor(f.admin,'contact',{version:d.version,reason:'Atualizar atendimento'});
 assert.equal(f.store.publicConversation().options[0].label,'Responsáveis');assert.equal(f.store.publicConversation().options.length,3);
 let response=await handleContact(new Request('https://example.test/api/contact/whatsapp?profile=family&unit=amavale'),f.env,f.store);assert.equal(response.status,302);assert.equal(new URL(response.headers.get('location')).searchParams.get('text'),'Luta pela Comunidade\nMensagem editada\nNúcleo: Amavale.');
 response=await handleContact(new Request('https://example.test/api/contact/whatsapp?profile=participant'),f.env,f.store);assert.equal(response.status,400);
 d=await f.store.restoreEditor(f.admin,'contact',{version:d.version,revision:d.history[0].id});await f.store.publishEditor(f.admin,'contact',{version:d.version,reason:'Restaurar opções anteriores'});assert.equal(f.store.publicConversation().title,'Fale com a secretaria');
});
test('Editor: API exige autenticação, perfil e origem; prévia também é privada',async t=>{
 const f=await fixture(t),token=await f.token(),request=(path,method='GET',data,auth=token,origin=f.env.PUBLIC_ORIGIN)=>handlePortal(new Request(f.env.PUBLIC_ORIGIN+'/api/portal/site-editor'+path,{method,headers:{Authorization:'Bearer '+auth,Origin:origin,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),f.env,f.store);
 assert.equal((await request('/pages')).status,200);assert.equal((await request('/page?page=%2F')).status,200);assert.equal((await request('/page?page=%2Fadministracao%2F')).status,404);
 for(const role of ['guardian','psychologist','social_worker']){const user=await f.store.provision(role+'@example.test',role),auth=await f.token(user.email);assert.equal((await request('/pages','GET',null,auth)).status,403);assert.equal((await request('/page/preview?page=%2F','POST',{data:{}},auth)).status,403)}
 assert.equal((await request('/pages','GET',null,'missing')).status,401);
 assert.equal((await request('/contact','PATCH',{version:0,data:{}},token,'https://attacker.test')).status,403);
 const d=await f.store.editorDocument(f.admin,'/');const r=await request('/page?page=%2F','PATCH',edit(d,d.fields.find(x=>x.kind==='title'),'Título pela API'));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
});
test('Editor HTTP: páginas já renderizadas, rascunhos privados e publicação visível sem JavaScript',async t=>{
 const f=await fixture(t),token=await f.token();const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,windowsHide:true,env:{...process.env,...f.env,RESEND_API_KEY:'',MAIL_FROM:'',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:'',ADDITIONAL_PUBLIC_ORIGINS:'',RENDER:'false',PORT:'0',HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());
 const origin=await new Promise((resolve,reject)=>{let out='';child.stdout.on('data',c=>{out+=c;const m=/http:\/\/127\.0\.0\.1:\d+/.exec(out);if(m)resolve(m[0])});child.once('error',reject);child.once('exit',code=>reject(Error('server exit '+code)));setTimeout(()=>reject(Error('server timeout')),10000).unref()});
 try{const call=(route,method='GET',data)=>fetch(origin+'/api/portal/site-editor'+route,{method,headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
 const registration=await (await fetch(origin+'/inscricao/')).text();assert.match(registration,/id="registration-form"/);assert.match(registration,/data-site-rendered="\/inscricao\/"/);
 let d=await (await call('/page?page=%2F')).json();d=await (await call('/page?page=%2F','PATCH',edit(d,d.fields.find(x=>x.kind==='title'),'Título HTTP publicado'))).json();
 assert.doesNotMatch(await (await fetch(origin+'/')).text(),/Título HTTP publicado/);
 assert.equal((await call('/page/publish?page=%2F','POST',{version:d.version,reason:'Conferência HTTP completa'})).status,200);
 const response=await fetch(origin+'/'),html=await response.text();assert.match(html,/<title>Título HTTP publicado<\/title>/);assert.match(html,/property="og:title" content="Título HTTP publicado"/);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await fetch(origin+'/site-page-templates.json')).status,404);assert.equal((await fetch(origin+'/api/portal/site-editor/pages')).status,401);
 for(const p of editorPages){assert.equal((await fetch(origin+p.page)).status,200)}
 }finally{if(child.exitCode===null&&!child.signalCode){const stopped=once(child,'exit');child.kill();await stopped}}
});
