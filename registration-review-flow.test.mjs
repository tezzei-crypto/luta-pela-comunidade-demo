import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';
import {handleRegistration} from './registration-handler.mjs';import {persistRegistration} from './registration-persistence.mjs';
import {registrationReadiness} from './registration-readiness.mjs';import {registrationNotices} from './registration-notices.mjs';
import {completeRegistrationAttachments} from './registration-fixtures.mjs';

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-registration-review-')),env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'fixture-only-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',PORTAL_INTAKE_ACTIVE:'true',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false'};
 const store=createSqliteStore(env,{transport:async()=>{throw Error('Unexpected external transport in test')}}),db=new DatabaseSync(path.join(dir,'portal.sqlite')),admin=(await store.members())[0];
 t.after(()=>{db.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-registration-review-')));fs.rmSync(dir,{recursive:true,force:true})});
 const tokenFor=m=>{const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),m.user_id,Date.now()+3600000);return token};
 const tokens={admin:tokenFor(admin)};
 for(const [key,units]of [['local',['amavale']],['other',['valparaiso']],['general',['amavale','valparaiso','vale-do-carangola']]]){const m=await store.saveStaffAccount(admin.user_id,null,{name:'Secretaria Fictícia',email:key+'@example.test',phone:'24999999999',role:'secretary',secretary_level:key==='general'?'general':'local',active:true,units,version:0});tokens[key]=tokenFor(m);}
 const req=(route,{as='admin',method='GET',data,form}={})=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,...(as?{Authorization:'Bearer '+tokens[as]}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)}),env,store);
 const fields=(id=randomUUID())=>({id,student_name:'Candidato Fictício',birth_date:'2017-01-01',unit:'amavale',guardian_name:'Responsável Fictício',guardian_email:'guardian@example.test',guardian_phone:'24999999999',relationship:'Mãe'});
 const create=async(attachments=completeRegistrationAttachments())=>{const row=fields();await persistRegistration(store,row,attachments);return row.id;};
 let now=Date.now();const notices=registrationNotices({db,get:(sql,...p)=>db.prepare(sql).get(...p),all:(sql,...p)=>db.prepare(sql).all(...p),run:(sql,...p)=>db.prepare(sql).run(...p),tx:fn=>{db.exec('BEGIN IMMEDIATE');try{const v=fn();db.exec('COMMIT');return v}catch(e){db.exec('ROLLBACK');throw e}},env,clock:()=>now});
 return {dir,env,store,db,admin,req,fields,create,notices,advance:ms=>now+=ms};
}

test('Inscrição: protocolo encontra ficha independentemente da lista; documentos públicos podem ser baixados pela secretaria do núcleo',async t=>{
 const f=await fixture(t),id=await f.create();
 for(const as of ['admin','local','general']){
  const response=await f.req('/registrations/'+id.toUpperCase(),{as});assert.equal(response.status,200);
  const r=(await response.json()).registration;assert.equal(r.student_name,'Candidato Fictício');assert.equal(r.readiness.online_consent,true);assert.equal(r.readiness.ready,true);assert.equal(r.payload_hash,undefined);
  for(const doc of r.documents){assert.equal(doc.object_path,undefined);const download=await f.req('/registrations/'+id+'/documents/'+doc.id,{as});assert.equal(download.status,200);assert.match(download.headers.get('Cache-Control'),/no-store/);assert.ok((await download.arrayBuffer()).byteLength>0);}
 }
 const docs=(await f.store.registration(id)).documents;
 for(const route of ['/registrations/'+id,'/registrations/'+id+'/documents/'+docs[0].id]){assert.equal((await f.req(route,{as:'other'})).status,403);assert.equal((await f.req(route,{as:''})).status,401);}
 assert.equal((await f.req('/registrations/'+randomUUID())).status,404);
 await f.req('/registrations/'+id+'/review',{method:'POST',data:{version:1,decision:'needs_info',reason:'Complementação fictícia'}});
 assert.equal((await (await f.req('/registrations?status=pending')).json()).registrations.length,0);
 assert.equal((await (await f.req('/registrations/'+id)).json()).registration.status,'needs_info');
});

test('Inscrição: impede aprovação incompleta; complementação, envio documental e aprovação são atômicos e auditados',async t=>{
 const f=await fixture(t),id=await f.create(completeRegistrationAttachments().filter(d=>!['photo.jpg','medicalCertificate.pdf'].includes(d.filename))),review={version:1,decision:'approved',reason:'',checked:true};
 let r=(await(await f.req('/registrations/'+id)).json()).registration;assert.deepEqual(r.readiness.missing,['Atestado médico','Foto de registro']);
 const refused=await f.req('/registrations/'+id+'/review',{method:'POST',data:review});assert.equal(refused.status,400);assert.match((await refused.json()).message,/Atestado médico/);assert.equal((await f.store.students()).length,0);
 assert.equal((await f.req('/registrations/'+id+'/review',{method:'POST',data:{...review,decision:'needs_info',reason:'Enviar foto e atestado fictícios'}})).status,200);
 for(const kind of ['medical_certificate','photo']){r=await f.store.registration(id);const form=new FormData();form.set('version',r.version);form.set('kind',kind);form.set('file',new Blob([kind==='photo'?new Uint8Array([255,216,255,0]):'%PDF-1.7 FICTICIO'],{type:kind==='photo'?'image/jpeg':'application/pdf'}),kind==='photo'?'fixture.jpg':'fixture.pdf');assert.equal((await f.req('/registrations/'+id+'/documents',{method:'POST',form})).status,201);}
 assert.equal((await f.req('/registrations/'+id+'/review',{method:'POST',data:review})).status,409);
 r=await f.store.registration(id);const approved=await f.req('/registrations/'+id+'/review',{method:'POST',data:{...review,version:r.version}});assert.equal(approved.status,200);const sid=(await approved.json()).student_id;
 assert.equal((await f.store.documents(sid)).length,4);assert.equal((await f.store.students()).length,1);
 assert.equal((await f.req('/registrations/'+id+'/review',{method:'POST',data:{...review,version:r.version}})).status,409);
 assert.equal((await f.store.auditLog()).filter(e=>e.action==='registration.approved:'+id).length,1);
});

