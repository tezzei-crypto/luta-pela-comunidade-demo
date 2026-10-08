import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {localDay,addDays,shiftMonth,period,daysIn,groupEvents,hourLabel} from './dist/portal/calendar-model.js';
const tomorrow=addDays(localDay(),2),until=addDays(localDay(),200);
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-calendar-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'only-calendar-tests-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test',PUBLIC_ORIGIN:'https://example.test'};
 const store=createSqliteStore(env,{transport:async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'test'})}}),admin=(await store.members())[0];
 t.after(()=>{store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-calendar-')));fs.rmSync(dir,{recursive:true,force:true})});
 const login=async email=>{await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token};
 const token=await login(admin.email),request=(route,auth=token)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{headers:{origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+auth}}),env,store);
 await store.import(admin.user_id,[{id:'UND1_000001',name:'Aluno Fictício Amavale',birth_date:'2015-02-01',status:'approved',version:0},{id:'UND2_000001',name:'Aluno Fictício Valparaíso',birth_date:'2018-04-01',status:'approved',version:0}]);
 async function professional(role='psychologist',email='professional@example.test'){
  const profile={name:'Profissional Fictício '+role,email,role,phone:'21999999999',rg:'TESTE123',cpf:'52998224725',council_number:'TESTE-000',council_region:'RJ',review_until:until,status:'pending',version:0,units:['amavale','valparaiso']};let p=await store.saveProfessional(admin.user_id,null,profile);
  for(const kind of ['photo','council'])await store.addProfessionalDocument(admin.user_id,p.user_id,{id:randomUUID(),kind,object_path:'tests/'+randomUUID()+'.pdf',mime:kind==='photo'?'image/png':'application/pdf',size:24,original_name:'fake'});
  p=await store.professional(admin.user_id,p.user_id);return store.saveProfessional(admin.user_id,p.user_id,{...profile,status:'verified',version:p.version,checked:true});
 }
 const slot=(uid,start='13:10',end='14:10',unit='amavale',day=tomorrow)=>store.createSlot(admin.user_id,{professional_id:uid,unit,day,start_time:start,end_time:end});
 const book=s=>store.bookSlot(admin.user_id,s.id,{id:randomUUID(),student_id:s.unit==='amavale'?'UND1_000001':'UND2_000001',contact_name:'Responsável fictício',phone:'21999999999',consent:true,version:s.version});
 const calendar=(actor=admin.user_id,params={})=>store.appointmentCalendar(actor,{from:tomorrow,to:tomorrow,...params});
 return {store,dir,admin,request,login,professional,slot,book,calendar};
}
test('Calendário: mês, semana, anos bissextos e fuso de Brasília sem depender do dispositivo',()=>{
 assert.equal(localDay('2026-10-10T02:59:59Z'),'2026-10-09');assert.equal(localDay('2026-10-10T03:00:00Z'),'2026-10-10');assert.equal(hourLabel('2026-10-09T16:10:00Z'),'13:10');
 assert.deepEqual(period('2026-10-09','week'),{from:'2026-10-05',to:'2026-10-11'});assert.deepEqual(period('2026-10-09','day'),{from:'2026-10-09',to:'2026-10-09'});assert.equal(daysIn(period('2026-10-09','month')).length,42);
 assert.equal(shiftMonth('2028-01-31',1),'2028-02-29');assert.equal(shiftMonth('2027-01-31',1),'2027-02-28');assert.equal(shiftMonth('2026-12-15',1),'2027-01-15');assert.equal(addDays('2028-02-28',1),'2028-02-29');
 const groups=groupEvents([{start_at:'2026-10-10T02:00:00Z',professional_name:'B'},{start_at:'2026-10-09T16:10:00Z',professional_name:'A'}]);assert.equal(groups.get('2026-10-09').length,2);assert.equal(groups.get('2026-10-09')[0].professional_name,'A');
});
test('Calendário: horários livres, núcleo, reserva, confirmação e cancelamento sem duplicar vaga',async t=>{
 const f=await fixture(t),p=await f.professional(),s=await f.slot(p.user_id);let e=(await f.calendar()).events[0];assert.equal(e.status,'free');assert.equal(e.unit,'amavale');assert.equal(e.student_name,null);assert.equal(hourLabel(e.start_at),'13:10');
 const b=await f.book(s);e=(await f.calendar()).events[0];assert.equal(e.status,'pending');assert.equal(e.student_name,'Aluno Fictício Amavale');assert.equal(e.booking_id,b.id);
 const c=await f.store.reviewBooking(f.admin.user_id,b.id,{status:'confirmed',version:b.version,reason:'Família confirmou no teste',contacted:true});assert.equal((await f.calendar()).events[0].status,'confirmed');
 await f.store.reviewBooking(f.admin.user_id,b.id,{status:'cancelled',version:c.version,reason:'Cancelamento fictício'});const free=await f.calendar();assert.equal(free.events.length,1);assert.equal(free.events[0].status,'free');assert.equal(free.events[0].student_name,null);
 await f.store.cancelSlot(f.admin.user_id,s.id,s.version);assert.equal((await f.calendar()).events[0].status,'withdrawn');
});
test('Calendário: filtros, CSV e detalhes respeitam isolamento entre profissionais e responsáveis',async t=>{
 const f=await fixture(t),p=await f.professional(),other=await f.professional('social_worker','other@example.test'),s=await f.slot(p.user_id),b=await f.book(s);await f.slot(other.user_id,'15:00','16:00','valparaiso');
 assert.equal((await f.calendar()).events.length,2);assert.equal((await f.calendar(f.admin.user_id,{unit:'valparaiso'})).events[0].professional_id,other.user_id);assert.equal((await f.calendar(f.admin.user_id,{status:'free'})).events.length,1);assert.equal((await f.calendar(p.user_id)).events.length,1);
 const own=await f.login(p.email),otherToken=await f.login(other.email),route='/appointment-calendar?from='+tomorrow+'&to='+tomorrow;
 assert.equal((await f.request(route,own)).status,200);assert.equal((await (await f.request(route,otherToken)).json()).events[0].student_name,null);assert.equal((await f.request(route+'&professional='+p.user_id,otherToken)).status,403);
 assert.equal((await f.request('/bookings/'+b.id,otherToken)).status,403);assert.equal((await f.request('/bookings/'+b.id,own)).status,200);
 const g=await f.store.provision('guardian@example.test','guardian'),gToken=await f.login(g.email);assert.equal((await f.request(route,gToken)).status,403);const teacher=await f.store.saveTeacher(f.admin.user_id,null,{name:'Professor Fictício',email:'teacher@example.test',phone:'21999999999',status:'pending',version:0,units:['amavale']});assert.equal((await f.request(route,await f.login(teacher.email))).status,403);
 const response=await f.request('/appointment-calendar.csv?from='+tomorrow+'&to='+tomorrow+'&status=free');assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');const csv=await response.text();assert.match(csv,/Livre/);assert.match(csv,/valparaiso/);assert.doesNotMatch(csv,/Aluno Fictício Amavale|21999999999|52998224725/);
 const events=(await f.calendar()).events;for(const e of events)for(const privateKey of ['phone','cpf','rg','email','contact_name','reason','requested_by','request_hash'])assert.equal(e[privateKey],undefined);
});
test('Calendário: período válido, limite de consulta e meia-noite em Brasília',async t=>{
 const f=await fixture(t),p=await f.professional();await f.slot(p.user_id,'00:00','00:50');await f.slot(p.user_id,'23:00','23:59');await f.slot(p.user_id,'00:00','00:50','amavale',addDays(tomorrow,1));assert.equal((await f.calendar()).events.length,2);
 for(const params of [{from:'2026-02-30'},{to:'2026-01-01'},{from:'2026-01-01',to:'2026-12-31'},{unit:'unknown'},{status:'unknown'},{professional:'bad'}])await assert.rejects(f.calendar(f.admin.user_id,params),{status:400});
 assert.equal((await f.request('/appointment-calendar')).status,400);
});
test('Calendário: liberação revogada e horário passado nunca aparecem como livres',async t=>{
 const f=await fixture(t),p=await f.professional(),s=await f.slot(p.user_id);await f.store.setMember(f.admin.user_id,p.user_id,p.role,false);assert.equal((await f.calendar()).events[0].status,'unavailable');
 const dbFile=fs.readdirSync(f.dir).find(n=>n.endsWith('.sqlite'));assert.ok(dbFile);const db=new DatabaseSync(path.join(f.dir,dbFile));db.prepare('UPDATE appointment_slots SET start_at=?,end_at=? WHERE id=?').run('2026-01-01T16:10:00.000Z','2026-01-01T17:10:00.000Z',s.id);db.close();assert.equal((await f.calendar(f.admin.user_id,{from:'2026-01-01',to:'2026-01-01'})).events[0].status,'expired');
});
