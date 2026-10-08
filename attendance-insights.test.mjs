import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {localDay} from './professional-tools.mjs';
import {absenceEpisodes} from './attendance-insights.mjs';
import {excelWorkbook} from './excel-export.mjs';

async function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-attendance-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'test-only-'.repeat(5),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',RESEND_API_KEY:'fake',MAIL_FROM:'sender@example.test',PUBLIC_ORIGIN:'https://test.example'};
 const transport=async(u,o)=>{mail.push({url:u,...JSON.parse(o.body),key:o.headers['Idempotency-Key']});return options.transport?options.transport(u,o):Response.json({id:randomUUID()})};let store=createSqliteStore(env,{transport});
 t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true})});const owner=(await store.members())[0];const initialPolicy=await store.rollcallSettings(owner.user_id);if(!options.keepDefaultPolicy)await store.saveRollcallSettings(owner.user_id,{...initialPolicy,grace_minutes:60});const admin=(await store.members())[0],sec=await store.provision('secretary@example.test','secretary'),guardian=await store.provision('guardian@example.test','guardian');
 const pupils=[{id:'UND1_000001',name:'Aluno Alfa Fictício',birth_date:'2018-01-01',status:'approved',version:0},{id:'UND1_000002',name:'Aluno Beta Fictício',birth_date:'2017-02-02',status:'approved',version:0},{id:'UND2_000001',name:'Outro Núcleo Fictício',birth_date:'2018-03-03',status:'approved',version:0}];await store.import(admin.user_id,pupils);
 const teacher=await store.saveTeacher(admin.user_id,null,{name:'Professor Fictício',email:'teacher@example.test',phone:'24999999999',status:'pending',test_access:true,units:['amavale'],version:0});
 const data={unit:'amavale',label:'Turma A',weekdays:[0,1,2,3,4,5,6],start_time:'15:00',end_time:'16:00',active:true,students:pupils.slice(0,2).map(s=>s.id),teachers:[teacher.user_id],version:0};
 const group=await store.saveGroup(admin.user_id,null,data),other=await store.saveGroup(admin.user_id,null,{...data,label:'Turma B',teachers:[],start_time:'17:00',end_time:'18:00'});
 const dates=Array.from({length:8},(_,i)=>new Date(+new Date(localDay()+'T12:00:00Z')-(8-i)*86400000).toISOString().slice(0,10));
 const lesson=async(i,status,g=group)=>{const c=await store.createClass(admin.user_id,{group_id:g.id,day:dates[i]});if(status)await store.markAttendance(admin.user_id,c.id,[{id:pupils[0].id,status,version:0}]);return c};
 const login=async email=>{await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token};
 const request=(token,url,method='GET',data)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+url,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,store);
 const care=async(role,unit='amavale')=>{const email=role+'-'+unit+'@example.test',p={name:'Profissional Fictício',email,role,phone:'24999999999',rg:'TESTE',cpf:'52998224725',council_number:'TESTE',council_region:'RJ',review_until:'2099-01-01',status:'pending',version:0,units:[unit]};let user=await store.saveProfessional(admin.user_id,null,p);for(const kind of ['photo','council'])await store.addProfessionalDocument(admin.user_id,user.user_id,{id:randomUUID(),kind,object_path:'fake/'+randomUUID(),mime:'image/png',size:20,original_name:'fake'});user=await store.professional(admin.user_id,user.user_id);return store.saveProfessional(admin.user_id,user.user_id,{...p,status:'verified',checked:true,version:user.version})};
 return {get store(){return store},transport,env,dir,admin,sec,guardian,teacher,group,other,pupils,dates,lesson,mail,login,request,care,data,reopen(){store.close();store=createSqliteStore(env,{transport})}};
}
test('Sequências: justificativa e desconhecido interrompem; cancelamento não vira falta',()=>{
 const rows=(statuses)=>statuses.map((status,i)=>({status,day:String(i),class_id:String(i)}));assert.equal(absenceEpisodes(rows(['absent','absent'])).length,0);assert.equal(absenceEpisodes(rows(['absent','absent','absent','absent']))[0].rows.length,4);
 for(const middle of ['present','justified','unmarked'])assert.equal(absenceEpisodes(rows(['absent','absent',middle,'absent'])).length,0);
 const r=rows(['absent','unmarked','absent','absent']);r[1].cancelled=1;assert.equal(absenceEpisodes(r)[0].rows.length,3);
});
test('Três faltas geram um alerta; a quarta atualiza o mesmo e correções preservam histórico',async t=>{
 const f=await fixture(t);const first=await f.lesson(0,'absent');await f.lesson(1,'absent');assert.equal((await f.store.attendanceAlerts(f.admin.user_id)).length,0);await f.lesson(2,'absent');let a=(await f.store.attendanceAlerts(f.admin.user_id))[0];assert.equal(a.streak,3);await f.lesson(3,'absent');let rows=await f.store.attendanceAlerts(f.admin.user_id);assert.equal(rows.length,1);assert.equal(rows[0].id,a.id);assert.equal(rows[0].streak,4);
 await f.store.attendanceFollowup(f.sec.user_id,a.id,{version:rows[0].version,workflow:'attempted',channel:'phone',outcome:'no_reply',note:'Tentativa fictícia sem resposta',next_contact:localDay()});
 await f.store.markAttendance(f.admin.user_id,first.id,[{id:f.pupils[0].id,status:'justified',version:1}]);rows=await f.store.attendanceAlerts(f.admin.user_id);assert.equal(rows.find(r=>r.id===a.id).signal,'corrected');assert.equal((await f.store.attendanceAlert(f.admin.user_id,a.id)).history.length,1);assert.equal(rows.filter(r=>r.signal==='active').length,1);
});
test('Turmas isoladas, sem marcação, justificativa, retorno e inatividade não geram falsos alertas',async t=>{
 const f=await fixture(t);await f.lesson(0,'absent');await f.lesson(1,'absent',f.other);await f.lesson(2,'absent');assert.equal((await f.store.attendanceAlerts(f.admin.user_id)).length,0);await f.lesson(3);await f.lesson(4,'absent');assert.equal((await f.store.attendanceAlerts(f.admin.user_id)).length,0);await f.lesson(5,'absent');await f.lesson(6,'absent');assert.equal((await f.store.attendanceAlerts(f.admin.user_id))[0].signal,'active');await f.lesson(7,'present');assert.equal((await f.store.attendanceAlerts(f.admin.user_id))[0].signal,'returned');
});
test('Relatório distingue ausência de dados, filtra núcleo/turma e exclui cancelamentos',async t=>{
 const f=await fixture(t);const c=await f.lesson(0,'present');await f.lesson(1,'absent');await f.lesson(2,'justified');await f.lesson(3);await f.lesson(4,'absent',f.other);
 let r=await f.store.attendanceReport(f.admin.user_id,{from:f.dates[0],to:f.dates[7],unit:'amavale',group_id:f.group.id});assert.deepEqual([r.totals.present,r.totals.absent,r.totals.justified,r.totals.unmarked],[1,1,1,5]);assert.equal(r.summary.find(s=>s.student_id===f.pupils[0].id).frequency,33.3);assert.equal(r.summary.find(s=>s.student_id===f.pupils[1].id).frequency,null);
 await f.store.cancelClass(f.teacher.user_id,c.id,{cancelled:true,reason:'Aula fictícia cancelada'});r=await f.store.attendanceReport(f.admin.user_id,{from:f.dates[0],to:f.dates[7],unit:'amavale',group_id:f.group.id});assert.equal(r.totals.present,0);assert.equal(r.totals.classes,3);await assert.rejects(f.store.markAttendance(f.teacher.user_id,c.id,[{id:f.pupils[0].id,status:'absent',version:1}]),{status:400});
 await assert.rejects(f.store.attendanceReport(f.admin.user_id,{from:f.dates[0],to:'2099-01-01'}),{status:400});
});
test('Professor só abre, consulta e lança chamadas de turmas vinculadas',async t=>{
 const f=await fixture(t);assert.equal((await f.store.groups(f.teacher.user_id,'amavale')).length,1);const denied=await f.lesson(0,'present',f.other);await assert.rejects(f.store.createClass(f.teacher.user_id,{group_id:f.other.id,day:f.dates[0]}),{status:403});await assert.rejects(f.store.attendance(f.teacher.user_id,denied.id),{status:403});await assert.rejects(f.store.markAttendance(f.teacher.user_id,denied.id,[{id:f.pupils[0].id,status:'absent',version:1}]),{status:403});await assert.rejects(f.store.cancelClass(f.teacher.user_id,denied.id,{cancelled:true,reason:'Sem vínculo'}),{status:403});assert.equal((await f.store.attendanceExport(f.teacher.user_id,'amavale',f.dates[0],f.dates[7])).length,0);
});

