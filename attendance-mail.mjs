import {createHash,randomUUID} from 'node:crypto';
import {deferRejectedEmail} from './resend-quota.mjs';

// Fresh alerts are grouped once per recipient per local day. Legacy attempts
// keep their original payload/key in attendance-insights, including uncertainty.
export function attendanceMail({db,get,all,run,tx,env,transport,recipients,emailAllowed,threshold,clock=()=>Date.now()}) {
 if(!all('PRAGMA table_info(attendance_notices)').some(c=>c.name==='batch_id'))db.exec("ALTER TABLE attendance_notices ADD COLUMN batch_id TEXT NOT NULL DEFAULT ''");
 db.exec(`CREATE TABLE IF NOT EXISTS attendance_mail_batches(
  id TEXT PRIMARY KEY,recipient_id TEXT NOT NULL,day TEXT NOT NULL,email TEXT NOT NULL,
  payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,claim TEXT NOT NULL DEFAULT '',provider_id TEXT NOT NULL DEFAULT '',
  UNIQUE(recipient_id,day));`);
 const dayOf=at=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
 const eligible=n=>n.signal==='active'&&n.workflow!=='closed'&&emailAllowed(n.recipient_id)&&recipients(n.unit,n.group_id).find(r=>r.user_id===n.recipient_id);
 const rows=id=>all('SELECT n.*,a.unit,a.group_id,a.signal,a.workflow FROM attendance_notices n JOIN attendance_alerts a ON a.id=n.alert_id WHERE n.batch_id=?',id);
 function enqueue(){const day=dayOf(clock());
  const fresh=all("SELECT n.*,a.unit,a.group_id,a.signal,a.workflow FROM attendance_notices n JOIN attendance_alerts a ON a.id=n.alert_id WHERE n.status IN ('pending','retry') AND n.attempts=0 AND n.first_attempt=0 AND n.batch_id='' ORDER BY n.recipient_id,n.alert_id").filter(eligible);
  for(const recipient of new Set(fresh.map(n=>n.recipient_id))){
   if(get('SELECT 1 FROM attendance_mail_batches WHERE recipient_id=? AND day=?',recipient,day))continue;
   const items=fresh.filter(n=>n.recipient_id===recipient),r=eligible(items[0]);
   const id=createHash('sha256').update(recipient+'\n'+day).digest('hex');
   const payload=JSON.stringify({from:env.MAIL_FROM,to:[r.email],subject:'Frequência: acompanhamento de faltas — Luta pela Comunidade',text:`Há ${items.length} novo(s) alerta(s) de ${threshold()} ou mais faltas consecutivas sem justificativa sob sua responsabilidade.\nEntre no painel privado para conferir os lançamentos e combinar o contato acolhedor com as famílias.\n${env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL}/portal/#absence-attention-area\n\nA justificativa interrompe a sequência. Registros sem marcação não contam como falta. Este resumo reúne os novos alertas disponíveis no momento do envio, uma vez ao dia por destinatário. Novos casos continuam disponíveis imediatamente no painel. Não contém nomes ou contatos das crianças.`});
   run('INSERT INTO attendance_mail_batches(id,recipient_id,day,email,payload) VALUES(?,?,?,?,?)',id,recipient,day,r.email,payload);
   for(const n of items)run('UPDATE attendance_notices SET batch_id=? WHERE alert_id=? AND recipient_id=?',id,n.alert_id,recipient);
  }
 }
 return async function deliver(){
  if(!env.RESEND_API_KEY||!env.MAIL_FROM)return;
  tx(enqueue);
  for(const {id} of all("SELECT id FROM attendance_mail_batches WHERE state IN ('pending','sending') AND next_attempt<=? AND lease_until<=? ORDER BY day,id LIMIT 20",clock(),clock())){
   const job=tx(()=>{
    const n=get('SELECT * FROM attendance_mail_batches WHERE id=?',id),now=clock();
    if(!['pending','sending'].includes(n.state)||n.next_attempt>now||n.lease_until>now)return;
    const items=rows(id);
    if(!items.length||items.some(item=>eligible(item)?.email!==n.email)){
     run("UPDATE attendance_mail_batches SET state='cancelled',lease_until=0 WHERE id=?",id);
     // Only definitely unattempted survivors can be included in a later digest.
     for(const item of items)run("UPDATE attendance_notices SET status=?,batch_id=?,updated_at=? WHERE alert_id=? AND recipient_id=?",eligible(item)?(n.first_attempt?'review':'pending'):'cancelled',n.first_attempt?id:'',new Date(now).toISOString(),item.alert_id,item.recipient_id);
     return;
    }
    if(n.attempts>=8||n.first_attempt&&now-n.first_attempt>=23*3600000){run("UPDATE attendance_mail_batches SET state='review',lease_until=0 WHERE id=?",id);run("UPDATE attendance_notices SET status='review' WHERE batch_id=?",id);return;}
    const claim=randomUUID();
    run("UPDATE attendance_mail_batches SET state='sending',attempts=attempts+1,first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END,lease_until=?,claim=? WHERE id=?",now,now+120000,claim,id);
    return {...n,claim};
   });
   if(!job)continue;
   let provider='';
   try{
    const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'attendance-summary-'+job.id},body:job.payload,signal:AbortSignal.timeout(10000)});
    if(await deferRejectedEmail(response,{run,table:'attendance_mail_batches',before:job,now:clock(),claim:job.claim}))continue;
    if(response.ok)provider=(await response.json()).id||'';
   }catch{}
   tx(()=>{
    if(get('SELECT claim FROM attendance_mail_batches WHERE id=?',id)?.claim!==job.claim)return;
    run("UPDATE attendance_mail_batches SET state=?,provider_id=?,next_attempt=?,lease_until=0 WHERE id=?",provider?'accepted':'pending',provider,clock()+Math.min(3600000,300000*2**job.attempts),id);
    run('UPDATE attendance_notices SET status=?,attempts=?,first_attempt=?,provider_id=?,updated_at=? WHERE batch_id=?',provider?'accepted':'retry',job.attempts+1,job.first_attempt||clock(),provider,new Date(clock()).toISOString(),id);
   });
  }
 };
}
