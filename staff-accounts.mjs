import {randomUUID} from 'node:crypto';
import {fail} from './portal-domain.mjs';

export function staffAccounts({db,get,all,run,tx,requireRole,audit}){
 db.exec(`CREATE TABLE IF NOT EXISTS administrative_profiles(user_id TEXT PRIMARY KEY REFERENCES members(user_id),name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)`);
 const query=`SELECT m.user_id,m.email,m.role,m.active,COALESCE(p.name,'') AS name,COALESCE(p.phone,'') AS phone,COALESCE(p.version,0) AS version,p.updated_at FROM members m LEFT JOIN administrative_profiles p ON p.user_id=m.user_id WHERE m.role IN ('admin','secretary')`;
 const clean=r=>r?{...r,active:!!r.active}:undefined;
 const row=id=>clean(get(query+' AND m.user_id=?',id));
 return {
  async staffAccounts(actor){requireRole(actor,['admin','secretary']);return all(query+' ORDER BY m.role,m.email').map(clean)},
  async saveStaffAccount(actor,id,p){return tx(()=>{
   const who=requireRole(actor,['admin','secretary']);
   if(!p||typeof p!=='object'||!['admin','secretary'].includes(p.role)||typeof p.active!=='boolean'||!Number.isSafeInteger(p.version)||p.version<0)fail('Confira a função e a situação da conta.');
   const old=id?row(id):null;if(id&&!old)fail('Conta administrativa não localizada.',404);
   if(who.role!=='admin'&&(p.role==='admin'||old?.role==='admin'))fail('Somente administradores gerais podem gerenciar administradores.',403);
   const name=typeof p.name==='string'?p.name.trim():'',phone=typeof p.phone==='string'?p.phone.trim():'';
   const email=typeof p.email==='string'?p.email.trim().toLowerCase():'';
   if(name.length<3||name.length>160||/[\x00-\x1f\x7f]/.test(name)||!/^\+?[\d ()-]{10,25}$/.test(phone)||phone.replace(/\D/g,'').length<10||email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail('Informe nome completo, email válido e telefone com DDD.');
   if(old&&email!==old.email)fail('O email de acesso não pode ser alterado. Cadastre outra conta, se necessário.');
   if((old?.version||0)!==p.version)fail('A conta foi alterada. Reabra o cadastro antes de salvar.',409);
   if(id===actor&&(!p.active||p.role!==old.role))fail('Você não pode desativar ou mudar a função da própria conta.',403);
   if(old?.role==='admin'&&old.active&&(!p.active||p.role!=='admin')&&get("SELECT COUNT(*) AS total FROM members WHERE role='admin' AND active=1").total<=1)fail('Mantenha pelo menos um administrador geral ativo.',409);
   if(!old&&get('SELECT 1 FROM members WHERE email=?',email))fail('Este email já está cadastrado. Edite a conta existente; ele não será convertido automaticamente.',409);
   const uid=id||randomUUID(),version=p.version+1,now=new Date().toISOString();
   if(old){
    run('UPDATE members SET role=?,active=? WHERE user_id=?',p.role,Number(p.active),uid);
    if(old.role!==p.role||old.active!==p.active){run('DELETE FROM sessions WHERE user_id=?',uid);run('DELETE FROM challenges WHERE email=?',email)}
   }else run('INSERT INTO members(user_id,email,role,active) VALUES(?,?,?,?)',uid,email,p.role,Number(p.active));
   run('INSERT INTO administrative_profiles(user_id,name,phone,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,phone=excluded.phone,version=excluded.version,updated_at=excluded.updated_at',uid,name,phone,version,now);
   audit(actor,`staff.${old?'update':'create'}:${uid}:${old?.role||'new'}>${p.role}:${old?.active??'new'}>${p.active}:v${version}`);
   return row(uid);
  })}
 };
}