test('CSV de frequência exclui aulas canceladas e volta a incluí-las após reabertura',async t=>{
 const f=await fixture(t),c=await f.lesson(0,'present');
 assert.equal((await f.store.attendanceExport(f.admin.user_id,'amavale',f.dates[0],f.dates[7])).length,1);
 await f.store.cancelClass(f.teacher.user_id,c.id,{cancelled:true,reason:'Aula cancelada para teste'});
 assert.equal((await f.store.attendanceExport(f.admin.user_id,'amavale',f.dates[0],f.dates[7])).length,0);
 await f.store.cancelClass(f.teacher.user_id,c.id,{cancelled:false,reason:'Aula reaberta após conferência'});
 assert.equal((await f.store.attendanceExport(f.admin.user_id,'amavale',f.dates[0],f.dates[7])).length,1);
});

test('Turma nova não inventa chamadas anteriores ao cadastro; aulas históricas abertas continuam verificáveis',async t=>{
 const f=await fixture(t),db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));
 try{
  db.prepare("UPDATE attendance_monitor_settings SET value=? WHERE key='start_day'").run(f.dates[0]);
  f.store.checkRollcalls(new Date(localDay()+'T23:59:00-03:00'));
  assert.equal(db.prepare('SELECT count(*) n FROM rollcall_issues WHERE day<?').get(localDay()).n,0);
  await f.lesson(0);
  f.store.checkRollcalls(new Date(localDay()+'T23:59:00-03:00'));
  assert.equal(db.prepare('SELECT count(*) n FROM rollcall_issues WHERE day=? AND group_id=?').get(f.dates[0],f.group.id).n,1);
 }finally{db.close()}
});

