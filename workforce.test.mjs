import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {csv,parseCsv} from './portal-domain.mjs';
const staffData=(email,role='secretary')=>({email,role,name:'Pessoa Fictícia da Equipe',phone:'24999999999',active:true,version:0});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-workforce-test-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'test-only-'.repeat(5),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',RESEND_API_KEY:'synthetic',MAIL_FROM:'test@example.test',PUBLIC_ORIGIN:'https://test.example'};
 let store=createSqliteStore(env,{transport:async(_url,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'fake'})}});const admin=(await store.members())[0],sec=await store.provision('secretary@example.test','secretary'),guardian=await store.provision('guardian@example.test','guardian');
 t.after(()=>{store.close();if(dir.startsWith(path.join(os.tmpdir(),'lpc-workforce-test-')))fs.rmSync(dir,{recursive:true,force:true})});
 const login=async email=>{await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token};
 const request=async(token,route,method='GET',data)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,store);
 const pupil={id:'UND1_000001',name:'Aluno Fictício',birth_date:'2018-01-01',status:'approved',version:0};await store.import(admin.user_id,[pupil]);
 const group=await store.saveGroup(sec.user_id,null,{unit:'amavale',label:'Turma fictícia',weekdays:[2,4],start_time:'16:25',end_time:'17:00',active:true,version:0,students:[pupil.id]});
 const monitorData={name:'Monitor Fictício',email:'monitor@example.test',phone:'24999999999',notes:'',active:true,version:0,units:['amavale']},monitor=await store.saveMonitor(sec.user_id,null,monitorData);
 const teacherData={name:'Professor Fictício',email:'teacher@example.test',phone:'24999999999',belt_degree:'Preta',certificate_issuer:'Entidade de teste',certificate_date:'2020-01-01',status:'pending',version:0,units:['amavale']};let teacher=await store.saveTeacher(sec.user_id,null,teacherData);
 for(const kind of ['photo','black_belt_diploma'])await store.addTeacherDocument(sec.user_id,teacher.user_id,{id:randomUUID(),kind,object_path:'fake/'+randomUUID()+'.pdf',mime:'application/pdf',size:10,original_name:'fixture'});
 teacher=await store.teacher(sec.user_id,teacher.user_id);teacher=await store.saveTeacher(sec.user_id,teacher.user_id,{...teacherData,status:'verified',checked:true,version:teacher.version});
 const care=async(role,email,unit='amavale')=>{const data={name:'Profissional Fictício',email,role,phone:'24999999999',rg:'TESTE',cpf:'52998224725',council_number:'TESTE',council_region:'RJ',review_until:new Date(Date.now()+86400000*90).toISOString().slice(0,10),status:'pending',version:0,units:[unit]};let p=await store.saveProfessional(sec.user_id,null,data);for(const kind of ['photo','council'])await store.addProfessionalDocument(sec.user_id,p.user_id,{id:randomUUID(),kind,object_path:'fake/'+randomUUID()+'.pdf',mime:'application/pdf',size:10,original_name:'fixture'});p=await store.professional(sec.user_id,p.user_id);return store.saveProfessional(sec.user_id,p.user_id,{...data,status:'verified',version:p.version,checked:true})};
 return {get store(){return store},admin,sec,guardian,login,request,pupil,group,monitor,monitorData,teacher,care,env,reopen(){store.close();store=createSqliteStore(env);return store}};
}
test('Perfis restritos: APIs de alunos, documentos, cadastros e gestão recusam professor e assistência',async t=>{
 const f=await fixture(t),care1=await f.care('psychologist','psych@example.test'),care2=await f.care('social_worker','social@example.test');
 for(const person of [f.teacher,care1,care2]){const token=await f.login(person.email);await f.store.link(f.admin.user_id,person.user_id===f.teacher.user_id?f.guardian.user_id:person.user_id,f.pupil.id);for(const route of ['/students','/students/'+f.pupil.id,'/students/'+f.pupil.id+'/documents','/export.csv','/documents.csv','/contacts.csv','/dashboard','/audit','/members','/registrations','/teachers','/teachers/'+f.teacher.user_id,'/professionals/'+care1.user_id,'/monitors','/workforce?unit=amavale','/workforce-sessions?unit=amavale','/workforce.csv?unit=amavale&from=2026-01-01&to=2026-12-31'])assert.equal((await f.request(token,route)).status,403,person.role+' '+route);assert.equal((await f.request(token,'/monitors','POST',f.monitorData)).status,403);assert.equal((await f.request(token,'/reports?unit=amavale')).status,200)}
 const teacherToken=await f.login('unused@example.test').catch(()=>null);assert.equal(teacherToken,null);
});
test('Psicologia e assistência: relatos do núcleo e agenda própria, sem presença ou agenda alheia',async t=>{
 const f=await fixture(t),p=await f.care('psychologist','psych@example.test'),s=await f.care('social_worker','social@example.test'),other=await f.care('psychologist','other@example.test','valparaiso');
 const report=await f.store.createReport(f.admin.user_id,{id:randomUUID(),kind:'incident',unit:'amavale',occurred_at:'2026-01-01T16:30',category:'Luz',description:'Relato fictício para teste de acesso',actions:'Procedimentos fictícios'});
 for(const person of [p,s]){const token=await f.login(person.email);assert.equal((await f.request(token,'/reports/'+report.id)).status,200);assert.equal((await f.request(token,'/reports?unit=valparaiso')).status,403);assert.equal((await f.request(token,'/unit-roster?unit=valparaiso')).status,403);assert.equal((await f.request(token,'/classes?unit=amavale')).status,403);assert.equal((await f.request(token,'/attendance.csv?unit=amavale')).status,403);assert.equal((await f.request(token,'/slots?professional='+other.user_id)).status,403);assert.equal((await f.request(token,'/bookings')).status,200);
 const day=new Date(Date.now()+86400000*10).toISOString().slice(0,10);assert.equal((await f.request(token,'/slots','POST',{professional_id:person.user_id,unit:'amavale',day,start_time:'10:00',end_time:'11:00'})).status,201);assert.equal((await f.request(token,'/slots','POST',{professional_id:other.user_id,unit:'valparaiso',day,start_time:'10:00',end_time:'11:00'})).status,403);assert.equal((await f.request(token,'/reports/'+report.id,'POST',{version:1,note:'Tentativa de encerramento',status:'closed'})).status,403)}
});
test('Secretaria: gestão completa de perfis, importação, métricas e histórico',async t=>{
 const f=await fixture(t),p=await f.care('psychologist','psych@example.test'),token=await f.login(f.sec.email);
 for(const route of ['/teachers','/teachers/'+f.teacher.user_id,'/professionals/'+p.user_id,'/monitors','/audit','/dashboard','/members','/students','/registrations'])assert.equal((await f.request(token,route)).status,200,route);
 const preview=await f.request(token,'/import/preview','POST',{csv:csv([{...f.pupil,version:1,kimono:'M2'}])});assert.equal(preview.status,200);assert.equal((await f.request(token,'/import/commit','POST',{token:(await preview.json()).token})).status,200);assert.equal((await f.store.student(f.pupil.id)).kimono,'M2');
});
test('Equipe: seleção por turma, datas válidas, lista histórica e salvamento com auditoria',async t=>{
 const f=await fixture(t),payload={group_id:f.group.id,day:'2026-10-06',people:['teacher:'+f.teacher.user_id,'monitor:'+f.monitor.id]};const session=await f.store.createWorkforceSession(f.sec.user_id,payload);assert.equal((await f.store.createWorkforceSession(f.sec.user_id,payload)).id,session.id);assert.equal((await f.store.workforceAttendance(f.sec.user_id,session.id)).people.every(p=>p.status==='unmarked'),true);
 await assert.rejects(f.store.createWorkforceSession(f.sec.user_id,{...payload,day:'2026-10-07'}));await assert.rejects(f.store.createWorkforceSession(f.sec.user_id,{...payload,day:'2099-01-01'}));await assert.rejects(f.store.createWorkforceSession(f.sec.user_id,{...payload,people:[] }));await assert.rejects(f.store.createWorkforceSession(f.sec.user_id,{...payload,people:['monitor:unknown']}),{status:409});
 await f.store.markWorkforceAttendance(f.sec.user_id,session.id,[{id:payload.people[0],status:'present',note:'',version:0},{id:payload.people[1],status:'justified',note:'Justificativa administrativa fictícia',version:0}]);
 await f.store.saveMonitor(f.sec.user_id,f.monitor.id,{...f.monitorData,name:'Nome alterado',active:false,version:1});assert.equal((await f.store.workforceRoster(f.sec.user_id,'amavale')).some(p=>p.id===payload.people[1]),false);
 assert.equal((await f.store.workforceAttendance(f.sec.user_id,session.id)).people.find(p=>p.role==='monitor').name,'Monitor Fictício');assert.equal((await f.store.workforceHistory(f.admin.user_id,session.id)).length,2);
 f.reopen();const row=(await f.store.workforceAttendance(f.admin.user_id,session.id)).people.find(p=>p.role==='teacher');assert.equal(row.status,'present');assert.equal(row.version,1);await f.store.markWorkforceAttendance(f.sec.user_id,session.id,[{id:row.person_key,status:'absent',note:'Correção de teste',version:1}]);assert.equal((await f.store.workforceHistory(f.admin.user_id,session.id)).at(-1).previous_status,'present');
});
test('Equipe: concorrência e lote inválido não gravam parcialmente; professor não marca a própria presença',async t=>{
 const f=await fixture(t),people=['teacher:'+f.teacher.user_id,'monitor:'+f.monitor.id],s=await f.store.createWorkforceSession(f.sec.user_id,{group_id:f.group.id,day:'2026-10-06',people});
 await assert.rejects(f.store.markWorkforceAttendance(f.sec.user_id,s.id,[{id:people[0],status:'present',version:0},{id:people[1],status:'present',version:8}]),{status:409});assert.equal((await f.store.workforceAttendance(f.sec.user_id,s.id)).people.every(p=>p.status==='unmarked'),true);assert.equal((await f.store.workforceHistory(f.admin.user_id,s.id)).length,0);
 await assert.rejects(f.store.markWorkforceAttendance(f.teacher.user_id,s.id,[{id:people[0],status:'present',version:0}]),{status:403});await assert.rejects(f.store.workforceAttendance(f.guardian.user_id,s.id),{status:403});await assert.rejects(f.store.saveMonitor(f.teacher.user_id,null,f.monitorData),{status:403});
 const token=await f.login(f.teacher.email);assert.equal((await f.request(token,'/workforce-sessions/'+s.id,'POST',{rows:[{id:people[0],status:'present',version:0}]})).status,403);
});
test('Equipe: CSV preserva acentos, neutraliza fórmulas e exclui dados de contato',async t=>{
 const f=await fixture(t),s=await f.store.createWorkforceSession(f.sec.user_id,{group_id:f.group.id,day:'2026-10-06',people:['monitor:'+f.monitor.id]});await f.store.markWorkforceAttendance(f.sec.user_id,s.id,[{id:'monitor:'+f.monitor.id,status:'present',version:0,note:'=SUM(A1:A2)'}]);const token=await f.login(f.sec.email),r=await f.request(token,'/workforce.csv?unit=amavale&from=2026-10-01&to=2026-10-31');assert.equal(r.status,200);const data=await r.text();assert.match(data,/'=SUM/);assert.match(data,/Monitor Fictício/);assert.doesNotMatch(data,/24999999999|monitor@example.test/);await assert.rejects(f.store.workforceExport(f.guardian.user_id,'amavale','2026-01-01','2026-12-31'),{status:403});
});

test('Contas administrativas: cadastro completo, duplicidade, versão e persistência',async t=>{
 const f=await fixture(t),token=await f.login(f.admin.email),data=staffData('second.admin@example.test','admin');
 const created=await f.request(token,'/staff-accounts','POST',data);assert.equal(created.status,201);const a=(await created.json()).account;
 assert.equal(a.name,data.name);assert.equal(a.version,1);assert.equal((await f.request(token,'/staff-accounts','POST',data)).status,409);
 const edit={...a,name:'Nome Completo Alterado'};assert.equal((await f.request(token,'/staff-accounts/'+a.user_id,'PATCH',edit)).status,200);assert.equal((await f.request(token,'/staff-accounts/'+a.user_id,'PATCH',edit)).status,409);
 await assert.rejects(f.store.saveStaffAccount(f.admin.user_id,a.user_id,{...edit,version:2,email:'other@example.test'}),{status:400});
 await assert.rejects(f.store.saveStaffAccount(f.admin.user_id,null,{...data,email:f.guardian.email}),{status:409});
 f.reopen();assert.equal((await f.store.staffAccounts(f.admin.user_id)).find(p=>p.user_id===a.user_id).name,edit.name);
});

test('Contas administrativas: só administrador gerencia administradores, sem atalhos pela API genérica',async t=>{
 const f=await fixture(t),adminToken=await f.login(f.admin.email),secToken=await f.login(f.sec.email),guardianToken=await f.login(f.guardian.email);
 const admin=await f.store.saveStaffAccount(f.admin.user_id,null,staffData('other.admin@example.test','admin'));
 assert.equal((await f.request(secToken,'/staff-accounts','POST',staffData('forbidden@example.test','admin'))).status,403);
 for(const patch of [{...admin,active:false},{...admin,role:'secretary'},{...admin,name:'Alteração indevida'}])assert.equal((await f.request(secToken,'/staff-accounts/'+admin.user_id,'PATCH',patch)).status,403);
 assert.equal((await f.request(secToken,'/staff-accounts','POST',staffData('other.secretary@example.test'))).status,201);
 for(const token of [adminToken,secToken]){assert.equal((await f.request(token,'/members','POST',staffData('bypass@example.test','admin'))).status,403);assert.equal((await f.request(token,'/members/'+admin.user_id,'PATCH',{role:'guardian',active:false})).status,403);assert.equal((await f.request(token,'/members/'+f.guardian.user_id,'PATCH',{role:'secretary',active:true})).status,400)}
 assert.equal((await f.request(guardianToken,'/staff-accounts')).status,403);
 assert.equal((await f.request(await f.login(f.teacher.email),'/staff-accounts')).status,403);
 await assert.rejects(f.store.saveStaffAccount(f.admin.user_id,f.admin.user_id,{...staffData(f.admin.email,'admin'),active:false}),{status:403});
 await assert.rejects(f.store.saveStaffAccount(f.admin.user_id,f.admin.user_id,{...staffData(f.admin.email,'secretary')}),{status:403});
});

test('Contas administrativas: desativação revoga sessões e códigos sem apagar o histórico',async t=>{
 const f=await fixture(t),data=staffData('staff@example.test'),a=await f.store.saveStaffAccount(f.admin.user_id,null,data),token=await f.login(data.email);
 assert.equal((await f.request(token,'/dashboard')).status,200);
 let updated=await f.store.saveStaffAccount(f.admin.user_id,a.user_id,{...a,active:false});assert.equal((await f.request(token,'/dashboard')).status,401);
 updated=await f.store.saveStaffAccount(f.admin.user_id,a.user_id,{...updated,active:true});assert.equal((await f.request(token,'/dashboard')).status,401);
 const renewed=await f.login(data.email);assert.equal((await f.request(renewed,'/dashboard')).status,200);
 const history=await f.store.auditLog();assert.ok(history.some(r=>r.action.includes('staff.create:'+a.user_id)));assert.equal(history.filter(r=>r.action.includes('staff.update:'+a.user_id)).length,2);
});

test('Professor de teste: autorização explícita do administrador preserva pendência documental e limites',async t=>{
 const f=await fixture(t),data={name:'Professor Fictício de Teste',email:'test.teacher@example.test',phone:'24999999999',units:['amavale'],status:'pending',version:0,test_access:true};
 await assert.rejects(f.store.saveTeacher(f.sec.user_id,null,data),{status:403});
 let person=await f.store.saveTeacher(f.admin.user_id,null,data);assert.equal(person.status,'pending');assert.equal(person.test_access,true);assert.equal((await f.store.teacherDocuments(f.admin.user_id,person.user_id)).length,0);
 const token=await f.login(data.email);assert.equal((await (await f.request(token,'/me')).json()).test_access,true);
 assert.equal((await f.request(token,'/groups?unit=amavale')).status,200);assert.equal((await f.request(token,'/reports?unit=amavale')).status,200);assert.equal((await f.request(token,'/reports?unit=valparaiso')).status,403);assert.equal((await f.request(token,'/students')).status,403);assert.equal((await f.request(token,'/members')).status,403);
 const lesson=await f.store.createClass(person.user_id,{group_id:f.group.id,day:'2026-10-06'});assert.ok(lesson.id);
 await f.store.markAttendance(person.user_id,lesson.id,[{id:f.pupil.id,status:'present',version:0}]);assert.equal((await f.store.attendance(person.user_id,lesson.id)).students[0].status,'present');
 for(const kind of ['incident','injury']){const report=await f.store.createReport(person.user_id,{id:randomUUID(),kind,unit:'amavale',...(kind==='injury'?{student_id:f.pupil.id}:{}),occurred_at:'2026-10-06T16:30',category:'Teste fictício',description:'Ocorrência fictícia para teste automatizado',actions:'Nenhuma ação real, apenas teste',guardian_contact:'Fictício',referral:'Nenhum'});assert.ok(report.id)}
 await assert.rejects(f.store.saveTeacher(f.admin.user_id,person.user_id,{...data,version:1,status:'verified',checked:true}),{status:400});
 await f.store.saveTeacher(f.admin.user_id,person.user_id,{...data,version:1,test_access:false});assert.equal((await f.request(token,'/groups?unit=amavale')).status,403);
 assert.ok((await f.store.auditLog()).some(r=>r.action==='teacher.test_access:'+person.user_id+':true'));
});
