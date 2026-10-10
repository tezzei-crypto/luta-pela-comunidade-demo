import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';import sharp from 'sharp';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';import {localDay} from './professional-tools.mjs';import {normalizeClassPhoto} from './class-evidence.mjs';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-priorities-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'fake-test-only-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test'};
 const transport=async(_,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:randomUUID()})};let store=createSqliteStore(env,{transport});t.after(()=>{store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-priorities-')));fs.rmSync(dir,{force:true,recursive:true})});
 const admin=(await store.members())[0].user_id,sec=(await store.provision('secretary@example.test','secretary')).user_id,guardian=(await store.provision('guardian@example.test','guardian')).user_id;
 await store.saveStaffAccount(admin,sec,{name:'Secretaria Fictícia',email:'secretary@example.test',phone:'24999999999',role:'secretary',active:true,version:0,units:['amavale']});
 const teacher=(await store.saveTeacher(admin,null,{name:'Docente Fictício',email:'teacher@example.test',phone:'24999999999',status:'pending',test_access:true,units:['amavale'],version:0})).user_id;
 await store.import(admin,[{id:'UND1_000001',name:'Estudante Fictício',birth_date:'2018-01-01',status:'approved',version:0}]);
 const group=await store.saveGroup(admin,null,{unit:'amavale',label:'Turma Fictícia',weekdays:[0,1,2,3,4,5,6],start_time:'10:00',end_time:'11:00',active:true,students:['UND1_000001'],teachers:[teacher],version:0});
 const other=await store.saveGroup(admin,null,{...group,id:undefined,label:'Outra turma',start_time:'13:00',end_time:'14:00',students:['UND1_000001'],teachers:[],version:0});
 const dates=Array.from({length:7},(_,i)=>new Date(+new Date(localDay()+'T12:00:00Z')-(7-i)*86400000).toISOString().slice(0,10));
 const lesson=async(i,status,g=group)=>{const c=await store.createClass(admin,{group_id:g.id,day:dates[i]});if(status)await store.markAttendance(admin,c.id,[{id:'UND1_000001',status,version:0}]);return c};
 const image=await sharp({create:{width:32,height:24,channels:3,background:'#124966'}}).png().withMetadata().toBuffer();
 const photo=(version=0)=>({request_id:randomUUID(),version,caption:'Registro fictício',mime:'image/png'});
 return {env,dir,admin,sec,teacher,guardian,group,other,dates,lesson,image,photo,mail,get store(){return store},reopen(){store.close();store=createSqliteStore(env,{transport})},async token(email){await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token},request(token,route,method='GET',data){return handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+token,...(data&&! (data instanceof FormData)?{'Content-Type':'application/json'}:{})},...(data?{body:data instanceof FormData?data:JSON.stringify(data)}:{})}),env,store)}};
}
async function change(f,threshold){const p=await f.store.absencePolicy(f.admin),preview=await f.store.previewAbsencePolicy(f.admin,{threshold,version:p.version});return f.store.saveAbsencePolicy(f.admin,{threshold,version:p.version,preview_token:preview.preview_token,reason:'Ajuste fictício de acompanhamento'})}

