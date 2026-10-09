import {createHmac} from 'node:crypto';
// Revision changes with domain data, never with logins, page views or audit reads.
const tables=['members','administrative_profiles','administrative_units','students','links','registrations','documents','student_contacts','teacher_profiles','teacher_documents','teacher_units','professional_profiles','professional_documents','professional_units','monitors','monitor_units','class_groups','group_students','group_teachers','classes','class_students','attendance','appointment_slots','bookings','appointment_requests','workforce_sessions','workforce_attendance','reports','report_updates','student_graduation','graduation_policy','graduation_history','project_contact','rollcall_issues','rollcall_policy','rollcall_notices'];
export function systemSync({db,get,requireRole,secret}){
 db.exec('CREATE TABLE IF NOT EXISTS system_revision(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL DEFAULT 0); INSERT OR IGNORE INTO system_revision(id,version) VALUES(1,0)');
 for(const table of tables){
  if(!get("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",table))continue;
  const columns=db.prepare('PRAGMA table_info('+table+')').all().map(r=>r.name).filter(k=>!['updated_at','notice_state','notice_claimed_at'].includes(k));
  const changed=columns.map(k=>'OLD."'+k+'" IS NOT NEW."'+k+'"').join(' OR ');
  for(const event of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} ${event==='UPDATE'?'WHEN '+changed:''} BEGIN UPDATE system_revision SET version=version+1 WHERE id=1; END`);
 }
 return {async systemRevision(actor){requireRole(actor,['admin','secretary','teacher','guardian','psychologist','social_worker']);const row=get('SELECT version FROM system_revision WHERE id=1'),day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return {revision:createHmac('sha256',secret).update(String(row.version)+'|'+day).digest('hex'),poll_after_seconds:20}}};
}
