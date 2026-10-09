import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';import {handleAgenda,handleAgendaSlots} from './agenda-handler.mjs';import {handlePortal} from './portal-handler.mjs';
import {spawn} from 'node:child_process';
const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10),until=new Date(Date.now()+200*86400000).toISOString().slice(0,10);
async function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-flow-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'test-only-'.repeat(5),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test',PUBLIC_ORIGIN:'https://example.test'};
 const transport=async(u,o)=>{mail.push({...JSON.parse(o.body),key:o.headers['Idempotency-Key']});return options.transport?options.transport(u,o):Response.json({id:'test'})},store=createSqliteStore(env,{transport}),admin=(await store.members())[0];t.after(()=>{store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-flow-')));fs.rmSync(dir,{recursive:true,force:true})});
 await store.import(admin.user_id,[{id:'UND1_000001',name:'Aluno fictício A',birth_date:'2010-02-01',status:'approved',version:0},{id:'UND2_000001',name:'Aluno fictício B',birth_date:'2010-02-01',status:'approved',version:0}]);
 const profile={name:'Profissional fictício',email:'care@example.test',role:'social_worker',phone:'21999999999',rg:'FICTICIO',cpf:'52998224725',council_number:'TESTE',council_region:'RJ',review_until:until,status:'pending',version:0,units:['amavale','valparaiso']};let professional=await store.saveProfessional(admin.user_id,null,profile);for(const kind of ['photo','council'])await store.addProfessionalDocument(admin.user_id,professional.user_id,{id:randomUUID(),kind,object_path:'test/'+randomUUID()+'.png',mime:'image/png',size:24,original_name:'fake'});professional=await store.professional(admin.user_id,professional.user_id);professional=await store.saveProfessional(admin.user_id,professional.user_id,{...profile,status:'verified',version:professional.version,checked:true});
 const slot=(start='13:10',end='14:10',extra={})=>store.createSlot(admin.user_id,{professional_id:professional.user_id,unit:'amavale',day,start_time:start,end_time:end,...extra});
 const payload=(s,extra={})=>({requestId:randomUUID(),studentId:'UND2_000001',contactName:'Solicitante fictício',phone:'21999999999',service:'Assistência social',unit:'amavale',date:day,time:s?new Date(new Date(s.start_at)-3*3600000).toISOString().slice(11,16):'13:10',weekday:new Date(day+'T12:00:00Z').getUTCDay(),consent:true,...(s?{slotId:s.id,slotVersion:s.version}:{}),...extra});
 const request=(body,route='/api/agenda')=>new Request(env.PUBLIC_ORIGIN+route,{method:'POST',headers:{origin:env.PUBLIC_ORIGIN,'content-type':'application/json'},body:JSON.stringify(body)});
 const calendar=()=>store.appointmentCalendar(admin.user_id,{from:day,to:day});const registry=()=>store.students();
 const post=p=>handleAgenda(request(p),env,transport,registry,undefined,()=>store);
 return {store,env,dir,admin,professional,slot,payload,calendar,post,request,mail,transport};
}
test('Fluxo público: vaga gravada antes do email, calendário ocupado e protocolo idempotente sem dados privados',async t=>{
 const f=await fixture(t),s=await f.slot(),p=f.payload(s),before=await f.store.systemRevision(f.admin.user_id);const r=await f.post(p);assert.equal(r.status,200);const receipt=await r.json();assert.equal(receipt.reserved,true);assert.equal(receipt.protocol,p.requestId);assert.deepEqual(Object.keys(receipt).sort(),['message','protocol','reserved','status']);
 let events=(await f.calendar()).events;assert.equal(events.length,1);assert.equal(events[0].status,'pending');assert.equal(events[0].student_id,p.studentId);assert.notEqual((await f.store.systemRevision(f.admin.user_id)).revision,before.revision);
 assert.equal((await f.post(p)).status,200);assert.equal(f.mail.length,1);assert.equal((await f.store.bookings(f.admin.user_id)).length,1);assert.equal((await f.store.publicAppointmentSlots({studentId:p.studentId})).length,0);assert.doesNotMatch(f.mail[0].text,/Aluno fictício|21999999999/);
 assert.equal((await f.post({...p,phone:'11999999999'})).status,409);
});
test('Fluxo público: concorrência entre conexões, sem duplicar vaga ou aluno',async t=>{
 const f=await fixture(t),s=await f.slot(),other=createSqliteStore(f.env);try{const results=await Promise.allSettled([f.store.createAppointmentRequest(f.payload(s)),other.createAppointmentRequest(f.payload(s,{studentId:'UND1_000001'}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected')[0].reason.status,409);assert.equal((await f.calendar()).events.length,1);assert.equal((await f.store.appointmentRequests(f.admin.user_id)).length,0)}finally{other.close()}
});
test('Preferência: aparece no calendário, pode ser recuperada de email e exige ciência para mudança de especialidade',async t=>{
 const f=await fixture(t),s=await f.slot(),p=f.payload(null,{service:'Psicologia',unit:'valparaiso'});const result=await f.store.createAppointmentRequest(p,f.admin.user_id);assert.equal(result.reserved,false);assert.equal(f.mail.length,0);let events=(await f.calendar()).events;assert.equal(events.filter(e=>e.status==='waiting').length,1);assert.equal(events.filter(e=>e.status==='free').length,1);
 await assert.rejects(f.store.reviewAppointmentRequest(f.admin.user_id,p.requestId,{action:'reserve',version:1,slot_id:s.id,slot_version:s.version,reason:'Especialidade corrigida'}));
 await f.store.reviewAppointmentRequest(f.admin.user_id,p.requestId,{action:'reserve',version:1,slot_id:s.id,slot_version:s.version,reason:'Solicitante corrigiu especialidade e núcleo',change_ack:true});events=(await f.calendar()).events;assert.equal(events.length,1);assert.equal(events[0].status,'pending');assert.equal(events[0].booking_id,p.requestId);assert.equal((await f.store.appointmentRequests(f.admin.user_id)).length,0);
 const b=await f.store.booking(f.admin.user_id,p.requestId);assert.equal(b.service,'social_worker');assert.equal(b.unit,'amavale');
});
test('Online: sem expor link público, confirmação privada, remarcação atômica e liberação da vaga anterior',async t=>{
 const f=await fixture(t),s=await f.slot('13:10','14:10',{modality:'online',meeting_url:'https://meet.google.com/ficticio-teste'}),p=f.payload(s);let publicSlots=await f.store.publicAppointmentSlots({studentId:p.studentId});assert.equal(publicSlots[0].modality,'online');assert.equal(publicSlots[0].meeting_url,undefined);
 await f.store.createAppointmentRequest(p);let b=await f.store.booking(f.admin.user_id,p.requestId);assert.equal(b.modality,'online');await assert.rejects(f.store.reviewBooking(f.admin.user_id,b.id,{status:'confirmed',version:b.version,reason:'Teste',contacted:false}));b=await f.store.reviewBooking(f.admin.user_id,b.id,{status:'confirmed',version:b.version,reason:'Família confirmou no teste',contacted:true});
 assert.equal((await f.calendar()).events[0].meeting_url,undefined);const s2=await f.slot('15:00','16:00');await assert.rejects(f.store.rescheduleBooking(f.admin.user_id,b.id,{version:b.version,slot_id:s2.id,slot_version:s2.version,reason:'Nova disponibilidade',change_ack:false}));
 b=await f.store.rescheduleBooking(f.admin.user_id,b.id,{version:b.version,slot_id:s2.id,slot_version:s2.version,reason:'Nova disponibilidade',change_ack:true});assert.equal(b.status,'pending');assert.equal(b.slot_id,s2.id);assert.equal((await f.calendar()).events.find(e=>e.id===s.id).status,'free');
 await f.store.reviewBooking(f.admin.user_id,b.id,{version:b.version,status:'cancelled',reason:'Cancelamento fictício'});assert.equal((await f.calendar()).events.filter(e=>e.status==='free').length,2);
});
test('Falha de email mantém solicitação durável e reenvio recupera aviso sem nova reserva',async t=>{
 const f=await fixture(t),s=await f.slot(),p=f.payload(s);delete f.env.RESEND_API_KEY;const result=await f.post(p);assert.equal(result.status,200);assert.equal((await result.json()).reserved,true);assert.equal((await f.store.pendingAppointmentNotices()).length,1);assert.equal((await f.calendar()).events[0].status,'pending');f.env.RESEND_API_KEY='fake';await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,1);assert.equal((await f.store.pendingAppointmentNotices()).length,0);await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,1);
});
test('Autorização, revogação, campos inválidos, isolamento e conflito de versão',async t=>{
 const f=await fixture(t),s=await f.slot(),p=f.payload(s),g=await f.store.provision('guardian@example.test','guardian');await assert.rejects(f.store.appointmentRequests(g.user_id),{status:403});await assert.rejects(f.store.createAppointmentRequest(p,g.user_id),{status:403});
 for(const change of [{slotVersion:99},{service:'Psicologia'},{unit:'valparaiso'},{time:'14:10'}])assert.equal((await f.post({...p,...change})).status,409);
 for(const change of [{phone:'0'},{consent:false},{date:'2027-02-30'},{time:'24:00'}])assert.equal((await f.post({...p,...change})).status,400);
 const slots=await handleAgendaSlots(f.request({studentId:p.studentId},'/api/agenda/slots'),f.env,()=>f.store);assert.equal(slots.status,200);assert.equal((await slots.json()).slots[0].meeting_url,undefined);
 await f.store.setMember(f.admin.user_id,f.professional.user_id,'social_worker',false);assert.equal((await f.store.publicAppointmentSlots({studentId:p.studentId})).length,0);assert.equal((await f.post(p)).status,403);
});
test('Migração preserva reservas, idempotência e vínculos; reabertura mantém calendário',async t=>{
 const f=await fixture(t),s=await f.slot();const b=await f.store.bookSlot(f.admin.user_id,s.id,{id:randomUUID(),student_id:'UND1_000001',contact_name:'Responsável teste',phone:'21999999999',consent:true,version:s.version});const copy=path.join(f.dir,'migration-copy');fs.mkdirSync(copy);const db=new DatabaseSync(path.join(copy,'portal.sqlite'));const source=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{const sql=source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name IN ('members','students','professional_profiles','appointment_slots')").all();for(const row of sql)db.exec(row.sql);for(const table of ['members','students','professional_profiles','appointment_slots']){for(const row of source.prepare('SELECT * FROM '+table).all()){const keys=Object.keys(row);db.prepare('INSERT INTO '+table+'('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...Object.values(row))}}
 db.exec("CREATE TABLE bookings(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,slot_id TEXT NOT NULL REFERENCES appointment_slots(id),student_id TEXT NOT NULL REFERENCES students(id),requested_by TEXT NOT NULL REFERENCES members(user_id),contact_name TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,notice_state TEXT NOT NULL DEFAULT 'pending')");const row=source.prepare('SELECT * FROM bookings WHERE id=?').get(b.id);db.prepare('INSERT INTO bookings VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));}finally{source.close();db.close()}
 const upgraded=createSqliteStore({...f.env,PORTAL_DATA_DIR:copy});try{assert.equal((await upgraded.booking(f.admin.user_id,b.id)).student_id,'UND1_000001');assert.equal((await upgraded.appointmentCalendar(f.admin.user_id,{from:day,to:day})).events[0].booking_id,b.id)}finally{upgraded.close()}
});
test('Servidor HTTP real: fluxo público persiste sem configuração de email, valida origem e reflete no calendário',async t=>{
 const f=await fixture(t),s=await f.slot(),child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,...f.env,PORT:'0',HOST:'127.0.0.1',PUBLIC_ORIGIN:'',RENDER_EXTERNAL_URL:'',ADDITIONAL_PUBLIC_ORIGINS:'',RENDER:'false',RESEND_API_KEY:'',MAIL_FROM:''},stdio:['ignore','pipe','pipe'],windowsHide:true});
 try{const base=await new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(Error('Servidor de teste não iniciou')),10000);child.once('exit',code=>{clearTimeout(timer);reject(Error('Servidor encerrou: '+code))});child.stdout.on('data',chunk=>{text+=chunk;const m=text.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timer);resolve(m[0])}});child.stderr.on('data',()=>{});});
  const post=(route,data,origin=base)=>fetch(base+route,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await post('/api/agenda/slots',{studentId:'UND2_000001'})).status,200);assert.equal((await post('/api/agenda/slots',{studentId:'UND2_000001'},'https://other.invalid')).status,403);
  const response=await post('/api/agenda',f.payload(s));assert.equal(response.status,200);assert.equal((await response.json()).reserved,true);assert.equal((await f.calendar()).events[0].status,'pending');
 }finally{child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve)})}
});