test('Limite de faltas: prévia sem efeitos, regras 1/3/5, histórico e persistência',async t=>{
 const f=await fixture(t);await f.lesson(0,'absent');await f.lesson(1,'absent');assert.equal((await f.store.attendanceAlerts(f.admin)).length,0);
 const p=await f.store.previewAbsencePolicy(f.admin,{threshold:1,version:1});assert.deepEqual(p.impact,{active_before:0,active_after:1});assert.equal((await f.store.attendanceAlerts(f.admin)).length,0);await change(f,1);const alert=(await f.store.attendanceAlerts(f.admin))[0];assert.equal(alert.streak,2);
 await f.store.attendanceFollowup(f.sec,alert.id,{version:alert.version,workflow:'contacted',channel:'phone',outcome:'reached',note:'Contato fictício com responsável'});
 await change(f,5);assert.equal((await f.store.attendanceAlerts(f.admin))[0].signal,'corrected');assert.equal((await f.store.attendanceAlert(f.admin,alert.id)).history.length,1);
 for(let i=2;i<5;i++)await f.lesson(i,'absent');assert.equal((await f.store.attendanceAlerts(f.admin))[0].signal,'active');await change(f,3);
 f.reopen();const policy=await f.store.absencePolicy(f.admin);assert.equal(policy.threshold,3);assert.equal(policy.history.length,3);assert.equal(policy.history[0].before_threshold,5);
 assert.equal((await f.store.attendanceReport(f.admin,{from:f.dates[0],to:f.dates[6]})).absence_threshold,3);assert.equal((await f.store.rollcallSettings(f.admin)).grace_minutes,720);
});
test('Limite: apenas administrador altera; validação, token, versão e fila preservam avisos aceitos',async t=>{
 const f=await fixture(t);for(const x of [0,31,1.5,'2',null])await assert.rejects(f.store.previewAbsencePolicy(f.admin,{threshold:x,version:1}),{status:400});
 for(const who of [f.sec,f.teacher,f.guardian])await assert.rejects(f.store.previewAbsencePolicy(who,{threshold:1,version:1}),{status:403});
 const preview=await f.store.previewAbsencePolicy(f.admin,{threshold:1,version:1});await assert.rejects(f.store.saveAbsencePolicy(f.admin,{threshold:2,version:1,preview_token:preview.preview_token,reason:'Motivo fictício'}),{status:400});await change(f,1);
 await assert.rejects(f.store.saveAbsencePolicy(f.admin,{threshold:1,version:1,preview_token:preview.preview_token,reason:'Motivo fictício'}),{status:409});await f.lesson(0,'absent');
 await change(f,5);let db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));assert.equal(db.prepare("SELECT count(*) AS n FROM attendance_notices WHERE status='pending'").get().n,0);db.close();await change(f,1);await f.store.deliverAttendanceNotices();const accepted=f.mail.filter(m=>m.subject.includes('Frequência')).length;assert.ok(accepted>=1);await change(f,5);await change(f,1);await f.store.deliverAttendanceNotices();assert.equal(f.mail.filter(m=>m.subject.includes('Frequência')).length,accepted);
 const token=await f.token('secretary@example.test');assert.equal((await f.request(token,'/attendance-alerts/settings','PATCH',{threshold:2,version:4})).status,403);
});
test('Fotos: reprocessamento remove metadados, histórico, idempotência, concorrência e persistência',async t=>{
 const f=await fixture(t),c=await f.lesson(0,'present'),p=f.photo();const first=await f.store.addClassPhoto(f.teacher,c.id,f.image,p);assert.equal(first.replayed,false);assert.equal((await f.store.addClassPhoto(f.teacher,c.id,f.image,p)).replayed,true);
 const bytes=await f.store.classPhoto(f.teacher,c.id,first.id),meta=await sharp(bytes).metadata();assert.equal(meta.format,'jpeg');assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);
 let e=await f.store.classEvidence(f.admin,c.id);assert.equal(e.photos.length,1);await f.store.reviewClassPhoto(f.admin,c.id,{version:e.check.version,photo_id:first.id,attendance_fingerprint:e.check.attendance_fingerprint,decision:'needs_photo',note:'Enviar uma foto mais nítida'});assert.equal((await f.store.classEvidence(f.teacher,c.id)).check.status,'needs_photo');
 const proposals=[f.photo(2),f.photo(2)];const results=await Promise.allSettled(proposals.map(p=>f.store.addClassPhoto(f.teacher,c.id,f.image,p)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 e=await f.store.classEvidence(f.admin,c.id);assert.equal(e.photos.length,2);await f.store.reviewClassPhoto(f.sec,c.id,{version:e.check.version,photo_id:e.photos[0].id,attendance_fingerprint:e.check.attendance_fingerprint,decision:'approved',note:''});
 f.reopen();e=await f.store.classEvidence(f.admin,c.id);assert.equal(e.check.status,'approved');assert.equal(e.history.length,4);assert.equal((await f.store.attendance(f.admin,c.id)).students[0].status,'present');
});
test('Fotos: professor restrito à turma, guarda privada e chamada alterada exige nova conferência',async t=>{
 const f=await fixture(t),c=await f.lesson(0,'present'),other=await f.lesson(0,'present',f.other),p=f.photo();await f.store.addClassPhoto(f.teacher,c.id,f.image,p);
 for(const who of [f.guardian,(await f.store.provision('care@example.test','psychologist')).user_id]){await assert.rejects(f.store.classEvidence(who,c.id),{status:403});await assert.rejects(f.store.classPhoto(who,c.id,p.request_id),{status:403});}
 await assert.rejects(f.store.addClassPhoto(f.teacher,other.id,f.image,f.photo()),{status:403});await assert.rejects(f.store.reviewClassPhoto(f.teacher,c.id,{}),{status:403});
 const e=await f.store.classEvidence(f.admin,c.id);await f.store.markAttendance(f.admin,c.id,[{id:'UND1_000001',status:'justified',version:1}]);await assert.rejects(f.store.reviewClassPhoto(f.admin,c.id,{version:e.check.version,photo_id:p.request_id,attendance_fingerprint:e.check.attendance_fingerprint,decision:'approved',note:''}),{status:409});assert.equal((await f.store.classEvidence(f.admin,c.id)).check.status,'changed');
 const token=await f.token('teacher@example.test'),response=await f.request(token,'/classes/'+c.id+'/photos/'+p.request_id);assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('Content-Type'),'image/jpeg');assert.equal((await f.request(token,'/classes/'+other.id+'/photos')).status,403);assert.equal((await f.request(token,'/classes/'+c.id+'/photos/'+p.request_id+'/review','POST',{})).status,403);
});
test('Fotos: arquivo falso, tipo divergente, tamanho, data, cancelamento e conflitos não gravam',async t=>{
 const f=await fixture(t),c=await f.lesson(0),p=f.photo();await assert.rejects(normalizeClassPhoto(Buffer.from('<svg><script/></svg>'),'image/svg+xml'),{status:400});await assert.rejects(normalizeClassPhoto(f.image,'image/jpeg'),{status:400});await assert.rejects(normalizeClassPhoto(Buffer.alloc(8*1024*1024+1),'image/png'),{status:400});
 await assert.rejects(f.store.addClassPhoto(f.admin,c.id,f.image,{...p,version:9}),{status:409});assert.equal((await f.store.classEvidence(f.admin,c.id)).photos.length,0);
 await f.store.cancelClass(f.admin,c.id,{cancelled:true,reason:'Cancelamento fictício'});await assert.rejects(f.store.addClassPhoto(f.admin,c.id,f.image,p),{status:400});
 const future=await f.store.createClass(f.admin,{group_id:f.group.id,day:'2099-01-01'});await assert.rejects(f.store.addClassPhoto(f.admin,future.id,f.image,p),{status:400});
});
test('Fotos HTTP: upload multipart válido, reenvio e falhas claras, sem alterar chamada',async t=>{
 const f=await fixture(t),c=await f.lesson(0),token=await f.token('teacher@example.test'),requestId=randomUUID();
 const data=()=>{const form=new FormData();form.set('file',new File([f.image],'teste.png',{type:'image/png'}));form.set('caption','Foto fictícia');form.set('request_id',requestId);form.set('version','0');return form};
 let response=await f.request(token,'/classes/'+c.id+'/photos','POST',data());assert.equal(response.status,201);response=await f.request(token,'/classes/'+c.id+'/photos','POST',data());assert.equal(response.status,200);assert.equal((await response.json()).replayed,true);assert.equal((await f.store.attendance(f.admin,c.id)).students[0].status,'unmarked');
 const tampered=data();tampered.set('caption','Outro conteúdo');assert.equal((await f.request(token,'/classes/'+c.id+'/photos','POST',tampered)).status,409);assert.equal((await f.request(token,'/classes/'+c.id+'/photos','POST',new FormData())).status,400);
});