test('Migração de turma preserva vínculos, versões e o monitoramento de turmas antigas',async t=>{
 const f=await fixture(t),db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));
 // Simulate the legacy schema, which predates both created_day and synchronization.
 db.exec('DROP TRIGGER IF EXISTS sync_class_groups_update; ALTER TABLE class_groups DROP COLUMN created_day');db.close();f.reopen();
 const before=await f.store.group(f.admin.user_id,f.group.id);
 assert.equal(before.created_day,'');assert.deepEqual(before.teachers,[f.teacher.user_id]);assert.equal(before.students.filter(s=>s.enrolled).length,2);
 const updated=await f.store.saveGroup(f.admin.user_id,f.group.id,{...f.data,version:before.version,created_day:'2099-01-01'});
 assert.equal(updated.created_day,'');assert.equal(updated.version,before.version+1);
 f.reopen();assert.equal((await f.store.group(f.admin.user_id,f.group.id)).created_day,'');
});
test('Relatórios e contatos: responsáveis e professores bloqueados; profissionais limitados ao núcleo',async t=>{
 const f=await fixture(t),care=await f.care('psychologist'),other=await f.care('social_worker','valparaiso');for(let i=0;i<3;i++)await f.lesson(i,'absent');const a=(await f.store.attendanceAlerts(f.admin.user_id))[0];
 for(const user of [f.teacher,f.guardian]){const token=await f.login(user.email);for(const url of ['/attendance-report/options','/attendance-alerts','/attendance-alerts/'+a.id,'/attendance-report.xlsx?from='+f.dates[0]+'&to='+f.dates[7]])assert.equal((await f.request(token,url)).status,403)}
 const token=await f.login(care.email);assert.equal((await f.request(token,'/attendance-alerts/'+a.id)).status,200);assert.equal((await f.request(token,'/attendance-report?unit=valparaiso&from='+f.dates[0]+'&to='+f.dates[7])).status,403);assert.equal((await f.request(token,'/rollcall-issues')).status,403);assert.equal((await f.store.attendanceAlerts(other.user_id)).length,0);await assert.rejects(f.store.attendanceAlert(other.user_id,a.id),{status:403});
});
test('Avisos duráveis para quatro perfis, sem alunos no email e sem repetição na quarta falta',async t=>{
 const f=await fixture(t);await f.care('psychologist');await f.care('social_worker');await f.care('psychologist','valparaiso');for(let i=0;i<3;i++)await f.lesson(i,'absent');f.reopen();await f.store.deliverAttendanceNotices();assert.equal(f.mail.length,4);assert.ok(f.mail.every(m=>m.to.length===1&&!m.text.includes('Aluno Alfa')));assert.equal(new Set(f.mail.map(m=>m.key)).size,4);await f.lesson(3,'absent');await f.store.deliverAttendanceNotices();assert.equal(f.mail.length,4);const a=(await f.store.attendanceAlerts(f.admin.user_id))[0];assert.equal((await f.store.attendanceAlert(f.admin.user_id,a.id)).notifications.filter(n=>n.status==='accepted').length,4);
});
test('Revogação de acesso e correção da falta cancelam avisos ainda não enviados',async t=>{
 const f=await fixture(t);const p=await f.care('psychologist');const classes=[];for(let i=0;i<3;i++)classes.push(await f.lesson(i,'absent'));await f.store.setMember(f.admin.user_id,p.user_id,'psychologist',false);await f.store.markAttendance(f.admin.user_id,classes[1].id,[{id:f.pupils[0].id,status:'justified',version:1}]);await f.store.deliverAttendanceNotices();assert.equal(f.mail.length,0);
});
test('Acompanhamento auditado, persistente e protegido contra sobrescrita concorrente',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++)await f.lesson(i,'absent');const a=(await f.store.attendanceAlerts(f.admin.user_id))[0],p={version:a.version,workflow:'attempted',channel:'phone',outcome:'no_reply',note:'Contato fictício sem resposta',next_contact:localDay()};await f.store.attendanceFollowup(f.sec.user_id,a.id,p);await assert.rejects(f.store.attendanceFollowup(f.admin.user_id,a.id,p),{status:409});f.reopen();const saved=await f.store.attendanceAlert(f.admin.user_id,a.id);assert.equal(saved.owner_email,f.sec.email);assert.equal(saved.history.length,1);assert.equal(saved.history[0].note,p.note);assert.equal(saved.workflow,'attempted');
});
test('Chamada pendente: prazo de uma hora, ocorrência única, email e resolução automática',async t=>{
 const f=await fixture(t),clock=new Date(localDay()+'T17:01:00-03:00');f.store.checkRollcalls(new Date(localDay()+'T16:59:00-03:00'));let db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));assert.equal(db.prepare('SELECT count(*) n FROM rollcall_issues').get().n,0);f.store.checkRollcalls(clock);let issues=db.prepare('SELECT * FROM rollcall_issues').all();assert.equal(issues.length,1);assert.equal(issues[0].expected,2);f.store.checkRollcalls(clock);assert.equal(db.prepare('SELECT count(*) n FROM rollcall_issues').get().n,1);
 const c=await f.store.createClass(f.teacher.user_id,{group_id:f.group.id,day:localDay()});await f.store.markAttendance(f.teacher.user_id,c.id,f.pupils.slice(0,2).map(s=>({id:s.id,status:'present',version:0})));f.store.checkRollcalls(clock);assert.equal(db.prepare('SELECT status FROM rollcall_issues WHERE id=?').get(issues[0].id).status,'resolved');db.close();
});
test('Excel válido em ZIP OOXML: texto literal, Unicode, células numéricas e sem fórmulas injetadas',()=>{
 const b=excelWorkbook([{name:'Presenças',columns:[{key:'name',label:'Aluno'},{key:'n',label:'Presenças'}],rows:[{name:'=HYPERLINK("malicioso") & ação',n:3}]}]);let offset=0;const files={};while(b.readUInt32LE(offset)===0x04034b50){const size=b.readUInt32LE(offset+18),nl=b.readUInt16LE(offset+26),xl=b.readUInt16LE(offset+28),name=b.subarray(offset+30,offset+30+nl).toString(),start=offset+30+nl+xl;files[name]=inflateRawSync(b.subarray(start,start+size)).toString();offset=start+size}assert.match(files['xl/worksheets/sheet1.xml'],/=HYPERLINK/);assert.match(files['xl/worksheets/sheet1.xml'],/&amp; ação/);assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<f[ >]/);assert.match(files['xl/worksheets/sheet1.xml'],/<v>3<\/v>/);assert.ok(files['[Content_Types].xml']);
});

