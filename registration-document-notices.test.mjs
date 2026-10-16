import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID,randomBytes,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';import {persistRegistration} from './registration-persistence.mjs';import {completeRegistrationAttachments} from './registration-fixtures.mjs';import {registrationDocumentNotices,DOCUMENT_NOTICE_FROM} from './registration-document-notices.mjs';

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-document-notices-')),env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'fake-document-notices-'.repeat(3),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',RESEND_API_KEY:'fake',MAIL_FROM:'other@example.test',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false'},calls=[];
 let now=Date.parse('2026-10-15T11:00:00Z'),send=async()=>Response.json({id:'provider-fixture'});
 const transport=async(url,options)=>{calls.push({url,headers:options.headers,body:JSON.parse(options.body),raw:options.body});return send(url,options)};
 const store=createSqliteStore(env,{transport}),db=new DatabaseSync(path.join(dir,'portal.sqlite')),admin=(await store.members())[0];
 t.after(()=>{db.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-document-notices-')));fs.rmSync(dir,{recursive:true,force:true})});
 const members={admin};
 for(const [key,units]of [['local',['amavale']],['other',['valparaiso']],['general',['amavale','valparaiso','vale-do-carangola']]])members[key]=await store.saveStaffAccount(admin.user_id,null,{name:'Secretaria Fictícia '+key,email:key+'@example.test',phone:'24999999999',role:'secretary',secretary_level:key==='general'?'general':'local',active:true,units,version:0});
 members.guardian=await store.provision('guardian@example.test','guardian');
 const tokens={};for(const [key,m]of Object.entries(members)){const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),m.user_id,Date.now()+3600000);tokens[key]=token;}
 const req=(route,{as='admin',method='GET',form,data}={})=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,...(as?{Authorization:'Bearer '+tokens[as]}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)}),env,store);
 const create=async(unit='amavale',complete=false)=>{const row={id:randomUUID(),student_name:unit==='amavale'?'Aluno Fictício A':'Aluno Fictício B',birth_date:'2017-01-01',unit,guardian_name:'Responsável Fictício',guardian_email:'private@example.test',guardian_phone:'24999999999',relationship:'Mãe'};await persistRegistration(store,row,completeRegistrationAttachments().filter(d=>complete||!['photo.jpg','medicalCertificate.pdf'].includes(d.filename)));return row.id;};
 const get=(sql,...p)=>db.prepare(sql).get(...p),all=(sql,...p)=>db.prepare(sql).all(...p),run=(sql,...p)=>db.prepare(sql).run(...p),tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}};
 const requireRole=(actor,roles)=>{const m=get('SELECT * FROM members WHERE user_id=? AND active=1',actor);if(!m||!roles.includes(m.role))throw Object.assign(Error('Denied'),{status:403});return m};
 const scope={units:actor=>all('SELECT unit FROM administrative_units WHERE user_id=? ORDER BY unit',actor).map(r=>r.unit)};
 const make=()=>registrationDocumentNotices({db,get,all,run,tx,requireRole,scope,env,transport,clock:()=>now});
 const notices=make(),onlyLocal=()=>run("UPDATE members SET active=0 WHERE role='secretary' AND user_id<>?",members.local.user_id);
 return {dir,env,store,db,admin,members,calls,req,create,get,all,run,make,notices,onlyLocal,setSend:fn=>send=fn,setTime:value=>now=Date.parse(value),advance:ms=>now+=ms};
}

test('Documentos: diário às 8h de Brasília, núcleos corretos, remetente, links, vínculo e exclusão de fichas completas',async t=>{
 const f=await fixture(t),a=await f.create(),b=await f.create('valparaiso');await f.create('vale-do-carangola',true);
 await f.store.import(f.admin.user_id,[{id:'UND1_000011',name:'ALUNO FICTICIO A',birth_date:'2017-01-01',status:'approved',version:0}]);
 f.setTime('2026-10-15T10:59:59Z');await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,0);
 f.advance(1000);await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,3);
 const local=f.calls.find(c=>c.body.to[0]==='local@example.test').body,general=f.calls.find(c=>c.body.to[0]==='general@example.test').body,other=f.calls.find(c=>c.body.to[0]==='other@example.test').body;
 for(const mail of [local,general,other]){assert.equal(mail.from,DOCUMENT_NOTICE_FROM);assert.match(mail.text,/Atestado médico; Foto de registro/);assert.doesNotMatch(mail.text,/private@example|24999999999|2017-01-01|object_path/);}
 assert.match(local.text,new RegExp('protocol='+a));assert.doesNotMatch(local.text,new RegExp(b));assert.match(local.text,/UND1_000011/);assert.match(general.text,new RegExp(a));assert.match(general.text,new RegExp(b));assert.doesNotMatch(other.text,new RegExp(a));
 await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,3);f.advance(86400000);await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,6);
});