test('Inscrição: autorização eletrônica não se confunde com arquivo; cadastro administrativo exige comprovação',()=>{
 const docs=completeRegistrationAttachments();assert.equal(docs.length,4);
 const base={source:'staff',consent_version:'Texto administrativo',documents:['student_document','guardian_document','medical_certificate','photo'].map(kind=>({kind}))};
 assert.equal(registrationReadiness(base).ready,false);assert.equal(registrationReadiness({...base,documents:[...base.documents,{kind:'consent'}]}).ready,true);
 assert.equal(registrationReadiness({...base,source:'website',consent_version:'2026-10-07-portal'}).online_consent,true);
 assert.equal(registrationReadiness({...base,source:'website',consent_version:'texto desconhecido'}).online_consent,false);
});

test('Inscrição: vincular aluno existente conserva ID e função de equipe do responsável',async t=>{
 const f=await fixture(t),row={...f.fields(),guardian_email:'local@example.test'};
 await f.store.import(f.admin.user_id,[{id:'UND1_000011',name:row.student_name,birth_date:row.birth_date,status:'approved',version:0}]);
 await persistRegistration(f.store,row,completeRegistrationAttachments());
 const decision={version:1,decision:'approved',reason:'Identidade fictícia conferida',checked:true};
 assert.equal((await f.req('/registrations/'+row.id+'/review',{method:'POST',data:decision})).status,409);
 const saved=await f.req('/registrations/'+row.id+'/review',{as:'local',method:'POST',data:{...decision,existing_student_id:'UND1_000011'}});assert.equal(saved.status,200);assert.equal((await saved.json()).student_id,'UND1_000011');
 assert.equal((await f.store.students()).length,1);const member=(await f.store.members()).find(m=>m.email===row.guardian_email);assert.equal(member.role,'secretary');assert.deepEqual(await f.store.administrativeScope(member.user_id),['amavale']);
 assert.equal((await f.req('/me',{as:'local'})).status,200);
});

test('Aviso de inscrição: fila sobrevive conexão nova, repete mesmo conteúdo e chave após falha, não duplica após aceitação',async t=>{
 const f=await fixture(t),id=await f.create(),calls=[],send=async(u,o)=>{calls.push(o);return calls.length===1?Response.json({}, {status:503}):Response.json({id:'accepted-fixture'})};
 assert.equal((await f.notices.deliver({id,send})).failed,1);assert.equal(f.notices.status(id).state,'pending');
 assert.equal((await f.notices.deliver({id,send})).accepted,0);f.advance(300001);
 const second=createSqliteStore(f.env);try{assert.equal((await second.registration(id)).notification.attempts,1);}finally{second.close()}
 assert.equal((await f.notices.deliver({id,send})).accepted,1);assert.equal(f.notices.status(id).state,'accepted');
 assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);
 const mail=JSON.parse(calls[0].body);assert.match(mail.text,new RegExp('#registrations-area\\?protocol='+id));assert.equal(mail.attachments,undefined);assert.doesNotMatch(mail.text,/Candidato Fictício|guardian@example|249999/);
 f.advance(86400000);await f.notices.deliver({id,send});assert.equal(calls.length,2);
});

test('Aviso de inscrição: concorrência, limite de 23h e falhas permanentes não disparam duplicatas',async t=>{
 const f=await fixture(t),id=await f.create();let release,calls=0;const gate=new Promise(r=>release=r),send=async()=>{calls++;await gate;throw Error('Unknown acceptance')};
 const first=f.notices.deliver({id,send});await f.notices.deliver({id,send});assert.equal(calls,1);release();await first;
 f.advance(23*3600000);await f.notices.deliver({id,send:async()=>assert.fail('Do not resend outside key lifetime')});assert.equal(f.notices.status(id).state,'needs_attention');
 const other=await f.create();await f.notices.deliver({id:other,send:async()=>Response.json({}, {status:403})});assert.equal(f.notices.status(other).state,'failed');
 f.advance(300001);await f.notices.deliver({id:other,send:async()=>assert.fail('Do not retry permanent failure')});
});

test('Inscrição: confirmação persiste na falha do email; repetição não cria novo aluno, documentos ou aviso',async t=>{
 const f=await fixture(t),id=randomUUID(),make=()=>{const form=new FormData();for(const [k,v]of Object.entries({studentName:'Candidato Fictício',birthDate:'2017-01-01',unit:'amavale',guardianName:'Responsável Fictício',guardianEmail:'guardian@example.test',guardianPhone:'24999999999',relationship:'Mãe',participationConsent:'on',medicalConsent:'on',dataConsent:'on',requestId:id.toUpperCase()}))form.set(k,v);return form;};let calls=0;
 const send=async()=>{calls++;return Response.json({}, {status:500})},request=()=>new Request(f.env.PUBLIC_ORIGIN+'/api/registrations',{method:'POST',headers:{Origin:f.env.PUBLIC_ORIGIN},body:make()});
 for(let i=0;i<2;i++){const response=await handleRegistration(request(),f.env,send,f.store);assert.equal(response.status,200);assert.equal((await response.json()).protocol,id);}
 assert.equal(calls,1);assert.equal((await f.store.registrations('pending')).length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM registration_notification_outbox').get().n,1);
});