test('Migração preserva o professor único do núcleo; retirada manual não é recriada ao reiniciar',async t=>{
 const f=await fixture(t),db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));db.exec('DROP TABLE group_teachers');db.close();f.reopen();
 assert.deepEqual((await f.store.group(f.admin.user_id,f.group.id)).teachers,[f.teacher.user_id]);let g=await f.store.group(f.admin.user_id,f.group.id);await f.store.saveGroup(f.admin.user_id,g.id,{...f.data,teachers:[],version:g.version});f.reopen();assert.equal((await f.store.group(f.admin.user_id,g.id)).teachers.length,0);
});

test('Chamada atrasada avisa professor vinculado, secretaria e administradores, sem duplicar após reinício',async t=>{
 const f=await fixture(t);await f.care('psychologist');const db=new DatabaseSync(path.join(f.dir,'portal.sqlite')),yesterday=f.dates.at(-1);db.prepare("UPDATE attendance_monitor_settings SET value=? WHERE key='start_day'").run(yesterday);db.prepare('UPDATE class_groups SET created_day=?').run(yesterday);db.close();
 const clock=new Date(localDay()+'T19:01:00-03:00');await f.store.deliverRollcallNotices(clock);const first=f.mail.length;assert.ok(first>=4);assert.ok(f.mail.every(m=>[f.admin.email,f.sec.email,f.teacher.email].includes(m.to[0])&&m.subject.includes('Chamada pendente')&&!m.text.includes('Aluno Alfa')));assert.equal(f.mail.filter(m=>m.to[0]===f.teacher.email).length,1);f.reopen();await f.store.deliverRollcallNotices(clock);assert.equal(f.mail.length,first);
});

