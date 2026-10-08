import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {handleRegistration} from './registration-handler.mjs';
import {sanitizeDiagnostic} from './diagnostics.mjs';
import {createRequestFeedback} from './dist/request-feedback.js';

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-diagnostics-')),mail=[];
 const env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'diagnostics-test-only-'.repeat(3),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PORTAL_INTAKE_ACTIVE:'true',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test',PUBLIC_ORIGIN:'https://example.test'};
 const store=createSqliteStore(env,{transport:async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'fake'})}});
 const admin=(await store.members())[0];
 t.after(()=>{store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-diagnostics-')));fs.rmSync(dir,{recursive:true,force:true})});
 async function login(email){await store.requestCode(email);return(await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token}
 const token=await login(admin.email);
 const request=(route,options={})=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method:options.method||'GET',headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+(options.token||token),'Content-Type':'application/json'},body:options.data?JSON.stringify(options.data):undefined}),env,store);
 return {env,store,admin,request,login,dir};
}
function registrationForm(id=randomUUID()){
 const form=new FormData();for(const [k,v]of Object.entries({studentName:'Aluno Fictício Diagnóstico',guardianName:'Responsável Fictício',birthDate:'2015-01-01',unit:'amavale',guardianEmail:'guardian@example.test',guardianPhone:'24999999999',relationship:'Mãe',participationConsent:'on',medicalConsent:'on',dataConsent:'on',requestId:id}))form.set(k,v);
 for(const k of ['studentDocument','guardianDocument','medicalCertificate'])form.set(k,new Blob(['%PDF-1.7 DOCUMENTO FICTICIO'],{type:'application/pdf'}),'teste.pdf');form.set('photo',new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'}),'teste.jpg');return form;
}
test('Diagnóstico: mantém só metadados permitidos e rejeita conteúdo sensível',()=>{
 const e=sanitizeDiagnostic({support_id:'email@example.com\nInjected',operation:'/api/students/private-name',kind:'secret',status:999,headers:{Authorization:'Bearer PRIVATE'},password:'PRIVATE',body:'PRIVATE',stack:'PRIVATE',release:'PRIVATE'});
 assert.equal(e.operation,'site');assert.equal(e.kind,'server');assert.equal(e.status,0);assert.doesNotMatch(JSON.stringify(e),/PRIVATE|email@example|Injected|private-name/);
});
test('Diagnóstico: consulta exclusiva do administrador, filtros, versão e retenção',async t=>{
 const f=await fixture(t),id=randomUUID();f.store.recordDiagnostic({support_id:id,operation:'registration',kind:'network',source:'browser'});
 const r=await f.request('/diagnostics?support_id='+id);assert.equal(r.status,200);const body=await r.json();assert.equal(body.events.length,1);assert.equal(body.events[0].source,'browser');assert.ok(body.events[0].guidance);
 for(const role of ['secretary','guardian','psychologist','social_worker']){await f.store.provision(role+'@example.test',role);const token=await f.login(role+'@example.test');assert.equal((await f.request('/diagnostics',{token})).status,403,role)}
 assert.equal((await f.request('/diagnostics/settings',{method:'PATCH',data:{retention_days:7,version:body.settings.version}})).status,200);
 assert.equal((await f.request('/diagnostics/settings',{method:'PATCH',data:{retention_days:90,version:body.settings.version}})).status,409);
 assert.equal((await f.request('/diagnostics?kind=unknown')).status,400);
});
test('Inscrição: gravação com quatro anexos e repetição sem duplicar após perda da confirmação',async t=>{
 const f=await fixture(t),id=randomUUID();
 const send=()=>handleRegistration(new Request(f.env.PUBLIC_ORIGIN+'/api/registrations',{method:'POST',headers:{Origin:f.env.PUBLIC_ORIGIN},body:registrationForm(id)}),{...f.env,RESEND_API_KEY:'',MAIL_FROM:''},undefined,f.store);
 for(let i=0;i<2;i++){const r=await send();assert.equal(r.status,200);assert.equal((await r.json()).protocol,id)}
 const rows=await f.store.registrations('pending',0);assert.equal(rows.length,1);assert.equal((await f.store.registration(id)).documents.length,4);
});

test('Inscrição: zero ou parte dos anexos, pendência visível e complementação pela secretaria',async t=>{
 const f=await fixture(t);await f.store.provision('secretary@example.test','secretary');const token=await f.login('secretary@example.test');
 for(const keep of [[],['photo'],['studentDocument','medicalCertificate']]){
  const id=randomUUID(),form=registrationForm(id);
  for(const k of ['studentDocument','guardianDocument','medicalCertificate','photo'])if(!keep.includes(k))form.set(k,new File([],''));
  const send=()=>handleRegistration(new Request(f.env.PUBLIC_ORIGIN+'/api/registrations',{method:'POST',headers:{Origin:f.env.PUBLIC_ORIGIN},body:form}),{...f.env,RESEND_API_KEY:'',MAIL_FROM:''},undefined,f.store);
  assert.equal((await send()).status,200);assert.equal((await send()).status,200);
  const candidate=(await(await f.request('/registrations/'+id,{token})).json()).registration;
  assert.equal(candidate.status,'pending');assert.equal(candidate.documents.length,keep.length);
  assert.equal((await f.store.students()).length,0,'A solicitação não aprova nem matricula automaticamente');
  const upload=new FormData();upload.set('kind','guardian_document');upload.set('version',candidate.version);upload.set('file',new Blob(['%PDF-1.7 ficticio'],{type:'application/pdf'}),'recebido-secretaria.pdf');
  const uploaded=await handlePortal(new Request(f.env.PUBLIC_ORIGIN+'/api/portal/registrations/'+id+'/documents',{method:'POST',headers:{Origin:f.env.PUBLIC_ORIGIN,Authorization:'Bearer '+token},body:upload}),f.env,f.store);
  assert.equal(uploaded.status,201);const updated=await f.store.registration(id);assert.equal(updated.documents.length,keep.length+1);assert.equal(updated.version,candidate.version+1);
  assert.equal((await send()).status,200,'Reenvio original não apaga a complementação');assert.equal((await f.store.registration(id)).documents.length,keep.length+1);
 }
 assert.equal((await f.store.registrations('pending')).length,3);
});

test('Inscrição: anexos opcionais não aceitam arquivo vazio nomeado ou formato disfarçado',async t=>{
 const f=await fixture(t);
 for(const file of [new File([],'vazio.pdf',{type:'application/pdf'}),new File(['MZ executable'],'foto.jpg',{type:'image/jpeg'})]){
  const form=registrationForm();form.set('photo',file);
  assert.equal((await handleRegistration(new Request(f.env.PUBLIC_ORIGIN+'/api/registrations',{method:'POST',headers:{Origin:f.env.PUBLIC_ORIGIN},body:form}),f.env,undefined,f.store)).status,400);
 }
 assert.equal((await f.store.registrations('pending')).length,0);
});
test('Navegador: diferencia HTML de erro, conexão e timeout, sem enviar o formulário no log',async()=>{
 const reports=[],id=randomUUID();
 const html=createRequestFeedback({fetcher:async()=>new Response('<html>upstream failure</html>',{status:502,headers:{'X-Support-ID':id}}),report:e=>reports.push(e)});
 await assert.rejects(html.requestJson('/api/registrations',{method:'POST',body:'PRIVATE'}),e=>e.status===502&&e.support_id===id&&/temporariamente/.test(e.message));
 const offline=createRequestFeedback({fetcher:async()=>{throw Error('PRIVATE')},online:()=>false,report:e=>reports.push(e)});
 await assert.rejects(offline.requestJson('/api/registrations'),e=>e.kind==='offline');
 const timeout=createRequestFeedback({fetcher:async(u,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('abort')))),timeoutMs:5,report:e=>reports.push(e)});
 await assert.rejects(timeout.requestJson('/api/registrations'),e=>e.kind==='timeout');
 assert.doesNotMatch(JSON.stringify(reports),/PRIVATE|body|headers/);
});

