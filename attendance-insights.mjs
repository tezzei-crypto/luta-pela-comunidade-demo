import {absencePolicy} from './absence-policy.mjs';
import {randomUUID} from 'node:crypto';
import {fail} from './portal-domain.mjs';
import {localDay} from './professional-tools.mjs';

const ROLES=['admin','secretary','psychologist','social_worker'];
const UNITS=['amavale','valparaiso','vale-do-carangola'];
const PREFIX={amavale:'UND1_',valparaiso:'UND2_','vale-do-carangola':'UND3_'};
export function attendanceDate(v){
 if(typeof v!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(+new Date(v+'T12:00:00Z'))||new Date(v+'T12:00:00Z').toISOString().slice(0,10)!==v)fail('Confira a data.');
 return v;
}
// A blank record is unknown, never an absence. Streaks never cross groups.
export function absenceEpisodes(rows,threshold=3){
 const episodes=[];let streak=[];
 const finish=()=>{if(streak.length>=threshold)episodes.push({start:streak[0],last:streak.at(-1),rows:streak});streak=[]};
 for(const r of rows){if(r.cancelled)continue;if(r.status==='absent')streak.push(r);else finish()}
 finish();return episodes;
}
export function attendanceInsights({db,get,all,run,tx,requireRole,scope,audit,env,transport}){
 db.exec(`CREATE TABLE IF NOT EXISTS attendance_alerts(
 id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id),group_id TEXT NOT NULL REFERENCES class_groups(id),
 first_class_id TEXT NOT NULL REFERENCES classes(id),unit TEXT NOT NULL,signal TEXT NOT NULL,
 evidence TEXT NOT NULL,last_day TEXT NOT NULL,streak INTEGER NOT NULL,workflow TEXT NOT NULL DEFAULT 'pending',
 owner_id TEXT REFERENCES members(user_id),next_contact TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(student_id,group_id,first_class_id));
 CREATE TABLE IF NOT EXISTS attendance_followups(id TEXT PRIMARY KEY,alert_id TEXT NOT NULL REFERENCES attendance_alerts(id),
 actor TEXT NOT NULL REFERENCES members(user_id),channel TEXT NOT NULL,outcome TEXT NOT NULL,note TEXT NOT NULL,
 workflow TEXT NOT NULL,next_contact TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS attendance_notices(alert_id TEXT NOT NULL REFERENCES attendance_alerts(id),
 recipient_id TEXT NOT NULL REFERENCES members(user_id),status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0,first_attempt INTEGER NOT NULL DEFAULT 0,provider_id TEXT NOT NULL DEFAULT '',
 updated_at TEXT NOT NULL,PRIMARY KEY(alert_id,recipient_id));
 CREATE INDEX IF NOT EXISTS attendance_alerts_unit ON attendance_alerts(unit,signal,last_day);
 CREATE INDEX IF NOT EXISTS attendance_notices_due ON attendance_notices(status,next_attempt);`);
 const policy=absencePolicy({db,get,all,run,tx,requireRole,audit,impact:threshold=>({active_before:countActive(policy.readAbsencePolicy().threshold),active_after:countActive(threshold)}),onChange:()=>reconcile()});
 const stamp=()=>new Date().toISOString();
 function allowed(actor){const m=requireRole(actor,ROLES);if(['admin','secretary'].includes(m.role))return scope.units(actor);
  const p=get("SELECT * FROM professional_profiles WHERE user_id=? AND status='verified' AND review_until>=?",actor,localDay());
  return p?all('SELECT unit FROM professional_units WHERE user_id=?',actor).map(r=>r.unit):[];
 }
 function filters(actor,p={}){
  const scope=allowed(actor),unit=p.unit||'',group_id=p.group_id||'';
  if(unit&&!UNITS.includes(unit))fail('Núcleo inválido.');if(unit&&!scope.includes(unit))fail('Acesso não permitido neste núcleo.',403);
  if(group_id){const g=get('SELECT * FROM class_groups WHERE id=?',group_id);if(!g||!scope.includes(g.unit)||unit&&g.unit!==unit)fail('Turma indisponível neste núcleo.',403)}
  return {units:unit?[unit]:scope,unit,group_id};
 }
 function recipients(unit){return all("SELECT m.user_id,m.email,m.role FROM members m WHERE m.active=1 AND (m.role='admin' OR (m.role='secretary' AND EXISTS(SELECT 1 FROM administrative_units au WHERE au.user_id=m.user_id AND au.unit=?)) OR (m.role IN ('psychologist','social_worker') AND EXISTS(SELECT 1 FROM professional_profiles p JOIN professional_units u USING(user_id) WHERE p.user_id=m.user_id AND p.status='verified' AND p.review_until>=? AND u.unit=?))) ORDER BY m.role,m.email",unit,localDay(),unit)}
 function source(from='2000-01-01',to=localDay()){
  // Historical snapshots preserve the pupils who belonged to each opened lesson.
  return all(`SELECT c.id AS class_id,c.group_id,c.unit,c.day,c.time,c.label,c.cancelled,s.id AS student_id,s.name,s.status AS student_status,
  COALESCE(a.status,'unmarked') AS status,COALESCE(a.version,0) AS version,a.updated_at,m.email AS recorded_by
  FROM classes c JOIN class_students cs ON cs.class_id=c.id JOIN students s ON s.id=cs.student_id
  LEFT JOIN attendance a ON a.class_id=c.id AND a.student_id=s.id LEFT JOIN members m ON m.user_id=a.updated_by
  WHERE c.group_id IS NOT NULL AND c.day BETWEEN ? AND ?
  UNION ALL
  SELECT c.id,c.group_id,c.unit,c.day,c.time,c.label,c.cancelled,s.id,s.name,s.status,a.status,a.version,a.updated_at,m.email
  FROM classes c JOIN attendance a ON a.class_id=c.id JOIN students s ON s.id=a.student_id LEFT JOIN members m ON m.user_id=a.updated_by
  WHERE c.group_id IS NULL AND c.day BETWEEN ? AND ? ORDER BY day,time,class_id,student_id`,from,to,from,to);
 }
 function countActive(threshold){
  const pairs=new Map();for(const row of source()){if(!row.group_id||row.cancelled)continue;const key=row.student_id+'|'+row.group_id;if(!pairs.has(key))pairs.set(key,[]);pairs.get(key).push(row)}
  let count=0;for(const rows of pairs.values()){const last=rows.at(-1);if(!get("SELECT 1 FROM group_students gs JOIN class_groups g ON g.id=gs.group_id JOIN students s ON s.id=gs.student_id WHERE gs.group_id=? AND gs.student_id=? AND g.active=1 AND s.status='approved'",last.group_id,last.student_id))continue;for(const ep of absenceEpisodes(rows,threshold)){if(ep.last!==last)continue;const old=get('SELECT workflow FROM attendance_alerts WHERE student_id=? AND group_id=? AND first_class_id=?',last.student_id,last.group_id,ep.start.class_id);if(old?.workflow!=='closed')count++}}return count;
 }
 function reconcile(){
  const byPair=new Map(),seen=new Set(),day=localDay();
  for(const r of source()){if(!r.group_id||r.cancelled)continue;const key=r.student_id+'|'+r.group_id;if(!byPair.has(key))byPair.set(key,[]);byPair.get(key).push(r)}
  for(const rows of byPair.values()){
   const latest=rows.at(-1),enrolled=get("SELECT 1 FROM group_students gs JOIN class_groups g ON g.id=gs.group_id JOIN students s ON s.id=gs.student_id WHERE gs.group_id=? AND gs.student_id=? AND g.active=1 AND s.status='approved'",latest.group_id,latest.student_id);
   for(const e of absenceEpisodes(rows,policy.readAbsencePolicy().threshold)){
    let old=get('SELECT * FROM attendance_alerts WHERE student_id=? AND group_id=? AND first_class_id=?',latest.student_id,latest.group_id,e.start.class_id);
    const following=rows.slice(rows.indexOf(e.last)+1),signal=!enrolled?'inactive':following.some(r=>['present','justified'].includes(r.status))?'returned':following.length?'unconfirmed':'active';
    // Do not notify old episodes already followed by a return at first installation.
    if(!old&&signal!=='active')continue;
    const evidence=JSON.stringify(e.rows.map(r=>({day:r.day,class_id:r.class_id}))),now=stamp();
    if(!old){const id=randomUUID();run('INSERT INTO attendance_alerts(id,student_id,group_id,first_class_id,unit,signal,evidence,last_day,streak,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,latest.student_id,latest.group_id,e.start.class_id,latest.unit,signal,evidence,e.last.day,e.rows.length,now,now);old=get('SELECT * FROM attendance_alerts WHERE id=?',id);audit('system','attendance.alert.created:'+id,latest.student_id)}
    else if(old.signal!==signal||old.evidence!==evidence)run('UPDATE attendance_alerts SET signal=?,evidence=?,last_day=?,streak=?,version=version+1,updated_at=? WHERE id=?',signal,evidence,e.last.day,e.rows.length,now,old.id);
    seen.add(old.id);
    if(signal==='active'&&old.workflow!=='closed')for(const r of recipients(latest.unit))run('INSERT OR IGNORE INTO attendance_notices(alert_id,recipient_id,updated_at) VALUES(?,?,?)',old.id,r.user_id,now);
   }
  }
  for(const old of all("SELECT id,student_id FROM attendance_alerts WHERE signal<>'corrected'"))if(!seen.has(old.id)){run("UPDATE attendance_alerts SET signal='corrected',version=version+1,updated_at=? WHERE id=?",stamp(),old.id);audit('system','attendance.alert.revised:'+old.id,old.student_id)}
  run("UPDATE attendance_notices SET status='cancelled',updated_at=? WHERE status IN ('pending','retry') AND alert_id IN (SELECT id FROM attendance_alerts WHERE signal<>'active' OR workflow='closed')",stamp());
  run("UPDATE attendance_notices SET status='pending',updated_at=? WHERE status='cancelled' AND first_attempt=0 AND alert_id IN (SELECT id FROM attendance_alerts WHERE signal='active' AND workflow<>'closed')",stamp());
 }
 function alertRead(actor,id){const a=get('SELECT a.*,s.name,g.label,g.start_time,m.email AS owner_email FROM attendance_alerts a JOIN students s ON s.id=a.student_id JOIN class_groups g ON g.id=a.group_id LEFT JOIN members m ON m.user_id=a.owner_id WHERE a.id=?',id);if(!a||!allowed(actor).includes(a.unit))fail('Alerta indisponível para esta conta.',403);return {...a,evidence:JSON.parse(a.evidence)}}
 function report(actor,p){
  const f=filters(actor,p),from=attendanceDate(p.from),to=attendanceDate(p.to);if(from>to||(+new Date(to)-new Date(from))/86400000>366||to>localDay())fail('Selecione um período de até 366 dias, sem datas futuras.');
  const matches=r=>f.units.includes(r.unit)&&(!f.group_id||r.group_id===f.group_id);
  const records=source(from,to).filter(matches),summary=new Map();if(records.length>60000)fail('Período muito grande. Reduza os filtros para exportar.');
  function row(r){const key=r.student_id+'|'+(r.group_id||'legacy');if(!summary.has(key))summary.set(key,{student_id:r.student_id,name:r.name,unit:r.unit,group_id:r.group_id||'',class:r.label||'Sem turma',present:0,absent:0,justified:0,unmarked:0});return summary.get(key)}
  for(const r of all("SELECT s.id AS student_id,s.name,g.unit,g.id AS group_id,g.label FROM group_students gs JOIN students s ON s.id=gs.student_id JOIN class_groups g ON g.id=gs.group_id WHERE s.status='approved' AND g.active=1"))if(matches(r))row(r);
  if(!f.group_id)for(const s of all("SELECT s.id AS student_id,s.name FROM students s WHERE s.status='approved' AND NOT EXISTS(SELECT 1 FROM group_students gs JOIN class_groups g ON g.id=gs.group_id WHERE gs.student_id=s.id AND g.active=1)")){const unit=UNITS.find(u=>s.student_id.startsWith(PREFIX[u]));if(f.units.includes(unit))row({...s,unit,group_id:'',label:'Sem turma'})}
  for(const r of records)if(!r.cancelled)row(r)[r.status]++;
  const result=[...summary.values()].map(r=>{const marked=r.present+r.absent+r.justified,total=marked+r.unmarked;return {...r,marked,total,frequency:marked?Math.round(1000*r.present/marked)/10:null,completion:total?Math.round(1000*marked/total)/10:null}}).sort((a,b)=>a.unit.localeCompare(b.unit)||a.class.localeCompare(b.class)||a.name.localeCompare(b.name,'pt-BR'));
  const lessons=all('SELECT * FROM classes WHERE day BETWEEN ? AND ? ORDER BY day DESC,time',from,to).filter(matches).map(c=>{const list=records.filter(r=>r.class_id===c.id);return {...c,total:list.length,marked:list.filter(r=>r.status!=='unmarked').length,present:list.filter(r=>r.status==='present').length,absent:list.filter(r=>r.status==='absent').length,justified:list.filter(r=>r.status==='justified').length,unmarked:list.filter(r=>r.status==='unmarked').length}});
  const totals=result.reduce((a,r)=>{for(const k of ['present','absent','justified','unmarked','marked','total'])a[k]+=r[k];return a},{present:0,absent:0,justified:0,unmarked:0,marked:0,total:0});
  return {absence_threshold:policy.readAbsencePolicy().threshold,generated_at:stamp(),from,to,unit:f.unit,group_id:f.group_id,summary:result,records,lessons,totals:{...totals,students:new Set(result.map(r=>r.student_id)).size,classes:lessons.filter(c=>!c.cancelled).length,frequency:totals.marked?Math.round(1000*totals.present/totals.marked)/10:null}};
 }
 let delivering=false;
 return {
  ...policy,
  reconcileAttendanceAlerts:()=>tx(reconcile),attendanceReconcile:reconcile,
  async attendanceReport(actor,p){requireRole(actor,ROLES);tx(reconcile);audit(actor,'attendance.report');return report(actor,p)},
  async attendanceReportOptions(actor){const scope=allowed(actor);return {units:scope,groups:all('SELECT id,unit,label,start_time,active FROM class_groups ORDER BY unit,start_time,label').filter(g=>scope.includes(g.unit))}},
  async attendanceAlerts(actor,p={}){const f=filters(actor,p);tx(reconcile);return all('SELECT id,unit,group_id FROM attendance_alerts ORDER BY last_day DESC,created_at DESC').filter(a=>f.units.includes(a.unit)&&(!f.group_id||f.group_id===a.group_id)).map(a=>{const r=alertRead(actor,a.id);return {...r,overdue:!!r.next_contact&&r.next_contact<=localDay()&&r.workflow!=='closed'}})},
  async attendanceAlert(actor,id){requireRole(actor,ROLES);tx(reconcile);const a=alertRead(actor,id),contact=get('SELECT guardian_name,guardian_phone,guardian_email FROM student_contacts WHERE student_id=?',a.student_id)||{};audit(actor,'attendance.alert.read:'+id,a.student_id);return {...a,contact,history:all('SELECT f.*,m.email AS actor_email FROM attendance_followups f JOIN members m ON m.user_id=f.actor WHERE alert_id=? ORDER BY created_at,id',id),notifications:all('SELECT n.status,n.attempts,n.updated_at,m.role FROM attendance_notices n JOIN members m ON m.user_id=n.recipient_id WHERE alert_id=? ORDER BY m.role',id)}},
  async attendanceFollowup(actor,id,p){return tx(()=>{const a=alertRead(actor,id);if(!p||!Number.isSafeInteger(p.version)||p.version!==a.version)fail('O acompanhamento foi alterado. Reabra antes de salvar.',409);
   if(!['pending','attempted','contacted','monitoring','closed'].includes(p.workflow)||!['phone','whatsapp','email','in_person','internal'].includes(p.channel)||!['no_reply','reached','return_planned','other'].includes(p.outcome)||typeof p.note!=='string'||p.note.trim().length<5||p.note.length>1500||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(p.note))fail('Confira situação, canal, resultado e registro do contato.');
   const next=p.next_contact||'';if(next){attendanceDate(next);if(next<localDay())fail('A próxima tentativa não pode ficar no passado.')}if(['attempted','monitoring'].includes(p.workflow)&&!next)fail('Defina a próxima tentativa ou revisão.');
   const now=stamp();run('INSERT INTO attendance_followups VALUES(?,?,?,?,?,?,?,?,?)',randomUUID(),id,actor,p.channel,p.outcome,p.note.trim(),p.workflow,next,now);
   run('UPDATE attendance_alerts SET workflow=?,owner_id=?,next_contact=?,version=version+1,updated_at=? WHERE id=?',p.workflow,actor,p.workflow==='closed'?'':next,now,id);audit(actor,'attendance.followup:'+id,a.student_id);return alertRead(actor,id);
  })},
  async attendanceRecipients(actor,p={}){const f=filters(actor,p);return f.units.map(unit=>({unit,roles:ROLES.map(role=>({role,count:recipients(unit).filter(r=>r.role===role).length}))}))},
  async deliverAttendanceNotices(){
   if(delivering)return;delivering=true;
   try{tx(reconcile);if(!env.RESEND_API_KEY||!env.MAIL_FROM)return;
    const due=all("SELECT n.*,a.unit,a.signal,a.workflow FROM attendance_notices n JOIN attendance_alerts a ON a.id=n.alert_id WHERE n.status IN ('pending','retry') AND n.next_attempt<=? ORDER BY n.next_attempt LIMIT 20",Date.now());
    for(const n of due){const r=recipients(n.unit).find(r=>r.user_id===n.recipient_id);if(!r||n.signal!=='active'||n.workflow==='closed'){run("UPDATE attendance_notices SET status='cancelled',updated_at=? WHERE alert_id=? AND recipient_id=?",stamp(),n.alert_id,n.recipient_id);continue}
     const now=Date.now();if(n.first_attempt&&now-n.first_attempt>=23*3600000||n.attempts>=8){run("UPDATE attendance_notices SET status='review',updated_at=? WHERE alert_id=? AND recipient_id=?",stamp(),n.alert_id,n.recipient_id);continue}
     run('UPDATE attendance_notices SET attempts=attempts+1,first_attempt=CASE WHEN first_attempt=0 THEN ? ELSE first_attempt END,next_attempt=?,updated_at=? WHERE alert_id=? AND recipient_id=?',now,now+300000,stamp(),n.alert_id,n.recipient_id);
     let provider='';try{const response=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'attendance-'+n.alert_id+'-'+r.user_id},body:JSON.stringify({from:env.MAIL_FROM,to:[r.email],subject:'Frequência: acompanhamento de faltas — Luta pela Comunidade',text:'Há um alerta de '+policy.readAbsencePolicy().threshold+' ou mais faltas consecutivas sem justificativa em um núcleo sob sua responsabilidade.\nEntre no painel privado para consultar o aluno, conferir os lançamentos e combinar o contato acolhedor com a família.\n'+(env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL)+'/portal/#attendance-report-area\n\nA justificativa interrompe a sequência. Registros sem marcação não contam como falta. Este aviso não substitui o acompanhamento da equipe.'}),signal:AbortSignal.timeout(10000)});if(response.ok)provider=(await response.json()).id||''}catch{}
     run('UPDATE attendance_notices SET status=?,provider_id=?,next_attempt=?,updated_at=? WHERE alert_id=? AND recipient_id=?',provider?'accepted':'retry',provider,now+Math.min(3600000,300000*2**n.attempts),stamp(),n.alert_id,n.recipient_id);
    }
   }finally{delivering=false}
  }
 };
}