test('Modalidade: uma vaga presencial não pode ser solicitada como online nem o inverso',async t=>{
 const f=await fixture(t),physical=await f.slot(),online=await f.slot('15:00','16:00',{modality:'online'});
 for(const [slot,modality]of [[physical,'online'],[online,'in_person']]){
  assert.equal((await f.post(f.payload(slot,{modality}))).status,409);
 }
 assert.equal((await f.store.bookings(f.admin.user_id)).length,0);
 assert.equal((await f.calendar()).events.filter(e=>e.status==='free').length,2);
});

test('Link da sala: responsável vinculado recebe somente após confirmação e perde acesso no cancelamento',async t=>{
 const f=await fixture(t),g=await f.store.provision('linked@example.test','guardian');await f.store.link(f.admin.user_id,g.user_id,'UND2_000001');
 const room='https://meet.google.com/sala-ficticia',s=await f.slot('13:10','14:10',{modality:'online',meeting_url:room});
 const p={id:randomUUID(),student_id:'UND2_000001',contact_name:'Responsável fictício',phone:'21999999999',consent:true,version:s.version};
 let b=await f.store.bookSlot(g.user_id,s.id,p);assert.ok(!b.meeting_url);
 assert.ok(!(await f.store.booking(g.user_id,b.id)).meeting_url);assert.ok(!(await f.store.bookings(g.user_id))[0].meeting_url);
 assert.equal((await f.store.booking(f.admin.user_id,b.id)).meeting_url,room);
 b=await f.store.reviewBooking(f.admin.user_id,b.id,{status:'confirmed',version:b.version,contacted:true,reason:'Confirmação fictícia'});
 assert.equal((await f.store.booking(g.user_id,b.id)).meeting_url,room);
 await f.store.reviewBooking(f.admin.user_id,b.id,{status:'cancelled',version:b.version,reason:'Cancelamento fictício'});
 assert.ok(!(await f.store.booking(g.user_id,b.id)).meeting_url);
});