test('Inscrição: falha no aviso de email é registrada e não desfaz o cadastro confirmado',async t=>{
 const f=await fixture(t),support=randomUUID(),form=registrationForm();
 const r=await handleRegistration(new Request(f.env.PUBLIC_ORIGIN+'/api/registrations',{method:'POST',headers:{Origin:f.env.PUBLIC_ORIGIN,'X-Support-ID':support},body:form}),f.env,async()=>Response.json({message:'PRIVATE'},{status:502}),f.store);
 assert.equal(r.status,200);assert.equal((await f.store.registrations('pending')).length,1);
 const events=f.store.diagnosticEvents(f.admin.user_id,{support_id:support}).events;assert.equal(events[0].kind,'email');assert.doesNotMatch(JSON.stringify(events),/PRIVATE|guardian@example/);
});
test('Navegador: só confirma inscrição com resposta JSON e protocolo',async()=>{
 const reports=[];
 const client=createRequestFeedback({fetcher:async()=>Response.json({message:'OK'}),report:e=>reports.push(e)});
 await assert.rejects(client.requestJson('/api/registrations',{},'protocol'),e=>e.kind==='unexpected_response');assert.equal(reports.length,1);
 const valid=createRequestFeedback({fetcher:async()=>Response.json({protocol:'test-protocol'}),report:()=>{throw Error('not needed')}});
 assert.equal((await valid.requestJson('/api/registrations',{},'protocol')).protocol,'test-protocol');
});
test('Servidor: inscrição completa, confirmação correlacionada e diagnóstico privado',async t=>{
 const f=await fixture(t);
 const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,...f.env,PORT:'0',HOST:'127.0.0.1',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:'',ADDITIONAL_PUBLIC_ORIGINS:'',RENDER:'false',RESEND_API_KEY:'',MAIL_FROM:'',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}});
 let stdout='';const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test server timeout')),10000);child.on('error',reject);child.stdout.on('data',b=>{stdout+=b;const m=stdout.match(/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(m[1])}})});
 const base='http://127.0.0.1:'+port,id=randomUUID(),r=await fetch(base+'/api/registrations',{method:'POST',headers:{Origin:base,'X-Support-ID':id},body:registrationForm()});
 assert.equal(r.status,200);assert.equal(r.headers.get('X-Support-ID'),id);assert.ok((await r.json()).protocol);
 const events=f.store.diagnosticEvents(f.admin.user_id,{support_id:id}).events;assert.equal(events[0].kind,'received');
 const invalid=await fetch(base+'/api/registrations',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'});assert.equal(invalid.status,415);assert.equal((await invalid.json()).support_id,invalid.headers.get('X-Support-ID'));
 const denied=await fetch(base+'/api/diagnostics',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(denied.status,403);
 const reportId=randomUUID(),report=await fetch(base+'/api/diagnostics',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({support_id:reportId,kind:'network',operation:'registration',body:'PRIVATE',email:'PRIVATE'})});assert.equal(report.status,202);assert.doesNotMatch(JSON.stringify(f.store.diagnosticEvents(f.admin.user_id,{support_id:reportId})),/PRIVATE/);
 assert.equal((await fetch(base+'/api/portal/diagnostics')).status,401);
 // Stop before fixture cleanup: Windows cannot remove an open SQLite file.
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;
});
