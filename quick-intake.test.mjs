import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';
import {fixtureTeacher} from './school-fixtures.mjs';import {localDay} from './professional-tools.mjs';import {operationsTools} from './operations-tools.mjs';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-quick-')),env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'fixture-not-production-'.repeat(3),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test'},store=createSqliteStore(env),db=new DatabaseSync(path.join(dir,'portal.sqlite'));
 t.after(()=>{db.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-quick-')));fs.rmSync(dir,{recursive:true,force:true})});
 const admin=(await store.members())[0].user_id,teacher=(await fixtureTeacher(store,admin)).user_id,other=(await fixtureTeacher(store,admin,['amavale'],'other@example.test')).user_id;
 const staff=async(level,units)=>store.saveStaffAccount(admin,null,{name:'Secretaria Fictícia '+level,email:level+'@example.test',phone:'24999999999',role:'secretary',secretary_level:level,units,active:true,version:0});
 const secretary=(await staff('local',['amavale'])).user_id,general=(await staff('general',['amavale','valparaiso','vale-do-carangola'])).user_id;
 const student={id:'UND1_000001',name:'Aluna Matriculada',birth_date:'2018-01-01',status:'approved',version:0};await store.import(admin,[student]);
 const group=await store.saveGroup(admin,null,{unit:'amavale',label:'Turma Fictícia',students:[student.id],teachers:[teacher],weekdays:[0,1,2,3,4,5,6],start_time:'15:00',end_time:'16:00',active:true,version:0});
 const day=localDay(),lesson=await store.createClass(admin,{group_id:group.id,day});
 const payload=(name='Visitante Fictício')=>({id:randomUUID(),class_id:lesson.id,name,age:null,phone:'',guardian_name:''});
 const token=actor=>{const tok=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(tok).digest('hex'),actor,Date.now()+3600000);return tok};
 const req=(actor,url,method='GET',data,origin=env.PUBLIC_ORIGIN)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+url,{method,headers:{Origin:origin,Authorization:'Bearer '+token(actor),'Content-Type':'application/json'},...(data!==undefined?{body:JSON.stringify(data)}:{})}),env,store);
 return {store,db,admin,teacher,other,secretary,general,student,group,lesson,day,payload,req,env};
}
test('pré-cadastro: salvar nome registra presença atomicamente, sem matrícula e com autoria real',async t=>{
 const f=await fixture(t),p=f.payload();const before=await f.store.systemRevision(f.admin);const res=await f.req(f.teacher,'/quick-intakes','POST',{...p,created_by:f.admin});assert.equal(res.status,200);assert.equal((await res.json()).present,true);
 const row=f.db.prepare('SELECT * FROM quick_intakes').get();assert.equal(row.created_by,f.teacher);assert.equal(row.status,'pending');assert.equal((await f.store.students()).length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM registrations').get().n,0);
 const v=(await f.store.visitors(f.teacher,f.lesson.id)).visitors[0];assert.equal(v.present,1);assert.equal(v.version,1);assert.notEqual((await f.store.systemRevision(f.admin)).revision,before.revision);
 const r=await f.store.operationsSummary(f.admin,f.day);assert.equal(r.totals.visitors_present,1);assert.equal(r.totals.held,1);assert.equal(r.totals.age_unknown,1);assert.equal(r.lessons[0].unmarked,1);
});
test('pré-cadastro: idempotência, nome normalizado, protocolo alterado e aluno já matriculado',async t=>{
 const f=await fixture(t),p=f.payload('Jóão Fictício');await f.store.quickCreate(f.teacher,p);assert.equal((await f.store.quickCreate(f.teacher,p)).repeated,true);
 await assert.rejects(f.store.quickCreate(f.teacher,{...p,name:'Outro Nome'}),{status:409});await assert.rejects(f.store.quickCreate(f.teacher,f.payload('  joao   FICTÍCIO ')),{status:409});await assert.rejects(f.store.quickCreate(f.teacher,f.payload(f.student.name)),{status:409});assert.equal(f.db.prepare('SELECT COUNT(*) n FROM visitor_attendance').get().n,1);
 await f.store.markVisitor(f.teacher,f.lesson.id,{intake_id:p.id,present:false,version:1});assert.equal((await f.store.quickCreate(f.teacher,p)).present,false);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM visitor_changes').get().n,2);
});
test('pré-cadastro: validação e erro de banco fazem rollback completo, sem presença parcial',async t=>{
 const f=await fixture(t);for(const override of [{name:' '},{age:2.5},{age:121},{phone:'abc'},{age:'12'}])await assert.rejects(f.store.quickCreate(f.teacher,{...f.payload(),...override}),{status:400});
 f.db.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON visitor_attendance BEGIN SELECT RAISE(ABORT,'fixture'); END");await assert.rejects(f.store.quickCreate(f.teacher,f.payload()));assert.equal(f.db.prepare('SELECT COUNT(*) n FROM quick_intakes').get().n,0);
});
test('pré-cadastro: professor vinculado, administradores e secretaria geral; local não lança presença',async t=>{
 const f=await fixture(t);for(const actor of [f.other,f.secretary])assert.equal((await f.req(actor,'/quick-intakes','POST',f.payload())).status,403);
 for(const actor of [f.admin,f.general])assert.equal((await f.req(actor,'/quick-intakes','POST',f.payload('Visitante '+actor))).status,200);
 assert.equal((await f.req(f.teacher,'/quick-intakes?unit=amavale')).status,403);assert.equal((await f.req(f.teacher,'/operations?day='+f.day)).status,403);
 assert.equal((await f.req(f.secretary,'/quick-intakes?unit=amavale')).status,200);assert.equal((await f.req(f.secretary,'/quick-intakes?unit=valparaiso')).status,403);
 f.db.prepare('DELETE FROM group_teachers WHERE teacher_id=?').run(f.teacher);assert.equal((await f.req(f.teacher,'/quick-intakes','POST',f.payload())).status,403);
});
test('pré-cadastro: aula cancelada/futura, sessão ausente, JSON nulo e CSRF são rejeitados',async t=>{
 const f=await fixture(t);await f.store.cancelClass(f.admin,f.lesson.id,{cancelled:true,reason:'Teste isolado'});await assert.rejects(f.store.quickCreate(f.teacher,f.payload()),{status:409});
 const future=await f.store.createClass(f.admin,{group_id:f.group.id,day:'2099-01-01'});await assert.rejects(f.store.quickCreate(f.teacher,{...f.payload(),class_id:future.id}),{status:400});
 assert.equal((await f.req(f.admin,'/quick-intakes','POST',null)).status,400);assert.equal((await f.req(f.admin,'/quick-intakes','POST',f.payload(),'https://evil.test')).status,403);
 assert.equal((await handlePortal(new Request(f.env.PUBLIC_ORIGIN+'/api/portal/quick-intakes?unit=amavale'),f.env,f.store)).status,401);
});
test('visitante: desfazer, concorrência e arquivamento preservam autoria e histórico',async t=>{
 const f=await fixture(t),p=f.payload();await f.store.quickCreate(f.teacher,p);await f.store.markVisitor(f.teacher,f.lesson.id,{intake_id:p.id,present:false,version:1});await assert.rejects(f.store.markVisitor(f.teacher,f.lesson.id,{intake_id:p.id,present:true,version:1}),{status:409});
 await f.store.quickUpdate(f.admin,p.id,{...p,status:'archived',version:1});await assert.rejects(f.store.markVisitor(f.teacher,f.lesson.id,{intake_id:p.id,present:true,version:2}),{status:409});assert.equal((await f.store.operationsSummary(f.admin,f.day)).totals.participations,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM visitor_changes').get().n,2);
});
test('vincular matrícula: exige conferência e evita dupla contagem sem apagar presença histórica',async t=>{
 const f=await fixture(t),p=f.payload('Nova Aluna Fictícia');await f.store.quickCreate(f.teacher,{...p,age:10});await f.store.import(f.admin,[{...f.student,id:'UND1_000002',name:p.name}]);
 const update={...p,status:'linked',student_id:'UND1_000002',version:1};await assert.rejects(f.store.quickUpdate(f.admin,p.id,update),{status:400});await f.store.quickUpdate(f.admin,p.id,{...update,identity_checked:true});
 f.db.prepare('INSERT INTO class_students VALUES(?,?)').run(f.lesson.id,'UND1_000002');await f.store.markAttendance(f.admin,f.lesson.id,[{id:'UND1_000002',status:'present',version:0}]);
 const r=await f.store.operationsSummary(f.admin,f.day);assert.equal(r.totals.participations,1);assert.equal(r.totals.unique_people,1);assert.equal(r.totals.children,1);assert.equal(r.totals.registered_present,1);assert.equal(r.totals.visitors_present,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM visitor_attendance').get().n,1);
});
test('resumo: pendência difere de ausência, realização explícita funciona com zero presentes, cancelamento exclui totais',async t=>{
 const f=await fixture(t);let r=await f.store.operationsSummary(f.admin,f.day);assert.equal(r.totals.unconfirmed,1);assert.equal(r.totals.held,0);
 await f.store.markAttendance(f.admin,f.lesson.id,[{id:f.student.id,status:'absent',version:0}]);r=await f.store.operationsSummary(f.admin,f.day);assert.equal(r.totals.held,0);assert.equal(r.lessons[0].attendance_complete,true);
 await f.store.classDelivery(f.teacher,f.lesson.id,{held:true,version:0});assert.equal((await f.store.operationsSummary(f.admin,f.day)).totals.held,1);
 await f.store.quickCreate(f.teacher,f.payload());await f.store.cancelClass(f.admin,f.lesson.id,{cancelled:true,reason:'Teste cancelado'});r=await f.store.operationsSummary(f.admin,f.day);assert.equal(r.totals.participations,0);assert.equal(r.totals.cancelled,1);assert.equal(r.totals.held,0);
 assert.equal((await f.store.operationsSummary(f.secretary,f.day)).notifications,undefined);await assert.rejects(f.store.operationsSummary(f.admin,'2026-02-30'),{status:400});
});
test('resumo: atendimento só conta se realizado e email não contém dados pessoais',async t=>{
 const f=await fixture(t);const prof=await f.store.saveProfessional(f.admin,null,{name:'Profissional Fictícia',email:'professional@example.test',phone:'24999999999',role:'psychologist',status:'pending',units:['amavale'],version:0});
 const start=new Date(f.day+'T15:00:00-03:00').toISOString(),end=new Date(f.day+'T16:00:00-03:00').toISOString();for(const status of ['confirmed','completed','absent','cancelled']){const sid=randomUUID();f.db.prepare('INSERT INTO appointment_slots(id,professional_id,unit,start_at,end_at,created_at) VALUES(?,?,?,?,?,?)').run(sid,prof.user_id,'amavale',start,end,start);f.db.prepare('INSERT INTO bookings(id,request_hash,slot_id,student_id,requested_by,contact_name,phone,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),'fixture',sid,f.student.id,f.admin,'SEGREDO RESPONSÁVEL','24999999999',status,start,start);}
 const r=await f.store.operationsSummary(f.admin,f.day);assert.equal(r.totals.appointments_completed,1);assert.equal(r.totals.appointments_waiting,1);assert.doesNotMatch(JSON.stringify(r),/SEGREDO|Aluna Matriculada|249999/);
});
test('emails de atividades: 8h Brasília, administradores ativos, uma cópia após reinício e retry idempotente',async t=>{
 const f=await fixture(t),calls=[];let now=new Date(Date.parse(f.day+'T10:59:00Z')+86400000),response=()=>{throw Error('timeout privado')};
 const deps={db:f.db,get:(q,...p)=>f.db.prepare(q).get(...p),all:(q,...p)=>f.db.prepare(q).all(...p),run:(q,...p)=>f.db.prepare(q).run(...p),requireRole:()=>({role:'admin'}),scope:{units:()=>['amavale']},env:{RESEND_API_KEY:'fixture-only',MAIL_FROM:'sender@example.test'},clock:()=>now,transport:async(u,o)=>{calls.push(o);return response()}};
 let ops=operationsTools(deps);await ops.deliverOperationsNotices();assert.equal(calls.length,0);now=new Date(+now+60000);await ops.deliverOperationsNotices();assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].body).to[0],'admin@example.test');assert.match(JSON.parse(calls[0].body).text,/Sem confirmação: 1/);
 await ops.deliverOperationsNotices();assert.equal(calls.length,1);now=new Date(+now+300000);response=()=>Response.json({id:'synthetic-accepted'});ops=operationsTools(deps);await ops.deliverOperationsNotices();assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);await ops.deliverOperationsNotices();assert.equal(calls.length,2);assert.doesNotMatch(calls[0].body,/Aluna Matriculada|fixture-only|guardian_phone/);
});


test('resumo: chamadas legadas sem snapshot preservam presenças registradas',async t=>{
 const f=await fixture(t);await f.store.markAttendance(f.admin,f.lesson.id,[{id:f.student.id,status:'present',version:0}]);f.db.prepare('DELETE FROM class_students WHERE class_id=?').run(f.lesson.id);f.db.prepare('UPDATE classes SET group_id=NULL WHERE id=?').run(f.lesson.id);
 const r=await f.store.operationsSummary(f.admin,f.day);assert.equal(r.totals.registered_present,1);assert.equal(r.totals.unique_people,1);
});

test('emails: revogação, rejeição permanente e janela de confirmação não viram duplicação',async t=>{
 const f=await fixture(t);let now=new Date(Date.parse(f.day+'T11:00:00Z')+86400000);const calls=[];let mode='timeout';
 const deps={db:f.db,get:(q,...p)=>f.db.prepare(q).get(...p),all:(q,...p)=>f.db.prepare(q).all(...p),run:(q,...p)=>f.db.prepare(q).run(...p),requireRole:()=>({role:'admin'}),scope:{units:()=>['amavale']},env:{RESEND_API_KEY:'fake',MAIL_FROM:'sender@example.test'},clock:()=>now,transport:async(u,o)=>{calls.push(o);if(mode==='timeout')throw Error('timeout');return Response.json({name:'validation_error'},{status:422})}};
 const ops=operationsTools(deps);await ops.deliverOperationsNotices();assert.equal(calls.length,1);now=new Date(+now+24*3600000);mode='rejected';await ops.deliverOperationsNotices();assert.equal(f.db.prepare("SELECT count(*) n FROM operations_outbox WHERE state='uncertain'").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM operations_outbox WHERE state='failed'").get().n,1);assert.equal(calls.length,2);await ops.deliverOperationsNotices();assert.equal(calls.length,2);
 now=new Date(+now+24*3600000);mode='timeout';await ops.deliverOperationsNotices();f.db.prepare('UPDATE members SET active=0 WHERE user_id=?').run(f.admin);now=new Date(+now+300000);await ops.deliverOperationsNotices();assert.equal(calls.length,3);assert.equal(f.db.prepare("SELECT count(*) n FROM operations_outbox WHERE state='cancelled'").get().n,1);
});