test('Resposta perdida: repetir protocolo após o horário recupera resultado e não cria nova solicitação',async t=>{
 const f=await fixture(t),s=await f.slot(),p=f.payload(s);assert.equal((await f.post(p)).status,200);
 let b=await f.store.booking(f.admin.user_id,p.requestId);await f.store.reviewBooking(f.admin.user_id,b.id,{version:b.version,status:'confirmed',contacted:true,reason:'Confirmação fictícia'});
 t.mock.timers.enable({apis:['Date'],now:new Date(+new Date(s.end_at)+60000)});
 try{
  b=await f.store.booking(f.admin.user_id,p.requestId);await f.store.reviewBooking(f.admin.user_id,b.id,{version:b.version,status:'completed',reason:'Atendimento fictício concluído'});
  const response=await f.post(p);assert.equal(response.status,200);const data=await response.json();assert.equal(data.status,'completed');assert.equal(data.reserved,false);assert.match(data.message,/realizado|concluído/i);assert.doesNotMatch(data.message,/Preferência registrada/);
  assert.equal((await f.post({...p,requestId:randomUUID()})).status,400);assert.equal((await f.store.bookings(f.admin.user_id)).length,1);
 }finally{t.mock.timers.reset()}
});

test('Aviso privado: falha de email é retomada pelo trabalho periódico, sem reservar novamente',async t=>{
 let fail=true;const f=await fixture(t,{transport:async()=>{if(fail)throw Error('Falha fictícia');return Response.json({id:'accepted'})}}),s=await f.slot();
 const b=await f.store.bookSlot(f.admin.user_id,s.id,{id:randomUUID(),student_id:'UND1_000001',contact_name:'Responsável fictício',phone:'21999999999',consent:true,version:s.version});
 await f.store.sendBookingNotice(f.admin.user_id,b.id);assert.equal(f.mail.length,1);fail=false;
 t.mock.timers.enable({apis:['Date'],now:Date.now()+300001});
 try{await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,2);assert.deepEqual(f.mail[0],f.mail[1]);await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,2);assert.equal((await f.calendar()).events[0].status,'pending')}finally{t.mock.timers.reset()}
});

