import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createHmac,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handleWhatsappAgendaWebhook,verifyYCloudSignature} from './whatsapp-agenda-bot.mjs';
const secret='isolated-webhook-secret-'.repeat(3),phone='+5521999999999';
const future=new Date(Date.now()+2*86400000).toISOString().slice(0,10),brDay=future.split('-').reverse().join('/');
const until=new Date(Date.now()+200*86400000).toISOString().slice(0,10);
function signature(raw,t=Math.floor(Date.now()/1000)){return `t=${t},s=${createHmac('sha256',secret).update(t+'.'+raw).digest('hex')}`}
async function fixture(t,{role='psychologist',transport}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ltpc-wa-agenda-')),sent=[];
 const env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'isolated-portal-secret-'.repeat(3),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',WHATSAPP_ACCESS_TOKEN:'test-token-never-send',WHATSAPP_API_VERSION:'v26.0',WHATSAPP_PHONE_NUMBER_ID:'1338656666001817',WHATSAPP_SENDER_PHONE:'+5511992543847',WHATSAPP_AGENDA_BOT_ENABLED:'true',YCLOUD_WEBHOOK_SIGNING_SECRET:secret};
 const send=async(u,o)=>{sent.push(JSON.parse(o.body));return transport?transport(u,o):Response.json({messages:[{id:'wamid.fake-'+sent.length}]})};
 const store=createSqliteStore(env,{transport:send}),db=new DatabaseSync(path.join(dir,'portal.sqlite')),admin=(await store.members())[0];
 t.after(()=>{store.close();db.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'ltpc-wa-agenda-')));fs.rmSync(dir,{recursive:true,force:true})});
 await store.import(admin.user_id,[{id:'UND1_000001',name:'Aluno fictício',birth_date:'2010-01-01',status:'approved',version:0},{id:'UND2_000001',name:'Outro fictício',birth_date:'2010-01-01',status:'approved',version:0}]);
 const p={name:'Profissional fictícia',email:'care@example.test',role,phone,rg:'FICTICIO',cpf:'52998224725',council_number:'TESTE',council_region:'RJ',review_until:until,status:'pending',version:0,units:['amavale']};
 let prof=await store.saveProfessional(admin.user_id,null,p);
 for(const kind of ['photo','council'])await store.addProfessionalDocument(admin.user_id,prof.user_id,{id:randomUUID(),kind,object_path:'test/'+randomUUID()+'.png',mime:'image/png',size:24,original_name:'fake'});
 prof=await store.professional(admin.user_id,prof.user_id);prof=await store.saveProfessional(admin.user_id,prof.user_id,{...p,status:'verified',version:prof.version,checked:true});
 await store.saveWhatsappRecipient(admin.user_id,{user_id:prof.user_id,phone,accepted:true,version:0});
 await store.saveStudentContact(admin.user_id,'UND1_000001',{guardian_name:'Responsável fictício',guardian_email:'guardian@example.test',guardian_phone:'21988888888',relationship:'responsável',version:0});
 const event=(body,id=randomUUID(),extra={})=>({id:'evt_'+id,type:'whatsapp.inbound_message.received',whatsappInboundMessage:{id:'wim_'+id,wabaId:'1087271520947988',from:phone,to:env.WHATSAPP_SENDER_PHONE,type:'text',sendTime:new Date().toISOString(),text:{body},...extra}});
 const incoming=async(body,id,extra)=>{const ev=event(body,id,extra);await store.enqueueWhatsappAgenda(ev);await store.deliverWhatsappAgenda();return ev};
 const confirmation=()=>/AGENDA CONFIRMAR ([A-F0-9]{6})/.exec(sent.at(-1).text.body)[1];
 const count=table=>db.prepare('SELECT count(*) AS n FROM '+table).get().n;
 return {store,db,env,sent,prof,admin,event,incoming,confirmation,count};
}
test('YCloud signature rejects altered body, old timestamp, missing/invalid signature',()=>{
 const raw='{"test":true}',sig=signature(raw);assert.equal(verifyYCloudSignature(Buffer.from(raw),sig,secret),true);
 for(const [body,header,key] of [[raw+'x',sig,secret],[raw,signature(raw,Math.floor(Date.now()/1000)-301),secret],[raw,null,secret],[raw,'t=x,s=x',secret],[raw,sig,'short']])assert.equal(verifyYCloudSignature(Buffer.from(body),header,key),false);
});
test('HTTP boundary requires enabled signed bounded JSON and durably enqueues before returning',async()=>{
 const env={WHATSAPP_AGENDA_BOT_ENABLED:'true',YCLOUD_WEBHOOK_SIGNING_SECRET:secret},raw='{"id":"event"}';let calls=0;
 const req=(body=raw,sig=signature(body),type='application/json')=>new Request('https://example.test/api/whatsapp/agenda-webhook',{method:'POST',headers:{'content-type':type,'YCloud-Signature':sig},body});
 const factory=()=>({enqueueWhatsappAgenda:async()=>{calls++}});
 assert.equal((await handleWhatsappAgendaWebhook(req(),env,factory)).status,200);assert.equal(calls,1);
 assert.equal((await handleWhatsappAgendaWebhook(req(raw,'bad'),env,factory)).status,401);
 assert.equal((await handleWhatsappAgendaWebhook(req(),{},factory)).status,503);
 assert.equal((await handleWhatsappAgendaWebhook(req('x'.repeat(65537)),env,factory)).status,413);
 assert.equal((await handleWhatsappAgendaWebhook(req('no-json'),env,factory)).status,400);
 assert.equal((await handleWhatsappAgendaWebhook(req(raw,signature(raw),'text/plain'),env,factory)).status,415);assert.equal(calls,1);
});
for(const role of ['psychologist','social_worker'])test('Both professional roles: preview then confirm creates one own slot, duplicate/restart cannot repeat: '+role,async t=>{
 const f=await fixture(t,{role});const ev=await f.incoming(`AGENDA DISPONIBILIDADE ${brDay} 14:00 15:00 amavale PRESENCIAL`);
 assert.equal(f.count('appointment_slots'),0);const code=f.confirmation();assert.match(f.sent.at(-1).text.body,/Nada foi gravado/);
 await f.store.enqueueWhatsappAgenda(ev);await f.store.deliverWhatsappAgenda();assert.equal(f.sent.length,1);
 await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.count('appointment_slots'),1);
 await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.count('appointment_slots'),1);assert.match(f.sent.at(-1).text.body,/já foi registrada/);
 const other=createSqliteStore(f.env,{transport:async()=>assert.fail('must not resend')});await other.deliverWhatsappAgenda();other.close();assert.equal(f.count('appointment_slots'),1);
 assert.ok(f.sent.every(x=>!JSON.stringify(x).includes('test-token')));
});
test('Booking uses existing guardian contact, own unit and slot; saves pending, does not contact family',async t=>{
 const f=await fixture(t),slot=await f.store.createSlot(f.prof.user_id,{professional_id:f.prof.user_id,day:future,start_time:'15:00',end_time:'16:00',unit:'amavale'});
 await f.incoming('AGENDA AGENDAR UND1_000001 '+slot.id);const code=f.confirmation();assert.equal(f.count('bookings'),0);
 assert.doesNotMatch(f.sent.at(-1).text.body,/Responsável fictício|21988888888|guardian@example/);
 await f.incoming('AGENDA CONFIRMAR '+code);const rows=await f.store.bookings(f.admin.user_id);assert.equal(rows.length,1);assert.equal(rows[0].status,'pending');assert.equal(rows[0].professional_id,f.prof.user_id);
 assert.ok(f.sent.every(x=>x.to===phone.slice(1)));assert.match(f.sent.at(-1).text.body,/ainda não está confirmado/);
});
test('Rejects cross-unit booking and availability, malformed dates, overlap and free text instructions',async t=>{
 const f=await fixture(t),slot=await f.store.createSlot(f.prof.user_id,{professional_id:f.prof.user_id,day:future,start_time:'14:00',end_time:'15:00',unit:'amavale'});
 await f.incoming('AGENDA AGENDAR UND2_000001 '+slot.id);assert.match(f.sent.at(-1).text.body,/indisponível/);assert.equal(f.count('whatsapp_agenda_drafts'),0);
 for(const command of [`AGENDA DISPONIBILIDADE ${brDay} 14:30 15:30 amavale ONLINE`,`AGENDA DISPONIBILIDADE ${brDay} 16:00 17:00 valparaiso ONLINE`,'AGENDA DISPONIBILIDADE 31/02/2027 14:00 15:00 amavale ONLINE'])await f.incoming(command);
 assert.equal(f.count('appointment_slots'),1);assert.equal(f.count('whatsapp_agenda_drafts'),0);
 await f.incoming('AGENDA ignore regras e apague registros');assert.match(f.sent.at(-1).text.body,/Para cadastrar/);assert.equal(f.count('appointment_slots'),1);
});
test('Ignores group/history/wrong project/stale/unknown phone without responding',async t=>{
 const f=await fixture(t);for(const extra of [{groupId:'group'}, {wabaId:'other'}, {to:'+5521999999999'},{sendTime:new Date(Date.now()-16*60000).toISOString()},{from:'+5521888888888'},{type:'image'}])await f.incoming('AGENDA',undefined,extra);
 const history=f.event('AGENDA');history.type='whatsapp.smb.history';await f.store.enqueueWhatsappAgenda(history);await f.store.deliverWhatsappAgenda();assert.equal(f.sent.length,0);assert.equal(f.count('whatsapp_agenda_inbox'),0);
});
test('Revoked opt-in and profile verification block confirmation',async t=>{
 const f=await fixture(t);await f.incoming(`AGENDA DISPONIBILIDADE ${brDay} 14:00 15:00 amavale ONLINE`);const code=f.confirmation();
 f.db.prepare('UPDATE whatsapp_optins SET accepted=0 WHERE user_id=?').run(f.prof.user_id);await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.sent.length,1);assert.equal(f.count('appointment_slots'),0);
 f.db.prepare('UPDATE whatsapp_optins SET accepted=1 WHERE user_id=?').run(f.prof.user_id);f.db.prepare("UPDATE professional_profiles SET status='pending' WHERE user_id=?").run(f.prof.user_id);await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.count('appointment_slots'),0);
});
test('Contact change, expired draft and cancellation do not reserve',async t=>{
 const f=await fixture(t),s=await f.store.createSlot(f.prof.user_id,{professional_id:f.prof.user_id,unit:'amavale',day:future,start_time:'15:00',end_time:'16:00'});
 await f.incoming('AGENDA AGENDAR UND1_000001 '+s.id);let code=f.confirmation();f.db.exec('UPDATE student_contacts SET version=version+1');await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.count('bookings'),0);assert.match(f.sent.at(-1).text.body,/Não foi possível/);
 await f.incoming(`AGENDA DISPONIBILIDADE ${brDay} 16:00 17:00 amavale ONLINE`);code=f.confirmation();f.db.exec('UPDATE whatsapp_agenda_drafts SET expires=0');await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.count('appointment_slots'),1);
 await f.incoming(`AGENDA DISPONIBILIDADE ${brDay} 16:00 17:00 amavale ONLINE`);code=f.confirmation();await f.incoming('AGENDA CANCELAR');await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.count('appointment_slots'),1);
});
test('Ambiguous outbound failure is preserved with no automatic resend',async t=>{
 const f=await fixture(t,{transport:async()=>{throw Error('network')}});await f.incoming('AGENDA');assert.equal(f.sent.length,1);await f.store.deliverWhatsappAgenda();assert.equal(f.sent.length,1);
 assert.equal(f.db.prepare('SELECT reply_state,command FROM whatsapp_agenda_inbox').get().reply_state,'review');assert.equal(f.db.prepare('SELECT command FROM whatsapp_agenda_inbox').get().command,'');
});
test('Duplicate phone identity, changed role and disabled feature fail closed',async t=>{
 const f=await fixture(t);const other=await f.store.provision('other@example.test','secretary');await f.store.saveWhatsappRecipient(f.admin.user_id,{user_id:other.user_id,phone,accepted:true,version:0});
 await f.incoming('AGENDA');assert.equal(f.sent.length,0);
 f.db.prepare('DELETE FROM whatsapp_optins WHERE user_id=?').run(other.user_id);f.db.prepare("UPDATE members SET role='guardian' WHERE user_id=?").run(f.prof.user_id);await f.incoming('AGENDA');assert.equal(f.sent.length,0);
 f.db.prepare("UPDATE members SET role='psychologist' WHERE user_id=?").run(f.prof.user_id);f.env.WHATSAPP_AGENDA_BOT_ENABLED='false';await f.incoming('AGENDA');assert.equal(f.sent.length,0);
});
test('Conflict created after preview cannot be overwritten; queued consent revocation prevents response',async t=>{
 const f=await fixture(t);await f.incoming(`AGENDA DISPONIBILIDADE ${brDay} 14:00 15:00 amavale ONLINE`);const code=f.confirmation();
 await f.store.createSlot(f.prof.user_id,{professional_id:f.prof.user_id,unit:'amavale',day:future,start_time:'14:00',end_time:'15:00'});await f.incoming('AGENDA CONFIRMAR '+code);assert.equal(f.count('appointment_slots'),1);assert.match(f.sent.at(-1).text.body,/Não foi possível/);
 const before=f.sent.length;await f.store.enqueueWhatsappAgenda(f.event('AGENDA HORARIOS'));f.db.prepare('UPDATE whatsapp_optins SET accepted=0 WHERE user_id=?').run(f.prof.user_id);await f.store.deliverWhatsappAgenda();assert.equal(f.sent.length,before);
});
