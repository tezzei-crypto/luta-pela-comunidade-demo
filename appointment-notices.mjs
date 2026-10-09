import {randomUUID} from 'node:crypto';

// The reservation is committed before this outbox runs. A mail outage cannot undo a booking.
export function appointmentNotices({db,get,all,run,tx,audit,env,transport,professionalApproved}){
 db.exec(`CREATE TABLE IF NOT EXISTS agenda_notice_attempts(
  kind TEXT NOT NULL,notice_id TEXT NOT NULL,token TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER NOT NULL,next_attempt INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,last_error TEXT NOT NULL DEFAULT '',PRIMARY KEY(kind,notice_id));`);
 const tableFor=kind=>kind==='request'?'appointment_requests':'bookings';
 const validEmail=email=>typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
 const pending=kind=>all(`SELECT r.id FROM ${tableFor(kind)} r LEFT JOIN agenda_notice_attempts a ON a.notice_id=r.id AND a.kind=?
  WHERE r.notice_state IN ('pending','failed','sending') AND coalesce(a.next_attempt,0)<=? AND coalesce(a.lease_until,0)<=?
  ORDER BY coalesce(a.next_attempt,0),r.created_at LIMIT 20`,kind,Date.now(),Date.now());
 function claim(kind,id){return tx(()=>{
  const table=tableFor(kind),r=get('SELECT * FROM '+table+' WHERE id=?',id),clock=Date.now();
  if(!r||!['pending','failed','sending'].includes(r.notice_state))return;
  const bookingId=kind==='booking'?id:r.booking_id;
  const b=bookingId?get(`SELECT b.status,s.start_at,s.professional_id,m.email FROM bookings b
   JOIN appointment_slots s ON s.id=b.slot_id JOIN members m ON m.user_id=s.professional_id WHERE b.id=?`,bookingId):null;
  // Public requests have their own notice. Never send a second one for the linked booking.
  if(kind==='booking'&&get('SELECT 1 FROM appointment_requests WHERE booking_id=?',id)||
   kind==='request'&&r.status==='cancelled'||b&&!['pending','confirmed'].includes(b.status)||
   (b?.start_at||r.desired_at)<=new Date(clock).toISOString()){
   run("UPDATE "+table+" SET notice_state='suppressed' WHERE id=?",id);return;
  }
  const old=get('SELECT * FROM agenda_notice_attempts WHERE kind=? AND notice_id=?',kind,id);
  if(old&&(old.lease_until>clock||old.next_attempt>clock))return;
  const review=reason=>{run("UPDATE "+table+" SET notice_state='review' WHERE id=?",id);
   if(old)run("UPDATE agenda_notice_attempts SET token='',lease_until=0,last_error=? WHERE kind=? AND notice_id=?",reason,kind,id);
   audit('system','agenda.notice.review:'+kind+':'+id+':'+reason);
  };
  // Legacy ambiguous attempts lack a stable payload/first-attempt timestamp. Do not resend blindly.
  if(!old&&r.notice_state!=='pending'){review('Tentativa antiga requer conferência no provedor.');return}
  if(old&&(clock-old.first_attempt>=23*3600000||old.attempts>=8)){review('Envio sem confirmação dentro do prazo seguro de repetição.');return}
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)return;
  const email=b?(professionalApproved(b.professional_id)?b.email:null):(r.service==='psychologist'?env.PSYCHOLOGIST_EMAIL:env.SOCIAL_WORKER_EMAIL);
  const to=[...new Set([...(kind==='request'?[env.AGENDA_EMAIL||'agenda@lutapelacomunidade.com.br']:[]),env.BOOTSTRAP_ADMIN_EMAIL,email].filter(validEmail))];
  if(!to.length)return;
  if(old&&JSON.parse(old.payload).to.some(email=>!to.includes(email))){review('Destinatário alterado; conferir entrega anterior antes de reenviar.');return}
  const payload=old?.payload||JSON.stringify({from:env.MAIL_FROM,to,
   subject:kind==='request'?'Solicitação registrada na agenda — Luta pela Comunidade':'Nova solicitação na agenda — Luta pela Comunidade',
   text:'Uma solicitação foi registrada no sistema.\nProtocolo: '+id+'\nConsulte a Agenda no painel protegido para verificar a vaga e confirmar com a família. O recebimento deste aviso não confirma o atendimento.\n'+(env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||'')+'/portal/#schedule-area'});
  const token=randomUUID();
  if(!old)run('INSERT INTO agenda_notice_attempts(kind,notice_id,first_attempt,payload) VALUES(?,?,?,?)',kind,id,clock,payload);
  run('UPDATE agenda_notice_attempts SET token=?,lease_until=?,attempts=attempts+1 WHERE kind=? AND notice_id=?',token,clock+120000,kind,id);
  run("UPDATE "+table+" SET notice_state='sending' WHERE id=?",id);
  return {token,payload,attempts:(old?.attempts||0)+1};
 })}
 async function send(kind,id){
  const n=claim(kind,id);if(!n)return;let sent=false,error='Não foi possível confirmar o envio; nova tentativa automática.';
  try{const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,
   'Content-Type':'application/json','Idempotency-Key':(kind==='request'?'appointment-record-':'booking-')+id},body:n.payload,signal:AbortSignal.timeout(15000)});
   sent=response.ok&&!!(await response.json()).id;if(!response.ok)error='Provedor recusou o aviso (HTTP '+response.status+').';
  }catch{}
  tx(()=>{const current=get('SELECT token FROM agenda_notice_attempts WHERE kind=? AND notice_id=?',kind,id);if(current?.token!==n.token)return;
   run("UPDATE agenda_notice_attempts SET token='',lease_until=0,next_attempt=?,last_error=? WHERE kind=? AND notice_id=?",Date.now()+Math.min(3600000,300000*2**(n.attempts-1)),sent?'':error,kind,id);
   run('UPDATE '+tableFor(kind)+' SET notice_state=? WHERE id=?',sent?'sent':'failed',id);
   audit('system','agenda.notice.'+(sent?'accepted':'retry')+':'+kind+':'+id);
  });
 }
 return {sendAppointmentNotice:id=>send('request',id),sendPrivateNotice:id=>send('booking',id),
  pendingAppointmentNotices:async()=>pending('request'),
  async deliverAppointmentNotices(){for(const kind of ['request','booking'])for(const n of pending(kind))await send(kind,n.id)}
 };
}