test('Aviso cancelado: não envia solicitação que foi encerrada antes da entrega',async t=>{
 const f=await fixture(t),p=f.payload(null);await f.store.createAppointmentRequest(p);
 await f.store.reviewAppointmentRequest(f.admin.user_id,p.requestId,{action:'cancel',version:1,reason:'Cancelado no teste antes do aviso'});
 await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,0);
});

test('API da agenda: JSON nulo, lista ou primitivo retorna erro de validação, nunca falha interna',async t=>{
 const f=await fixture(t);await f.store.requestCode(f.env.BOOTSTRAP_ADMIN_EMAIL);const token=(await f.store.verifyCode(f.env.BOOTSTRAP_ADMIN_EMAIL,f.mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token;
 for(const data of [null,[],false,'texto',123])for(const [route,method] of [['/slots','POST'],['/appointment-requests','POST'],['/auth/request','POST'],['/teachers','POST'],['/monitors','POST'],['/workforce-sessions','POST'],['/reports','POST'],['/students/UND1_000001/contact','PATCH'],['/students/UND1_000001/progression','PATCH'],['/graduation-policy','PATCH'],['/site-editor/page?page=home','PATCH']]){
  const req=new Request(f.env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{origin:f.env.PUBLIC_ORIGIN,authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(data)});
  assert.equal((await handlePortal(req,f.env,f.store)).status,400,route+' '+JSON.stringify(data));
 }
});

test('Estados da reserva: matriz completa das 25 transições após o atendimento',async t=>{
 const allowed={pending:['confirmed','cancelled'],confirmed:['cancelled','completed','absent'],cancelled:[],completed:[],absent:[]};
 for(const from of Object.keys(allowed))for(const to of Object.keys(allowed))await t.test(from+' → '+to,async t=>{
  const f=await fixture(t),s=await f.slot(),p=f.payload(s);await f.store.createAppointmentRequest(p);let b=await f.store.booking(f.admin.user_id,p.requestId);
  if(from!=='pending'&&from!=='cancelled')b=await f.store.reviewBooking(f.admin.user_id,b.id,{version:b.version,status:'confirmed',contacted:true,reason:'Preparação fictícia'});
  if(['completed','absent'].includes(from))t.mock.timers.enable({apis:['Date'],now:new Date(+new Date(s.end_at)+60000)});
  if(['completed','absent','cancelled'].includes(from))b=await f.store.reviewBooking(f.admin.user_id,b.id,{version:b.version,status:from,reason:'Preparação fictícia'});
  const operation=f.store.reviewBooking(f.admin.user_id,b.id,{version:b.version,status:to,contacted:true,reason:'Transição de teste'});
  if(allowed[from].includes(to)&&!['completed','absent'].includes(to))assert.equal((await operation).status,to);
  else if(allowed[from].includes(to)){
   await assert.rejects(operation,{status:400});t.mock.timers.enable({apis:['Date'],now:new Date(+new Date(s.end_at)+60000)});
   assert.equal((await f.store.reviewBooking(f.admin.user_id,b.id,{version:b.version,status:to,reason:'Resultado após o fim'})).status,to);
  }else await assert.rejects(operation);
  t.mock.timers.reset();
 });
});

test('Remarcação: conflito, versão antiga, reserva ocupada e repetição preservam a reserva original',async t=>{
 const f=await fixture(t),a=await f.slot(),b=await f.slot('14:10','15:10'),c=await f.slot('15:10','16:10');
 const p=f.payload(a);await f.store.createAppointmentRequest(p);await f.store.createAppointmentRequest(f.payload(b,{studentId:'UND1_000001'}));let booking=await f.store.booking(f.admin.user_id,p.requestId);
 for(const change of [{slot_id:b.id,slot_version:b.version},{slot_id:c.id,slot_version:99},{slot_id:c.id,slot_version:c.version,version:99},{slot_id:c.id,slot_version:c.version,change_ack:false}]){
  await assert.rejects(f.store.rescheduleBooking(f.admin.user_id,booking.id,{version:booking.version,slot_id:c.id,slot_version:c.version,change_ack:true,reason:'Remarcação fictícia',...change}));assert.equal((await f.store.booking(f.admin.user_id,booking.id)).slot_id,a.id);
 }
 const input={version:booking.version,slot_id:c.id,slot_version:c.version,change_ack:true,reason:'Remarcação acordada'};booking=await f.store.rescheduleBooking(f.admin.user_id,booking.id,input);
 await assert.rejects(f.store.rescheduleBooking(f.admin.user_id,booking.id,input),{status:409});assert.equal((await f.calendar()).events.find(e=>e.id===a.id).status,'free');
 assert.equal((await f.post(p)).status,200);assert.equal((await f.store.booking(f.admin.user_id,booking.id)).slot_id,c.id);
});

test('Agenda: permissões de leitura/escrita por responsável, professor, profissional e secretaria',async t=>{
 const f=await fixture(t),s=await f.slot(),p=f.payload(s);await f.store.createAppointmentRequest(p);
 const guardian=await f.store.provision('stranger@example.test','guardian'),secretary=await f.store.provision('secretary@example.test','secretary');
 const teacher=await f.store.saveTeacher(f.admin.user_id,null,{name:'Professor Fictício',email:'teacher@example.test',phone:'21999999999',status:'pending',test_access:true,units:['amavale'],version:0});
 for(const actor of [guardian.user_id,teacher.user_id]){
  await assert.rejects(f.store.booking(actor,p.requestId),{status:403});await assert.rejects(f.store.appointmentCalendar(actor,{from:day,to:day}),{status:403});
  await assert.rejects(f.store.reviewBooking(actor,p.requestId,{status:'confirmed',version:1,contacted:true,reason:'Teste negado'}),{status:403});
 }
 assert.equal((await f.store.booking(f.professional.user_id,p.requestId)).id,p.requestId);
 await assert.rejects(f.store.reviewBooking(f.professional.user_id,p.requestId,{status:'confirmed',version:1,contacted:true,reason:'Teste negado'}),{status:403});
 assert.equal((await f.store.reviewBooking(secretary.user_id,p.requestId,{status:'confirmed',version:1,contacted:true,reason:'Confirmação fictícia'})).status,'confirmed');
});

test('Outbox: processos simultâneos enviam um aviso, retomada preserva payload e respeita 23 horas',async t=>{
 let failing=true;const f=await fixture(t,{transport:async()=>{await new Promise(r=>setTimeout(r,10));if(failing)throw Error('Falha simulada');return Response.json({id:'accepted'})}}),s=await f.slot(),p=f.payload(s);await f.store.createAppointmentRequest(p);
 const other=createSqliteStore(f.env,{transport:f.transport});try{await Promise.all([f.store.deliverAppointmentNotices(),other.deliverAppointmentNotices()])}finally{other.close()}
 assert.equal(f.mail.length,1);const before=f.mail[0];
 t.mock.timers.enable({apis:['Date'],now:Date.now()+300001});
 try{await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,2);assert.deepEqual(f.mail[1],before);t.mock.timers.tick(23*3600000);await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,2);const db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{assert.equal(db.prepare('SELECT notice_state FROM appointment_requests WHERE id=?').get(p.requestId).notice_state,'review')}finally{db.close()}}finally{t.mock.timers.reset()}
});