test('Regras de chamada editáveis: limites, concorrência, persistência e permissões HTTP',async t=>{
 const f=await fixture(t),p=await f.store.rollcallSettings(f.admin.user_id);
 assert.equal(p.grace_minutes,60);assert.equal(p.can_edit,true);
 const teacherToken=await f.login(f.teacher.email),adminToken=await f.login(f.admin.email),guardianToken=await f.login(f.guardian.email);
 assert.equal((await f.request(teacherToken,'/rollcall-issues')).status,200);
 assert.equal((await f.request(guardianToken,'/rollcall-issues')).status,403);
 for(const token of [teacherToken,guardianToken])assert.equal((await f.request(token,'/rollcall-settings','POST',p)).status,403);
 assert.equal((await f.request(adminToken,'/rollcall-settings','POST',{...p,grace_minutes:-1})).status,400);
 assert.equal((await f.request(adminToken,'/rollcall-settings','POST',{...p,teacher_email:'true'})).status,400);
 const saved=await f.store.saveRollcallSettings(f.admin.user_id,{...p,grace_minutes:15,repeat_hours:48,max_notices:3});
 assert.equal(saved.version,p.version+1);await assert.rejects(f.store.saveRollcallSettings(f.admin.user_id,p),{status:409});f.reopen();assert.equal((await f.store.rollcallSettings(f.admin.user_id)).grace_minutes,15);
});

test('Prazo configurável, isolamento do professor e conclusão imediata sem inventar faltas',async t=>{
 const f=await fixture(t),db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{
 await f.store.saveRollcallSettings(f.admin.user_id,{...await f.store.rollcallSettings(f.admin.user_id),grace_minutes:0});
 // Policy reconciliation uses the real clock; isolate the boundary under test.
 db.exec('DELETE FROM rollcall_notices; DELETE FROM rollcall_issues');
 f.store.checkRollcalls(new Date(localDay()+'T15:59:00-03:00'));assert.equal(db.prepare('SELECT count(*) n FROM rollcall_issues').get().n,0);
 const clock=new Date(localDay()+'T19:01:00-03:00');f.store.checkRollcalls(clock);
 let own=await f.store.rollcallIssues(f.teacher.user_id,{},clock);assert.equal(own.length,1);assert.equal(own[0].group_id,f.group.id);assert.ok(own[0].notifications.every(n=>n.recipient_id===f.teacher.user_id));
 const c=await f.store.createClass(f.teacher.user_id,{group_id:f.group.id,day:localDay()});
 await f.store.markAttendance(f.teacher.user_id,c.id,[{id:f.pupils[0].id,status:'present',version:0}]);assert.equal(db.prepare('SELECT status FROM rollcall_issues WHERE group_id=?').get(f.group.id).status,'open');
 assert.equal(db.prepare("SELECT count(*) n FROM attendance WHERE status='absent'").get().n,0);
 await f.store.markAttendance(f.teacher.user_id,c.id,[{id:f.pupils[1].id,status:'justified',version:0}]);assert.equal(db.prepare('SELECT status FROM rollcall_issues WHERE group_id=?').get(f.group.id).status,'resolved');
 await f.store.deliverRollcallNotices(clock);assert.equal(f.mail.filter(m=>m.to[0]===f.teacher.email).length,0);
 }finally{db.close()}
});

