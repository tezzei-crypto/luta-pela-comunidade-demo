import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handleMetrics} from './metrics-handler.mjs';
import {handlePortal} from './portal-handler.mjs';
import {persistRegistration} from './registration-persistence.mjs';
const pupil={id:'UND1_000079',name:'Aluno Fictício',birth_date:'2014-01-01',status:'approved',version:0};
async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-admin-test-')),mail=[];
 const env={PORTAL_DATA_DIR:root,PORTAL_SECRET:'test-secret-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',RESEND_API_KEY:'not-real',MAIL_FROM:'test@example.test',METRICS_ENABLED:'true'};
 const store=createSqliteStore(env,{transport:async(url,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'fake'})}});
 t.after(()=>{try{store.close()}catch{}const absolute=path.resolve(root);if(!absolute.startsWith(path.join(os.tmpdir(),'lpc-admin-test-')))throw Error('Unsafe cleanup');fs.rmSync(absolute,{recursive:true,force:true})});
 const admin=(await store.members())[0];return {root,env,store,admin,mail};
}
const registration=()=>({id:randomUUID(),student_name:'Novo Aluno Fictício',birth_date:'2015-02-10',unit:'amavale',guardian_name:'Responsável Fictício',guardian_email:'guardian@example.test',guardian_phone:'24999999999',relationship:'Mãe'});
const attachments=()=>[{filename:'photo.jpg',content:Buffer.from([255,216,255,0]).toString('base64')},{filename:'studentDocument.pdf',content:Buffer.from('%PDF-1.7 teste').toString('base64')}];
test('SQLite: importação atômica, controle de versão e persistência em outra conexão',async t=>{
 const {store,admin,env}=await fixture(t);await store.import(admin.user_id,[pupil]);
 await assert.rejects(store.import(admin.user_id,[{...pupil,version:1,name:'Não deve persistir'},{...pupil,id:'UND1_000080',version:3}]),e=>e.status===409);
 assert.equal((await store.student(pupil.id)).name,pupil.name);
 const other=createSqliteStore(env);assert.equal((await other.student(pupil.id)).version,1);other.close();
});
test('SQLite: código de uso único, sessão revogada e ausência de cadastro público',async t=>{
 const {store,admin,mail}=await fixture(t);await store.requestCode('unknown@example.test');assert.equal(mail.length,0);
 await store.requestCode(admin.email);await store.requestCode(admin.email);assert.equal(mail.length,1);
 const code=mail[0].text.match(/\b\d{8}\b/)[0];const session=await store.verifyCode(admin.email,code);
 assert.equal((await store.user(session.access_token)).id,admin.user_id);
 await assert.rejects(store.verifyCode(admin.email,code),e=>e.status===401);
 await store.logout(session.access_token);await assert.rejects(store.user(session.access_token),e=>e.status===401);
});
test('SQLite: cinco tentativas invalidam código e desativar conta revoga sessão',async t=>{
 const {store,admin,mail}=await fixture(t);const user=await store.provision('staff@example.test','secretary');
 await store.requestCode(user.email);const code=mail[0].text.match(/\b\d{8}\b/)[0];for(let i=0;i<5;i++)await assert.rejects(store.verifyCode(user.email,'00000000'));
 await assert.rejects(store.verifyCode(user.email,code),e=>e.status===401);
 const second=await store.provision('second@example.test','guardian');await store.requestCode(second.email);const session=await store.verifyCode(second.email,mail[1].text.match(/\b\d{8}\b/)[0]);
 await store.setMember(admin.user_id,second.user_id,'guardian',false);await assert.rejects(store.user(session.access_token));
});
test('SQLite: aprovação exige conferência, mantém sequência e não duplica no reenvio',async t=>{
 const {store,admin}=await fixture(t);await store.import(admin.user_id,[pupil]);const r=registration();
 await persistRegistration(store,r,attachments());await persistRegistration(store,r,attachments());assert.equal((await store.registrations('pending')).length,1);
 await assert.rejects(store.reviewRegistration(admin.user_id,r.id,{version:1,decision:'approved',reason:'',checked:false}));
 const result=await store.reviewRegistration(admin.user_id,r.id,{version:1,decision:'approved',reason:'Documentos conferidos',checked:true});assert.equal(result.student_id,'UND1_000080');assert.equal((await store.documents(result.student_id)).length,2);
 await assert.rejects(store.reviewRegistration(admin.user_id,r.id,{version:1,decision:'approved',reason:'',checked:true}),e=>e.status===409);
 assert.equal((await store.students()).length,2);assert.equal((await store.auditLog()).filter(a=>a.action.startsWith('registration.approved')).length,1);
});
test('SQLite: duplicata exige vínculo explícito e lote com documento inválido reverte aprovação',async t=>{
 const {store,admin}=await fixture(t),r=registration();await store.import(admin.user_id,[{...pupil,name:r.student_name,birth_date:r.birth_date}]);await persistRegistration(store,r,attachments());
 await assert.rejects(store.reviewRegistration(admin.user_id,r.id,{version:1,decision:'approved',reason:'',checked:true}),e=>e.status===409);
 assert.equal((await store.reviewRegistration(admin.user_id,r.id,{version:1,decision:'approved',reason:'Mesmo aluno conferido',checked:true,existing_student_id:pupil.id})).student_id,pupil.id);
 const bad={...registration(),student_name:'Outra Pessoa Fictícia',payload_hash:'test',consent_version:'test',documents:[{id:randomUUID(),object_path:'duplicate',kind:'photo',original_name:'a',mime:'image/jpeg',size:1},{id:randomUUID(),object_path:'duplicate',kind:'photo',original_name:'b',mime:'image/jpeg',size:1}]};
 await store.receiveRegistration(bad);await assert.rejects(store.reviewRegistration(admin.user_id,bad.id,{version:1,decision:'approved',reason:'',checked:true}));
 assert.equal((await store.students()).length,1);assert.equal((await store.registration(bad.id)).status,'pending');
});
test('SQLite: responsável não aprova nem altera identificação; secretaria não concede função',async t=>{
 const {store,admin}=await fixture(t);await store.import(admin.user_id,[pupil]);const guardian=await store.provision('guardian@example.test','guardian'),secretary=await store.provision('secretary@example.test','secretary');
 await assert.rejects(store.update(guardian.user_id,{...pupil,version:1}),e=>e.status===403);await store.link(admin.user_id,guardian.user_id,pupil.id);
 await assert.rejects(store.update(guardian.user_id,{...pupil,version:1,status:'inactive'}),e=>e.status===403);
 await assert.rejects(store.setMember(secretary.user_id,guardian.user_id,'admin',true),e=>e.status===403);
 await assert.rejects(store.reviewRegistration(guardian.user_id,randomUUID(),{}),e=>e.status===403);
});
test('Métricas: permissão, escopo público, deduplicação e agregação real',async t=>{
 const {store,admin,env}=await fixture(t);const event={eventId:randomUUID(),sessionId:randomUUID(),visitorId:randomUUID(),page:'/',consent:true};
 const send=(body=event,headers={})=>handleMetrics(new Request('https://example.test/api/metrics',{method:'POST',headers:{origin:'https://example.test','user-agent':'Mozilla/5.0','Content-Type':'application/json',...headers},body:JSON.stringify(body)}),env,store);
 assert.equal((await send({...event,consent:false})).status,400);assert.equal((await send({...event,page:'/portal/'})).status,400);assert.equal((await send({...event,name:'PII'})).status,400);
 assert.equal((await send(event,{'sec-gpc':'1'})).status,204);assert.equal((await store.dashboard(admin.user_id,30)).traffic.pageviews,0);
 await send();await send();await send({...event,eventId:randomUUID(),page:'/inscricao/'});
 const result=await store.dashboard(admin.user_id,30);assert.deepEqual([result.traffic.pageviews,result.traffic.sessions,result.traffic.visitors],[2,1,1]);assert.equal(result.daily.length,1);
 const secretary=await store.provision('secretary@example.test','secretary');assert.equal((await store.dashboard(secretary.user_id,30)).traffic.pageviews,2);
});
test('API: responsável não acessa painel, inscrições, auditoria ou métricas',async t=>{
 const {store,env,mail}=await fixture(t);await store.provision('guardian@example.test','guardian');await store.requestCode('guardian@example.test');const session=await store.verifyCode('guardian@example.test',mail[0].text.match(/\b\d{8}\b/)[0]);
 for(const endpoint of ['/dashboard','/registrations','/audit']){const r=await handlePortal(new Request('https://example.test/api/portal'+endpoint,{headers:{Authorization:'Bearer '+session.access_token}}),env,store);assert.equal(r.status,403)}
});
test('Backup SQLite consistente e caminhos privados não escapam da pasta',async t=>{
 const {store,admin}=await fixture(t);await store.import(admin.user_id,[pupil]);const file=await store.backup(),db=new DatabaseSync(file,{readOnly:true});assert.equal(db.prepare('SELECT count(*) AS n FROM students').get().n,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');db.close();
 await assert.rejects(store.upload('../outside',Buffer.from('x')));await assert.rejects(store.download('/../../outside'));
});
