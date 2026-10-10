import {fail} from './portal-domain.mjs';

// Actor identity comes from the authenticated account, never from the payload.
// Historical baselines preserve only the last known state; earlier edits are unknown.
export function attendanceHistory({db,get,all,run,requireRole,lessonAccess}){
 const migrated=!!get("SELECT 1 FROM auth_migrations WHERE name='attendance_history_baseline_v1'");
 db.exec(`CREATE TABLE IF NOT EXISTS attendance_changes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,class_id TEXT NOT NULL REFERENCES classes(id),
  student_id TEXT NOT NULL REFERENCES students(id),previous_status TEXT,status TEXT NOT NULL,
  version INTEGER NOT NULL,actor TEXT NOT NULL REFERENCES members(user_id),actor_name TEXT NOT NULL,
  actor_role TEXT NOT NULL,created_at TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('change','baseline')),
  UNIQUE(class_id,student_id,version));
  CREATE INDEX IF NOT EXISTS attendance_changes_class ON attendance_changes(class_id,id);`);
 const identity=actor=>get("SELECT m.role,COALESCE(NULLIF(a.name,''),NULLIF(t.name,''),m.email) AS name FROM members m LEFT JOIN administrative_profiles a USING(user_id) LEFT JOIN teacher_profiles t USING(user_id) WHERE m.user_id=?",actor);
 const append=(classId,studentId,previous,status,version,actor,at,kind)=>{const who=identity(actor);run('INSERT INTO attendance_changes(class_id,student_id,previous_status,status,version,actor,actor_name,actor_role,created_at,kind) VALUES(?,?,?,?,?,?,?,?,?,?)',classId,studentId,previous,status,version,actor,who.name,who.role,at,kind)};
 if(!migrated){db.exec('BEGIN IMMEDIATE');try{for(const a of all('SELECT * FROM attendance WHERE NOT EXISTS(SELECT 1 FROM attendance_changes h WHERE h.class_id=attendance.class_id AND h.student_id=attendance.student_id AND h.version=attendance.version)'))append(a.class_id,a.student_id,null,a.status,a.version,a.updated_by,a.updated_at,'baseline');run("INSERT INTO auth_migrations VALUES('attendance_history_baseline_v1')");db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}}
 return {
  recordAttendanceChange(actor,lesson,row,old){requireRole(actor,['admin','secretary','teacher']);append(lesson.id,row.id,old?.status||'unmarked',row.status,row.version+1,actor,new Date().toISOString(),'change')},
  async attendanceHistory(actor,id,before){
   const lesson=get('SELECT * FROM classes WHERE id=?',id);if(!lesson)fail('Aula não localizada.',404);lessonAccess(actor,lesson);
   const cursor=before===undefined||before===null?Number.MAX_SAFE_INTEGER:Number(before);
   if(!Number.isSafeInteger(cursor)||cursor<=0)fail('Página do histórico inválida.');
   const rows=all('SELECT h.*,s.name AS student_name FROM attendance_changes h JOIN students s ON s.id=h.student_id WHERE h.class_id=? AND h.id<? ORDER BY h.id DESC LIMIT 101',id,cursor);
   return {changes:rows.slice(0,100),next_before:rows.length>100?rows[99].id:null};
  }
 };
}