test('Pausa noturna, repetição limitada, parada por conclusão e suspensão global',async t=>{
 const f=await fixture(t),db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{
 db.prepare('UPDATE class_groups SET weekdays=?').run(JSON.stringify([new Date(localDay()+'T12:00:00Z').getUTCDay()]));
 const night=new Date(localDay()+'T23:00:00-03:00'),morning=new Date(+night+9*3600000);
 await f.store.deliverRollcallNotices(night);assert.equal(f.mail.length,0);
 await f.store.deliverRollcallNotices(morning);assert.equal(f.mail.length,5);
 await f.store.deliverRollcallNotices(new Date(+morning+23*3600000));assert.equal(f.mail.length,5);
 await f.store.deliverRollcallNotices(new Date(+morning+24*3600000));assert.equal(f.mail.length,10);
 await f.store.deliverRollcallNotices(new Date(+morning+48*3600000));assert.equal(f.mail.length,10);assert.equal(new Set(f.mail.map(m=>m.key)).size,10);
 await f.store.saveRollcallSettings(f.admin.user_id,{...await f.store.rollcallSettings(f.admin.user_id),enabled:false,max_notices:5});
 await f.store.deliverRollcallNotices(new Date(+morning+72*3600000));assert.equal(f.mail.length,10);
 }finally{db.close()}
});

test('Cancelamento, revogação e retirada do vínculo impedem email ao professor',async t=>{
 const f=await fixture(t),clock=new Date(localDay()+'T19:00:00-03:00');f.store.checkRollcalls(clock);
 let g=await f.store.group(f.admin.user_id,f.group.id);await f.store.saveGroup(f.admin.user_id,g.id,{...f.data,teachers:[],version:g.version});
 assert.equal((await f.store.rollcallIssues(f.teacher.user_id,{},clock)).length,0);await f.store.deliverRollcallNotices(clock);assert.equal(f.mail.filter(m=>m.to[0]===f.teacher.email).length,0);
 g=await f.store.group(f.admin.user_id,f.group.id);await f.store.saveGroup(f.admin.user_id,g.id,{...f.data,version:g.version});
 const c=await f.store.createClass(f.teacher.user_id,{group_id:g.id,day:localDay()});await f.store.cancelClass(f.teacher.user_id,c.id,{cancelled:true,reason:'Aula não ocorreu por teste'});
 await f.store.deliverRollcallNotices(clock);assert.equal(f.mail.filter(m=>m.to[0]===f.teacher.email).length,0);
 await f.store.cancelClass(f.teacher.user_id,c.id,{cancelled:false,reason:'Correção do cancelamento de teste'});await f.store.setMember(f.admin.user_id,f.teacher.user_id,'teacher',false);
 await f.store.deliverRollcallNotices(clock);assert.equal(f.mail.filter(m=>m.to[0]===f.teacher.email).length,0);
});

test('Falha de rede tenta novamente com a mesma chave e após 23h exige conferência',async t=>{
 const f=await fixture(t,{transport:async()=>{throw Error('falha simulada')}}),clock=new Date(localDay()+'T19:00:00-03:00');
 await f.store.deliverRollcallNotices(clock);assert.equal(f.mail.length,5);const keys=f.mail.map(m=>m.key);
 await f.store.deliverRollcallNotices(new Date(+clock+60000));assert.equal(f.mail.length,5);
 await f.store.deliverRollcallNotices(new Date(+clock+300000));assert.equal(f.mail.length,10);assert.deepEqual(f.mail.slice(5).map(m=>m.key),keys);
 const db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{db.prepare('UPDATE class_groups SET weekdays=?').run('[]');await f.store.deliverRollcallNotices(new Date(+clock+23*3600000));assert.equal(db.prepare("SELECT count(*) n FROM rollcall_notices WHERE status='review'").get().n,5);assert.equal(f.mail.length,10)}finally{db.close()}
});

