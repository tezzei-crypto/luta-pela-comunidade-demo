import {randomUUID} from 'node:crypto';
import {fail} from './portal-domain.mjs';
import {localDay} from './professional-tools.mjs';

const defaults={enabled:true,teacher_email:true,manager_email:true,grace_minutes:720,repeat_hours:24,max_notices:2,quiet_start:20,quiet_end:8,version:0};
const brParts=clock=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).formatToParts(clock).map(p=>[p.type,p.value]));
const brDay=clock=>{const p=brParts(clock);return `${p.year}-${p.month}-${p.day}`};
export function rollcallTools({db,get,all,run,tx,requireRole,scope,audit,env,transport}){
 db.exec(`CREATE TABLE IF NOT EXISTS attendance_monitor_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS rollcall_issues(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES class_groups(id),day TEXT NOT NULL,unit TEXT NOT NULL,
 status TEXT NOT NULL,expected INTEGER NOT NULL,marked INTEGER NOT NULL,teachers TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(group_id,day));
 CREATE TABLE IF NOT EXISTS rollcall_notices(issue_id TEXT NOT NULL REFERENCES rollcall_issues(id),recipient_id TEXT NOT NULL REFERENCES members(user_id),
 status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,first_attempt INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,provider_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(issue_id,recipient_id));
 CREATE TABLE IF NOT EXISTS rollcall_policy(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS rollcall_notice_history(id TEXT PRIMARY KEY,issue_id TEXT NOT NULL,recipient_id TEXT NOT NULL,sequence INTEGER NOT NULL,provider_id TEXT NOT NULL,sent_at INTEGER NOT NULL,UNIQUE(issue_id,recipient_id,sequence));`);
 const columns=new Set(all('PRAGMA table_info(rollcall_notices)').map(c=>c.name));
 for(const [name,type]of Object.entries({send_count:'INTEGER NOT NULL DEFAULT 0',last_sent:'INTEGER NOT NULL DEFAULT 0',claim_token:"TEXT NOT NULL DEFAULT ''",lease_until:'INTEGER NOT NULL DEFAULT 0',last_error:"TEXT NOT NULL DEFAULT ''",payload:"TEXT NOT NULL DEFAULT ''"}))if(!columns.has(name))db.exec('ALTER TABLE rollcall_notices ADD COLUMN '+name+' '+type);
 run("UPDATE rollcall_notices SET send_count=1,last_sent=first_attempt WHERE status='accepted' AND send_count=0");
 run("INSERT OR IGNORE INTO attendance_monitor_settings VALUES('start_day',?)",localDay());
 run("INSERT OR IGNORE INTO attendance_monitor_settings VALUES('teacher_start_day',?)",localDay());
 run('INSERT OR IGNORE INTO rollcall_policy VALUES(1,?)',JSON.stringify(defaults));
 const policy=()=>({...defaults,...JSON.parse(get('SELECT value FROM rollcall_policy WHERE id=1').value)});
 const managers=unit=>all("SELECT user_id,email,role FROM members WHERE active=1 AND (role='admin' OR (role='secretary' AND EXISTS(SELECT 1 FROM administrative_units au WHERE au.user_id=members.user_id AND au.unit=?)))",unit);
 const teachers=group=>all("SELECT m.user_id,m.email,m.role,p.name FROM group_teachers gt JOIN members m ON m.user_id=gt.teacher_id JOIN teacher_profiles p ON p.user_id=m.user_id WHERE gt.group_id=? AND m.active=1 AND m.role='teacher' AND (p.status='verified' OR p.test_access=1) AND EXISTS(SELECT 1 FROM teacher_units tu WHERE tu.user_id=m.user_id AND tu.unit=?)",group.id,group.unit);
 const recipients=(g,day,p)=>[...(p.manager_email?managers(g.unit):[]),...(p.teacher_email&&day>=get("SELECT value FROM attendance_monitor_settings WHERE key='teacher_start_day'").value?teachers(g):[])];
 function reconcile(clock=new Date()){
  const p=policy(),now=+clock,today=brDay(clock),start=get("SELECT value FROM attendance_monitor_settings WHERE key='start_day'").value;
  // Never invent obligations before installation or before a group's creation.
  const first=new Date(Math.max(+new Date(start+'T12:00:00Z'),now-30*86400000));
  const dates=new Set(all("SELECT day FROM rollcall_issues WHERE status='open'").map(r=>r.day));
  if(p.enabled)for(let d=first;d.toISOString().slice(0,10)<=today;d=new Date(+d+86400000))dates.add(d.toISOString().slice(0,10));
  for(const g of all('SELECT * FROM class_groups'))for(const day of dates){
   const old=get('SELECT * FROM rollcall_issues WHERE group_id=? AND day=?',g.id,day),weekday=new Date(day+'T12:00:00Z').getUTCDay(),deadline=+new Date(day+'T'+g.end_time+':00-03:00')+p.grace_minutes*60000;
   if(!old&&g.created_day&&day<g.created_day&&!get('SELECT 1 FROM classes WHERE group_id=? AND day=?',g.id,day))continue;
   if(!old&&(!p.enabled||!g.active||!JSON.parse(g.weekdays).includes(weekday)||now<deadline))continue;
   const c=get('SELECT * FROM classes WHERE group_id=? AND day=?',g.id,day),assigned=teachers(g);
   const roster=c?all('SELECT student_id FROM class_students WHERE class_id=?',c.id):all("SELECT gs.student_id FROM group_students gs JOIN students s ON s.id=gs.student_id WHERE gs.group_id=? AND s.status='approved'",g.id);
   const marked=c?Number(get("SELECT count(*) AS n FROM attendance a JOIN class_students cs ON cs.class_id=a.class_id AND cs.student_id=a.student_id WHERE a.class_id=? AND a.status<>'unmarked'",c.id).n):0;
   const status=c?.cancelled||!g.active?'cancelled':!roster.length||marked>=roster.length?'resolved':'open';
   if(!old&&status!=='open')continue;
   const reason=!assigned.length?'Turma sem professor habilitado vinculado':!c?'Chamada não aberta':'Chamada incompleta',stamp=clock.toISOString(),teacherJson=JSON.stringify(assigned.map(({user_id,name})=>({user_id,name}))),id=old?.id||randomUUID();
   if(!old){run('INSERT INTO rollcall_issues VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,g.id,day,g.unit,status,roster.length,marked,teacherJson,reason,stamp,stamp);audit('system','rollcall.issue.created:'+id)}
   else if(old.status!==status||old.marked!==marked||old.expected!==roster.length||old.teachers!==teacherJson||old.reason!==reason)run('UPDATE rollcall_issues SET status=?,expected=?,marked=?,teachers=?,reason=?,updated_at=? WHERE id=?',status,roster.length,marked,teacherJson,reason,stamp,id);
   const eligible=p.enabled&&status==='open'&&now>=deadline?recipients(g,day,p):[];
   for(const m of eligible){
    run('INSERT OR IGNORE INTO rollcall_notices(issue_id,recipient_id) VALUES(?,?)',id,m.user_id);
    const n=get('SELECT * FROM rollcall_notices WHERE issue_id=? AND recipient_id=?',id,m.user_id);
    if(n.status==='cancelled'&&n.attempts>0&&n.payload&&n.send_count<p.max_notices){run("UPDATE rollcall_notices SET status='retry',claim_token='',lease_until=0 WHERE issue_id=? AND recipient_id=?",id,m.user_id)}
    else if(n.send_count<p.max_notices&&['accepted','cancelled'].includes(n.status)&&(!n.last_sent||now-n.last_sent>=p.repeat_hours*3600000))run("UPDATE rollcall_notices SET status='pending',attempts=0,first_attempt=0,next_attempt=?,claim_token='',lease_until=0,payload='' WHERE issue_id=? AND recipient_id=?",now,id,m.user_id);
   }
   for(const n of all('SELECT * FROM rollcall_notices WHERE issue_id=?',id))if(!eligible.some(m=>m.user_id===n.recipient_id)||n.send_count>=p.max_notices){
    if(['pending','retry','sending'].includes(n.status))run("UPDATE rollcall_notices SET status='cancelled',claim_token='',lease_until=0 WHERE issue_id=? AND recipient_id=?",id,n.recipient_id);
   }
  }
 }
 function access(actor){return requireRole(actor,['admin','secretary','teacher'])}
 function settings(actor){const m=access(actor);return {...policy(),can_edit:m.role==='admin',mail_configured:!!(env.RESEND_API_KEY&&env.MAIL_FROM),time_zone:'America/Sao_Paulo',check_interval_minutes:5}}
 function quiet(p,clock){const h=Number(brParts(clock).hour);return p.quiet_start!==p.quiet_end&&(p.quiet_start>p.quiet_end?(h>=p.quiet_start||h<p.quiet_end):(h>=p.quiet_start&&h<p.quiet_end))}
 let delivering=false;
 return {
  rollcallReconcile:reconcile,
  checkRollcalls:clock=>tx(()=>reconcile(clock)),
  async rollcallSettings(actor){return settings(actor)},
  async saveRollcallSettings(actor,input){return tx(()=>{
   requireRole(actor,['admin']);const old=policy(),p={};
   if(input?.version!==old.version)fail('As regras foram alteradas por outra pessoa. Atualize antes de salvar.',409);
   for(const k of ['enabled','teacher_email','manager_email']){if(typeof input[k]!=='boolean')fail('Escolha se os avisos estão ativados.');p[k]=input[k]}
   for(const [k,min,max]of [['grace_minutes',0,2880],['repeat_hours',1,168],['max_notices',1,5],['quiet_start',0,23],['quiet_end',0,23]]){if(!Number.isSafeInteger(input[k])||input[k]<min||input[k]>max)fail('Confira os limites dos prazos e horários dos avisos.');p[k]=input[k]}
   p.version=old.version+1;run('UPDATE rollcall_policy SET value=? WHERE id=1',JSON.stringify(p));audit(actor,'rollcall.policy.updated:'+p.version);reconcile();return settings(actor);
  })},
  async rollcallIssues(actor,p={},clock=new Date()){
   const m=access(actor);tx(()=>reconcile(clock));
   return all('SELECT i.*,g.label,g.start_time,g.end_time,c.id AS class_id FROM rollcall_issues i JOIN class_groups g ON g.id=i.group_id LEFT JOIN classes c ON c.group_id=i.group_id AND c.day=i.day ORDER BY day DESC,g.start_time')
    .filter(r=>(m.role!=='secretary'||scope.permits(actor,r.unit))&&(!p.unit||r.unit===p.unit)&&(!p.group_id||r.group_id===p.group_id)&&(!p.status||r.status===p.status)&&(m.role!=='teacher'||teachers({id:r.group_id,unit:r.unit}).some(t=>t.user_id===actor)))
    .map(r=>({...r,notify_after:new Date(+new Date(r.day+'T'+r.end_time+':00-03:00')+policy().grace_minutes*60000).toISOString(),within_grace:+clock<+new Date(r.day+'T'+r.end_time+':00-03:00')+policy().grace_minutes*60000,teachers:JSON.parse(r.teachers),notifications:all('SELECT n.recipient_id,m.email,m.role,n.status,n.send_count,n.last_sent,n.last_error FROM rollcall_notices n JOIN members m ON m.user_id=n.recipient_id WHERE n.issue_id=?',r.id).filter(n=>m.role!=='teacher'||n.recipient_id===actor)}));
  },
  async cancelClass(actor,id,p){return tx(()=>{const m=access(actor),c=get('SELECT * FROM classes WHERE id=?',id);if(!c)fail('Aula não localizada.',404);
   if(m.role==='teacher'&&(!c.group_id||!teachers({id:c.group_id,unit:c.unit}).some(t=>t.user_id===actor)))fail('Professor sem vínculo com esta turma.',403);
   if(typeof p.cancelled!=='boolean'||typeof p.reason!=='string'||p.reason.trim().length<5||p.reason.length>500)fail('Informe o motivo do cancelamento ou da reabertura.');
   run('UPDATE classes SET cancelled=?,cancellation_reason=? WHERE id=?',Number(p.cancelled),p.reason.trim(),id);audit(actor,'class.'+(p.cancelled?'cancelled':'reopened')+':'+id);reconcile();return get('SELECT * FROM classes WHERE id=?',id);
  })},
  async deliverRollcallNotices(clock=new Date()){
   if(delivering)return;delivering=true;
   try{
    const now=+clock;tx(()=>reconcile(clock));const p=policy();
    if(!p.enabled||quiet(p,clock)||!env.RESEND_API_KEY||!env.MAIL_FROM)return;
    const candidates=all("SELECT issue_id,recipient_id FROM rollcall_notices WHERE (status IN ('pending','retry') AND next_attempt<=?) OR (status='sending' AND lease_until<=?) LIMIT 20",now,now);
    for(const candidate of candidates){
     // Claim inside the SQLite write transaction: simultaneous workers cannot send the same notice.
     const claim=tx(()=>{
      const n=get('SELECT * FROM rollcall_notices WHERE issue_id=? AND recipient_id=?',candidate.issue_id,candidate.recipient_id),i=get('SELECT * FROM rollcall_issues WHERE id=?',candidate.issue_id),g=get('SELECT * FROM class_groups WHERE id=?',i.group_id),latest=policy();
      if(!latest.enabled||quiet(latest,clock)||i.status!=='open'||n.send_count>=latest.max_notices||!(['pending','retry'].includes(n.status)&&n.next_attempt<=now||n.status==='sending'&&n.lease_until<=now))return;
      const m=recipients(g,i.day,latest).find(m=>m.user_id===n.recipient_id);if(!m)return;
      // Resend retains idempotency keys for 24h. Ambiguous attempts stop before that boundary.
      if(n.attempts>=8||n.first_attempt&&now-n.first_attempt>=23*3600000){run("UPDATE rollcall_notices SET status='review',last_error='Envio sem confirmação; requer conferência do provedor.' WHERE issue_id=? AND recipient_id=?",n.issue_id,n.recipient_id);return}
      const payload=n.payload||JSON.stringify({from:env.MAIL_FROM,to:[m.email],subject:'Chamada pendente — Luta pela Comunidade',text:`A chamada de ${g.label}, núcleo ${i.unit}, em ${i.day.split('-').reverse().join('/')} (${g.start_time}–${g.end_time}, horário de Brasília), ainda precisa ser concluída.\n${i.marked} de ${i.expected} marcações registradas.\nAbra o painel, confira a aula e salve a chamada:\n${env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL||''}/${m.role==='teacher'?'professor':'administracao'}/#rollcall-area\nSe a aula não ocorreu, registre o cancelamento com motivo. Não marque faltas apenas para encerrar a pendência.\nO lembrete para automaticamente quando a chamada fica completa ou a aula é cancelada.`});
      const token=randomUUID();run("UPDATE rollcall_notices SET status='sending',payload=?,claim_token=?,lease_until=?,attempts=attempts+1,first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END WHERE issue_id=? AND recipient_id=?",payload,token,now+120000,now,n.issue_id,n.recipient_id);return {n,i,g,m,token,payload};
     });
     if(!claim)continue;const {n,i,g,m,token,payload}=claim;let provider='',error='Não foi possível confirmar o envio; nova tentativa automática.';
     const key='rollcall-'+n.issue_id+'-'+m.user_id+(n.send_count?'-'+(n.send_count+1):'');
     try{
      const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':key},body:payload,signal:AbortSignal.timeout(10000)});
      if(response.ok)provider=(await response.json()).id||'';
      else error='Provedor recusou o envio (HTTP '+response.status+'); nova tentativa automática.';
     }catch{}
     tx(()=>{
      const current=get('SELECT * FROM rollcall_notices WHERE issue_id=? AND recipient_id=?',n.issue_id,n.recipient_id);
      if(current.claim_token!==token)return;
      run("UPDATE rollcall_notices SET status=?,provider_id=?,send_count=send_count+?,last_sent=CASE WHEN ? THEN ? ELSE last_sent END,next_attempt=?,claim_token='',lease_until=0,last_error=? WHERE issue_id=? AND recipient_id=?",provider?'accepted':'retry',provider,provider?1:0,provider?1:0,now,now+Math.min(3600000,300000*2**n.attempts),provider?'':error,n.issue_id,n.recipient_id);
      if(provider){run('INSERT OR IGNORE INTO rollcall_notice_history VALUES(?,?,?,?,?,?)',randomUUID(),n.issue_id,n.recipient_id,n.send_count+1,provider,now);audit('system','rollcall.notice.accepted:'+n.issue_id+':'+n.recipient_id)}
     });
    }
   }finally{delivering=false}
  }
 };
}
