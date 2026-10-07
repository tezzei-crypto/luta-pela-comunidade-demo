import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {handleRegistration} from './registration-handler.mjs';
import {csv,parseCsv} from './portal-domain.mjs';
const pupil={id:'UND1_000001',name:'Aluno Fictício de Teste',birth_date:'2015-01-01',status:'approved',version:0};
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-flow-')),mail=[];
 const env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'only-tests-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test',PUBLIC_ORIGIN:'https://example.test',PORTAL_INTAKE_ACTIVE:'true'};
 const store=createSqliteStore(env,{transport:async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'fake'})}});
 t.after(()=>{store.close();if(!dir.startsWith(path.join(os.tmpdir(),'lpc-flow-')))throw Error('Unsafe test cleanup');fs.rmSync(dir,{recursive:true,force:true})});
 async function login(email){await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token}
 const token=await login(env.BOOTSTRAP_ADMIN_EMAIL),admin=(await store.members())[0];
 function request(route,{token:tkn=token,method='GET',data,form}={}){return handlePortal(new Request('https://example.test/api/portal'+route,{method,headers:{origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+tkn,...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)}),env,store)}
 return {env,store,admin,request,login};
}
test('Fluxo integrado: CSV, ficha, medidas, documentos privados e logout',async t=>{
 const {request}=await fixture(t);
 const preview=await request('/import/preview',{method:'POST',data:{csv:csv([pupil])}});assert.equal(preview.status,200);
 const commit=await request('/import/commit',{method:'POST',data:{token:(await preview.json()).token}});assert.equal(commit.status,200);
 const profile=(await (await request('/students/'+pupil.id)).json()).student;assert.equal(profile.name,pupil.name);assert.equal(typeof profile.age,'number');
 assert.equal((await request('/students/'+pupil.id,{method:'PATCH',data:{version:1,weight_kg:'32,5',height_cm:142,kimono:'M2'}})).status,200);
 const file=new FormData();file.set('kind','report_card');file.set('file',new Blob(['%PDF-1.7\nfictitious test\n%%EOF'],{type:'application/pdf'}),'boletim-teste.pdf');
 const uploaded=await request('/students/'+pupil.id+'/documents',{method:'POST',form:file});assert.equal(uploaded.status,201);const id=(await uploaded.json()).id;
 const docs=await (await request('/students/'+pupil.id+'/documents')).json();assert.equal(docs.documents.length,1);assert.equal(docs.documents[0].object_path,undefined);
 const download=await request('/documents/'+id+'/download');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.match(await download.text(),/fictitious test/);
 const exported=parseCsv(await (await request('/export.csv')).text());assert.equal(exported[0].weight_kg,32.5);assert.equal(exported[0].version,2);
 assert.equal((await request('/auth/logout',{method:'POST',data:{}})).status,200);assert.equal((await request('/students')).status,401);
});
test('Fluxo integrado: secretaria cadastra responsável; acesso depende do vínculo',async t=>{
 const {request,store,admin,login}=await fixture(t);await store.import(admin.user_id,[pupil,{...pupil,id:'UND1_000002'}]);
 const guardian=(await (await request('/members',{method:'POST',data:{email:'guardian@example.test',role:'guardian'}})).json()).member;
 const token=await login(guardian.email);assert.equal((await request('/students/'+pupil.id,{token})).status,403);
 assert.equal((await request('/links',{method:'POST',data:{user_id:guardian.user_id,student_id:pupil.id}})).status,200);
 assert.equal((await request('/students/'+pupil.id,{token})).status,200);assert.equal((await request('/students/UND1_000002',{token})).status,403);
 assert.equal((await request('/members',{token})).status,403);assert.equal((await request('/import/preview',{token,method:'POST',data:{csv:csv([pupil])}})).status,403);
});
test('Fluxo integrado: inscrição persiste sem email, análise e aprovação conservam documentos',async t=>{
 const {env,store,request}=await fixture(t);const id=randomUUID();
 const form=new FormData();for(const [k,v] of Object.entries({studentName:'Inscrito Fictício',guardianName:'Responsável Fictício',birthDate:'2015-01-01',unit:'amavale',guardianEmail:'guardian@example.test',guardianPhone:'24999999999',relationship:'Mãe',participationConsent:'on',medicalConsent:'on',dataConsent:'on',requestId:id}))form.set(k,v);
 for(const key of ['studentDocument','guardianDocument','medicalCertificate'])form.set(key,new Blob(['%PDF-1.7 teste'],{type:'application/pdf'}),'teste.pdf');form.set('photo',new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'}),'teste.jpg');
 const r=await handleRegistration(new Request(env.PUBLIC_ORIGIN+'/api/registrations',{method:'POST',headers:{origin:env.PUBLIC_ORIGIN},body:form}),env,async()=>{throw Error('fake provider outage')},store);assert.equal(r.status,200);
 const reg=(await (await request('/registrations/'+id)).json()).registration;assert.equal(reg.documents.length,4);assert.equal(reg.documents[0].object_path,undefined);
 assert.equal((await request('/registrations/'+id+'/review',{method:'POST',data:{version:1,decision:'approved',reason:'',checked:false}})).status,400);
 const approved=await request('/registrations/'+id+'/review',{method:'POST',data:{version:1,decision:'approved',reason:'',checked:true}});assert.equal(approved.status,200);assert.equal((await approved.json()).student_id,'UND1_000001');
 assert.equal((await (await request('/students/UND1_000001/documents')).json()).documents.length,4);
});
test('Servidor HTTP: páginas, scripts e privacidade dos arquivos internos',async t=>{
 const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,PORT:'0',HOST:'127.0.0.1',PORTAL_DATA_DIR:'',PORTAL_SECRET:''},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());let output='';const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);child.on('error',reject);child.stdout.on('data',b=>{output+=b;const m=output.match(/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(m[1])}})});
 const base='http://127.0.0.1:'+port;
 for(const route of ['/','/agendamento/','/inscricao/','/patrocinar/','/portal/','/administracao/','/portal/portal.js','/portal/admin.js','/portal/portal.css']){const r=await fetch(base+route);assert.equal(r.status,200,route);if(route==='/administracao/')assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/)}
 for(const route of ['/server.mjs','/.env','/portal.sqlite','/data/approved-students.json','/objects/file.pdf','/%2e%2e%2fserver.mjs'])assert.notEqual((await fetch(base+route)).status,200,route);
 assert.deepEqual(await (await fetch(base+'/api/health')).json(),{ok:true});assert.equal((await fetch(base+'/api/portal/students')).status,503);
 child.kill();await once(child,'exit');
});
