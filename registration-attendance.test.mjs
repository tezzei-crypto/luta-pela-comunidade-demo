import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomBytes,createHash,randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';import {localDay} from './professional-tools.mjs';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-registration-attendance-')),env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'isolated-pending-call-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false'};
 let store=createSqliteStore(env);const db=new DatabaseSync(path.join(dir,'portal.sqlite'));t.after(()=>{db.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-registration-attendance-')));fs.rmSync(dir,{recursive:true,force:true})});
 const admin=(await store.members())[0],teacher=await store.saveTeacher(admin.user_id,null,{name:'Docente Fictício do Vale',email:'teacher@example.test',phone:'24999999999',status:'pending',test_access:true,units:['vale-do-carangola'],version:0}),other=await store.saveTeacher(admin.user_id,null,{name:'Outro Docente Fictício',email:'other@example.test',phone:'24999999998',status:'pending',test_access:true,units:['amavale','vale-do-carangola'],version:0}),guardian=await store.provision('parent@example.test','guardian'),local=await store.saveStaffAccount(admin.user_id,null,{name:'Secretaria Local Fictícia',email:'local@example.test',phone:'24999999997',role:'secretary',secretary_level:'local',units:['vale-do-carangola'],active:true,version:0});
 const records=await store.importRegistrationDrafts(admin.user_id,{unit:'vale-do-carangola',rows:Array.from({length:34},(_,i)=>({student_name:'Criança Fictícia '+String(i+1).padStart(2,'0'),birth_date:'2018-01-01',source_key:'ficticio-'+i,source_reference:'Ficha fictícia '+i}))});
 const ids=records.records.map(r=>r.id),groups=[];for(const [label,start,end,registrations]of [['Manhã Fictícia','10:30','11:30',ids.slice(0,15)],['Tarde Fictícia','15:00','16:00',ids.slice(15)]])groups.push(await store.saveGroup(admin.user_id,null,{unit:'vale-do-carangola',label,weekdays:[1,3],start_time:start,end_time:end,active:true,teachers:[teacher.user_id],students:[],registrations,version:0}));
 const date=new Date(localDay()+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);const day=date.toISOString().slice(0,10);db.prepare("UPDATE attendance_monitor_settings SET value=? WHERE key IN ('start_day','teacher_start_day')").run(day);
 const tokens=new Map();for(const m of [admin,teacher,other,guardian,local]){const tok=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(tok).digest('hex'),m.user_id,Date.now()+3600000);tokens.set(m.user_id,tok);}
 const req=(m,route,method='GET',data)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+tokens.get(m.user_id),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),env,store);
 const open=async index=>{const res=await req(teacher,'/classes','POST',{group_id:groups[index].id,day});assert.equal(res.status,201);return (await res.json()).lesson};
 return {db,env,dir,admin,teacher,other,guardian,local,ids,groups,day,req,open,get store(){return store},reopen(){store.close();store=createSqliteStore(env)}};
}

