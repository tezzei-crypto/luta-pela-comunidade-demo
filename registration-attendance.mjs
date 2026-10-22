import {fail} from './portal-domain.mjs';

// Attendance for incomplete registrations uses the original protocol, never a
// fabricated student ID. Each class preserves its own roster and edit history.
export function registrationAttendance({db,get,all,run,audit}){
 db.exec(`CREATE TABLE IF NOT EXISTS class_registration_roster(
  class_id TEXT NOT NULL REFERENCES classes(id),registration_id TEXT NOT NULL REFERENCES registrations(id),
  name TEXT NOT NULL,birth_date TEXT NOT NULL,PRIMARY KEY(class_id,registration_id));
 CREATE TABLE IF NOT EXISTS registration_attendance(
  class_id TEXT NOT NULL,registration_id TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('present','absent','justified','unmarked')),
  version INTEGER NOT NULL,updated_by TEXT NOT NULL REFERENCES members(user_id),updated_at TEXT NOT NULL,
  PRIMARY KEY(class_id,registration_id),FOREIGN KEY(class_id,registration_id) REFERENCES class_registration_roster(class_id,registration_id));
 CREATE TABLE IF NOT EXISTS registration_attendance_changes(
  id INTEGER PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),registration_id TEXT NOT NULL REFERENCES registrations(id),
  previous_status TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,actor TEXT NOT NULL REFERENCES members(user_id),
  actor_name TEXT NOT NULL,actor_role TEXT NOT NULL,created_at TEXT NOT NULL,kind TEXT NOT NULL DEFAULT 'change',UNIQUE(class_id,registration_id,version));
 CREATE INDEX IF NOT EXISTS registration_attendance_changes_class ON registration_attendance_changes(class_id,id);
 CREATE VIEW IF NOT EXISTS provisional_class_roster AS
 SELECT cr.class_id,cr.registration_id AS id,cr.name,cr.birth_date,r.student_id AS resolved_student_id,
 CASE WHEN r.status='approved' THEN 'approved' ELSE 'incomplete' END AS enrollment_status,1 AS provisional,
 COALESCE(a.status,'unmarked') AS status,COALESCE(a.version,0) AS version,a.updated_by,a.updated_at,
 COALESCE((SELECT h.actor_name FROM registration_attendance_changes h WHERE h.class_id=cr.class_id AND h.registration_id=cr.registration_id AND h.version=a.version ORDER BY h.id DESC LIMIT 1),'') AS updated_by_name
 FROM class_registration_roster cr JOIN registrations r ON r.id=cr.registration_id
 LEFT JOIN registration_attendance a ON a.class_id=cr.class_id AND a.registration_id=cr.registration_id;`);
 const rows=id=>all('SELECT * FROM provisional_class_roster WHERE class_id=? ORDER BY name,id',id).map(({birth_date,class_id,resolved_student_id,...row})=>row);
 return {
  rows,
  snapshot(id,group){run("INSERT OR IGNORE INTO class_registration_roster SELECT ?,r.id,r.student_name,r.birth_date FROM group_registrations gr JOIN registrations r ON r.id=gr.registration_id WHERE gr.group_id=? AND r.source='staff_draft' AND r.status IN ('pending','needs_info') AND r.student_id IS NULL",id,group)},
  mark(actor,lesson,r){
   if(!get('SELECT 1 FROM class_registration_roster WHERE class_id=? AND registration_id=?',lesson.id,r.id))fail('Pré-cadastro não pertence à lista desta aula.',403);
   const old=get('SELECT * FROM registration_attendance WHERE class_id=? AND registration_id=?',lesson.id,r.id);
   if((old?.version||0)!==r.version)fail('A chamada foi alterada. Recarregue antes de salvar.',409);
   if((old?.status||'unmarked')===r.status)return;
   const who=get("SELECT m.role,COALESCE(NULLIF(p.name,''),NULLIF(t.name,''),m.email) AS name FROM members m LEFT JOIN administrative_profiles p USING(user_id) LEFT JOIN teacher_profiles t USING(user_id) WHERE m.user_id=?",actor),at=new Date().toISOString();
   const eventId=get('SELECT MAX(COALESCE((SELECT max(id) FROM attendance_changes),0),COALESCE((SELECT max(id) FROM registration_attendance_changes),0))+1 AS id').id;
   run('INSERT INTO registration_attendance_changes VALUES(?,?,?,?,?,?,?,?,?,?,?)',eventId,lesson.id,r.id,old?.status||'unmarked',r.status,r.version+1,actor,who.name,who.role,at,'change');
   run('INSERT INTO registration_attendance VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,registration_id) DO UPDATE SET status=excluded.status,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at',lesson.id,r.id,r.status,r.version+1,actor,at);
   audit(actor,'registration.attendance.'+r.status+':'+lesson.id+':'+r.id);
  },
  exportRows(unit,from,to){return all("SELECT c.id AS class_id,c.group_id,c.day AS date,c.time,c.label AS class,c.unit,r.id AS student_id,r.name,r.status,r.version,r.updated_at,r.updated_by,r.updated_by_name,'registration' AS record_type FROM provisional_class_roster r JOIN classes c ON c.id=r.class_id WHERE c.unit=? AND c.cancelled=0 AND c.day BETWEEN ? AND ? AND r.version>0 ORDER BY c.day,c.time,r.name",unit,from,to)}
 };
}