test('Documentos: falha transitória persiste, retoma sem duplicar, congela chave e conteúdo e mostra aceitação sem afirmar entrega',async t=>{
 const f=await fixture(t);f.onlyLocal();await f.create();f.setSend(async()=>Response.json({error:'do not expose'},{status:503}));
 await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);let status=await f.notices.registrationDocumentNotificationStatus(f.members.local.user_id);assert.equal(status.recipients[0].latest.state,'pending');assert.equal(status.recipients[0].latest.attempts,1);
 await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);f.advance(300000);f.setSend(async()=>Response.json({id:'accepted-fixture'}));await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,2);assert.equal(f.calls[0].raw,f.calls[1].raw);assert.equal(f.calls[0].headers['Idempotency-Key'],f.calls[1].headers['Idempotency-Key']);
 status=await f.notices.registrationDocumentNotificationStatus(f.members.local.user_id);assert.equal(status.recipients[0].latest.state,'accepted');assert.ok(status.recipients[0].latest.accepted_at);assert.equal(status.recipients[0].latest.delivered,undefined);
});

test('Documentos: duas execuções concorrentes não enviam duas vezes; lease expirado retoma o mesmo aviso',async t=>{
 const f=await fixture(t);f.onlyLocal();await f.create();let resolve;f.setSend(()=>new Promise(r=>resolve=r));const first=f.notices.deliverRegistrationDocumentNotices();await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);resolve(Response.json({id:'accepted-fixture'}));await first;
 f.advance(86400000);f.setSend(async()=>{throw Error('Timeout fictício')});await f.notices.deliverRegistrationDocumentNotices();const previous=f.calls.at(-1);f.run("UPDATE registration_document_outbox SET state='sending',lease_until=?,next_attempt=0 WHERE day='2026-10-16'",Date.parse('2026-10-16T11:02:00Z'));f.advance(180000);f.setSend(async()=>Response.json({id:'accepted-fixture'}));await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.at(-1).headers['Idempotency-Key'],previous.headers['Idempotency-Key']);assert.equal(f.calls.at(-1).raw,previous.raw);
});

test('Documentos: regularização via formulário encerra avisos; aprovação não produz novos lembretes',async t=>{
 const f=await fixture(t);f.onlyLocal();const id=await f.create();await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);
 let r=await f.store.registration(id);assert.equal((await f.req('/registrations/'+id+'/review',{method:'POST',data:{version:r.version,decision:'needs_info',reason:'Enviar anexos fictícios'}})).status,200);
 for(const kind of ['photo','medical_certificate']){r=await f.store.registration(id);const form=new FormData();form.set('version',r.version);form.set('kind',kind);form.set('file',new Blob([kind==='photo'?new Uint8Array([255,216,255,0]):'%PDF-1.7 FICTICIO'],{type:kind==='photo'?'image/jpeg':'application/pdf'}),kind==='photo'?'test.jpg':'test.pdf');assert.equal((await f.req('/registrations/'+id+'/documents',{method:'POST',form})).status,201);}
 f.advance(86400000);await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);r=await f.store.registration(id);assert.equal((await f.req('/registrations/'+id+'/review',{method:'POST',data:{version:r.version,decision:'approved',reason:'',checked:true}})).status,200);f.advance(86400000);await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);
});

