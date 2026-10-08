import {randomUUID} from 'node:crypto';
import {fail} from './portal-domain.mjs';
import {localDay} from './professional-tools.mjs';

export function rollcallTools({db,get,all,run,tx,requireRole,audit,env,transport}){
 db.exec(`CREATE TABLE IF NOT EXISTS attendance_monitor_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS rollcall_issues(id TEXT PRIMARY KEY,group_id TEXT NOT NULL REFERENCES class_groups(id),day TEXT NOT NULL,unit TEXT NOT NULL,
 status TEXT NOT NULL,expected INTEGER NOT NULL,marked INTEGER NOT NULL,teachers TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(group_id,day));
 CREATE TABLE IF NOT EXISTS rollcall_notices(issue_id TEXT NOT NULL REFERENCES rollcall_issues(id),recipient_id TEXT NOT NULL REFERENCES members(user_id),
 status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,first_attempt INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,provider_id TEXT NOT NULL DEFAULT '',PRIMARY KEY(issue_id,recipient_id));`);
 run("INSERT OR IGNORE INTO attendance_monitor_settings VALUES('start_day',?)",localDay());
 const managers=()=>all("SELECT user_id,email FROM members WHERE active=1 AND role IN ('admin','secretary')");
 function reconcile(clock=new Date()){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(clock).map(p=>[p.type,p.value])),today=`${parts.year}-${parts.month}-${parts.day}`,start=get("SELECT value FROM attendance_monitor_settings WHERE key='start_day'").value;
  // Start monitoring at installation; do not invent historic missed obligations.
  const first=new Date(Math.max(+new Date(start+'T12:00:00Z'),+clock-30*86400000));
  const dates=new Set(all("SELECT day FROM rollcall_issues WHERE status='open'").map(r=>r.day));
  for(let d=first;d.toISOString().slice(0,10)<=today;d=new Date(+d+86400000))dates.add(d.toISOString().slice(0,10));
  const groups=all('SELECT * FROM class_groups');
  for(const g of groups)for(const day of dates){
   const old=get('SELECT * FROM rollcall_issues WHERE group_id=? AND day=?',g.id,day),weekday=new Date(day+'T12:00:00Z').getUTCDay();
   if(!old&&g.created_day&&day<g.created_day&&!get('SELECT 1 FROM classes WHERE group_id=? AND day=?',g.id,day))continue;
   if(!old&&(!g.active||!JSON.parse(g.weekdays).includes(weekday)||+clock<+new Date(day+'T'+g.end_time+':00-03:00')+3600000))continue;
   const c=get('SELECT * FROM classes WHERE group_id=? AND day=?',g.id,day),teachers=all("SELECT m.user_id,p.name FROM group_teachers gt JOIN members m ON m.user_id=gt.teacher_id JOIN teacher_profiles p ON p.user_id=m.user_id WHERE gt.group_id=? AND m.active=1 AND m.role='teacher' AND (p.status='verified' OR p.test_access=1) AND EXISTS(SELECT 1 FROM teacher_units tu WHERE tu.user_id=m.user_id AND tu.unit=?)",g.id,g.unit);
   const roster=c?all('SELECT student_id FROM class_students WHERE class_id=?',c.id):all("SELECT gs.student_id FROM group_students gs JOIN students s ON s.id=gs.student_id WHERE gs.group_id=? AND s.status='approved'",g.id);
   const marked=c?Number(get("SELECT count(*) AS n FROM attendance a JOIN class_students cs ON cs.class_id=a.class_id AND cs.student_id=a.student_id WHERE a.class_id=? AND a.status<>'unmarked'",c.id).n):0;
   const status=c?.cancelled||!g.active?'cancelled':!roster.length||marked>=roster.length?'resolved':'open';
   if(!old&&status!=='open')continue;
   const reason=!teachers.length?'Turma sem professor habilitado vinculado':!c?'Chamada não aberta':'Chamada incompleta',now=new Date().toISOString(),teacherJson=JSON.stringify(teachers);
   const id=old?.id||randomUUID();
   if(!old){run('INSERT INTO rollcall_issues VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,g.id,day,g.unit,status,roster.length,marked,teacherJson,reason,now,now);audit('system','rollcall.issue.created:'+id)}
   else if(old.status!==status||old.marked!==marked||old.expected!==roster.length||old.teachers!==teacherJson||old.reason!==reason)run('UPDATE rollcall_issues SET status=?,expected=?,marked=?,teachers=?,reason=?,updated_at=? WHERE id=?',status,roster.length,marked,teacherJson,reason,now,id);
   if(status==='open')for(const m of managers())run('INSERT OR IGNORE INTO rollcall_notices(issue_id,recipient_id) VALUES(?,?)',id,m.user_id);
  }
 }
 let delivering=false;
 return {
  checkRollcalls:(clock)=>tx(()=>reconcile(clock)),
  async rollcallIssues(actor,p={}){requireRole(actor,['admin','secretary']);tx(()=>reconcile());return all('SELECT i.*,g.label,g.start_time,g.end_time FROM rollcall_issues i JOIN class_groups g ON g.id=i.group_id ORDER BY day DESC,g.start_time').filter(r=>(!p.unit||r.unit===p.unit)&&(!p.group_id||r.group_id===p.group_id)).map(r=>({...r,teachers:JSON.parse(r.teachers)}))},
  async cancelClass(actor,id,p){return tx(()=>{const m=requireRole(actor,['admin','secretary','teacher']),c=get('SELECT * FROM classes WHERE id=?',id);if(!c)fail('Aula não localizada.',404);
   if(m.role==='teacher'&&(!c.group_id||!get("SELECT 1 FROM group_teachers gt JOIN members m ON m.user_id=gt.teacher_id JOIN teacher_profiles t ON t.user_id=m.user_id JOIN teacher_units u ON u.user_id=m.user_id WHERE gt.group_id=? AND gt.teacher_id=? AND m.active=1 AND (t.status='verified' OR t.test_access=1) AND u.unit=?",c.group_id,actor,c.unit)))fail('Professor sem vínculo com esta turma.',403);
   if(typeof p.cancelled!=='boolean'||typeof p.reason!=='string'||p.reason.trim().length<5||p.reason.length>500)fail('Informe o motivo do cancelamento ou da reabertura.');
   run('UPDATE classes SET cancelled=?,cancellation_reason=? WHERE id=?',Number(p.cancelled),p.reason.trim(),id);audit(actor,'class.'+(p.cancelled?'cancelled':'reopened')+':'+id);reconcile();return get('SELECT * FROM classes WHERE id=?',id);
  })},
  async deliverRollcallNotices(){if(delivering)return;delivering=true;try{tx(()=>reconcile());if(!env.RESEND_API_KEY||!env.MAIL_FROM)return;
   for(const n of all("SELECT n.*,i.unit,i.status AS issue_status,i.day,g.label FROM rollcall_notices n JOIN rollcall_issues i ON i.id=n.issue_id JOIN class_groups g ON g.id=i.group_id WHERE n.status IN ('pending','retry') AND n.next_attempt<=? LIMIT 20",Date.now())){
    const m=managers().find(r=>r.user_id===n.recipient_id);if(!m||n.issue_status!=='open'){run("UPDATE rollcall_notices SET status='cancelled' WHERE issue_id=? AND recipient_id=?",n.issue_id,n.recipient_id);continue}
    const now=Date.now();if(n.attempts>=8||n.first_attempt&&now-n.first_attempt>=23*3600000){run("UPDATE rollcall_notices SET status='review' WHERE issue_id=? AND recipient_id=?",n.issue_id,n.recipient_id);continue}
    run('UPDATE rollcall_notices SET attempts=attempts+1,first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END,next_attempt=? WHERE issue_id=? AND recipient_id=?',now,now+300000,n.issue_id,n.recipient_id);
    let provider='';try{const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'rollcall-'+n.issue_id+'-'+m.user_id},body:JSON.stringify({from:env.MAIL_FROM,to:[m.email],subject:'Chamada pendente — Luta pela Comunidade',text:'A chamada da turma '+n.label+' de '+n.day+' ainda não está completa, após uma hora do fim previsto da aula.\nConfira a ocorrência administrativa, o professor responsável e as marcações pendentes no painel.\n'+(env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL)+'/administracao/#attendance-report-area\nSe a aula não ocorreu, registre o cancelamento com o motivo. Não transforme marcações pendentes em faltas.'}),signal:AbortSignal.timeout(10000)});if(response.ok)provider=(await response.json()).id||''}catch{}
    run('UPDATE rollcall_notices SET status=?,provider_id=?,next_attempt=? WHERE issue_id=? AND recipient_id=?',provider?'accepted':'retry',provider,now+Math.min(3600000,300000*2**n.attempts),n.issue_id,n.recipient_id);
   }
  }finally{delivering=false}}
 };
}