test('Outbox: lease interrompido é recuperado, resultado obsoleto não sobrescreve o envio atual',async t=>{
 let release;const f=await fixture(t,{transport:async()=>new Promise(r=>release=r)}),s=await f.slot(),p=f.payload(s);await f.store.createAppointmentRequest(p);const first=f.store.sendAppointmentNotice(p.requestId);
 await new Promise(r=>setTimeout(r,10));assert.equal(f.mail.length,1);
 t.mock.timers.enable({apis:['Date'],now:Date.now()+120001});
 const other=createSqliteStore(f.env,{transport:async()=>Response.json({id:'recovered'})});
 try{await other.deliverAppointmentNotices();release(new Response('',{status:503}));await first;const db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{assert.equal(db.prepare('SELECT notice_state FROM appointment_requests WHERE id=?').get(p.requestId).notice_state,'sent')}finally{db.close()}}finally{other.close();t.mock.timers.reset()}
});

test('Outbox: profissional revogado e tentativas antigas sem recibo exigem conferência',async t=>{
 const f=await fixture(t,{transport:async()=>{throw Error('Falha fictícia')}}),s=await f.slot(),p=f.payload(s);await f.store.createAppointmentRequest(p);await f.store.sendAppointmentNotice(p.requestId);await f.store.setMember(f.admin.user_id,f.professional.user_id,'social_worker',false);
 t.mock.timers.enable({apis:['Date'],now:Date.now()+300001});try{await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,1)}finally{t.mock.timers.reset()}
 const db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));try{assert.equal(db.prepare('SELECT notice_state FROM appointment_requests WHERE id=?').get(p.requestId).notice_state,'review');db.prepare('DELETE FROM agenda_notice_attempts WHERE notice_id=?').run(p.requestId);db.prepare("UPDATE appointment_requests SET notice_state='sending' WHERE id=?").run(p.requestId);await f.store.deliverAppointmentNotices();assert.equal(f.mail.length,1);assert.equal(db.prepare('SELECT notice_state FROM appointment_requests WHERE id=?').get(p.requestId).notice_state,'review')}finally{db.close()}
});

