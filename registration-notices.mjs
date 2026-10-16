import {randomUUID} from 'node:crypto';

export const REGISTRATION_RECIPIENTS=['participante@lutapelacomunidade.com.br','tezzei@gmail.com'];
export function registrationNotice(id,env){
 const origin=new URL(env.PUBLIC_ORIGIN||'https://www.lutapelacomunidade.com.br').origin;
 const link=origin+'/administracao/#registrations-area?protocol='+encodeURIComponent(id);
 return {from:env.MAIL_FROM,to:REGISTRATION_RECIPIENTS,subject:'Nova inscrição para análise — Luta pela Comunidade',text:`Uma nova inscrição foi recebida no painel administrativo.\n\nProtocolo: ${id}\n\nAbrir inscrição para análise (é necessário entrar com seu email autorizado):\n${link}\n\nConfira a identificação, a autorização do responsável e os documentos. Se faltar algo, registre a complementação e entre em contato com a família. O aviso não significa aprovação e não contém documentos pessoais.`};
}

export function registrationNotices({db,get,all,run,tx,env,transport=fetch,emailAllowedAddress=()=>true,clock=()=>Date.now()}){
 db.exec(`CREATE TABLE IF NOT EXISTS registration_notification_outbox(
  registration_id TEXT PRIMARY KEY REFERENCES registrations(id),payload TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,first_attempt INTEGER,
  next_attempt INTEGER NOT NULL DEFAULT 0,lease_until INTEGER NOT NULL DEFAULT 0,claim TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL DEFAULT '',accepted_at TEXT NOT NULL DEFAULT '',last_status INTEGER NOT NULL DEFAULT 0
 )`);
 function enqueue(id){
  // Called only inside the transaction creating a new registration. Never backfill old notices.
  if(env.PORTAL_INTAKE_ACTIVE==='true')run('INSERT INTO registration_notification_outbox(registration_id) VALUES(?)',id);
 }
 function status(id){
  const r=get('SELECT state,attempts,accepted_at,last_status,next_attempt FROM registration_notification_outbox WHERE registration_id=?',id);
  return r?{...r,next_attempt:r.next_attempt?new Date(r.next_attempt).toISOString():null}:null;
 }
 async function deliver({id,send=transport}={}){
  const result={accepted:0,failed:0};
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)return result;
  const now=clock();
  const rows=all("SELECT registration_id FROM registration_notification_outbox WHERE state IN ('pending','sending') AND next_attempt<=? AND lease_until<=?"+(id?' AND registration_id=?':'')+' ORDER BY rowid LIMIT 20',now,now,...(id?[id]:[]));
  for(const row of rows){
   const job=tx(()=>{
    const r=get('SELECT * FROM registration_notification_outbox WHERE registration_id=?',row.registration_id),at=clock();
    if(!['pending','sending'].includes(r.state)||r.next_attempt>at||r.lease_until>at)return null;
    // Provider keys expire in 24 hours. Stop before that boundary if acceptance is uncertain.
    if(r.first_attempt!==null&&(at-r.first_attempt>=23*3600000||r.attempts>=8)){
     run("UPDATE registration_notification_outbox SET state='needs_attention',lease_until=0 WHERE registration_id=?",r.registration_id);return null;
    }
    const message=r.payload?JSON.parse(r.payload):registrationNotice(r.registration_id,env);
    const allowed=message.to.filter(emailAllowedAddress);
    if(!allowed.length||r.attempts>0&&allowed.length!==message.to.length){run("UPDATE registration_notification_outbox SET state='cancelled',lease_until=0 WHERE registration_id=?",r.registration_id);return null;}
    const payload=JSON.stringify({...message,to:allowed}),claim=randomUUID();
    run("UPDATE registration_notification_outbox SET state='sending',payload=?,attempts=attempts+1,first_attempt=COALESCE(first_attempt,?),lease_until=?,claim=? WHERE registration_id=?",payload,at,at+120000,claim,r.registration_id);
    return {...r,payload,claim,attempts:r.attempts+1};
   });
   if(!job)continue;
   let code=0,providerId='';
   try{
    const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':'registration-private-v2-'+job.registration_id},body:job.payload,signal:AbortSignal.timeout(15000)});
    code=response.status;
    if(response.ok){const data=await response.json();if(typeof data.id==='string'&&data.id)providerId=data.id;}
   }catch{/* Record only status, never provider bodies or private request content. */}
   const accepted=!!providerId,permanent=code>=400&&code<500&&![408,409,429].includes(code),state=accepted?'accepted':permanent?'failed':job.attempts>=8?'needs_attention':'pending';
   const next=clock()+Math.min(3600000,300000*2**(job.attempts-1));
   run('UPDATE registration_notification_outbox SET state=?,provider_id=?,accepted_at=?,last_status=?,lease_until=0,next_attempt=? WHERE registration_id=? AND claim=?',state,providerId,accepted?new Date(clock()).toISOString():'',code,accepted?0:next,job.registration_id,job.claim);
   result[accepted?'accepted':'failed']++;
  }
  return result;
 }
 return {enqueue,status,deliver};
}
