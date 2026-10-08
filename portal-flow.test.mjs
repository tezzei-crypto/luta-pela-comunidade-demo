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
 const env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'only-tests-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test',PUBLIC_ORIGIN:'https://example.test',PORTAL_INTAKE_ACTIVE:'true'};
 const store=createSqliteStore(env,{transport:async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'fake'})}});
 t.after(()=>{store.close();if(!dir.startsWith(path.join(os.tmpdir(),'lpc-flow-')))throw Error('Unsafe test cleanup');fs.rmSync(dir,{recursive:true,force:true})});
 async function login(email){await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token}
 const token=await login(env.BOOTSTRAP_ADMIN_EMAIL),admin=(await store.members())[0];
 function request(route,{token:tkn=token,method='GET',data,form}={}){return handlePortal(new Request('https://example.test/api/portal'+route,{method,headers:{origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+tkn,...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)}),env,store)}
 return {env,store,admin,request,login};
}
test('Fluxo integrado: CSV, ficha, medidas, documentos privados e logout',async t=>{
 const {request,store,admin}=await fixture(t);await store.import(admin.user_id,[pupil]);
 const preview=await request('/import/preview',{method:'POST',data:{csv:csv([{...pupil,version:1}])}});assert.equal(preview.status,200);
 const commit=await request('/import/commit',{method:'POST',data:{token:(await preview.json()).token}});assert.equal(commit.status,200);
 const profile=(await (await request('/students/'+pupil.id)).json()).student;assert.equal(profile.name,pupil.name);assert.equal(typeof profile.age,'number');
 assert.equal((await request('/students/'+pupil.id,{method:'PATCH',data:{version:2,weight_kg:'32,5',height_cm:142,kimono:'M2'}})).status,200);
 const file=new FormData();file.set('kind','report_card');file.set('file',new Blob(['%PDF-1.7\nfictitious test\n%%EOF'],{type:'application/pdf'}),'boletim-teste.pdf');
 const uploaded=await request('/students/'+pupil.id+'/documents',{method:'POST',form:file});assert.equal(uploaded.status,201);const id=(await uploaded.json()).id;
 const docs=await (await request('/students/'+pupil.id+'/documents')).json();assert.equal(docs.documents.length,1);assert.equal(docs.documents[0].object_path,undefined);
 const download=await request('/documents/'+id+'/download');assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/^attachment/);assert.match(await download.text(),/fictitious test/);
 const exported=parseCsv(await (await request('/export.csv')).text());assert.equal(exported[0].weight_kg,32.5);assert.equal(exported[0].version,3);
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
 // The isolated loopback server must not inherit production hosts from Render's build environment.
 const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,PORT:'0',HOST:'127.0.0.1',PORTAL_DATA_DIR:'',PORTAL_SECRET:'',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:'',ADDITIONAL_PUBLIC_ORIGINS:'',RENDER:'false'},stdio:['ignore','pipe','pipe']});
 t.after(()=>child.kill());let output='';const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Server timeout')),10000);child.on('error',reject);child.stdout.on('data',b=>{output+=b;const m=output.match(/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timer);resolve(m[1])}})});
 const base='http://127.0.0.1:'+port;
 for(const route of ['/','/agendamento/','/inscricao/','/patrocinar/','/portal/','/administracao/','/portal/portal.js','/portal/admin.js','/portal/portal.css']){const r=await fetch(base+route);assert.equal(r.status,200,route);if(route==='/administracao/')assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/)}
 for(const route of ['/server.mjs','/.env','/portal.sqlite','/data/approved-students.json','/objects/file.pdf','/%2e%2e%2fserver.mjs'])assert.notEqual((await fetch(base+route)).status,200,route);
 assert.deepEqual(await (await fetch(base+'/api/health')).json(),{ok:true});assert.equal((await fetch(base+'/api/portal/students')).status,503);
 child.kill();await once(child,'exit');
});