test('Professor restrito ao Vale vê duas turmas e chama 15 e 19 crianças sem dados completos; salva, reabre e mantém autoria',async t=>{
 const f=await fixture(t),list=await (await f.req(f.teacher,'/groups?unit=vale-do-carangola')).json();assert.deepEqual(list.groups.map(g=>g.provisional_enrolled),[15,19]);assert.equal((await f.req(f.teacher,'/groups?unit=amavale')).status,403);
 for(const [i,expected]of [[0,15],[1,19]]){
  const c=await f.open(i),again=await f.open(i);assert.equal(again.id,c.id);let data=await (await f.req(f.teacher,'/classes/'+c.id+'/attendance')).json();assert.equal(data.students.length,expected);assert.equal(data.can_write,true);assert.ok(data.students.every(r=>r.provisional===1&&r.status==='unmarked'&&r.enrollment_status==='incomplete'&&!('guardian_email'in r)&&!('birth_date'in r)));
  await f.store.rollcallIssues(f.admin.user_id,{},new Date(f.day+'T23:59:00-03:00'));
  const before=await f.store.classEvidence(f.admin.user_id,c.id),marks=data.students.map((r,n)=>({id:r.id,status:['present','absent','justified'][n%3],version:0,updated_by:f.admin.user_id}));
  assert.equal((await f.req(f.teacher,'/classes/'+c.id+'/attendance','POST',{rows:marks})).status,200);
  data=await (await f.req(f.teacher,'/classes/'+c.id+'/attendance')).json();assert.equal(data.students.filter(r=>r.status==='unmarked').length,0);assert.ok(data.students.every(r=>r.updated_by===f.teacher.user_id&&r.updated_by_name===f.teacher.name&&r.version===1));
  const after=await f.store.classEvidence(f.admin.user_id,c.id);assert.notEqual(after.check.attendance_fingerprint,before.check.attendance_fingerprint);
  const history=await (await f.req(f.teacher,'/classes/'+c.id+'/attendance-history')).json();assert.equal(history.changes.length,expected);assert.ok(history.changes.every(r=>r.actor===f.teacher.user_id));
  const review=await f.store.classReviewTask(f.admin.user_id,c.id);assert.equal(review.summary.counts.roster,expected);assert.equal(review.summary.counts.unmarked,0);
  const issue=(await f.store.rollcallIssues(f.teacher.user_id,{},new Date(f.day+'T23:59:00-03:00'))).find(r=>r.class_id===c.id);assert.equal(issue.status,'resolved');assert.equal(issue.expected,expected);assert.equal(issue.marked,expected);
 }
 assert.equal(f.db.prepare('SELECT count(*) n FROM students').get().n,0);assert.equal(f.db.prepare("SELECT count(*) n FROM registrations WHERE status='needs_info' AND guardian_email='' AND student_id IS NULL").get().n,34);
 const exportRows=await f.store.attendanceExport(f.teacher.user_id,'vale-do-carangola',f.day,f.day);assert.equal(exportRows.length,34);assert.ok(exportRows.every(r=>r.record_type==='registration'));
 const operations=await f.store.operationsSummary(f.admin.user_id,f.day);assert.equal(operations.lessons.reduce((n,r)=>n+r.roster_size,0),34);assert.ok(operations.lessons.every(r=>r.attendance_complete));assert.equal(operations.totals.participations,12);
 f.reopen();assert.equal((await f.store.attendance(f.teacher.user_id,(await f.open(0)).id)).students.length,15);
});

test('Chamada pendente: nega outra turma, professor sem vínculo, responsável, secretaria local, futuro e aula cancelada; conflitos revertem lote',async t=>{
 const f=await fixture(t),c=await f.open(0),route='/classes/'+c.id+'/attendance',first=f.ids[0];
 for(const who of [f.other,f.guardian]){assert.equal((await f.req(who,route)).status,403);assert.equal((await f.req(who,route,'POST',{rows:[{id:first,status:'present',version:0}]})).status,403)}
 assert.equal((await (await f.req(f.local,route)).json()).can_write,false);assert.equal((await f.req(f.local,route,'POST',{rows:[{id:first,status:'present',version:0}]})).status,403);
 assert.equal((await f.req(f.teacher,route,'POST',{rows:[{id:first,status:'present',version:0},{id:f.ids[15],status:'present',version:0}]})).status,403);assert.equal((await f.store.attendance(f.teacher.user_id,c.id)).students[0].status,'unmarked');
 assert.equal((await f.req(f.teacher,route,'POST',{rows:[{id:first,status:'present',version:0}]})).status,200);assert.equal((await f.req(f.teacher,route,'POST',{rows:[{id:first,status:'absent',version:0}]})).status,409);
 assert.equal((await f.req(f.teacher,route,'POST',{rows:[{id:first,status:'absent',version:1},{id:first,status:'present',version:1}]})).status,400);assert.equal((await f.store.attendance(f.teacher.user_id,c.id)).students[0].status,'present');
 assert.equal((await f.req(f.teacher,'/quick-intakes','POST',{id:randomUUID(),class_id:c.id,name:'Criança Fictícia 01',age:8,guardian_name:'',phone:''})).status,409);
 await f.store.cancelClass(f.admin.user_id,c.id,{cancelled:true,reason:'Cancelamento fictício'});assert.equal((await f.req(f.teacher,route,'POST',{rows:[{id:first,status:'absent',version:1}]})).status,400);
 await f.store.cancelClass(f.admin.user_id,c.id,{cancelled:false,reason:'Reabertura fictícia'});const futureDay=new Date(Date.parse(f.day+'T12:00:00Z')+7*86400000).toISOString().slice(0,10),future=await f.store.createClass(f.teacher.user_id,{group_id:f.groups[0].id,day:futureDay});assert.equal((await f.req(f.teacher,'/classes/'+future.id+'/attendance','POST',{rows:[{id:first,status:'present',version:0}]})).status,400);f.db.prepare("UPDATE teacher_profiles SET test_access=0 WHERE user_id=?").run(f.teacher.user_id);assert.equal((await f.req(f.teacher,route)).status,403);
});