test('Datas e intervalos: adjacência permitida, sobreposição, passado, data impossível e duração excessiva recusados',async t=>{
 const f=await fixture(t);await f.slot();await f.slot('14:10','15:10');
 for(const [start,end]of [['13:09','14:00'],['13:10','14:10'],['14:00','14:20'],['12:00','16:00']])await assert.rejects(f.slot(start,end),{status:409});
 for(const change of [{day:'2027-02-30'},{day:'2024-02-29'},{start_time:'24:00'},{end_time:'13:10'},{start_time:'00:00',end_time:'09:00'},{day:'2099-01-01'},{modality:'invalid'},{modality:'online',meeting_url:'javascript:alert(1)'}])await assert.rejects(f.slot('17:00','18:00',change));
 assert.equal((await f.calendar()).events.length,2);
});

test('Consultas grandes: filtrar o núcleo antes do limite não esconde uma vaga válida',async t=>{
 const f=await fixture(t),first=new Date(day+'T12:00:00Z'),db=new DatabaseSync(path.join(f.dir,'portal.sqlite'));
 try{const insert=db.prepare('INSERT INTO appointment_slots(id,professional_id,unit,start_at,end_at,created_at) VALUES(?,?,?,?,?,?)');db.exec('BEGIN');for(let i=0;i<1001;i++){const start=+first+i*60000;insert.run(randomUUID(),f.professional.user_id,'valparaiso',new Date(start).toISOString(),new Date(start+60000).toISOString(),new Date().toISOString())}db.exec('COMMIT')}finally{db.close()}
 const target=await f.slot('13:10','14:10',{day:new Date(+first+3*86400000).toISOString().slice(0,10)});
 const rows=await f.store.publicAppointmentSlots({studentId:'UND2_000001',service:'Assistência social',unit:'amavale'});assert.deepEqual(rows.map(r=>r.id),[target.id]);
 await assert.rejects(f.store.publicAppointmentSlots({studentId:'UND2_000001'}),{status:413});
});