test('Chamada: aula única, estados explícitos, conflito de versão e CSV',async t=>{
 const {request,store,admin}=await fixture(t);await store.import(admin.user_id,[pupil]);
 const data={unit:'amavale',day:'2020-01-01',time:'18:00',label:'Jiu-Jitsu de teste'};
 const lesson=(await (await request('/classes',{method:'POST',data})).json()).lesson;
 assert.equal((await (await request('/classes',{method:'POST',data})).json()).lesson.id,lesson.id);
 const route='/classes/'+lesson.id+'/attendance';let rows=(await (await request(route)).json()).students;assert.equal(rows[0].status,'unmarked');
 assert.equal((await request(route,{method:'POST',data:{rows:[{id:pupil.id,status:'present',version:0}]}})).status,200);
 assert.equal((await request(route,{method:'POST',data:{rows:[{id:pupil.id,status:'absent',version:0}]}})).status,409);
 assert.equal((await request(route,{method:'POST',data:{rows:[{id:pupil.id,status:'justified',version:1}]}})).status,200);
 const exported=await request('/attendance.csv?unit=amavale&from=2020-01-01&to=2020-12-31');assert.equal(exported.status,200);assert.match(await exported.text(),/justified/);
 rows=(await (await request(route)).json()).students;assert.equal(rows[0].version,2);assert.equal(rows[0].status,'justified');
});
test('Chamada: bloqueia outra unidade, data futura e responsáveis',async t=>{
 const {request,store,admin,login}=await fixture(t);await store.import(admin.user_id,[pupil,{...pupil,id:'UND2_000001'}]);
 const lesson=(await (await request('/classes',{method:'POST',data:{unit:'amavale',day:'2020-01-01',time:'18:00',label:'Aula teste'}})).json()).lesson;
 const route='/classes/'+lesson.id+'/attendance';assert.equal((await request(route,{method:'POST',data:{rows:[{id:'UND2_000001',status:'present',version:0}]}})).status,403);
 const future=(await (await request('/classes',{method:'POST',data:{unit:'amavale',day:'2099-01-01',time:'18:00',label:'Aula futura'}})).json()).lesson;
 assert.equal((await request('/classes/'+future.id+'/attendance',{method:'POST',data:{rows:[{id:pupil.id,status:'present',version:0}]}})).status,400);
 await store.provision('guardian@example.test','guardian');const token=await login('guardian@example.test');assert.equal((await request(route,{token})).status,403);assert.equal((await request('/classes?unit=amavale',{token})).status,403);
});
test('Aprovação: email do responsável recebe vínculo e agendamento preenchido privado',async t=>{
 const {request,store,admin,login}=await fixture(t);const id=randomUUID();await store.receiveRegistration({id,payload_hash:'test',student_name:pupil.name,birth_date:pupil.birth_date,unit:'amavale',guardian_name:'Responsável Fictício',guardian_email:'guardian@example.test',guardian_phone:'24999999999',relationship:'Pai',consent_version:'test',documents:[]});
 await store.reviewRegistration(admin.user_id,id,{version:1,decision:'approved',reason:'',checked:true});const token=await login('guardian@example.test');
 const result=await request('/students/UND1_000001/appointment',{token});assert.equal(result.status,200);const data=await result.json();assert.equal(data.student.name,pupil.name);assert.equal(data.contact.guardian_name,'Responsável Fictício');assert.equal(data.contact.guardian_phone,'24999999999');
 assert.equal((await request('/students/UND1_000002/appointment',{token})).status,403);
 await store.update(admin.user_id,{...pupil,version:1,status:'inactive'});assert.equal((await request('/students/UND1_000001/appointment',{token})).status,403);
});

