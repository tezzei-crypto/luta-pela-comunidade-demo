import {createHash} from 'node:crypto';

const deferred = new WeakMap();
export const QUOTA_MESSAGE = 'Envio aguardando liberação do limite do provedor; aviso preservado na fila.';

// A 429 is a definite rejection, unlike a timeout. It must not consume the
// ambiguous-send retry budget or start Resend's 24-hour idempotency window.
export async function retryAfterQuota(response, now = Date.now()) {
 if (response?.status !== 429) return 0;
 if (deferred.has(response)) return deferred.get(response).until;
 let data = {};
 try { data = await response.clone().json(); } catch {}
 const kind = ['daily_quota_exceeded','monthly_quota_exceeded'].includes(data.name) ? data.name : 'rate_limit_exceeded';
 const raw = response.headers?.get?.('retry-after');
 const retry = raw && (/^\d+(\.\d+)?$/.test(raw) ? now + Number(raw)*1000 : Date.parse(raw));
 // Monthly resets depend on the billing cycle: probe hourly, never invent its date.
 const fallback = kind === 'daily_quota_exceeded' ? new Date(now).setUTCHours(24,0,5,0) : now + (kind === 'monthly_quota_exceeded' ? 3600000 : 300000);
 const until = Math.max(now + 1000, Number.isFinite(retry) && retry > now ? retry : fallback);
 deferred.set(response,{until,kind});
 return until;
}

export function quotaAwareTransport({db,get,run,transport,clock=()=>Date.now(),key=''}) {
 db.exec("CREATE TABLE IF NOT EXISTS mail_provider_pause(account TEXT PRIMARY KEY,until_ms INTEGER NOT NULL,reason TEXT NOT NULL)");
 const account=createHash('sha256').update(key).digest('hex');
 const status=()=>{const row=get('SELECT until_ms,reason FROM mail_provider_pause WHERE account=?',account);return row&&row.until_ms>clock()?{paused:true,retry_at:new Date(row.until_ms).toISOString(),reason:row.reason}:{paused:false};};
 let tail=Promise.resolve();
 const send=async(url,options)=>{
  if(String(url)!=='https://api.resend.com/emails'||options?.method!=='POST')return transport(url,options);
  const job=tail.then(async()=>{
   const pause=status();
   if(pause.paused){const response=Response.json({name:pause.reason},{status:429});deferred.set(response,{until:Date.parse(pause.retry_at),kind:pause.reason});return response;}
   const response=await transport(url,options),until=await retryAfterQuota(response,clock());
   if(until){const {kind}=deferred.get(response);run('INSERT INTO mail_provider_pause VALUES(?,?,?) ON CONFLICT(account) DO UPDATE SET until_ms=MAX(until_ms,excluded.until_ms),reason=excluded.reason',account,until,kind);}
   return response;
  });
  tail=job.catch(()=>{});return job;
 };
 send.mailStatus=status;
 return send;
}

// Fixed schemas only; no SQL identifiers come from a request or provider reply.
const schemas={
 registration_notification_outbox:{keys:['registration_id'],first:'first_attempt',next:'next_attempt',claim:'claim',lease:'lease_until',code:true},
 registration_document_outbox:{keys:['id'],first:'first_attempt',next:'next_attempt',claim:'claim',lease:'lease_until',code:true},
 intake_notification_outbox:{keys:['id'],first:'first_attempt_at',next:'next_attempt_at',claim:'claim_token',lease:'lease_until',error:'error',iso:true},
 class_review_mail:{keys:['id'],first:'first_attempt_at',next:'next_attempt_at',error:'error',iso:true},
 operations_outbox:{keys:['id'],first:'first_attempt_at',next:'next_attempt_at',error:'error',iso:true},
 recovery_mail_outbox:{keys:['id'],first:'first_attempt_at',next:'next_attempt_at',error:'error',iso:true},
 attendance_notices:{keys:['alert_id','recipient_id'],first:'first_attempt',next:'next_attempt',state:'status',value:'retry'},
 attendance_mail_batches:{keys:['id'],first:'first_attempt',next:'next_attempt',claim:'claim',lease:'lease_until'},
 rollcall_notices:{keys:['issue_id','recipient_id'],first:'first_attempt',next:'next_attempt',state:'status',value:'retry',claim:'claim_token',lease:'lease_until',error:'last_error'}
};
export async function deferRejectedEmail(response,{run,table,before,now=Date.now(),claim}) {
 const until=await retryAfterQuota(response,now);if(!until)return false;
 const s=schemas[table];if(!s)throw Error('Unknown mail outbox');
 const sets=[`${s.state||'state'}=?`,'attempts=?',`${s.first}=?`,`${s.next}=?`];
 const values=[s.value||'pending',before.attempts,before[s.first],s.iso?new Date(until).toISOString():until];
 if(s.lease)sets.push(`${s.lease}=0`);
 if(s.error){sets.push(`${s.error}=?`);values.push(QUOTA_MESSAGE);}
 if(s.code)sets.push('last_status=429');
 const where=s.keys.map(k=>`${k}=?`);values.push(...s.keys.map(k=>before[k]));
 if(s.claim&&claim){where.push(`${s.claim}=?`);values.push(claim);}
 run(`UPDATE ${table} SET ${sets.join(',')} WHERE ${where.join(' AND ')}`,...values);
 return true;
}