test('Concorrência real: oito trabalhadores disputam uma vaga e somente um confirma a reserva',async t=>{
 const {Worker}=await import('node:worker_threads'),f=await fixture(t),s=await f.slot(),barrier=new SharedArrayBuffer(4),flag=new Int32Array(barrier);
 const workers=Array.from({length:8},()=>new Worker(`const {parentPort,workerData}=require('node:worker_threads');(async()=>{const {createSqliteStore}=await import(workerData.module);const store=createSqliteStore(workerData.env);parentPort.postMessage({ready:true});Atomics.wait(new Int32Array(workerData.barrier),0,0);try{await store.createAppointmentRequest(workerData.payload);parentPort.postMessage({status:200})}catch(error){parentPort.postMessage({status:error.status||500})}finally{store.close()}})().catch(e=>{throw e})`,{eval:true,workerData:{module:new URL('./portal-sqlite.mjs',import.meta.url).href,env:f.env,payload:f.payload(s),barrier}}));
 t.after(()=>Promise.all(workers.map(w=>w.terminate())));
 let ready=0;const outcomes=workers.map(w=>new Promise((resolve,reject)=>{w.on('error',reject);w.on('message',m=>{if(m.ready){if(++ready===workers.length){Atomics.store(flag,0,1);Atomics.notify(flag,0)}}else resolve(m.status)})}));
 const results=await Promise.all(outcomes);assert.equal(results.filter(s=>s===200).length,1);assert.equal(results.filter(s=>s===409).length,7);assert.equal((await f.store.bookings(f.admin.user_id)).length,1);assert.equal((await f.calendar()).events[0].status,'pending');
});