test('Histórico misto usa paginação única; snapshots pendentes não mudam ao editar a turma e não aprovam fichas',async t=>{
 const f=await fixture(t);await f.store.import(f.admin.user_id,[{id:'UND3_000001',name:'Aluno Aprovado Fictício',birth_date:'2017-01-01',status:'approved',version:0}]);
 await f.store.saveGroup(f.admin.user_id,f.groups[0].id,{...f.groups[0],students:['UND3_000001'],registrations:f.ids.slice(0,15)});const c=await f.open(0);assert.equal((await f.store.attendance(f.teacher.user_id,c.id)).students.length,16);
 await f.store.markAttendance(f.teacher.user_id,c.id,[{id:f.ids[0],status:'present',version:0},{id:'UND3_000001',status:'present',version:0},{id:f.ids[1],status:'absent',version:0}]);const history=await f.store.attendanceHistory(f.teacher.user_id,c.id);assert.equal(new Set(history.changes.map(r=>r.id)).size,3);const older=await f.store.attendanceHistory(f.teacher.user_id,c.id,history.changes[0].id);assert.equal(older.changes.length,2);
 const g=await f.store.group(f.admin.user_id,f.groups[0].id);await f.store.saveGroup(f.admin.user_id,g.id,{...g,students:[],registrations:[]});assert.equal((await f.store.attendance(f.teacher.user_id,c.id)).students.length,16);assert.equal(f.db.prepare("SELECT count(*) n FROM registrations WHERE status='needs_info'").get().n,34);
});


test('Aprovação posterior preserva chamada provisória e futuras chamadas trazem a matrícula sem duplicação',async t=>{
 const f=await fixture(t),c=await f.open(0),id=f.ids[0];await f.store.markAttendance(f.teacher.user_id,c.id,[{id,status:'present',version:0}]);
 for(const kind of ['photo','student_document','guardian_document','medical_certificate','consent']){const r=await f.store.registration(id);await f.store.registrationUpload(f.admin.user_id,id,r.version,{id:randomUUID(),kind,object_path:'fixture/'+randomUUID(),original_name:'FICTICIO',mime:kind==='photo'?'image/jpeg':'application/pdf',size:20})}
 let r=await f.store.registration(id);await f.store.saveRegistrationDraftContact(f.admin.user_id,id,{guardian_name:'Responsável Fictício',guardian_email:'family@example.test',guardian_phone:'24999999999',relationship:'Mãe',version:r.version});r=await f.store.registration(id);const approved=await f.store.reviewRegistration(f.admin.user_id,id,{decision:'approved',reason:'',checked:true,version:r.version});
 const old=await f.store.attendance(f.teacher.user_id,c.id);assert.equal(old.students.length,15);assert.equal(old.students.find(r=>r.id===id).status,'present');assert.equal(old.students.find(r=>r.id===id).enrollment_status,'approved');
 const nextDay=new Date(Date.parse(f.day+'T12:00:00Z')+2*86400000).toISOString().slice(0,10),next=await f.store.createClass(f.teacher.user_id,{group_id:f.groups[0].id,day:nextDay}),rows=(await f.store.attendance(f.teacher.user_id,next.id)).students;assert.equal(rows.length,15);assert.equal(rows.filter(r=>r.id===approved.student_id).length,1);assert.equal(rows.filter(r=>r.id===id).length,0);
});
