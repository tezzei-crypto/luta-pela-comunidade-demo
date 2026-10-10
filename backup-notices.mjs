import {createHash,randomUUID} from 'node:crypto';

// Persistent outbox: retries reuse the exact payload and provider idempotency key.
export function backupNotifications({db,get,all,run,env,transport,status,clock=()=>new Date()}){
 db.exec(`CREATE TABLE IF NOT EXISTS recovery_mail_incidents(kind TEXT PRIMARY KEY,token TEXT NOT NULL,opened_at TEXT NOT NULL,resolved_at TEXT);
 CREATE TABLE IF NOT EXISTS recovery_mail_outbox(id TEXT PRIMARY KEY,event_key TEXT NOT NULL,user_id TEXT NOT NULL,email TEXT NOT NULL,kind TEXT NOT NULL,incident TEXT,created_at TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,first_attempt_at TEXT,last_attempt_at TEXT,next_attempt_at TEXT,accepted_at TEXT,provider_id TEXT,error TEXT,UNIQUE(event_key,email));`);
 let delivering=false;
 const configured=()=>!!(env.RESEND_API_KEY&&env.MAIL_FROM);
 const recipients=()=>all("SELECT user_id,lower(email) AS email FROM members WHERE active=1 AND role='admin' ORDER BY email").filter(r=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
 const localTime=date=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const dateText=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Ainda não registrado';
 const link='https://www.lutapelacomunidade.com.br/administracao/#backup-area';
 function overview(s,now){
  const latest=s.packages[0],since=new Date(now.getTime()-86400000).toISOString(),totals=get("SELECT count(*) AS created,sum(CASE WHEN drive_verified_at IS NOT NULL THEN 1 ELSE 0 END) AS external FROM recovery_packages WHERE created_at>=?",since);
  return `Situação conferida em ${dateText(now)} (horário de Brasília).\nÚltimo backup criado: ${dateText(latest?.created_at)}.\nÚltimas 24 horas: ${totals.created} pacote(s) criado(s); ${totals.external||0} com cópia automática confirmada no Drive.\nCópia automática mais recente no Drive: ${s.external_pending?'PENDENTE — o pacote local não comprova a cópia externa.':'CONFIRMADA por tamanho e checksum.'}\nRestauração: ${s.restore_pending?'ensaio recente ainda não registrado.':'relatório recente registrado pela administração.'}\nRotina: a cada ${s.settings.interval_hours} horas.\n\nConfira a situação e as instruções no painel:\n${link}\n\nEste email não contém bancos, documentos, chaves ou dados de alunos. Aceitação pelo serviço de email não confirma leitura. Os avisos dependem do servidor e do provedor de email disponíveis; indisponibilidade total exige monitoramento externo.`;
 }
 function enqueue(eventKey,kind,incident,subject,text,now){
  for(const r of recipients()){
   const id=createHash('sha256').update(eventKey+'\n'+r.email).digest('hex');
   run("INSERT OR IGNORE INTO recovery_mail_outbox(id,event_key,user_id,email,kind,incident,created_at,payload) VALUES(?,?,?,?,?,?,?,?)",id,eventKey,r.user_id,r.email,kind,incident,now.toISOString(),JSON.stringify({from:env.MAIL_FROM,to:[r.email],subject,text}));
  }
 }
 function notificationStatus(){return {configured:configured(),policy:'daily_and_failures',daily_hour:8,time_zone:'America/Sao_Paulo',check_minutes:5,recipients:recipients().map(r=>r.email),pending:get("SELECT count(*) AS n FROM recovery_mail_outbox WHERE state='pending'").n,unconfirmed:get("SELECT count(*) AS n FROM recovery_mail_outbox WHERE state IN ('failed','uncertain')").n,last_accepted:get("SELECT accepted_at,kind FROM recovery_mail_outbox WHERE state='accepted' ORDER BY accepted_at DESC LIMIT 1")||null};}
 async function deliver(){
  if(delivering)return;delivering=true;
  try{
   const now=clock(),stamp=now.toISOString(),s=status();if(!s.settings.enabled||!s.settings.configured)return;
   const failures={generation:s.last_run?.state==='failed',overdue:s.overdue,external:s.external_pending};
   const labels={generation:'Falha ao gerar o backup. A cópia anterior foi preservada.',overdue:'Backup atrasado ou nenhuma cópia recente disponível.',external:s.settings.drive_connected?'Cópia externa automática ainda não confirmada.':'Conexão automática com o Google Drive ainda não configurada.'};
   for(const [kind,active] of Object.entries(failures)){
    let incident=get('SELECT * FROM recovery_mail_incidents WHERE kind=?',kind);
    if(!active){if(incident&&!incident.resolved_at)run('UPDATE recovery_mail_incidents SET resolved_at=? WHERE kind=?',stamp,kind);continue;}
    if(!incident||incident.resolved_at){incident={token:randomUUID()};run('INSERT INTO recovery_mail_incidents(kind,token,opened_at,resolved_at) VALUES(?,?,?,NULL) ON CONFLICT(kind) DO UPDATE SET token=excluded.token,opened_at=excluded.opened_at,resolved_at=NULL',kind,incident.token,stamp);}
    // Never freeze an incomplete sender configuration into the outbox.
    if(configured())enqueue('alert:'+incident.token,kind,incident.token,'Atenção ao backup — Luta pela Comunidade',labels[kind]+'\n\n'+overview(s,now),now);
   }
   const local=localTime(now),day=`${local.year}-${local.month}-${local.day}`;
   if(configured()&&Number(local.hour)>=8)enqueue('daily:'+day,'daily',null,'Resumo diário de backup — Luta pela Comunidade',overview(s,now),now);
   if(!configured())return;
   const pending=all("SELECT * FROM recovery_mail_outbox WHERE state='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,id LIMIT 20",stamp);
   for(const item of pending){
    const member=get("SELECT user_id FROM members WHERE user_id=? AND active=1 AND role='admin' AND lower(email)=?",item.user_id,item.email);
    const current=item.kind==='daily'?item.event_key==='daily:'+day:!!get('SELECT kind FROM recovery_mail_incidents WHERE token=? AND resolved_at IS NULL',item.incident);
    if(!member||!current){run("UPDATE recovery_mail_outbox SET state='cancelled',error=NULL WHERE id=?",item.id);continue;}
    // Resend keeps idempotency keys for 24 h. Do not risk another send after that window.
    if(item.first_attempt_at&&now.getTime()-Date.parse(item.first_attempt_at)>=23*3600000){run("UPDATE recovery_mail_outbox SET state='uncertain',error='Confirmação ausente; confira o provedor antes de repetir.' WHERE id=?",item.id);continue;}
    run('UPDATE recovery_mail_outbox SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?),last_attempt_at=? WHERE id=?',stamp,stamp,item.id);
    try{
     const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'backup-'+item.id},body:item.payload,signal:AbortSignal.timeout(10000)});
     const result=await response.json().catch(()=>({}));
     if(response.ok&&typeof result.id==='string'&&result.id){run("UPDATE recovery_mail_outbox SET state='accepted',accepted_at=?,provider_id=?,error=NULL WHERE id=?",stamp,result.id,item.id);continue;}
     if(response.status>=400&&response.status<500&&response.status!==429&&!(response.status===409&&result.name==='concurrent_idempotent_requests')){run("UPDATE recovery_mail_outbox SET state='failed',error='Envio rejeitado pelo provedor; confira a configuração de email.' WHERE id=?",item.id);continue;}
    }catch{}
    const delay=Math.min(60,5*2**Math.min(item.attempts,4))*60000;
    run("UPDATE recovery_mail_outbox SET next_attempt_at=?,error='Email ainda sem confirmação; nova tentativa programada.' WHERE id=?",new Date(now.getTime()+delay).toISOString(),item.id);
   }
  }finally{delivering=false;}
 }
 return {notificationStatus,deliver};
}
