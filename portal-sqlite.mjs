import {classEvidence} from './class-evidence.mjs';
import {appointmentNotices} from './appointment-notices.mjs';
import {systemSync} from './system-sync.mjs';
import {siteEditor} from './site-editor.mjs';
import {diagnostics} from './diagnostics.mjs';
import {contactSettings} from './contact-settings.mjs';
import {attendanceInsights} from './attendance-insights.mjs';
import {rollcallTools} from './rollcall-tools.mjs';
import {staffAccounts} from './staff-accounts.mjs';
import {workforceTools} from './workforce-tools.mjs';
import {professionalTools} from './professional-tools.mjs';
import {schedulingTools} from './scheduling-tools.mjs';
import {studentDetails} from './student-details.mjs';
import {teacherTools} from './teacher-tools.mjs';
import {migrateMembers} from './portal-migrations.mjs';
import {projectTools} from './project-tools.mjs';
import {DatabaseSync,backup} from 'node:sqlite';
import {randomUUID,randomInt,randomBytes,createHmac,createHash,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail,COLUMNS,validateStudent} from './portal-domain.mjs';

const schema=`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS members(user_id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','secretary','psychologist','social_worker','guardian','teacher')),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)));
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY,name TEXT NOT NULL,birth_date TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('approved','pending','inactive')),height_cm REAL,weight_kg REAL,kimono TEXT NOT NULL DEFAULT '',rashguard TEXT NOT NULL DEFAULT '',shorts TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS links(user_id TEXT NOT NULL REFERENCES members(user_id),student_id TEXT NOT NULL REFERENCES students(id),PRIMARY KEY(user_id,student_id));
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,student_id TEXT NOT NULL REFERENCES students(id),kind TEXT NOT NULL,object_path TEXT UNIQUE NOT NULL,original_name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES members(user_id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,student_id TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS challenges(email TEXT PRIMARY KEY,nonce TEXT NOT NULL,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,last_sent INTEGER NOT NULL,window_start INTEGER NOT NULL,requests INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES members(user_id),expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS registrations(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,student_name TEXT NOT NULL,birth_date TEXT NOT NULL,unit TEXT NOT NULL,guardian_name TEXT NOT NULL,guardian_email TEXT NOT NULL,guardian_phone TEXT NOT NULL,relationship TEXT NOT NULL,consent_version TEXT NOT NULL,documents TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',reason TEXT NOT NULL DEFAULT '',student_id TEXT REFERENCES students(id),version INTEGER NOT NULL DEFAULT 1,reviewed_by TEXT,reviewed_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS registrations_status ON registrations(status,created_at);
CREATE TABLE IF NOT EXISTS metric_events(event_id TEXT PRIMARY KEY,page TEXT NOT NULL,session_hash TEXT NOT NULL,visitor_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS metrics_time ON metric_events(created_at);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
PRAGMA user_version=1;`;
const nowIso=()=>new Date().toISOString();
const sha=v=>createHash('sha256').update(v).digest('hex');
const emailValid=email=>typeof email==='string'&&email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const brDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
function dayOf(date){const p=Object.fromEntries(brDate.formatToParts(new Date(date)).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`}
export function createSqliteStore(env,{transport=fetch}={}){
 const root=path.resolve(env.PORTAL_DATA_DIR),publicRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
 if(!path.isAbsolute(env.PORTAL_DATA_DIR)||root===publicRoot||root.startsWith(publicRoot+path.sep)||!env.PORTAL_SECRET||env.PORTAL_SECRET.length<32)throw Error('Diretório privado ou segredo inválido.');
 if(env.RENDER==='true'&&(env.PERSISTENT_STORAGE_CONFIRMED!=='true'||!(root==='/var/data'||root.startsWith('/var/data/'))))throw Error('Configure e confirme o disco persistente /var/data antes de habilitar o portal.');
 fs.mkdirSync(root,{recursive:true,mode:0o700});const objects=path.join(root,'objects');fs.mkdirSync(objects,{recursive:true,mode:0o700});
 const db=new DatabaseSync(path.join(root,'portal.sqlite'));db.exec(schema);migrateMembers(db);db.function('br_day',{deterministic:true},dayOf);
 const get=(sql,...params)=>db.prepare(sql).get(...params),all=(sql,...params)=>db.prepare(sql).all(...params),run=(sql,...params)=>db.prepare(sql).run(...params);
 function tx(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
 // Upgrade only live one-hour sessions once. Expired and revoked sessions stay invalid.
 db.exec('CREATE TABLE IF NOT EXISTS auth_migrations(name TEXT PRIMARY KEY)');
 tx(()=>{if(!get('SELECT 1 FROM auth_migrations WHERE name=?','session_six_hours_v1')){
  run('UPDATE sessions SET expires=expires+? WHERE expires>?',5*3600000,Date.now());
  run('INSERT INTO auth_migrations VALUES(?)','session_six_hours_v1');
 }});
 const asMember=m=>m?{...m,active:!!m.active}:undefined;
 const member=id=>asMember(get('SELECT * FROM members WHERE user_id=? AND active=1',id));
 const requireRole=(actor,roles)=>{const m=member(actor);if(!m||!roles.includes(m.role))fail('Acesso não permitido.',403);return m};
 const audit=(actor,action,id=null)=>run('INSERT INTO audit(actor,action,student_id,created_at) VALUES(?,?,?,?)',actor,action,id,nowIso());
 const documentRow=r=>{run('INSERT INTO documents(id,student_id,kind,object_path,original_name,mime,size,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',r.id,r.student_id,r.kind,r.object_path,r.original_name,r.mime,r.size,r.created_by,nowIso())};
 const asRegistration=r=>r?{...r,documents:JSON.parse(r.documents)}:undefined;
 function objectPath(key){if(typeof key!=='string'||!key||key.split('/').some(p=>!p||p==='.'||p==='..'||!/^[a-zA-Z0-9_.-]+$/.test(p)))fail('Arquivo inválido.');const full=path.resolve(objects,...key.split('/'));if(!full.startsWith(objects+path.sep))fail('Arquivo inválido.');return full}
 const teaching=teacherTools({db,get,all,run,tx,requireRole,audit});
 let insights,rollcalls;
 const project=projectTools({db,get,all,run,tx,requireRole,audit,requireUnit:teaching.requireUnit,onAttendanceChanged:()=>{insights?.attendanceReconcile();rollcalls?.rollcallReconcile()}});
 const evidence=classEvidence({db,get,all,run,tx,requireRole,audit,objectPath,lessonAccess:project.lessonAccess});
 const professionals=professionalTools({db,get,all,run,tx,requireRole,audit});
 const scheduling=schedulingTools({db,get,all,run,tx,requireRole,audit,...professionals});
 const agendaNotices=appointmentNotices({db,get,all,run,tx,audit,env,transport,professionalApproved:professionals.professionalApproved});
 insights=attendanceInsights({db,get,all,run,tx,requireRole,audit,env,transport});
 rollcalls=rollcallTools({db,get,all,run,tx,requireRole,audit,env,transport});
 db.exec('CREATE TABLE IF NOT EXISTS student_sequences(prefix TEXT PRIMARY KEY,last_number INTEGER NOT NULL CHECK(last_number BETWEEN 0 AND 999999))');
 const initial=env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
 if(initial&&emailValid(initial)&&!get("SELECT user_id FROM members WHERE role='admin'")){
  if(get('SELECT user_id FROM members WHERE email=?',initial))throw Error('A conta inicial já existe sem função administrativa; confira a configuração.');
  run("INSERT INTO members(user_id,email,role) VALUES(?,?,'admin')",randomUUID(),initial);
 }
 function apply(actor,rows){return tx(()=>{
  const m=requireRole(actor,['admin','secretary','guardian']);if(!Array.isArray(rows)||!rows.length||rows.length>500||m.role==='guardian'&&rows.length!==1)fail('Lote inválido.');
  const seen=new Set();
  for(const raw of rows){const r=validateStudent(raw);if(seen.has(r.id))fail('ID repetido no lote.');seen.add(r.id);
   const old=get('SELECT * FROM students WHERE id=?',r.id);
   
   if(m.role==='guardian'&&(!old||!get('SELECT 1 FROM links WHERE user_id=? AND student_id=?',actor,r.id)||['name','birth_date','status'].some(k=>r[k]!==old[k])))fail('Acesso não permitido.',403);
   if((old?.version||0)!==r.version)fail('Ficha alterada. Recarregue ou exporte um CSV atualizado.',409);
   const row={height_cm:null,weight_kg:null,kimono:'',rashguard:'',shorts:'',...r,version:r.version+1,updated_at:nowIso()};
   if(old)run('UPDATE students SET name=?,birth_date=?,status=?,height_cm=?,weight_kg=?,kimono=?,rashguard=?,shorts=?,version=?,updated_at=? WHERE id=?',...['name','birth_date','status','height_cm','weight_kg','kimono','rashguard','shorts','version','updated_at','id'].map(k=>row[k]));
   else run('INSERT INTO students('+[...COLUMNS,'updated_at'].join(',')+') VALUES('+Array(11).fill('?').join(',')+')',...[...COLUMNS,'updated_at'].map(k=>row[k]));
   audit(actor,'student.update',r.id);
  }return rows.length;
 })}
 const api={
  ...siteEditor({db,get,all,run,tx,requireRole,audit,objectPath}),
  ...diagnostics({db,get,all,run,tx,requireRole,audit}),
  ...contactSettings({db,get,run,tx,requireRole,audit}),...insights,...rollcalls,...staffAccounts({db,get,all,run,tx,requireRole,audit}),...project,...evidence,...teaching,...professionals,...scheduling,...workforceTools({db,get,all,run,tx,requireRole,audit}),...studentDetails({db,get,all,run,tx,requireRole,audit}),
  ...agendaNotices,
  async sendBookingNotice(actor,id){await scheduling.booking(actor,id);await agendaNotices.sendPrivateNotice(id)},
  close:()=>db.close(),
  async requestCode(email){
   email=email.trim().toLowerCase();if(!emailValid(email)||!get('SELECT 1 FROM members WHERE email=? AND active=1',email))return;
   const now=Date.now(),old=get('SELECT * FROM challenges WHERE email=?',email);
   if(old&&(now-old.last_sent<60000||now-old.window_start<600000&&old.requests>=3))return;
   const code=String(randomInt(10000000,100000000)),nonce=randomUUID(),hash=createHmac('sha256',env.PORTAL_SECRET).update(email+':'+nonce+':'+code).digest('hex');
   run('INSERT OR REPLACE INTO challenges(email,nonce,hash,expires,attempts,last_sent,window_start,requests) VALUES(?,?,?,?,0,?,?,?)',email,nonce,hash,now+600000,now,old&&now-old.window_start<600000?old.window_start:now,old&&now-old.window_start<600000?old.requests+1:1);
   if(!env.RESEND_API_KEY||!env.MAIL_FROM)throw Error('Email não configurado');
   try{
    const r=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'portal-login-'+nonce},body:JSON.stringify({from:env.MAIL_FROM,to:[email],subject:'Seu código de acesso — Luta pela Comunidade',text:`Seu código pessoal é: ${code}\n\nEle expira em 10 minutos e só pode ser usado uma vez. Não compartilhe este código. Se você não solicitou, ignore este email.`}),signal:AbortSignal.timeout(15000)});
    if(!r.ok||!(await r.json()).id)throw Error('Email não enviado');
   }catch(e){run('UPDATE challenges SET expires=0 WHERE email=? AND nonce=?',email,nonce);throw e}
  },
  async verifyCode(email,code){
   email=email.trim().toLowerCase();const c=get('SELECT * FROM challenges WHERE email=?',email),m=get('SELECT * FROM members WHERE email=? AND active=1',email),now=Date.now();
   if(!c||!m||c.expires<now||c.attempts>=5)fail('Código inválido ou expirado.',401);
   run('UPDATE challenges SET attempts=attempts+1 WHERE email=?',email);
   const hash=createHmac('sha256',env.PORTAL_SECRET).update(email+':'+c.nonce+':'+code).digest('hex');
   if(!timingSafeEqual(Buffer.from(hash),Buffer.from(c.hash)))fail('Código inválido ou expirado.',401);
   const token=randomBytes(32).toString('base64url');tx(()=>{run('UPDATE challenges SET expires=0 WHERE email=?',email);run('DELETE FROM sessions WHERE expires<?',now);run('INSERT INTO sessions(hash,user_id,expires) VALUES(?,?,?)',sha(token),m.user_id,now+6*3600000);audit(m.user_id,'auth.login')});return {access_token:token,expires_in:6*3600};
  },
  user:async token=>{const u=get('SELECT m.user_id AS id,s.expires AS expires_at FROM sessions s JOIN members m ON m.user_id=s.user_id WHERE s.hash=? AND s.expires>? AND m.active=1',sha(token),Date.now());if(!u)fail('Sessão expirada.',401);return u},
  logout:async token=>run('DELETE FROM sessions WHERE hash=?',sha(token)),
  member:async id=>member(id),members:async()=>all('SELECT * FROM members ORDER BY email').map(asMember),
  links:async id=>all('SELECT student_id FROM links WHERE user_id=?',id),
  students:async ids=>ids?ids.length?all('SELECT * FROM students WHERE id IN ('+ids.map(()=>'?').join(',')+') ORDER BY id',...ids):[]:all('SELECT * FROM students ORDER BY id'),
  student:async id=>get('SELECT * FROM students WHERE id=?',id),
  documents:async id=>all('SELECT * FROM documents WHERE student_id=? ORDER BY created_at DESC',id),
  document:async id=>get('SELECT * FROM documents WHERE id=?',id),
  audit:async(...args)=>{audit(...args)},auditLog:async()=>all('SELECT a.*,m.email AS actor_email FROM audit a LEFT JOIN members m ON m.user_id=a.actor ORDER BY a.id DESC LIMIT 100'),
  update:async(actor,row)=>apply(actor,[row]),import:async(actor,rows)=>apply(actor,rows),
  upload:async(key,bytes)=>{const dest=objectPath(key);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,bytes,{flag:'wx',mode:0o600})},
  addDocument:async row=>documentRow(row),
  removeObject:async key=>{fs.unlinkSync(objectPath(key))},
  download:async key=>new Response(fs.readFileSync(objectPath(key))),
  provision:async(email,role)=>{
   if(!emailValid(email)||!['guardian','secretary','psychologist','social_worker'].includes(role))fail('Conta inválida.');const old=get('SELECT * FROM members WHERE email=?',email);if(old){if(old.role!==role)fail('Este email já tem outra função. Confira a conta existente.',409);return asMember(old)}
   const id=randomUUID();run('INSERT INTO members(user_id,email,role) VALUES(?,?,?)',id,email,role);return member(id);
  },
  link:async(actor,uid,id)=>tx(()=>{
   const m=requireRole(actor,['admin','secretary']),target=member(uid);
   if(!target||!['guardian','psychologist','social_worker'].includes(target.role))fail('Vínculo não permitido.',403);
   run('INSERT OR IGNORE INTO links(user_id,student_id) VALUES(?,?)',uid,id);audit(actor,'link.add:'+uid,id);
  }),
  setMember:async(actor,uid,role,active)=>tx(()=>{
   requireRole(actor,['admin','secretary']);const target=get('SELECT * FROM members WHERE user_id=?',uid);
   if(actor===uid||!target||['admin','secretary'].includes(target.role)||!['guardian','psychologist','social_worker','teacher'].includes(role)||role==='teacher'&&target.role!=='teacher'||typeof active!=='boolean')fail('Conta inválida.',403);
   run('UPDATE members SET role=?,active=? WHERE user_id=?',role,Number(active),uid);run('DELETE FROM links WHERE user_id=?',uid);run('DELETE FROM teacher_units WHERE user_id=?',uid);run("UPDATE teacher_profiles SET status='pending',test_access=0,version=version+1 WHERE user_id=?",uid);run("UPDATE professional_profiles SET status='pending',version=version+1 WHERE user_id=?",uid);run('DELETE FROM sessions WHERE user_id=?',uid);run('DELETE FROM challenges WHERE email=?',target.email);audit(actor,'member.update:'+uid);
  }),
  registrations:async(status,offset=0)=>all('SELECT id,student_name,birth_date,unit,status,student_id,version,created_at FROM registrations WHERE status=? ORDER BY created_at,id LIMIT 51 OFFSET ?',status,offset),
  registration:async id=>asRegistration(get('SELECT * FROM registrations WHERE id=?',id)),
  receiveRegistration:async row=>tx(()=>{
   const old=asRegistration(get('SELECT * FROM registrations WHERE id=?',row.id));if(old){if(old.payload_hash!==row.payload_hash)fail('Protocolo já utilizado.',409);return old}
   const columns=['id','payload_hash','student_name','birth_date','unit','guardian_name','guardian_email','guardian_phone','relationship','consent_version','documents','created_at'];
   const r={...row,documents:JSON.stringify(row.documents),created_at:nowIso()};run('INSERT INTO registrations('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')',...columns.map(k=>r[k]));return row;
  }),
  reviewRegistration:async(actor,id,p)=>tx(()=>{
   const reviewer=requireRole(actor,['admin','secretary']);const r=asRegistration(get('SELECT * FROM registrations WHERE id=?',id));
   if(!r)fail('Inscrição não localizada.',404);if(r.version!==p.version||r.status==='approved')fail('Inscrição alterada. Recarregue antes de decidir.',409);
   if(!['approved','needs_info','rejected'].includes(p.decision)||typeof p.reason!=='string'||p.reason.length>500||p.decision!=='approved'&&p.reason.trim().length<5)fail('Decisão inválida.');
   let sid=null;
   if(p.decision==='approved'){
    if(p.checked!==true)fail('Confirme a conferência documental.');const prefix={amavale:'UND1_',valparaiso:'UND2_','vale-do-carangola':'UND3_'}[r.unit];if(!prefix)fail('Núcleo inválido.');
    const normalized=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
    if(p.student_id||p.new_student_id)fail('O ID de aluno novo é gerado somente pelo sistema.');
    if(p.existing_student_id){const old=get('SELECT * FROM students WHERE id=?',p.existing_student_id);if(!old||normalized(old.name)!==normalized(r.student_name)||old.birth_date!==r.birth_date||!old.id.startsWith(prefix)||old.status!=='approved')fail('Confira o ID existente e a identidade do aluno.',409);sid=old.id}
    else{
     if(all('SELECT name FROM students WHERE birth_date=? AND id LIKE ?',r.birth_date,prefix+'%').some(s=>normalized(s.name)===normalized(r.student_name)))fail('Possível duplicata. Confira e vincule o ID existente.',409);
     const highest=Number(get('SELECT COALESCE(MAX(CAST(substr(id,6) AS INTEGER)),0) AS n FROM students WHERE id LIKE ?',prefix+'%').n);
     const next=Math.max(highest,get('SELECT last_number FROM student_sequences WHERE prefix=?',prefix)?.last_number||0)+1;if(next>999999)fail('Faixa de IDs esgotada.');
     run('INSERT INTO student_sequences VALUES(?,?) ON CONFLICT(prefix) DO UPDATE SET last_number=excluded.last_number',prefix,next);
     sid=prefix+String(next).padStart(6,'0');const newRow=validateStudent({id:sid,name:r.student_name,birth_date:r.birth_date,status:'approved',version:0});
     run('INSERT INTO students(id,name,birth_date,status,updated_at) VALUES(?,?,?,?,?)',sid,newRow.name,newRow.birth_date,'approved',nowIso());
    }
    project.approvedContact({...r,student_id:sid},actor);
    for(const d of r.documents)documentRow({...d,student_id:sid,created_by:actor});
   }
   run('UPDATE registrations SET status=?,reason=?,student_id=?,version=version+1,reviewed_by=?,reviewed_at=? WHERE id=?',p.decision,p.reason.trim(),sid,actor,nowIso(),id);audit(actor,'registration.'+p.decision+':'+id,sid);return {student_id:sid,status:p.decision};
  }),
  recordMetric:async event=>tx(()=>{run('DELETE FROM metric_events WHERE created_at<?',new Date(Date.now()-90*86400000).toISOString());run('INSERT OR IGNORE INTO metric_events(event_id,page,session_hash,visitor_hash,created_at) VALUES(?,?,?,?,?)',event.event_id,event.page,event.session_hash,event.visitor_hash,nowIso())}),
  dashboard:async(actor,days)=>{
   const m=requireRole(actor,['admin','secretary']);if(![7,30,90].includes(days))fail('Período inválido.');
   const day=dayOf(Date.now()),since=new Date(new Date(day+'T00:00:00-03:00').getTime()-(days-1)*86400000).toISOString();
   const result={...get("SELECT count(*) AS students,count(*) FILTER(WHERE status='approved') AS approved,count(*) FILTER(WHERE status='inactive') AS inactive,count(*) FILTER(WHERE height_cm IS NULL OR weight_kg IS NULL OR kimono='' OR rashguard='' OR shorts='') AS incomplete FROM students"),
    registrations:get("SELECT count(*) FILTER(WHERE status='pending') AS pending,count(*) FILTER(WHERE status='needs_info') AS needs_info,count(*) FILTER(WHERE status='approved') AS approved,count(*) FILTER(WHERE status='rejected') AS rejected,count(*) FILTER(WHERE created_at>=?) AS period_received FROM registrations",since),
    units:all("SELECT substr(id,1,4) AS unit,count(*) AS students,count(*) FILTER(WHERE status='approved') AS approved FROM students GROUP BY 1 ORDER BY 1"),documents:get('SELECT count(*) AS n FROM documents').n,generated_at:nowIso(),days,since};
   if(['admin','secretary'].includes(m.role))Object.assign(result,{traffic:{...get('SELECT count(*) AS pageviews,count(DISTINCT session_hash) AS sessions,count(DISTINCT visitor_hash) AS visitors FROM metric_events WHERE created_at>=?',since),first_event:get('SELECT min(created_at) AS d FROM metric_events').d},
    daily:all('SELECT br_day(created_at) AS day,count(*) AS pageviews,count(DISTINCT session_hash) AS sessions,count(DISTINCT visitor_hash) AS visitors FROM metric_events WHERE created_at>=? GROUP BY 1 ORDER BY 1',since),pages:all('SELECT page,count(*) AS views FROM metric_events WHERE created_at>=? GROUP BY page ORDER BY views DESC,page',since)});
   return result;
  },
  async backup(){const dir=path.join(root,'backups');fs.mkdirSync(dir,{recursive:true,mode:0o700});const file=path.join(dir,'portal-'+nowIso().replace(/[:.]/g,'-')+'.sqlite');await backup(db,file);return file}
 };
 Object.assign(api,systemSync({db,get,requireRole,secret:env.PORTAL_SECRET}));
 return api;
}
