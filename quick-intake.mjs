import {createHash} from 'node:crypto';
import {fail} from './portal-domain.mjs';
import {localDay} from './professional-tools.mjs';
import {studentUnit} from './unit-scope.mjs';
import {intakeWorkflow} from './intake-workflow.mjs';

const normalize=s=>String(s).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const text=(v,max,required=false)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x1f\x7f]/.test(v)||required&&v.trim().length<3)fail('Confira o nome e os dados informados.');return v.trim().replace(/\s+/g,' ')};
function fields(p){
 const name=text(p.name,160,true),guardian_name=text(p.guardian_name??'',160),phone=text(p.phone??'',30).replace(/[ ().-]/g,'');
 const age=p.age===''||p.age===null||p.age===undefined?null:p.age;
 if(age!==null&&(!Number.isInteger(age)||age<0||age>120))fail('Informe a idade em anos ou deixe em branco.');
 if(phone&&!/^\+?\d{10,15}$/.test(phone))fail('Confira o telefone com DDD ou deixe em branco.');
 return {name,guardian_name,phone,age};
}
export function quickIntake({db,get,all,run,tx,requireRole,scope,audit,project,requireUnit,env,transport,emailAllowed=()=>true}){
 db.exec(`CREATE TABLE IF NOT EXISTS quick_intakes(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,unit TEXT NOT NULL,group_id TEXT NOT NULL REFERENCES class_groups(id),name TEXT NOT NULL,name_key TEXT NOT NULL,age INTEGER,guardian_name TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','linked','archived')),student_id TEXT REFERENCES students(id),created_by TEXT NOT NULL REFERENCES members(user_id),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
 CREATE INDEX IF NOT EXISTS quick_intakes_unit ON quick_intakes(unit,status);
 CREATE TABLE IF NOT EXISTS visitor_attendance(class_id TEXT NOT NULL REFERENCES classes(id),intake_id TEXT NOT NULL REFERENCES quick_intakes(id),present INTEGER NOT NULL CHECK(present IN (0,1)),version INTEGER NOT NULL,updated_by TEXT NOT NULL REFERENCES members(user_id),updated_at TEXT NOT NULL,PRIMARY KEY(class_id,intake_id));
 CREATE TABLE IF NOT EXISTS visitor_changes(id INTEGER PRIMARY KEY AUTOINCREMENT,class_id TEXT NOT NULL,intake_id TEXT NOT NULL,present INTEGER NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS class_delivery(class_id TEXT PRIMARY KEY REFERENCES classes(id),held INTEGER NOT NULL CHECK(held IN (0,1)),version INTEGER NOT NULL,updated_by TEXT NOT NULL REFERENCES members(user_id),updated_at TEXT NOT NULL);`);
 const workflow=intakeWorkflow({db,get,all,run,tx,requireRole,scope,audit,env,transport,emailAllowed});
 function lesson(actor,id,write=false){const c=get('SELECT * FROM classes WHERE id=?',id);if(!c)fail('Aula não localizada.',404);project.lessonAccess(actor,c);if(write){project.requireAttendanceWrite(actor,c);if(c.cancelled)fail('Aula cancelada. Reabra a aula antes de lançar presença.',409);if(c.day>localDay())fail('A presença só pode ser registrada na data da aula ou depois.');}return c;}
 function read(actor,id){const r=get('SELECT * FROM quick_intakes WHERE id=?',id);if(!r)fail('Pré-cadastro não localizado.',404);requireRole(actor,['admin','secretary','teacher']);requireUnit(actor,r.unit);if(requireRole(actor,['admin','secretary','teacher']).role==='teacher')project.groupRead(actor,r.group_id);return r;}
 function mark(actor,c,r,present,version){
  if(c.unit!==r.unit||c.group_id!==r.group_id)fail('Pré-cadastro de outra turma. A secretaria precisa conferir o vínculo.',403);
  const old=get('SELECT * FROM visitor_attendance WHERE class_id=? AND intake_id=?',c.id,r.id);
  if(!Number.isSafeInteger(version)||version!==(old?.version||0))fail('Presença alterada. Atualize a lista antes de salvar.',409);
  if(typeof present!=='boolean')fail('Presença inválida.');
  if(present&&r.status!=='pending')fail('Pré-cadastro encerrado. Use a chamada do aluno matriculado.',409);
  if(old&&Boolean(old.present)===present)return old;
  const now=new Date().toISOString();
  run('INSERT INTO visitor_attendance VALUES(?,?,?,?,?,?) ON CONFLICT(class_id,intake_id) DO UPDATE SET present=excluded.present,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at',c.id,r.id,Number(present),version+1,actor,now);
  run('INSERT INTO visitor_changes(class_id,intake_id,present,actor,created_at) VALUES(?,?,?,?,?)',c.id,r.id,Number(present),actor,now);
  audit(actor,'visitor.'+(present?'present':'removed')+':'+c.id+':'+r.id);return get('SELECT * FROM visitor_attendance WHERE class_id=? AND intake_id=?',c.id,r.id);
 }
 return {
  ...workflow,
  async quickCreate(actor,p){return tx(()=>{
   if(!uuid(p.id)||!uuid(p.class_id))fail('Protocolo ou aula inválida.');
   const c=lesson(actor,p.class_id,true),f=fields(p),hash=createHash('sha256').update(JSON.stringify({class_id:c.id,...f})).digest('hex'),old=get('SELECT * FROM quick_intakes WHERE id=?',p.id);
   if(old){read(actor,old.id);if(old.request_hash!==hash)fail('Este envio já foi utilizado com outros dados. Atualize a lista.',409);return {id:old.id,repeated:true,present:!!get('SELECT present FROM visitor_attendance WHERE class_id=? AND intake_id=?',c.id,old.id)?.present};}
   const nameKey=normalize(f.name);
   if(all('SELECT name FROM class_registration_roster WHERE class_id=?',c.id).some(r=>normalize(r.name)===nameKey))fail('Esta criança já está na chamada como cadastro pendente. Marque a presença na lista existente.',409);
   if(all('SELECT id,name FROM students WHERE status=\'approved\'').some(s=>studentUnit(s.id)===c.unit&&normalize(s.name)===nameKey))fail('Já existe aluno matriculado com esse nome neste núcleo. Confira a chamada ou peça à secretaria para vinculá-lo à turma.',409);
   if(get("SELECT id FROM quick_intakes WHERE unit=? AND name_key=? AND status<>'archived'",c.unit,nameKey))fail('Já existe pré-cadastro com esse nome. Use a lista de visitantes para marcar a presença; em caso de homônimo, peça a conferência da secretaria.',409);
   const now=new Date().toISOString();run('INSERT INTO quick_intakes(id,request_hash,unit,group_id,name,name_key,age,guardian_name,phone,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',p.id,hash,c.unit,c.group_id,f.name,nameKey,f.age,f.guardian_name,f.phone,actor,now,now);
   mark(actor,c,get('SELECT * FROM quick_intakes WHERE id=?',p.id),true,0);audit(actor,'quick_intake.create:'+p.id);
   return {id:p.id,present:true,repeated:false};
  })},
  async quickList(actor,unit){return workflow.listIntakeWorkflow(actor,unit)},
  async quickUpdate(actor,id,p){return tx(()=>{
   requireRole(actor,['admin','secretary']);const r=read(actor,id);if(!Number.isSafeInteger(p.version)||p.version!==r.version)fail('Pré-cadastro alterado. Reabra antes de salvar.',409);
   const f=fields(p),status=p.status;if(!['pending','linked','archived'].includes(status))fail('Situação inválida.');
   const guardian_email=text(p.guardian_email??r.guardian_email,254),relationship=text(p.relationship??r.relationship,80);if(guardian_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardian_email))fail('Confira o email do responsável.');
   if(status==='linked'&&r.registration_id){workflow.checkIntakeApproval(r.registration_id);if(get('SELECT student_id FROM registrations WHERE id=?',r.registration_id)?.student_id!==p.student_id)fail('Use o ID da ficha associada e aprovada.');}
   let sid=null;if(status==='linked'){const s=get("SELECT * FROM students WHERE id=? AND status='approved'",p.student_id);if(!s||studentUnit(s.id)!==r.unit||normalize(s.name)!==normalize(f.name)||p.identity_checked!==true)fail('Confira o ID, o núcleo e a identidade do aluno aprovado.');if(get('SELECT id FROM quick_intakes WHERE student_id=? AND id<>?',s.id,id))fail('Esse ID já está vinculado a outro pré-cadastro.',409);sid=s.id;}
   if(r.status==='linked'&&(status!=='linked'||sid!==r.student_id))fail('Vínculo de matrícula já conferido. Preserve o histórico.',409);
   if(status==='pending'&&get("SELECT id FROM quick_intakes WHERE unit=? AND name_key=? AND status<>'archived' AND id<>?",r.unit,normalize(f.name),id))fail('Existe outro pré-cadastro com esse nome. Confira a identidade.',409);
   run('UPDATE quick_intakes SET name=?,name_key=?,age=?,guardian_name=?,phone=?,status=?,student_id=?,guardian_email=?,relationship=?,updated_at=?,version=version+1 WHERE id=?',f.name,normalize(f.name),f.age,f.guardian_name,f.phone,status,sid,guardian_email,relationship,new Date().toISOString(),id);if(status==='linked')workflow.finalizeIntake(actor,r,sid);audit(actor,'quick_intake.'+status+':'+id,sid);return {id};
  })},
  async visitors(actor,id){const c=lesson(actor,id),can_write=project.canAttendanceWrite(actor,c);return {lesson:c,can_write,delivery:get('SELECT held,version FROM class_delivery WHERE class_id=?',id)||{held:0,version:0},visitors:all("SELECT q.id,q.name,q.age,q.status,q.student_id,COALESCE(a.present,0) AS present,COALESCE(a.version,0) AS version,a.updated_at,COALESCE(t.name,m.email,'') AS updated_by_name FROM quick_intakes q LEFT JOIN visitor_attendance a ON a.intake_id=q.id AND a.class_id=? LEFT JOIN members m ON m.user_id=a.updated_by LEFT JOIN teacher_profiles t ON t.user_id=m.user_id WHERE q.group_id=? AND (q.status='pending' OR a.class_id IS NOT NULL) ORDER BY q.name,q.id",id,c.group_id)}},
  async markVisitor(actor,id,p){return tx(()=>{const c=lesson(actor,id,true),r=read(actor,p.intake_id);return mark(actor,c,r,p.present,p.version)})},
  async classDelivery(actor,id,p){return tx(()=>{lesson(actor,id,true);const old=get('SELECT * FROM class_delivery WHERE class_id=?',id);if(typeof p.held!=='boolean'||!Number.isSafeInteger(p.version)||p.version!==(old?.version||0))fail('Confirmação alterada. Atualize a chamada.',409);run('INSERT INTO class_delivery VALUES(?,?,?,?,?) ON CONFLICT(class_id) DO UPDATE SET held=excluded.held,version=excluded.version,updated_by=excluded.updated_by,updated_at=excluded.updated_at',id,Number(p.held),p.version+1,actor,new Date().toISOString());audit(actor,'class.held:'+id+':'+p.held);return {held:p.held,version:p.version+1}})},
 };
}
