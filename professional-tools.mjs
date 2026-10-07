import {randomUUID} from 'node:crypto';
import {fail} from './portal-domain.mjs';
import {UNITS} from './teacher-tools.mjs';
export const PROFESSIONAL_ROLES=['psychologist','social_worker'];
const keys=['name','phone','rg','cpf','council_number','council_region','review_until'];
const now=()=>new Date().toISOString();
const text=(v,label,max=160,min=0)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail('Confira '+label+'.');return v.trim()};
export function validCpf(v){if(!/^\d{11}$/.test(v)||/^(\d)\1+$/.test(v))return false;return [9,10].every(n=>{const sum=[...v.slice(0,n)].reduce((a,c,i)=>a+Number(c)*(n+1-i),0),d=(sum*10)%11;return Number(v[n])===(d===10?0:d)})}
export function localDay(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return `${p.year}-${p.month}-${p.day}`}
export function professionalTools({db,get,all,run,tx,requireRole,audit}){
 db.exec(`CREATE TABLE IF NOT EXISTS professional_profiles(user_id TEXT PRIMARY KEY REFERENCES members(user_id),name TEXT NOT NULL,phone TEXT NOT NULL,rg TEXT NOT NULL,cpf TEXT NOT NULL,council_number TEXT NOT NULL,council_region TEXT NOT NULL,review_until TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','verified')),version INTEGER NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS professional_units(user_id TEXT NOT NULL REFERENCES professional_profiles(user_id),unit TEXT NOT NULL,PRIMARY KEY(user_id,unit));
 CREATE TABLE IF NOT EXISTS professional_documents(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES professional_profiles(user_id),kind TEXT NOT NULL CHECK(kind IN ('photo','identity','council')),object_path TEXT UNIQUE NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,original_name TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES members(user_id),created_at TEXT NOT NULL);`);
 const units=uid=>all('SELECT unit FROM professional_units WHERE user_id=? ORDER BY unit',uid).map(r=>r.unit);
 const profile=uid=>{const p=get("SELECT p.*,m.email,m.role,m.active FROM professional_profiles p JOIN members m USING(user_id) WHERE p.user_id=? AND m.role IN ('psychologist','social_worker')",uid);return p?{...p,active:!!p.active,units:units(uid)}:undefined};
 const read=(actor,uid)=>{const m=requireRole(actor,['admin',...PROFESSIONAL_ROLES]);if(m.role!=='admin'&&actor!==uid)fail('Acesso não permitido.',403);const p=profile(uid);if(!p)fail('Profissional não localizado.',404);return p};
 const approved=uid=>{const p=profile(uid);return !!(p?.active&&p.status==='verified'&&p.review_until>=localDay())};
 return {
  professionalProfile:profile,professionalApproved:approved,
  async professionals(actor){const m=requireRole(actor,['admin','secretary',...PROFESSIONAL_ROLES]);const rows=m.role==='admin'||m.role==='secretary'?all('SELECT user_id FROM professional_profiles').map(p=>profile(p.user_id)).filter(Boolean):[profile(actor)].filter(Boolean);return rows.map(p=>({user_id:p.user_id,name:p.name,role:p.role,active:p.active,status:p.status,available:approved(p.user_id),units:p.units}))},
  async professional(actor,uid){const p=read(actor,uid);audit(actor,'professional.read:'+uid);return {...p,available:approved(uid)}},
  async saveProfessional(actor,uid,p){return tx(()=>{
   requireRole(actor,['admin']);if(!p||Object.keys(p).some(k=>![...keys,'email','role','units','status','version','checked'].includes(k)))fail('Campos inválidos.');
   if(!PROFESSIONAL_ROLES.includes(p.role)||!['pending','verified'].includes(p.status)||!Number.isSafeInteger(p.version)||p.version<0)fail('Cadastro inválido.');
   const row=Object.fromEntries(keys.map(k=>[k,text(p[k]??'',k,k==='rg'?40:160,k==='name'?3:k==='phone'?8:0)]));
   if(!/^\+?[\d ()-]{8,30}$/.test(row.phone))fail('Confira o telefone.');row.cpf=row.cpf.replace(/[. -]/g,'');if(row.cpf&&!validCpf(row.cpf))fail('CPF inválido. Confira os dígitos.');
   if(row.review_until&&(!/^20\d{2}-\d{2}-\d{2}$/.test(row.review_until)||!Number.isFinite(+new Date(row.review_until+'T12:00:00Z'))||new Date(row.review_until+'T12:00:00Z').toISOString().slice(0,10)!==row.review_until))fail('Data de revisão inválida.');
   if(!Array.isArray(p.units)||p.units.length>3||new Set(p.units).size!==p.units.length||p.units.some(u=>!UNITS.includes(u)))fail('Núcleos inválidos.');
   const email=text(p.email,'email',254,3).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Email inválido.');const old=uid?profile(uid):null;
   if(uid&&!old)fail('Profissional não localizado.',404);if((old?.version||0)!==p.version)fail('Cadastro alterado. Recarregue antes de salvar.',409);
   if(old&&(email!==old.email||p.role!==old.role))fail('Email e profissão não podem ser alterados neste cadastro.');
   if(p.status==='verified'&&(!uid||p.checked!==true||!row.rg||!row.cpf||!row.council_number||!row.council_region||row.review_until<localDay()||!p.units.length||['photo','council'].some(k=>!get('SELECT 1 FROM professional_documents WHERE user_id=? AND kind=?',uid,k))))fail('Confira RG, CPF, foto, conselho atualizado, validade da conferência e núcleos antes de liberar.');
   if(!old){const existing=get('SELECT * FROM members WHERE email=?',email);if(existing){if(existing.role!==p.role||!existing.active||profile(existing.user_id))fail('Email já utilizado por outra conta ou conta desativada.',409);uid=existing.user_id}else{uid=randomUUID();run('INSERT INTO members(user_id,email,role) VALUES(?,?,?)',uid,email,p.role)}}
   const columns=['user_id',...keys,'status','version','updated_at'],values={user_id:uid,...row,status:p.status,version:p.version+1,updated_at:now()};
   run('INSERT INTO professional_profiles('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+') ON CONFLICT(user_id) DO UPDATE SET '+columns.slice(1).map(k=>k+'=excluded.'+k).join(','),...columns.map(k=>values[k]));
   run('DELETE FROM professional_units WHERE user_id=?',uid);for(const u of p.units)run('INSERT INTO professional_units VALUES(?,?)',uid,u);audit(actor,'professional.save:'+uid);return {...profile(uid),available:approved(uid)};
  })},
  async professionalDocuments(actor,uid){read(actor,uid);return all('SELECT * FROM professional_documents WHERE user_id=? ORDER BY created_at DESC',uid)},
  async professionalDocument(actor,id){const d=get('SELECT * FROM professional_documents WHERE id=?',id);if(!d)fail('Documento não localizado.',404);read(actor,d.user_id);return d},
  async addProfessionalDocument(actor,uid,d){return tx(()=>{read(actor,uid);if(!['photo','identity','council'].includes(d.kind))fail('Categoria inválida.');run('INSERT INTO professional_documents VALUES(?,?,?,?,?,?,?,?,?)',d.id,uid,d.kind,d.object_path,d.mime,d.size,d.original_name,actor,now());run("UPDATE professional_profiles SET status='pending',version=version+1,updated_at=? WHERE user_id=?",now(),uid);audit(actor,'professional.document:'+d.id);return d.id})}
 };
}