const teacherData={name:'Professor Fictício',email:'teacher@example.test',phone:'24999999999',belt_degree:'Preta, 2º grau',certificate_issuer:'Entidade de teste',certificate_date:'2010-01-01',first_aid_until:'',availability:'Segundas',notes:'Teste fictício',units:['amavale'],status:'pending',version:0};
async function readyTeacher(request,email=teacherData.email){
 const created=await request('/teachers',{method:'POST',data:{...teacherData,email}});assert.equal(created.status,201);let teacher=(await created.json()).teacher;
 for(const kind of ['photo','black_belt_diploma']){const form=new FormData();form.set('kind',kind);form.set('file',kind==='photo'?new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'}):new Blob(['%PDF-1.7 teste'],{type:'application/pdf'}),kind==='photo'?'foto.jpg':'diploma.pdf');assert.equal((await request('/teachers/'+teacher.user_id+'/documents',{method:'POST',form})).status,201)}
 teacher=(await (await request('/teachers/'+teacher.user_id)).json()).teacher;
 const approved=await request('/teachers/'+teacher.user_id,{method:'PATCH',data:{...teacherData,email,version:teacher.version,status:'verified',checked:true}});assert.equal(approved.status,200);return (await approved.json()).teacher;
}
test('Professor: aprovação documental, unidades limitadas e nenhuma ficha privada',async t=>{
 const {request,store,admin,login}=await fixture(t);await store.import(admin.user_id,[pupil,{...pupil,id:'UND2_000001'}]);
 const teacher=await readyTeacher(request),token=await login(teacher.email);
 assert.deepEqual((await (await request('/units',{token})).json()).units,['amavale']);
 const roster=(await (await request('/unit-roster?unit=amavale',{token})).json()).students;assert.equal(roster.length,1);assert.equal(roster[0].birth_date,undefined);assert.equal(roster[0].name,pupil.name);
 for(const route of ['/unit-roster?unit=valparaiso','/students/'+pupil.id,'/export.csv','/documents.csv','/registrations','/audit','/dashboard'])assert.equal((await request(route,{token})).status,403,route);
 assert.equal((await request('/classes',{token,method:'POST',data:{unit:'valparaiso',day:'2020-01-01',time:'18:00',label:'Aula'}})).status,403);
 const group=await store.saveGroup(admin.user_id,null,{unit:'amavale',label:'Aula vinculada',weekdays:[3],start_time:'18:00',end_time:'19:00',active:true,version:0,students:[pupil.id],teachers:[teacher.user_id]});
 const lesson=(await (await request('/classes',{token,method:'POST',data:{group_id:group.id,day:'2020-01-01'}})).json()).lesson;
 assert.equal((await request('/classes/'+lesson.id+'/attendance',{token,method:'POST',data:{rows:[{id:pupil.id,status:'present',version:0}]}})).status,200);
 const other=(await (await request('/classes',{method:'POST',data:{unit:'valparaiso',day:'2020-01-01',time:'18:00',label:'Aula'}})).json()).lesson;
 assert.equal((await request('/classes/'+other.id+'/attendance',{token})).status,403);
 assert.equal((await request('/teachers',{token,method:'POST',data:{...teacherData,email:'x@example.test'}})).status,403);
 assert.equal((await request('/members/'+teacher.user_id,{method:'PATCH',data:{role:'teacher',active:false}})).status,200);assert.equal((await request('/units',{token})).status,401);
});
test('Professor: documentos obrigatórios, versão otimista e reconferência após upload',async t=>{
 const {request,login}=await fixture(t);const r=await request('/teachers',{method:'POST',data:{...teacherData,status:'verified',checked:true}});assert.equal(r.status,400);
 let teacher=(await (await request('/teachers',{method:'POST',data:teacherData})).json()).teacher,token=await login(teacher.email);
 assert.deepEqual((await (await request('/units',{token})).json()).units,[]);
 assert.equal((await request('/teachers/'+teacher.user_id,{method:'PATCH',data:{...teacherData,version:1,status:'verified',checked:true}})).status,400);
 assert.equal((await request('/teachers/'+teacher.user_id,{method:'PATCH',data:{...teacherData,version:0}})).status,409);
 const ready=await readyTeacher(request,'second@example.test');const secondToken=await login(ready.email);
 assert.equal((await request('/teachers/'+teacher.user_id+'/documents',{token:secondToken})).status,403);
 const form=new FormData();form.set('kind','black_belt_diploma');form.set('file',new Blob(['%PDF-1.7 new'],{type:'application/pdf'}),'novo.pdf');assert.equal((await request('/teachers/'+ready.user_id+'/documents',{token:secondToken,method:'POST',form})).status,403);const uploaded=await request('/teachers/'+ready.user_id+'/documents',{method:'POST',form});assert.equal(uploaded.status,201);
 const doc=(await uploaded.json()).id;assert.equal((await request('/teacher-documents/'+doc+'/download',{token})).status,403);assert.equal((await request('/teacher-documents/'+doc+'/download',{token:secondToken})).status,403);assert.equal((await request('/teacher-documents/'+doc+'/download')).status,200);
 assert.deepEqual((await (await request('/units',{token:secondToken})).json()).units,[]);
 const documents=(await (await request('/teachers/'+ready.user_id+'/documents')).json()).documents;assert.equal(documents[0].object_path,undefined);
});
test('Relatos: protocolo idempotente, lesão vinculada, histórico e privacidade',async t=>{
 const {request,store,admin,login}=await fixture(t);await store.import(admin.user_id,[pupil,{...pupil,id:'UND2_000001'}]);const teacher=await readyTeacher(request),token=await login(teacher.email);
 const incident={id:randomUUID(),kind:'incident',unit:'amavale',occurred_at:'2020-01-01T18:30',category:'Iluminação',description:'A luz apagou durante a aula de teste.',actions:'Aula interrompida e coordenação avisada.'};
 assert.equal((await request('/reports',{token,method:'POST',data:incident})).status,201);assert.equal((await request('/reports',{token,method:'POST',data:incident})).status,201);
 assert.equal((await request('/reports',{token,method:'POST',data:{...incident,description:'Outro texto para mesmo protocolo'}})).status,409);
 assert.equal((await (await request('/reports?unit=amavale',{token})).json()).reports.length,1);
 assert.equal((await request('/reports/'+incident.id,{token,method:'POST',data:{version:1,note:'Tentativa de encerrar sozinho.',status:'closed'}})).status,403);
 assert.equal((await request('/reports/'+incident.id,{token,method:'POST',data:{version:1,note:'Coordenação informada às 18:40.',status:'open'}})).status,200);
 assert.equal((await request('/reports/'+incident.id,{method:'POST',data:{version:1,note:'Versão desatualizada.',status:'closed'}})).status,409);
 assert.equal((await request('/reports/'+incident.id,{method:'POST',data:{version:2,note:'Iluminação restabelecida e conferida.',status:'closed'}})).status,200);
 const saved=(await (await request('/reports/'+incident.id,{token})).json()).report;assert.equal(saved.description,incident.description);assert.equal(saved.updates.length,2);assert.equal(saved.request_hash,undefined);
 const injury={...incident,id:randomUUID(),kind:'injury',student_id:pupil.id,category:'Joelho',description:'Aluno informou dor após movimento. Teste fictício.',actions:'Atividade interrompida; responsável chamado.',guardian_contact:'Responsável informado pela equipe às 18:40.',referral:'Encaminhado para avaliação pelo responsável.'};assert.equal((await request('/reports',{token,method:'POST',data:injury})).status,201);
 assert.equal((await request('/reports',{token,method:'POST',data:{...injury,id:randomUUID(),student_id:'UND2_000001'}})).status,403);
 assert.equal((await request('/reports',{token,method:'POST',data:{...injury,id:randomUUID(),occurred_at:'2099-01-01T18:30'}})).status,400);
 const second=await readyTeacher(request,'second@example.test'),secondToken=await login(second.email);assert.equal((await request('/reports/'+injury.id,{token:secondToken})).status,403);
 assert.equal((await request('/reports.csv?unit=amavale',{token})).status,403);const exported=await request('/reports.csv?unit=amavale');assert.equal(exported.status,200);assert.match(await exported.text(),/Joelho/);
 await store.provision('guardian@example.test','guardian');const guardianToken=await login('guardian@example.test');assert.equal((await request('/reports/'+injury.id,{token:guardianToken})).status,403);
});
test('Migração: preserva membros, vínculos e integridade ao adicionar professor',async()=>{
 const {DatabaseSync}=await import('node:sqlite'),{migrateMembers}=await import('./portal-migrations.mjs');const db=new DatabaseSync(':memory:');
 try{db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE members(user_id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','guardian')),active INTEGER NOT NULL DEFAULT 1);CREATE TABLE sample(user_id TEXT REFERENCES members(user_id));INSERT INTO members VALUES('a','a@example.test','admin',1);INSERT INTO sample VALUES('a');`);migrateMembers(db);migrateMembers(db);db.prepare('INSERT INTO members VALUES(?,?,?,?)').run('t','t@example.test','teacher',1);assert.equal(db.prepare('SELECT count(*) AS n FROM sample JOIN members USING(user_id)').get().n,1);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1)}finally{db.close()}
});

test('Inicialização: importa uma vez, faz backup e não sobrescreve cadastro após reiniciar',async t=>{
 const {env,store,admin}=await fixture(t),{execFileSync}=await import('node:child_process');const source=path.join(env.PORTAL_DATA_DIR,'seed.csv'),contacts=path.join(env.PORTAL_DATA_DIR,'contacts.json');fs.writeFileSync(source,csv([pupil]));fs.writeFileSync(contacts,JSON.stringify([{id:pupil.id,guardian_name:'Responsável de teste',guardian_phone:'24999999999'}]));
 const args=['--input-type=module','--eval',"import {initializePortal} from './portal-bootstrap.mjs';await initializePortal();"],options={cwd:import.meta.dirname,env:{...process.env,...env,RENDER:'false',BOOTSTRAP_STUDENTS_FILE:source,BOOTSTRAP_CONTACTS_FILE:contacts},encoding:'utf8'};
 execFileSync(process.execPath,args,options);assert.equal((await store.students()).length,1);assert.equal(fs.readdirSync(path.join(env.PORTAL_DATA_DIR,'backups')).length,2);assert.equal((await store.studentContact(admin.user_id,pupil.id)).guardian_name,'Responsável de teste');
 await store.update(admin.user_id,{...pupil,name:'Nome corrigido no teste',version:1});execFileSync(process.execPath,args,options);assert.equal((await store.student(pupil.id)).name,'Nome corrigido no teste');assert.equal((await store.students()).length,1);
});

test('Contato do aluno: visível só para vinculados, versão e importação sem sobrescrever',async t=>{
 const {request,store,admin,login}=await fixture(t);await store.import(admin.user_id,[pupil,{...pupil,id:'UND2_000001'}]);
 assert.equal(await store.importContacts(admin.user_id,[{id:pupil.id,guardian_name:'Responsável da planilha',guardian_phone:'24999999999'}]),1);
 let c=(await (await request('/students/'+pupil.id+'/contact')).json()).contact;assert.equal(c.guardian_name,'Responsável da planilha');
 const patch={...c,guardian_name:'Responsável corrigido',guardian_email:'guardian@example.test',relationship:'Mãe'};assert.equal((await request('/students/'+pupil.id+'/contact',{method:'PATCH',data:patch})).status,200);
 assert.equal((await request('/students/'+pupil.id+'/contact',{method:'PATCH',data:patch})).status,409);assert.equal(await store.importContacts(admin.user_id,[{id:pupil.id,guardian_name:'Valor antigo',guardian_phone:'24999999999'}]),0);
 const guardian=await store.provision('guardian@example.test','guardian'),token=await login(guardian.email);assert.equal((await request('/students/'+pupil.id+'/contact',{token})).status,403);await store.link(admin.user_id,guardian.user_id,pupil.id);
 c=(await (await request('/students/'+pupil.id+'/contact',{token})).json()).contact;assert.equal(c.guardian_name,'Responsável corrigido');assert.equal((await request('/students/UND2_000001/contact',{token})).status,403);assert.equal((await request('/students/'+pupil.id+'/contact',{token,method:'PATCH',data:{...c,guardian_email:'another@example.test'}})).status,403);
 const exported=await request('/contacts.csv');assert.equal(exported.status,200);assert.match(await exported.text(),/Responsável corrigido/);assert.equal((await request('/contacts.csv',{token})).status,403);
});

test('Amavale: inicialização de duas turmas por idade, horários e preservação após reiniciar',async t=>{
 const {env,store,admin}=await fixture(t),{execFileSync}=await import('node:child_process');const source=path.join(env.PORTAL_DATA_DIR,'seed-groups.csv');const year=new Date().getUTCFullYear(),rows=[{...pupil,birth_date:(year-12)+'-01-01'},{...pupil,id:'UND1_000002',name:'Infantil de teste',birth_date:(year-8)+'-01-01'},{...pupil,id:'UND1_000003',name:'Fora da faixa de teste',birth_date:(year-20)+'-01-01'}];fs.writeFileSync(source,csv(rows));const options={cwd:import.meta.dirname,env:{...process.env,...env,RENDER:'false',BOOTSTRAP_STUDENTS_FILE:source,BOOTSTRAP_AMAVALE_GROUPS:'true'},encoding:'utf8'},args=['--input-type=module','--eval',"import {initializePortal} from './portal-bootstrap.mjs';await initializePortal();"];execFileSync(process.execPath,args,options);const groups=await store.groups(admin.user_id,'amavale');assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>g.enrolled),[1,1]);assert.deepEqual(groups[0].weekdays,[2,4]);assert.equal(groups[0].start_time,'15:00');assert.equal(groups[0].end_time,'16:00');assert.equal(groups[1].start_time,'16:25');assert.equal(groups[1].end_time,'17:00');await store.saveGroup(admin.user_id,groups[0].id,{...groups[0],students:[],version:1});execFileSync(process.execPath,args,options);assert.equal((await store.groups(admin.user_id,'amavale'))[0].enrolled,0);
});
test('Prospect completo continua pendente: secretaria autorizada aprova e gera um único ID',async t=>{
 const {request,store,admin,login}=await fixture(t);const secretary=await store.provision('secretary@example.test','secretary'),token=await login(secretary.email),id=randomUUID();
 const data={id,student_name:'Candidato Fictício',birth_date:'2015-01-01',unit:'amavale',guardian_name:'Responsável Fictício',guardian_email:'guardian@example.test',guardian_phone:'24999999999',relationship:'Mãe',source_reference:'Email de teste fictício',consent_version:'2026-10-05',checked:true};
 assert.equal((await request('/registrations',{token,method:'POST',data:{...data,checked:false}})).status,400);assert.equal((await request('/registrations',{token,method:'POST',data})).status,201);assert.equal((await request('/registrations',{token,method:'POST',data})).status,201);
 for(const kind of ['photo','student_document','guardian_document','medical_certificate']){const current=await store.registration(id),form=new FormData();form.set('kind',kind);form.set('version',current.version);form.set('file',kind==='photo'?new Blob([new Uint8Array([255,216,255,0])],{type:'image/jpeg'}):new Blob(['%PDF-1.7 fictício'],{type:'application/pdf'}),kind==='photo'?'foto.jpg':'doc.pdf');assert.equal((await request('/registrations/'+id+'/documents',{token,method:'POST',form})).status,201)}
 let r=await store.registration(id);assert.equal(r.status,'pending');assert.equal(r.student_id,null);assert.equal(r.documents.length,4);assert.equal((await store.students()).length,0);assert.equal((await store.members()).some(m=>m.email===data.guardian_email),false);
 const decision={version:r.version,decision:'approved',reason:'Conferido pela administração',checked:true};assert.equal((await request('/registrations/'+id+'/review',{token,method:'POST',data:decision})).status,200);assert.equal((await request('/registrations/'+id+'/review',{method:'POST',data:decision})).status,409);
 r=await store.registration(id);assert.equal(r.student_id,'UND1_000001');assert.equal((await store.students()).length,1);assert.equal((await store.documents(r.student_id)).length,4);assert.equal((await store.studentContact(admin.user_id,r.student_id)).relationship,'Mãe');assert.equal((await store.members()).some(m=>m.email===data.guardian_email),true);
 const form=new FormData();form.set('kind','report_card');form.set('version',r.version);form.set('file',new Blob(['%PDF-1.7 fake'],{type:'application/pdf'}),'boletim.pdf');assert.equal((await request('/registrations/'+id+'/documents',{method:'POST',form})).status,409);
});
test('Secretaria gerencia situação da ficha conforme permissão integral',async t=>{
 const {request,store,admin,login}=await fixture(t);await store.import(admin.user_id,[{...pupil,status:'pending'}]);await store.provision('secretary@example.test','secretary');const token=await login('secretary@example.test');
 assert.equal((await request('/students/'+pupil.id,{token,method:'PATCH',data:{version:1,status:'approved'}})).status,200);assert.equal((await store.student(pupil.id)).status,'approved');
});