test('Documentos: desativação, troca de email, mudança de núcleo ou correção da pendência cancelam retries privados',async t=>{
 for(const change of ['inactive','email','unit','documents','rejected']){await t.test(change,async t=>{const f=await fixture(t);f.onlyLocal();const id=await f.create();f.setSend(async()=>{throw Error('Timeout')});await f.notices.deliverRegistrationDocumentNotices();
  if(change==='inactive')f.run('UPDATE members SET active=0 WHERE user_id=?',f.members.local.user_id);
  if(change==='email')f.run('UPDATE members SET email=? WHERE user_id=?','new@example.test',f.members.local.user_id);
  if(change==='unit')f.run('UPDATE administrative_units SET unit=? WHERE user_id=?','valparaiso',f.members.local.user_id);
  if(change==='documents'){const r=await f.store.registration(id);f.run('UPDATE registrations SET documents=? WHERE id=?',JSON.stringify([...r.documents,{kind:'photo'}]),id);}
  if(change==='rejected')await f.store.reviewRegistration(f.admin.user_id,id,{version:1,decision:'rejected',reason:'Não aprovado fictício'});
  f.advance(300000);await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);assert.equal(f.get('SELECT state FROM registration_document_outbox').state,'cancelled');
 });}
});

test('Documentos: falha permanente, tentativas limitadas e virada de dia não disparam envio antigo',async t=>{
 const f=await fixture(t);f.onlyLocal();await f.create();f.setSend(async()=>Response.json({error:'private-provider-body'},{status:422}));await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.get('SELECT state FROM registration_document_outbox').state,'failed');f.advance(300000);await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,1);
 f.advance(86400000);f.setSend(async()=>Response.json({}, {status:503}));await f.notices.deliverRegistrationDocumentNotices();f.run("UPDATE registration_document_outbox SET attempts=8,next_attempt=0 WHERE state='pending'");await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,2);assert.equal(f.get("SELECT state FROM registration_document_outbox WHERE day='2026-10-16'").state,'needs_attention');
 f.advance(86400000);await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,3);f.setTime('2026-10-18T03:01:00Z');await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,3);assert.equal(f.get("SELECT state FROM registration_document_outbox WHERE day='2026-10-17'").state,'cancelled');
});

test('Documentos: API de situação exige autenticação e limita a secretaria à própria conta, sem permitir disparo por GET/POST',async t=>{
 const f=await fixture(t);await f.create();await f.create('valparaiso');await f.notices.deliverRegistrationDocumentNotices();
 for(const as of ['admin','local','general','other']){const res=await f.req('/registration-document-notices',{as});assert.equal(res.status,200);assert.equal(res.headers.get('Cache-Control'),'no-store');const p=await res.json();assert.equal(p.recipients.length,as==='admin'?3:1);if(as==='local'){assert.deepEqual(p.recipients[0].units,['amavale']);assert.equal(p.recipients[0].email,'local@example.test');}assert.doesNotMatch(JSON.stringify(p),/Aluno Fictício|private@example|payload|provider-fixture/);}
 assert.equal((await f.req('/registration-document-notices',{as:''})).status,401);assert.equal((await f.req('/registration-document-notices',{as:'guardian'})).status,403);assert.equal((await f.req('/registration-document-notices',{method:'POST',data:{}})).status,404);assert.equal(f.calls.length,3);
});

test('Documentos: sem serviço configurado não cria fila nem afirma envio bem-sucedido',async t=>{
 const f=await fixture(t);await f.create();delete f.env.RESEND_API_KEY;await f.notices.deliverRegistrationDocumentNotices();assert.equal(f.calls.length,0);assert.equal(f.all('SELECT * FROM registration_document_outbox').length,0);assert.equal((await f.notices.registrationDocumentNotificationStatus(f.admin.user_id)).configured,false);
});


test('Documentos: cota não esgota tentativas; resumo vencido é substituído e segue apenas para as duas secretarias autorizadas',async t=>{
 const f=await fixture(t);await f.create();f.setSend(async()=>Response.json({name:'daily_quota_exceeded'},{status:429}));await f.notices.deliverRegistrationDocumentNotices();
 assert.equal(f.calls.length,2);assert.ok(f.all('SELECT * FROM registration_document_outbox').every(n=>n.state==='pending'&&n.attempts===0&&n.first_attempt===null&&n.last_status===429));
 f.advance(300000);await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,2);
 f.setTime('2026-10-16T11:00:00Z');f.setSend(async()=>Response.json({id:'accepted-after-quota'}));await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,4);
 assert.equal(f.all("SELECT * FROM registration_document_outbox WHERE state='cancelled'").length,2);assert.equal(f.all("SELECT * FROM registration_document_outbox WHERE state='accepted'").length,2);
 assert.deepEqual(new Set(f.calls.slice(2).map(c=>c.body.to[0])),new Set(['local@example.test','general@example.test']));await f.make().deliverRegistrationDocumentNotices();assert.equal(f.calls.length,4);
});