test('Dois processos, recuperação de lease e migração não duplicam aviso aceito',async t=>{
 const f=await fixture(t,{transport:async()=>{await new Promise(resolve=>setTimeout(resolve,10));return Response.json({id:randomUUID()})}}),clock=new Date(localDay()+'T19:00:00-03:00');
 const other=createSqliteStore(f.env,{transport:f.transport});try{await Promise.all([f.store.deliverRollcallNotices(clock),other.deliverRollcallNotices(clock)])}finally{other.close()}
 assert.equal(f.mail.length,5);assert.equal(new Set(f.mail.map(m=>m.key)).size,5);
 const db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{
  assert.equal(db.prepare('SELECT count(*) n FROM rollcall_notice_history').get().n,5);
  db.exec("UPDATE rollcall_notices SET send_count=0 WHERE status='accepted'");f.reopen();await f.store.deliverRollcallNotices(clock);assert.equal(f.mail.length,5);
  db.prepare("UPDATE rollcall_notices SET status='sending',send_count=0,last_sent=0,attempts=1,first_attempt=?,lease_until=?,claim_token='interrupted' WHERE recipient_id=?").run(+clock,+clock+120000,f.teacher.user_id);
  await f.store.deliverRollcallNotices(new Date(+clock+60000));assert.equal(f.mail.length,5);
  await f.store.deliverRollcallNotices(new Date(+clock+120000));assert.equal(f.mail.length,6);assert.ok(f.mail.slice(0,5).some(m=>m.key===f.mail[5].key));
 }finally{db.close()}
});

test('Servidor sem email mantém a pendência visível sem afirmar envio',async t=>{
 const f=await fixture(t);f.env.RESEND_API_KEY='';const clock=new Date(localDay()+'T19:00:00-03:00');await f.store.deliverRollcallNotices(clock);
 assert.equal(f.mail.length,0);assert.equal((await f.store.rollcallSettings(f.admin.user_id)).mail_configured,false);
 const rows=await f.store.rollcallIssues(f.teacher.user_id,{},clock);assert.equal(rows.length,1);assert.equal(rows[0].notifications[0].status,'pending');assert.equal(rows[0].notifications[0].send_count,0);
});

test('Prazo inicial de 12 horas atravessa a meia-noite e não envia lembrete antecipado',async t=>{
 const f=await fixture(t,{keepDefaultPolicy:true}),p=await f.store.rollcallSettings(f.admin.user_id);assert.equal(p.grace_minutes,720);
 const before=new Date(localDay()+'T23:59:00-03:00');await f.store.deliverRollcallNotices(before);assert.equal(f.mail.length,0);
 assert.equal((await f.store.rollcallIssues(f.teacher.user_id,{},before)).length,0);
 const nextDay=new Date(+new Date(localDay()+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const boundary=new Date(nextDay+'T04:00:00-03:00');await f.store.deliverRollcallNotices(boundary);assert.equal(f.mail.length,0);
 assert.equal((await f.store.rollcallIssues(f.teacher.user_id,{},boundary)).length,1);
 await f.store.deliverRollcallNotices(new Date(nextDay+'T08:00:00-03:00'));assert.equal(f.mail.filter(m=>m.to[0]===f.teacher.email).length,1);
 // Increasing the grace period also postpones an already-created occurrence.
 await f.store.saveRollcallSettings(f.admin.user_id,{...p,grace_minutes:1440});
 const rows=await f.store.rollcallIssues(f.teacher.user_id,{},new Date(nextDay+'T08:01:00-03:00'));assert.equal(rows[0].within_grace,true);
});

test('Nova tentativa preserva o conteúdo enviado mesmo com progresso parcial da chamada',async t=>{
 let failed=true;const f=await fixture(t,{transport:async()=>{if(failed)throw Error('tempo esgotado');return Response.json({id:randomUUID()})}}),clock=new Date(localDay()+'T19:00:00-03:00');
 await f.store.deliverRollcallNotices(clock);const before=f.mail.find(m=>m.to[0]===f.teacher.email);
 const c=await f.store.createClass(f.teacher.user_id,{group_id:f.group.id,day:localDay()});await f.store.markAttendance(f.teacher.user_id,c.id,[{id:f.pupils[0].id,status:'present',version:0}]);
 failed=false;await f.store.deliverRollcallNotices(new Date(+clock+300000));const after=f.mail.filter(m=>m.to[0]===f.teacher.email).at(-1);
 assert.equal(after.key,before.key);assert.equal(after.text,before.text);
});
