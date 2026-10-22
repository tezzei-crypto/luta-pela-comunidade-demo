import {deferRejectedEmail} from './resend-quota.mjs';
import {createHash} from 'node:crypto';
import {fail} from './portal-domain.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const names={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
const dayOf=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
function validDay(day){if(typeof day!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(day))fail('Informe um período válido.');const d=new Date(day+'T12:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==day)fail('Informe um período válido.');return day;}

export function classReview({db,get,all,run,tx,requireRole,scope,audit,evidence,env={},transport=fetch,emailAllowed=()=>true,officialStart=()=>'',clock=()=>new Date()}){
 db.exec(`CREATE TABLE IF NOT EXISTS class_reviews(class_id TEXT PRIMARY KEY REFERENCES classes(id),version INTEGER NOT NULL DEFAULT 0,decision TEXT NOT NULL,fingerprint TEXT NOT NULL,snapshot TEXT NOT NULL,note TEXT NOT NULL,reviewed_by TEXT NOT NULL REFERENCES members(user_id),reviewed_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS class_review_history(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),actor TEXT NOT NULL REFERENCES members(user_id),payload_hash TEXT NOT NULL,decision TEXT NOT NULL,fingerprint TEXT NOT NULL,snapshot TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS class_review_history_class ON class_review_history(class_id,created_at);
 CREATE TABLE IF NOT EXISTS class_review_mail(id TEXT PRIMARY KEY,recipient_id TEXT NOT NULL,email TEXT NOT NULL,day TEXT NOT NULL,scope_hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,first_attempt_at TEXT,next_attempt_at TEXT,accepted_at TEXT,provider_id TEXT,error TEXT);`);
 const memberName=id=>get("SELECT COALESCE(NULLIF(p.name,''),m.email) AS name FROM members m LEFT JOIN administrative_profiles p ON p.user_id=m.user_id WHERE m.user_id=?",id)?.name||'Equipe';
 function data(c){
  const roster=all("SELECT s.id,s.name,COALESCE(a.status,'unmarked') AS status,COALESCE(a.version,0) AS version FROM (SELECT student_id FROM class_students WHERE class_id=? UNION SELECT student_id FROM attendance WHERE class_id=?) r JOIN students s ON s.id=r.student_id LEFT JOIN attendance a ON a.class_id=? AND a.student_id=s.id ORDER BY s.id",c.id,c.id,c.id).concat(all('SELECT id,name,status,version FROM provisional_class_roster WHERE class_id=? ORDER BY id',c.id));
  const visitors=all('SELECT q.id,q.name,q.student_id,q.status AS intake_status,a.present,a.version FROM visitor_attendance a JOIN quick_intakes q ON q.id=a.intake_id WHERE a.class_id=? ORDER BY q.id',c.id);
  const photo=get('SELECT id,created_at FROM class_photos WHERE class_id=? ORDER BY rowid DESC LIMIT 1',c.id)||null;
  const check=get('SELECT version,status,fingerprint,reviewed_by,reviewed_at FROM class_photo_checks WHERE class_id=?',c.id)||{version:0,status:'empty'};
  const photoStatus=check.fingerprint&&check.fingerprint!==evidence.classEvidenceFingerprint(c.id)?'changed':check.status;
  const delivery=get('SELECT held,version FROM class_delivery WHERE class_id=?',c.id)||{held:0,version:0};
  const presentIds=new Set(roster.filter(s=>s.status==='present').map(s=>s.id));
  const presentVisitors=[...new Map(visitors.filter(v=>v.present&&!presentIds.has(v.student_id)).map(v=>[v.student_id||'visitor:'+v.id,v])).values()];
  const counts={roster:roster.length,present:presentIds.size,absent:roster.filter(s=>s.status==='absent').length,justified:roster.filter(s=>s.status==='justified').length,unmarked:roster.filter(s=>s.status==='unmarked').length,visitors:presentVisitors.length,total_present:presentIds.size+presentVisitors.length};
  const summary={class_id:c.id,unit:c.unit,day:c.day,time:c.time,label:c.label,cancelled:!!c.cancelled,held:!!delivery.held||counts.total_present>0,photo_id:photo?.id||null,photo_status:photoStatus,counts};
  const fingerprint=hash({class:{id:c.id,group_id:c.group_id,unit:c.unit,day:c.day,time:c.time,label:c.label,cancelled:c.cancelled},roster,visitors,photo,check,delivery});
  return {roster,visitors,photo,photo_status:photoStatus,photo_reviewed_by:check.reviewed_by?memberName(check.reviewed_by):'',photo_reviewed_at:check.reviewed_at||'',summary,fingerprint};
 }
 function task(c,detail=false){const d=data(c),r=get('SELECT * FROM class_reviews WHERE class_id=?',c.id);const reasons=[];
  if(!d.summary.held)reasons.push('Confirmar se a aula aconteceu');
  if(!d.photo)reasons.push('Aguardar foto do professor');else if(d.photo_status!=='approved')reasons.push(d.photo_status==='needs_photo'?'Aguardar nova foto':'Conferir a foto');
  if(d.summary.counts.unmarked)reasons.push('Completar '+d.summary.counts.unmarked+' marcação(ões) da chamada');
  const current=!!r&&r.fingerprint===d.fingerprint;
  const status=c.cancelled?'cancelled':current&&r.decision==='completed'?'completed':current&&r.decision==='needs_changes'?'needs_changes':r?.decision==='completed'?'changed':reasons.length?'waiting':'ready';
  return {lesson:{id:c.id,unit:c.unit,day:c.day,time:c.time,label:c.label,cancelled:!!c.cancelled},version:r?.version||0,fingerprint:d.fingerprint,status,reasons,summary:d.summary,photo_reviewed_by:d.photo_reviewed_by,photo_reviewed_at:d.photo_reviewed_at,last_review:r?{decision:r.decision,note:r.note,reviewed_by:memberName(r.reviewed_by),reviewed_at:r.reviewed_at,snapshot:JSON.parse(r.snapshot)}:null,...(detail?{students:d.roster,visitors:d.visitors,history:all('SELECT id,actor,decision,note,snapshot,created_at FROM class_review_history WHERE class_id=? ORDER BY created_at DESC,rowid DESC LIMIT 30',c.id).map(h=>({...h,actor_name:memberName(h.actor),snapshot:JSON.parse(h.snapshot)}))}:{})};
 }
 function read(actor,id){requireRole(actor,['admin','secretary']);const c=get('SELECT * FROM classes WHERE id=?',id);if(!c)fail('Aula não localizada.',404);scope.requireUnit(actor,c.unit);if(c.day>dayOf(clock()))fail('A conferência é feita após a aula.');return c;}
 function list(units,from,to){return all('SELECT * FROM classes WHERE day BETWEEN ? AND ? ORDER BY day DESC,time DESC,id',from,to).filter(c=>c.day>=officialStart()&&units.includes(c.unit)).map(c=>task(c));}
 function range(p={}){const today=dayOf(clock()),from=validDay(p.from||new Date(Date.parse(today+'T12:00:00Z')-89*86400000).toISOString().slice(0,10)),to=validDay(p.to||today);if(from>to||Date.parse(to)-Date.parse(from)>366*86400000||to>today)fail('Selecione até um ano, sem datas futuras.');return {from,to};}
 const secretaries=()=>all("SELECT user_id,lower(email) AS email FROM members WHERE role='secretary' AND active=1 ORDER BY email").map(s=>({...s,units:scope.units(s.user_id)})).filter(s=>emailAllowed(s.user_id)&&s.units.length&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email));
 let sending=false;
 async function deliver(){if(sending||!env.RESEND_API_KEY||!env.MAIL_FROM)return;sending=true;try{
  const now=clock(),stamp=now.toISOString(),day=dayOf(now),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(now));
  run("UPDATE class_review_mail SET state='cancelled' WHERE day<>? AND first_attempt_at IS NULL AND state='pending'",day);
  if(hour>=8){const {from,to}=range();for(const s of secretaries()){
   const pending=list(s.units,from,to).filter(t=>!['completed','cancelled'].includes(t.status));if(!pending.length)continue;
   const id=hash([s.user_id,day]),text=`SECRETARIA — CONFERÊNCIA DAS AULAS\n\n${pending.length} aula(s) aguardam conferência no período de ${from} a ${to}.\n${s.units.map(u=>names[u]+': '+pending.filter(t=>t.lesson.unit===u).length).join('\n')}\n\n1. Confira a foto privada. As fotos já aprovadas continuam aprovadas.\n2. Confira a chamada, justificativas e visitantes. Não preencha faltas apenas para encerrar a tarefa.\n3. Confira o resumo e salve a conferência completa, ou solicite correções com motivo.\n\nhttps://www.lutapelacomunidade.com.br/administracao/#class-review-area\n\nO sistema registra autoria e horário. Mudanças posteriores na foto, chamada ou visitantes pedem nova conferência. As tarefas concluídas ou aulas canceladas saem dos próximos resumos. Este email retrata o momento do envio; confira o painel atualizado. Os nomes, contatos e fotos permanecem no painel privado.`;
   run('INSERT OR IGNORE INTO class_review_mail(id,recipient_id,email,day,scope_hash,payload) VALUES(?,?,?,?,?,?)',id,s.user_id,s.email,day,hash(s.units),JSON.stringify({from:env.MAIL_FROM,to:[s.email],subject:'Secretaria: conferir foto e chamada das aulas — Luta pela Comunidade',text}));
  }}
  for(const item of all("SELECT * FROM class_review_mail WHERE state='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY day,id LIMIT 20",stamp)){
   const s=secretaries().find(s=>s.user_id===item.recipient_id&&s.email===item.email);const currentRange=range();
   if(!s||!list(s.units,currentRange.from,currentRange.to).some(t=>!['completed','cancelled'].includes(t.status))||item.scope_hash&&item.scope_hash!==hash(s.units)){run("UPDATE class_review_mail SET state='cancelled' WHERE id=?",item.id);continue;}
   if(item.first_attempt_at&&+now-Date.parse(item.first_attempt_at)>=23*3600000){run("UPDATE class_review_mail SET state='uncertain',error='Confira o provedor antes de repetir.' WHERE id=?",item.id);continue;}
   run('UPDATE class_review_mail SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=?',stamp,item.id);
   try{const res=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'class-review-'+item.id},body:item.payload,signal:AbortSignal.timeout(10000)});if(await deferRejectedEmail(res,{run,table:'class_review_mail',before:item,now:+now}))continue;const p=await res.json().catch(()=>({}));if(res.ok&&typeof p.id==='string'&&p.id){run("UPDATE class_review_mail SET state='accepted',provider_id=?,accepted_at=?,error=NULL WHERE id=?",p.id,stamp,item.id);continue;}if(res.status>=400&&res.status<500&&res.status!==429&&!(res.status===409&&p.name==='concurrent_idempotent_requests')){run("UPDATE class_review_mail SET state='failed',error='Provedor recusou o envio.' WHERE id=?",item.id);continue;}}catch{}
   run('UPDATE class_review_mail SET next_attempt_at=?,error=? WHERE id=?',new Date(+now+Math.min(60,5*2**Math.min(item.attempts,4))*60000).toISOString(),'Sem confirmação; nova tentativa programada.',item.id);
  }
 }finally{sending=false;}}
 return {
  async classReviewQueue(actor,p={}){requireRole(actor,['admin','secretary']);let units=scope.units(actor);if(p.unit){scope.requireUnit(actor,p.unit);units=[p.unit];}const {from,to}=range(p),tasks=list(units,from,to),pending=tasks.filter(t=>!['completed','cancelled'].includes(t.status)).length;return {from,to,official_start_date:officialStart(),tasks,summary:{pending,completed:tasks.filter(t=>t.status==='completed').length,cancelled:tasks.filter(t=>t.status==='cancelled').length},notifications:{provider:transport.mailStatus?.()||{paused:false},configured:!!(env.RESEND_API_KEY&&env.MAIL_FROM),daily_hour:8,check_minutes:5,states:all('SELECT state,recipient_id FROM class_review_mail').filter(n=>requireRole(actor,['admin','secretary']).role==='admin'||n.recipient_id===actor).reduce((a,n)=>(a[n.state]=(a[n.state]||0)+1,a),{}),recipients:secretaries().filter(s=>s.units.some(u=>units.includes(u))).map(s=>s.email)}};},
  async classReviewTask(actor,id){return task(read(actor,id),true);},
  async saveClassReview(actor,id,p){return tx(()=>{const c=read(actor,id);if(!p||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(p.id)||!['completed','needs_changes'].includes(p.decision)||typeof p.note!=='string'||p.note.length>1500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(p.note))fail('Confira a decisão e a observação.');
   const payloadHash=hash({class_id:id,version:p.version,fingerprint:p.fingerprint,decision:p.decision,note:p.note.trim(),photo_checked:p.photo_checked===true,attendance_checked:p.attendance_checked===true,summary_checked:p.summary_checked===true});const old=get('SELECT * FROM class_review_history WHERE id=?',p.id);if(old){if(old.class_id!==id||old.actor!==actor||old.payload_hash!==payloadHash)fail('Protocolo de conferência já utilizado.',409);return {repeated:true,task:task(c,true)};}
   const t=task(c,true);if(c.cancelled)fail('Aula cancelada: preserve o cancelamento e o histórico.',409);if(!Number.isSafeInteger(p.version)||p.version!==t.version||p.fingerprint!==t.fingerprint)fail('A foto, chamada ou visitantes mudaram. Atualize a tarefa antes de salvar.',409);
   if(p.decision==='completed'&&(t.reasons.length||![p.photo_checked,p.attendance_checked,p.summary_checked].every(v=>v===true)))fail('Confira as três etapas e resolva as pendências antes de concluir.');if(p.decision==='needs_changes'&&p.note.trim().length<5)fail('Explique a correção necessária (mínimo de cinco caracteres).');
   const stamp=clock().toISOString(),snapshot=JSON.stringify(t.summary);run('INSERT INTO class_reviews VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(class_id) DO UPDATE SET version=excluded.version,decision=excluded.decision,fingerprint=excluded.fingerprint,snapshot=excluded.snapshot,note=excluded.note,reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at',id,t.version+1,p.decision,t.fingerprint,snapshot,p.note.trim(),actor,stamp);run('INSERT INTO class_review_history VALUES(?,?,?,?,?,?,?,?,?)',p.id,id,actor,payloadHash,p.decision,t.fingerprint,snapshot,p.note.trim(),stamp);audit(actor,'class.review.'+p.decision+':'+id);return {repeated:false,task:task(c,true)};
  })},
  deliverClassReviewNotices:deliver
 };
}
