import {fail} from './portal-domain.mjs';

// Preserve lesson records and audit history; only the official accounting boundary changes.
export function projectPeriod({db,get,run,requireRole,audit,onChange=()=>{}}){
 db.exec(`CREATE TABLE IF NOT EXISTS project_period(id INTEGER PRIMARY KEY CHECK(id=1),start_date TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO project_period(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS project_period_history(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,old_date TEXT NOT NULL,new_date TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const officialStart=()=>get('SELECT start_date FROM project_period WHERE id=1').start_date;
 // Called inside saveRollcallSettings' transaction and version check.
 function setOfficialStart(actor,value,reason){
  requireRole(actor,['admin']);const old=officialStart();if(value===undefined||value===old)return;
  if(typeof value!=='string'||value&&(!/^20\d{2}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value))fail('Confira a data de início oficial.');
  if(typeof reason!=='string'||reason.trim().length<5||reason.length>500||/[\x00-\x1f]/.test(reason))fail('Informe o motivo da mudança do início oficial (5 a 500 caracteres).');
  run('UPDATE project_period SET start_date=?,version=version+1 WHERE id=1',value);
  run('INSERT INTO project_period_history(actor,old_date,new_date,reason,created_at) VALUES(?,?,?,?,?)',actor,old,value,reason.trim(),new Date().toISOString());
  audit(actor,'attendance.official_start:'+old+'>'+value);onChange();
 }
 return {officialStart,setOfficialStart};
}
