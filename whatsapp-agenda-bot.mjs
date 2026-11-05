import {createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {normalizeContactPhone} from './contact-settings.mjs';
import {studentUnit} from './unit-scope.mjs';
const professionalRoles=['psychologist','social_worker'];
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,200}$/.test(v);
const unitNames={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
const help='Agenda do Luta pela Comunidade.\nPara cadastrar disponibilidade: AGENDA DISPONIBILIDADE DD/MM/AAAA HH:MM HH:MM NUCLEO PRESENCIAL (ou ONLINE). Núcleos: amavale, valparaiso, vale-do-carangola.\nPara ver seus horários: AGENDA HORARIOS.\nPara reservar: AGENDA AGENDAR ID_DO_ALUNO ID_DO_HORARIO.\nRevise o resumo e envie AGENDA CONFIRMAR CODIGO. Para desistir: AGENDA CANCELAR.\nA reserva aguarda confirmação da secretaria com a família. Não envie informações clínicas por aqui.';
const normalize=v=>{try{if(typeof v!=='string'||!/^[+\d\s().-]+$/.test(v))return null;const digits=v.replace(/\D/g,'');return normalizeContactPhone(v.startsWith('+')?v:[10,11].includes(digits.length)?'+55'+digits:'+'+digits)}catch{return null}};
const dayTime=v=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(v));
export function verifyYCloudSignature(raw,header,secret,clock=Date.now){
 if(typeof secret!=='string'||secret.length<32||typeof header!=='string'||header.length>250)return false;
 const m=/^t=(\d{10}),s=([a-f0-9]{64})$/.exec(header);if(!m||Math.abs(clock()/1000-Number(m[1]))>300)return false;
 const expected=createHmac('sha256',secret).update(m[1]+'.').update(raw).digest();return timingSafeEqual(expected,Buffer.from(m[2],'hex'));
}
export async function handleWhatsappAgendaWebhook(request,env,storeFactory){
 const response=(status,received=false)=>Response.json({received},{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return response(405);
 if(env.WHATSAPP_AGENDA_BOT_ENABLED!=='true'||!env.YCLOUD_WEBHOOK_SIGNING_SECRET)return response(503);
 if(!request.headers.get('content-type')?.includes('application/json'))return response(415);
 const raw=Buffer.from(await request.arrayBuffer());if(raw.length>65536)return response(413);
 if(!verifyYCloudSignature(raw,request.headers.get('YCloud-Signature'),env.YCLOUD_WEBHOOK_SIGNING_SECRET))return response(401);
 let event;try{event=JSON.parse(raw)}catch{return response(400)}
 await storeFactory(env).enqueueWhatsappAgenda(event);return response(200,true);
}
export function whatsappAgendaBot({db,get,all,run,tx,env,transport,scheduling,professionalApproved,audit,clock=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_agenda_inbox(message_id TEXT PRIMARY KEY,event_id TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES members(user_id),phone TEXT NOT NULL,command TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'queued',reply_state TEXT NOT NULL DEFAULT 'none',reply_id TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,http_status INTEGER,error_code INTEGER);
 CREATE TABLE IF NOT EXISTS whatsapp_agenda_drafts(user_id TEXT PRIMARY KEY REFERENCES members(user_id),code TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,expires INTEGER NOT NULL,result_id TEXT NOT NULL DEFAULT '');`);
 const enabled=()=>env.WHATSAPP_AGENDA_BOT_ENABLED==='true'&&env.YCLOUD_WEBHOOK_SIGNING_SECRET?.length>=32&&env.WHATSAPP_SENDER_PHONE==='+5511992543847'&&env.WHATSAPP_PHONE_NUMBER_ID==='1338656666001817'&&/^v\d{1,3}\.0$/.test(env.WHATSAPP_API_VERSION||'')&&!!env.WHATSAPP_ACCESS_TOKEN;
 function actor(phone){
  // Re-read consent, role, verification and phone ownership on every action.
  const matches=all('SELECT o.user_id,o.phone,o.accepted,m.role,m.active,p.phone AS profile_phone FROM whatsapp_optins o JOIN members m USING(user_id) LEFT JOIN professional_profiles p USING(user_id)').filter(r=>normalize(r.phone)===phone);
  if(matches.length!==1)return null;const m=matches[0];
  return m.accepted&&m.active&&professionalRoles.includes(m.role)&&normalize(m.profile_phone)===phone&&professionalApproved(m.user_id)?m:null;
 }
 function preview(actorId,p){
  if(p.kind==='slot')return `Cadastrar disponibilidade: ${unitNames[p.unit]}, ${p.day.split('-').reverse().join('/')} das ${p.start_time} às ${p.end_time}, ${p.modality==='online'?'online':'presencial'}.`;
  const slot=get('SELECT * FROM appointment_slots WHERE id=?',p.slot_id),contact=get('SELECT version,guardian_name,guardian_phone FROM student_contacts WHERE student_id=?',p.student_id);
  if(!slot||slot.professional_id!==actorId||slot.state!=='open'||slot.start_at<=new Date(clock()).toISOString()||studentUnit(p.student_id)!==slot.unit||!get("SELECT 1 FROM students WHERE id=? AND status='approved'",p.student_id)||get("SELECT 1 FROM bookings WHERE slot_id=? AND status IN ('pending','confirmed')",slot.id)||!contact||contact.guardian_name.trim().length<3||!normalize(contact.guardian_phone))throw Error('unavailable');
  p.version=slot.version;p.contact_version=contact.version;
  return `Reservar seu horário de ${dayTime(slot.start_at)} em ${unitNames[slot.unit]} para o cadastro ${p.student_id}. A secretaria ainda precisará confirmar com a família.`;
 }
 function makeDraft(uid,p){
  const summary=preview(uid,p),code=randomBytes(3).toString('hex').toUpperCase();
  run("INSERT INTO whatsapp_agenda_drafts(user_id,code,payload,state,expires) VALUES(?,?,?,'pending',?) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code,payload=excluded.payload,state='pending',expires=excluded.expires,result_id=''",uid,code,JSON.stringify(p),clock()+600000);
  return summary+'\nNada foi gravado na agenda ainda. Para confirmar em até 10 minutos, envie AGENDA CONFIRMAR '+code+'. Para desistir: AGENDA CANCELAR.';
 }
 async function process(item){
  const m=actor(item.phone);if(!m||m.user_id!==item.user_id)return null;
  const command=item.command.trim(),upper=command.toUpperCase();
  if(upper==='AGENDA'||upper==='AGENDA AJUDA')return help;
  if(upper==='AGENDA CANCELAR'){run("UPDATE whatsapp_agenda_drafts SET state='cancelled' WHERE user_id=? AND state='pending'",m.user_id);return 'Rascunho cancelado. Nenhum horário ou atendimento foi excluído.'}
  if(upper==='AGENDA HORARIOS'){
   const slots=(await scheduling.slots(m.user_id,m.user_id)).filter(s=>s.state==='open'&&!s.booking_id&&s.start_at>new Date(clock()).toISOString()).slice(0,5);
   return slots.length?'Seus próximos horários livres:\n'+slots.map(s=>`${dayTime(s.start_at)} — ${unitNames[s.unit]} — ${s.id}`).join('\n'):'Você não tem horários livres cadastrados.\n'+help;
  }
  const confirmed=/^AGENDA CONFIRMAR ([A-F0-9]{6})$/i.exec(command);
  if(confirmed){
   const draft=get('SELECT * FROM whatsapp_agenda_drafts WHERE user_id=?',m.user_id);
   if(!draft||draft.code!==confirmed[1].toUpperCase())return 'Código de confirmação inválido. Solicite um novo resumo com AGENDA.';
   if(draft.state==='completed')return 'Essa operação já foi registrada. Não foi repetida.';
   if(draft.state!=='pending'||draft.expires<clock())return 'Resumo expirado ou já processado. Confira a agenda no painel antes de solicitar novamente.';
   const p=JSON.parse(draft.payload);if(!actor(item.phone))return null;
   if(!run("UPDATE whatsapp_agenda_drafts SET state='committing' WHERE user_id=? AND state='pending'",m.user_id).changes)return 'Operação já em conferência. Consulte o painel.';
   // Claim before mutation. A crash is reviewed, never blindly replayed.
   try{const result=p.kind==='slot'?await scheduling.createSlot(m.user_id,{...p,professional_id:m.user_id}):await scheduling.bookOwnProfessionalSlot(m.user_id,p.slot_id,{...p,consent:true});
    run("UPDATE whatsapp_agenda_drafts SET state='completed',result_id=? WHERE user_id=?",result.id,m.user_id);audit(m.user_id,'whatsapp.agenda.'+p.kind+':'+result.id);
    return p.kind==='slot'?'Disponibilidade cadastrada na agenda do sistema. Protocolo: '+result.id+'.':'Reserva registrada no sistema. Protocolo: '+result.id+'. Aguarde a confirmação da secretaria com a família; o atendimento ainda não está confirmado.';
   }catch{run("UPDATE whatsapp_agenda_drafts SET state='review' WHERE user_id=?",m.user_id);return 'Não foi possível concluir. Confira disponibilidade, conflitos, cadastro e permissões no painel. Esta operação não será repetida automaticamente.'}
  }
  const available=/^AGENDA DISPONIBILIDADE (\d{2})\/(\d{2})\/(20\d{2}) ([0-2]\d:[0-5]\d) ([0-2]\d:[0-5]\d) (amavale|valparaiso|vale-do-carangola) (PRESENCIAL|ONLINE)$/i.exec(command);
  if(available){const [,dd,mm,yy,start_time,end_time,unit,mode]=available;
   const day=`${yy}-${mm}-${dd}`,date=new Date(day+'T12:00:00Z'),start=Date.parse(day+'T'+start_time+':00-03:00'),end=Date.parse(day+'T'+end_time+':00-03:00');
   if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==day||!Number.isFinite(start)||!Number.isFinite(end)||start<=clock()||end<=start||end-start>8*3600000||start>clock()+366*86400000||!get('SELECT 1 FROM professional_units WHERE user_id=? AND unit=?',m.user_id,unit.toLowerCase()))return 'Confira data futura, início e fim, duração até 8 horas e núcleo autorizado.';
   if(get("SELECT 1 FROM appointment_slots WHERE professional_id=? AND state='open' AND start_at<? AND end_at>?",m.user_id,new Date(end).toISOString(),new Date(start).toISOString()))return 'Esse intervalo já está ocupado na sua agenda. Nenhuma alteração foi feita.';
   return makeDraft(m.user_id,{kind:'slot',day,start_time,end_time,unit:unit.toLowerCase(),modality:mode.toUpperCase()==='ONLINE'?'online':'in_person'});
  }
  const booking=/^AGENDA AGENDAR (UND[1-3]_\d{6}) ([a-f0-9-]{36})$/i.exec(command);
  if(booking){try{return makeDraft(m.user_id,{kind:'booking',id:randomUUID(),student_id:booking[1].toUpperCase(),slot_id:booking[2].toLowerCase()})}catch{return 'Horário ou cadastro indisponível para seu núcleo. Confira no painel os dados do responsável e a sua agenda.'}}
  return help;
 }
 let running=false;
 return {
  async enqueueWhatsappAgenda(event){
   if(!enabled()||!event||event.type!=='whatsapp.inbound_message.received'||!validId(event.id))return;
   const msg=event.whatsappInboundMessage;if(!msg||msg.wabaId!=='1087271520947988'||normalize(msg.to)!==env.WHATSAPP_SENDER_PHONE||msg.groupId||msg.type!=='text'||!validId(msg.id)||typeof msg.text?.body!=='string'||msg.text.body.length>250)return;
   const age=clock()-Date.parse(msg.sendTime);if(!Number.isFinite(age)||age< -60000||age>15*60000)return;
   const phone=normalize(msg.from),m=phone&&actor(phone);if(!m||!/^AGENDA(?:\s|$)/i.test(msg.text.body.trim()))return;
   tx(()=>{if(get('SELECT 1 FROM whatsapp_agenda_inbox WHERE message_id=?',msg.id))return;
    if(get('SELECT count(*) AS n FROM whatsapp_agenda_inbox WHERE user_id=? AND created_at>?',m.user_id,clock()-60000).n>=12||get('SELECT count(*) AS n FROM whatsapp_agenda_inbox WHERE user_id=? AND created_at>?',m.user_id,clock()-86400000).n>=100)return;
    run('INSERT INTO whatsapp_agenda_inbox(message_id,event_id,user_id,phone,command,created_at) VALUES(?,?,?,?,?,?)',msg.id,event.id,m.user_id,phone,msg.text.body.trim(),clock());
   });
  },
  async deliverWhatsappAgenda(){
   if(running||!enabled())return;running=true;
   try{for(const item of all("SELECT * FROM whatsapp_agenda_inbox WHERE state='queued' ORDER BY created_at,rowid LIMIT 20")){
    if(!run("UPDATE whatsapp_agenda_inbox SET state='processing' WHERE message_id=? AND state='queued'",item.message_id).changes)continue;
    if(clock()-item.created_at>15*60000){run("UPDATE whatsapp_agenda_inbox SET state='expired',command='' WHERE message_id=?",item.message_id);continue}
    let text;try{text=await process(item)}catch{text=null}
    if(!text||!actor(item.phone)){run("UPDATE whatsapp_agenda_inbox SET state='ignored',command='' WHERE message_id=?",item.message_id);continue}
    run("UPDATE whatsapp_agenda_inbox SET state='processed',reply_state='sending',command='' WHERE message_id=?",item.message_id);
    try{const r=await transport('https://graph.facebook.com/'+env.WHATSAPP_API_VERSION+'/'+env.WHATSAPP_PHONE_NUMBER_ID+'/messages',{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',to:item.phone.slice(1),type:'text',text:{body:text+'\nMensagem gerada pelo sistema do Luta pela Comunidade.'}}),signal:AbortSignal.timeout(10000)});
     const j=await r.json().catch(()=>({})),id=typeof j.messages?.[0]?.id==='string'?j.messages[0].id.slice(0,250):'';
     run('UPDATE whatsapp_agenda_inbox SET reply_state=?,reply_id=?,http_status=?,error_code=? WHERE message_id=?',r.ok&&id?'accepted':r.ok?'review':'failed',id,Number.isInteger(r.status)?r.status:null,Number.isSafeInteger(j.error?.code)?j.error.code:null,item.message_id);
    }catch{run("UPDATE whatsapp_agenda_inbox SET reply_state='review' WHERE message_id=?",item.message_id)}
   }}finally{running=false}
  }
 };
}
