import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {ADMIN_UNITS} from './unit-scope.mjs';
const day=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
const account=(email,units,extra={})=>({name:'Secretaria Fictícia',email,phone:'24999999999',role:'secretary',active:true,version:0,units,...extra});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-unit-scope-')),env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'test-only-scope-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false'},store=createSqliteStore(env),db=new DatabaseSync(path.join(dir,'portal.sqlite'));
 t.after(()=>{db.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-unit-scope-')));fs.rmSync(dir,{recursive:true,force:true})});
 const admin=(await store.members())[0],tokens=new Map();
 const token=m=>{const v=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(v).digest('hex'),m.user_id,Date.now()+3600000);tokens.set(m.user_id,v);return v};token(admin);
 const req=(m,route,method='GET',data)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+tokens.get(m.user_id),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,store);
 const secretaries=[];for(let i=0;i<3;i++){const m=await store.saveStaffAccount(admin.user_id,null,account('secretary'+i+'@example.test',[ADMIN_UNITS[i]]));token(m);secretaries.push(m)}
 const pupils=ADMIN_UNITS.map((u,i)=>({id:`UND${i+1}_000001`,name:'Aluno Fictício '+i,birth_date:'2015-01-01',status:'approved',version:0}));await store.import(admin.user_id,pupils);
 const regs=[],groups=[],classes=[],docs=[];
 for(let i=0;i<3;i++){
  const id=randomUUID();await store.manualRegistration(admin.user_id,{id,student_name:'Candidato Fictício '+i,birth_date:'2016-01-01',unit:ADMIN_UNITS[i],guardian_name:'Responsável Fictício',guardian_email:`guardian${i}@example.test`,guardian_phone:'24999999999',relationship:'Responsável',consent_version:'teste-v1',source_reference:'Teste isolado',checked:true});regs.push(id);
  groups.push(await store.saveGroup(admin.user_id,null,{unit:ADMIN_UNITS[i],label:'Turma Fictícia '+i,weekdays:[0,1,2,3,4,5,6],start_time:'10:00',end_time:'11:00',active:true,version:0,students:[pupils[i].id]}));
  classes.push(await store.createClass(admin.user_id,{group_id:groups[i].id,day:new Date().toISOString().slice(0,10)}));
  const did=randomUUID(),key=pupils[i].id+'/'+did+'.pdf';await store.upload(key,Buffer.from('%PDF-1.7 fixture'));await store.addDocument({id:did,student_id:pupils[i].id,kind:'report_card',object_path:key,original_name:'fixture.pdf',mime:'application/pdf',size:16,created_by:admin.user_id});docs.push(did);
 }
 return {dir,env,store,db,admin,secretaries,pupils,regs,groups,classes,docs,token,req};
}
test('Núcleos: seleção obrigatória, autorização somente geral, versões e revogação imediata de sessão',async t=>{
 const f=await fixture(t),s=f.secretaries[0];
 for(const units of [undefined,[],['invalid'],['amavale','amavale']])await assert.rejects(f.store.saveStaffAccount(f.admin.user_id,null,account('invalid@example.test',units)),{status:400});
 assert.equal((await f.req(s,'/staff-accounts')).status,403);
 assert.equal((await f.req(s,'/staff-accounts','POST',account('escalation@example.test',ADMIN_UNITS))).status,403);
 assert.equal((await f.req(s,'/members/'+f.admin.user_id,'PATCH',{role:'admin',active:true})).status,403);
 const cached=f.store.forActor(s.user_id),updated=await f.store.saveStaffAccount(f.admin.user_id,s.user_id,{...s,units:['valparaiso']});
 assert.equal((await f.req(s,'/students')).status,401);await assert.rejects(cached.student(f.pupils[0].id),{status:403});
 assert.equal((await cached.students())[0].id,f.pupils[1].id);
 await assert.rejects(f.store.saveStaffAccount(f.admin.user_id,s.user_id,{...s,units:['amavale']}),{status:409});
 assert.ok((await f.store.auditLog()).some(r=>r.action.includes('units=amavale>valparaiso')));
 f.token(updated);assert.deepEqual((await (await f.req(updated,'/me')).json()).units,['valparaiso']);
});
test('Núcleos: matriz 3×3 de fichas, documentos, contatos, graduação, inscrições, turmas e chamadas',async t=>{
 const f=await fixture(t);
 for(let a=0;a<3;a++)for(let b=0;b<3;b++){
  const s=f.secretaries[a],expected=a===b?200:403;
  for(const route of ['/students/'+f.pupils[b].id,'/students/'+f.pupils[b].id+'/documents','/students/'+f.pupils[b].id+'/contact','/students/'+f.pupils[b].id+'/progression','/documents/'+f.docs[b]+'/download','/registrations/'+f.regs[b],'/groups/'+f.groups[b].id,'/classes/'+f.classes[b].id+'/attendance','/unit-roster?unit='+ADMIN_UNITS[b]])assert.equal((await f.req(s,route)).status,expected,`${a} → ${b} ${route}`);
  if(a!==b)for(const [route,method,data]of [
   ['/students/'+f.pupils[b].id,'PATCH',{version:1,name:'Ataque'}],
   ['/students/'+f.pupils[b].id+'/contact','PATCH',{}],
   ['/students/'+f.pupils[b].id+'/progression','PATCH',{}],
   ['/registrations/'+f.regs[b]+'/review','POST',{version:1,decision:'rejected',reason:'Teste de bloqueio'}],
   ['/groups/'+f.groups[b].id,'PATCH',{unit:ADMIN_UNITS[a]}],
   ['/classes/'+f.classes[b].id+'/attendance','POST',{rows:[]}],
   ['/classes/'+f.classes[b].id+'/cancellation','POST',{}]])assert.equal((await f.req(s,route,method,data)).status,403,route);
 }
});
test('Núcleos: buscas, CSV, dashboard e paginação filtram antes do limite; administrador mantém visão geral',async t=>{
 const f=await fixture(t),s=f.secretaries[1];
 for(let i=0;i<60;i++)await f.store.manualRegistration(f.admin.user_id,{id:randomUUID(),student_name:'Outro Núcleo '+i,birth_date:'2016-01-01',unit:'amavale',guardian_name:'Responsável Fictício',guardian_email:'g@example.test',guardian_phone:'24999999999',relationship:'Responsável',consent_version:'teste',source_reference:'Teste isolado',checked:true});
 const r=await (await f.req(s,'/registrations')).json();assert.equal(r.registrations.length,1);assert.equal(r.has_more,false);assert.equal(r.registrations[0].unit,'valparaiso');
 for(const route of ['/students','/contacts.csv','/export.csv','/documents.csv']){const text=await (await f.req(s,route)).text();assert.match(text,/UND2_000001/);assert.doesNotMatch(text,/UND[13]_000001/)}
 const dash=await (await f.req(s,'/dashboard')).json();assert.equal(dash.students,1);assert.equal(dash.documents,1);assert.equal(dash.traffic,undefined);assert.equal(dash.registrations.pending,1);
 assert.equal((await (await f.req(f.admin,'/students')).json()).students.length,3);
 const local=f.store.forActor(s.user_id);await assert.rejects(local.import(s.user_id,[{...f.pupils[1],version:1,name:'Não salvar'},{...f.pupils[0],version:1}]),{status:403});assert.equal((await f.store.student(f.pupils[1].id)).version,1);
 for(const route of ['/audit','/staff-accounts','/members','/contact-settings','/site-editor','/diagnostics'])assert.equal((await f.req(s,route)).status,403,route);
 await assert.rejects(local.backup(),{status:403});await assert.rejects(local.futureUnclassifiedEndpoint(),{status:403});
 await assert.rejects(local.bookings(f.admin.user_id),{status:403});await assert.rejects(local.appointmentCalendar(f.admin.user_id,{from:day,to:day}),{status:403});
});
test('Núcleos: conta legada sem atribuição fica vazia; múltiplos núcleos persistem após reinício',async t=>{
 const f=await fixture(t),legacy=await f.store.provision('legacy@example.test','secretary');f.token(legacy);
 assert.deepEqual((await (await f.req(legacy,'/students')).json()).students,[]);
 assert.deepEqual((await (await f.req(legacy,'/units')).json()).units,[]);
 assert.equal((await f.req(legacy,'/students/'+f.pupils[0].id)).status,403);
 const multi=await f.store.saveStaffAccount(f.admin.user_id,legacy.user_id,account(legacy.email,['amavale','vale-do-carangola']));
 const second=createSqliteStore(f.env);try{assert.equal((await second.forActor(multi.user_id).students()).length,2)}finally{second.close()}
});
test('Núcleos: funcionários compartilhados têm lista mínima, sem documento ou alteração local',async t=>{
 const f=await fixture(t),local=f.store.forActor(f.secretaries[0].user_id),who=f.secretaries[0].user_id;
 const data={name:'Professor Compartilhado',email:'teacher@example.test',phone:'24999999999',belt_degree:'Preta',certificate_issuer:'TESTE',certificate_date:'2020-01-01',notes:'PRIVADO',availability:'PRIVADO',status:'pending',version:0,units:ADMIN_UNITS};
 const teacher=await f.store.saveTeacher(f.admin.user_id,null,data);
 const list=await local.teachers(who);assert.equal(list.length,1);assert.equal(list[0].scope_readonly,true);assert.deepEqual(list[0].units,['amavale']);assert.doesNotMatch(JSON.stringify(list),/PRIVADO/);
 await assert.rejects(local.teacher(who,teacher.user_id),{status:403});await assert.rejects(local.saveTeacher(who,teacher.user_id,{...data,units:['amavale'],version:1}),{status:403});
 await assert.rejects(local.saveTeacher(who,null,{...data,email:'other@example.test',units:['valparaiso']}),{status:403});
 const own=await local.saveTeacher(who,null,{...data,email:'local@example.test',units:['amavale']});assert.equal((await local.teacher(who,own.user_id)).name,data.name);
});
test('Núcleos: agenda presencial e online usa núcleo do atendimento, preserva aluno externo sem expor ficha',async t=>{
 const f=await fixture(t),s=f.secretaries[0],who=s.user_id,local=f.store.forActor(who),profile={name:'Profissional Compartilhado',email:'care@example.test',role:'social_worker',phone:'24999999999',rg:'TESTE',cpf:'52998224725',council_number:'TESTE',council_region:'RJ',review_until:new Date(Date.now()+100*86400000).toISOString().slice(0,10),status:'pending',version:0,units:ADMIN_UNITS};
 let care=await f.store.saveProfessional(f.admin.user_id,null,profile);for(const kind of ['photo','council'])await f.store.addProfessionalDocument(f.admin.user_id,care.user_id,{id:randomUUID(),kind,object_path:'fake/'+randomUUID()+'.pdf',mime:'application/pdf',size:20,original_name:'fixture'});care=await f.store.professional(f.admin.user_id,care.user_id);await f.store.saveProfessional(f.admin.user_id,care.user_id,{...profile,version:care.version,status:'verified',checked:true});
 const slots=[];for(let i=0;i<3;i++)slots.push(await f.store.createSlot(f.admin.user_id,{professional_id:care.user_id,unit:ADMIN_UNITS[i],day,start_time:`${10+i}:00`,end_time:`${10+i}:30`,modality:i===0?'online':'in_person',meeting_url:i===0?'https://example.test/sala':'',location:i===0?'':'Local de teste'}));
 const p={requestId:randomUUID(),studentId:f.pupils[1].id,contactName:'Responsável Fictício',phone:'24999999999',service:'Assistência social',unit:'amavale',date:day,time:'10:00',weekday:new Date(day+'T12:00:00Z').getUTCDay(),consent:true,slotId:slots[0].id,slotVersion:1};
 await f.store.createAppointmentRequest(p);const calendar=await (await f.req(s,`/appointment-calendar?from=${day}&to=${day}`)).json();assert.equal(calendar.events.length,1);assert.equal(calendar.events[0].status,'pending');assert.equal(calendar.events[0].student_id,f.pupils[1].id);
 assert.equal((await f.req(s,'/students/'+f.pupils[1].id)).status,403);assert.equal((await f.req(s,'/bookings/'+p.requestId)).status,200);
 assert.equal((await f.req(f.secretaries[1],'/bookings/'+p.requestId)).status,403);
 const available=await local.publicAppointmentSlots({studentId:p.studentId});assert.equal(available.length,0);
 await assert.rejects(local.rescheduleBooking(who,p.requestId,{slot_id:slots[1].id}),{status:403});
 await assert.rejects(local.cancelSlot(who,slots[1].id,1),{status:403});
 await assert.rejects(local.createSlot(who,{unit:'valparaiso'}),{status:403});
 assert.equal((await local.slots(who,care.user_id)).length,1);
 assert.equal((await f.req(s,'/students/'+f.pupils[0].id+'/appointment','POST',{...p,requestId:randomUUID(),unit:'valparaiso',slotId:slots[1].id})).status,403);
});
test('Núcleos: lembretes e alertas não incluem secretarias de outras unidades e revogação cancela fila',async t=>{
 const f=await fixture(t),clock=new Date(new Date().toISOString().slice(0,10)+'T23:30:00-03:00');await f.store.checkRollcalls(clock);
 const rows=f.db.prepare("SELECT i.unit,m.user_id FROM rollcall_notices n JOIN rollcall_issues i ON i.id=n.issue_id JOIN members m ON m.user_id=n.recipient_id WHERE m.role='secretary' AND n.status='pending'").all();
 assert.equal(rows.length,3);for(const r of rows)assert.equal(f.secretaries[ADMIN_UNITS.indexOf(r.unit)].user_id,r.user_id);
 const recipients=await f.store.attendanceRecipients(f.admin.user_id);for(const r of recipients)assert.equal(r.roles.find(x=>x.role==='secretary').count,1);
 const sec=f.secretaries[0];await f.store.saveStaffAccount(f.admin.user_id,sec.user_id,{...sec,units:['valparaiso']});await f.store.checkRollcalls(clock);
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM rollcall_notices n JOIN rollcall_issues i ON i.id=n.issue_id WHERE i.unit='amavale' AND n.recipient_id=? AND n.status IN ('pending','retry','sending')").get(sec.user_id).n,0);
});
