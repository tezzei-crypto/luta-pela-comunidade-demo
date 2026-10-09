import {createHash} from 'node:crypto';
import {fail} from './portal-domain.mjs';

export function absencePolicy({db,get,all,run,tx,requireRole,audit,impact,onChange}) {
 db.exec(`CREATE TABLE IF NOT EXISTS absence_policy(id INTEGER PRIMARY KEY CHECK(id=1),threshold INTEGER NOT NULL CHECK(threshold BETWEEN 1 AND 30),version INTEGER NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS absence_policy_history(id INTEGER PRIMARY KEY,version INTEGER NOT NULL,actor TEXT NOT NULL REFERENCES members(user_id),reason TEXT NOT NULL,before_threshold INTEGER NOT NULL,after_threshold INTEGER NOT NULL,created_at TEXT NOT NULL);`);
 run('INSERT OR IGNORE INTO absence_policy VALUES(1,3,1,?)',new Date().toISOString());
 const read=()=>get('SELECT threshold,version,updated_at FROM absence_policy WHERE id=1');
 const prepare=(actor,p)=>{requireRole(actor,['admin']);const old=read();if(!p||!Number.isSafeInteger(p.threshold)||p.threshold<1||p.threshold>30)fail('Informe de 1 a 30 faltas consecutivas.');if(p.version!==old.version)fail('A regra mudou. Reabra a configuração antes de salvar.',409);return old};
 const digest=(actor,old,threshold)=>createHash('sha256').update(JSON.stringify([actor,old.version,threshold])).digest('hex');
 return {
  readAbsencePolicy:read,
  async absencePolicy(actor){const m=requireRole(actor,['admin','secretary','psychologist','social_worker']);return {...read(),can_edit:m.role==='admin',history:m.role==='admin'?all('SELECT h.*,m.email AS actor_email FROM absence_policy_history h JOIN members m ON m.user_id=h.actor ORDER BY h.id DESC LIMIT 30'):[]}},
  async previewAbsencePolicy(actor,p){const old=prepare(actor,p);return {before:old.threshold,after:p.threshold,preview_token:digest(actor,old,p.threshold),impact:impact(p.threshold),message:'O limite é uma regra operacional do projeto. O histórico será recalculado; presenças, justificativas e registros sem marcação interrompem a sequência. Aulas canceladas ficam fora. Contatos e emails já enviados são preservados. Novos alertas poderão gerar avisos à equipe.'}},
  async saveAbsencePolicy(actor,p){return tx(()=>{const old=prepare(actor,p);if(p.preview_token!==digest(actor,old,p.threshold))fail('Confira a prévia antes de salvar.');if(typeof p.reason!=='string'||p.reason.trim().length<5||p.reason.length>500||/[\x00-\x1f]/.test(p.reason))fail('Informe o motivo da alteração, de 5 a 500 caracteres.');if(old.threshold===p.threshold)return read();const now=new Date().toISOString();run('UPDATE absence_policy SET threshold=?,version=version+1,updated_at=? WHERE id=1',p.threshold,now);run('INSERT INTO absence_policy_history(version,actor,reason,before_threshold,after_threshold,created_at) VALUES(?,?,?,?,?,?)',old.version+1,actor,p.reason.trim(),old.threshold,p.threshold,now);audit(actor,'absence.policy.updated:v'+(old.version+1));onChange();return read()})}
 };
}
