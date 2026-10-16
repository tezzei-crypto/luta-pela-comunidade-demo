import {createHash,randomUUID} from 'node:crypto';
import {registrationReadiness} from './registration-readiness.mjs';

export const DOCUMENT_NOTICE_FROM='tezzei@lutapelacomunidade.com.br';
const zone='America/Sao_Paulo',labels={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'},prefixes={amavale:'UND1_',valparaiso:'UND2_','vale-do-carangola':'UND3_'};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized=value=>String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
const line=value=>String(value).replace(/\s+/g,' ').trim();
const dayOf=now=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const hourOf=now=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(now));

export function registrationDocumentNotices({db,get,all,run,tx,requireRole,scope,env={},transport=fetch,emailAllowed=()=>true,clock=()=>Date.now()}){
 db.exec(`CREATE TABLE IF NOT EXISTS registration_document_outbox(
  id TEXT PRIMARY KEY,recipient_id TEXT NOT NULL REFERENCES members(user_id),email TEXT NOT NULL,day TEXT NOT NULL,
  snapshot TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER,next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,claim TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',accepted_at TEXT NOT NULL DEFAULT '',last_status INTEGER NOT NULL DEFAULT 0,
  UNIQUE(recipient_id,day));
  CREATE INDEX IF NOT EXISTS registration_document_due ON registration_document_outbox(state,next_attempt);`);
 const configured=()=>!!env.RESEND_API_KEY;
 function recipient(id){
  if(!emailAllowed(id))return null;
  const m=get("SELECT user_id,lower(email) AS email FROM members WHERE user_id=? AND active=1 AND role='secretary'",id);
  if(!m||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email))return null;
  const units=scope.units(id);return units.length?{...m,units}:null;
 }
 const recipients=()=>all("SELECT user_id FROM members WHERE active=1 AND role='secretary' ORDER BY email").map(m=>recipient(m.user_id)).filter(Boolean);
 function item(r){
  if(!r||!['pending','needs_info'].includes(r.status)||!prefixes[r.unit])return null;
  const missing=registrationReadiness(r).missing;if(!missing.length)return null;
  const existing_ids=all("SELECT id,name FROM students WHERE birth_date=? AND id LIKE ? AND status='approved' ORDER BY id",r.birth_date,prefixes[r.unit]+'%').filter(s=>normalized(s.name)===normalized(r.student_name)).map(s=>s.id);
  return {id:r.id,name:line(r.student_name),unit:r.unit,missing,existing_ids};
 }
 const pending=units=>all("SELECT * FROM registrations WHERE status IN ('pending','needs_info') ORDER BY created_at,id").filter(r=>units.includes(r.unit)).map(item).filter(Boolean);
 function payload(s,rows,day){
  const origin=new URL(env.PUBLIC_ORIGIN||'https://www.lutapelacomunidade.com.br').origin;
  const details=rows.map((r,i)=>`${i+1}. ${r.name} — ${labels[r.unit]}\nFaltam: ${r.missing.join('; ')}.\n${r.existing_ids.length?'Antes de concluir, confira o possível vínculo com '+r.existing_ids.join(', ')+'. Confirme que é a mesma pessoa e selecione o cadastro existente para preservar o ID e o histórico.\n':''}Abrir inscrição: ${origin}/administracao/#registrations-area?protocol=${encodeURIComponent(r.id)}`).join('\n\n');
  return JSON.stringify({from:DOCUMENT_NOTICE_FROM,to:[s.email],subject:'Documentos pendentes: '+rows.length+' inscrição(ões) — Luta pela Comunidade',text:`SECRETARIA — DOCUMENTOS PENDENTES\nResumo de ${day.split('-').reverse().join('/')} (Brasília).\n\n${details}\n\nPróxima ação: entrar em contato com o responsável, solicitar os itens indicados e anexar os documentos à inscrição. Confira a identidade, a autorização e os possíveis vínculos antes de concluir a análise. Este aviso não aprova nem altera inscrições.\n\nOs links exigem login com seu email autorizado. Não envie documentos em resposta a este email; utilize o painel privado. O resumo reflete o momento do envio: consulte a ficha atual antes de agir.\n\nEste resumo é enviado uma vez ao dia, a partir das 8h de Brasília, somente quando há documentos pendentes nos seus núcleos. Inscrições completas, aprovadas ou não aprovadas saem dos próximos avisos.\n\nFabio Tezzei\nLuta pela Comunidade`});
 }
 async function deliver(){
  const result={accepted:0,failed:0,cancelled:0};if(!configured())return result;
  const now=clock(),day=dayOf(now);
  // Never send yesterday's snapshot after a restart. Today's digest uses current data.
  run("UPDATE registration_document_outbox SET state='cancelled',lease_until=0 WHERE day<>? AND state IN ('pending','sending') AND lease_until<=?",day,now);
  if(hourOf(now)>=8)for(const s of recipients())tx(()=>{
   if(get('SELECT 1 FROM registration_document_outbox WHERE recipient_id=? AND day=?',s.user_id,day))return;
   const rows=pending(s.units);if(!rows.length)return;
   run('INSERT INTO registration_document_outbox(id,recipient_id,email,day,snapshot,payload) VALUES(?,?,?,?,?,?)',digest([s.user_id,day]),s.user_id,s.email,day,JSON.stringify(rows),payload(s,rows,day));
  });
  const due=all("SELECT id FROM registration_document_outbox WHERE day=? AND state IN ('pending','sending') AND next_attempt<=? AND lease_until<=? ORDER BY rowid LIMIT 20",day,now,now);
  for(const row of due){
   const job=tx(()=>{
    const n=get('SELECT * FROM registration_document_outbox WHERE id=?',row.id),at=clock();
    if(!n||!['pending','sending'].includes(n.state)||n.next_attempt>at||n.lease_until>at)return null;
    if(n.day!==dayOf(at)){run("UPDATE registration_document_outbox SET state='cancelled',lease_until=0 WHERE id=?",n.id);result.cancelled++;return null;}
    const s=recipient(n.recipient_id),old=JSON.parse(n.snapshot);
    const current=old.map(r=>item(get('SELECT * FROM registrations WHERE id=?',r.id)));
    // Cancel changed or revoked work instead of retrying an obsolete private message.
    if(!s||s.email!==n.email||current.some(r=>!r||!s.units.includes(r.unit))||n.first_attempt!==null&&digest(current)!==digest(old)){
     run("UPDATE registration_document_outbox SET state='cancelled',lease_until=0 WHERE id=?",n.id);result.cancelled++;return null;
    }
    if(n.attempts>=8||n.first_attempt!==null&&at-n.first_attempt>=23*3600000){run("UPDATE registration_document_outbox SET state='needs_attention',lease_until=0 WHERE id=?",n.id);return null;}
    const body=n.first_attempt===null?payload(s,current,n.day):n.payload,claim=randomUUID();
    run("UPDATE registration_document_outbox SET state='sending',payload=?,snapshot=?,attempts=attempts+1,first_attempt=COALESCE(first_attempt,?),lease_until=?,claim=? WHERE id=?",body,JSON.stringify(current),at,at+120000,claim,n.id);
    return {...n,payload:body,claim,attempts:n.attempts+1};
   });
   if(!job)continue;
   let code=0,provider='';
   try{const res=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'registration-documents-'+job.id},body:job.payload,signal:AbortSignal.timeout(15000)});code=res.status;if(res.ok){const data=await res.json();if(typeof data.id==='string'&&data.id)provider=data.id;}}catch{/* No private content or provider body in logs. */}
   const accepted=!!provider,permanent=code>=400&&code<500&&![408,409,429].includes(code),state=accepted?'accepted':permanent?'failed':job.attempts>=8?'needs_attention':'pending';
   run('UPDATE registration_document_outbox SET state=?,provider_id=?,accepted_at=?,last_status=?,next_attempt=?,lease_until=0 WHERE id=? AND claim=?',state,provider,accepted?new Date(clock()).toISOString():'',code,accepted?0:clock()+Math.min(3600000,300000*2**(job.attempts-1)),job.id,job.claim);
   result[accepted?'accepted':'failed']++;
  }
  return result;
 }
 async function status(actor){
  const m=requireRole(actor,['admin','secretary']),visible=recipients().filter(s=>m.role==='admin'||s.user_id===actor);
  return {configured:configured(),sender:DOCUMENT_NOTICE_FROM,daily_hour:8,timezone:zone,check_minutes:5,recipients:visible.map(s=>({email:s.email,units:s.units,pending_count:pending(s.units).length,latest:get('SELECT day,state,attempts,accepted_at,last_status,next_attempt FROM registration_document_outbox WHERE recipient_id=? ORDER BY day DESC LIMIT 1',s.user_id)||null}))};
 }
 return {deliverRegistrationDocumentNotices:deliver,registrationDocumentNotificationStatus:status};
}
