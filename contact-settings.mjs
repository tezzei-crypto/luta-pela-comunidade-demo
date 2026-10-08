import {fail} from './portal-domain.mjs';
export function normalizeContactPhone(value){
 if(typeof value!=='string'||value.length>40||!/^[+\d\s().-]+$/.test(value))fail('Informe o número com +, código do país e DDD. Exemplo: +55 11 98774-1447.');
 const phone=value.replace(/[\s().-]/g,'');
 if(!/^\+[1-9]\d{7,14}$/.test(phone)||phone.startsWith('+55')&&!/^\+55[1-9]\d[2-9]\d{7,8}$/.test(phone))fail('Confira o código do país, o DDD e o número completo.');
 return phone;
}
export function formatContactPhone(phone){return /^\+55\d{11}$/.test(phone)?phone.replace(/^(\+55)(\d{2})(\d{5})(\d{4})$/,'$1 $2 $3-$4'):phone}
export function contactSettings({db,get,run,tx,requireRole,audit}){
 db.exec(`CREATE TABLE IF NOT EXISTS project_contact(id INTEGER PRIMARY KEY CHECK(id=1),phone TEXT NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),version INTEGER NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT);
 CREATE TABLE IF NOT EXISTS project_contact_history(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,old_phone TEXT NOT NULL,new_phone TEXT NOT NULL,enabled INTEGER NOT NULL,created_at TEXT NOT NULL);`);
 // Seed once from the number explicitly supplied by project coordination.
 run('INSERT OR IGNORE INTO project_contact VALUES(1,?,1,1,?,NULL)','+5511987741447',new Date().toISOString());
 const read=()=>{const r=get('SELECT phone,enabled,version,updated_at FROM project_contact WHERE id=1');return {...r,enabled:!!r.enabled,display_phone:formatContactPhone(r.phone)}};
 return {
  async publicContact(){const r=read();return {enabled:r.enabled,...(r.enabled?{display_phone:r.display_phone}:{})}},
  async contactDestination(){const r=read();if(!r.enabled)fail('O WhatsApp da secretaria está temporariamente indisponível.',503);return r.phone.slice(1)},
  async contactSettings(actor){requireRole(actor,['admin','secretary']);return read()},
  async saveContactSettings(actor,p){return tx(()=>{
   requireRole(actor,['admin','secretary']);const old=read(),phone=normalizeContactPhone(p.phone);
   if(typeof p.enabled!=='boolean')fail('Confira a situação do canal.');
   if(!Number.isSafeInteger(p.version)||p.version!==old.version)fail('O contato foi alterado por outra pessoa. Recarregue os dados antes de salvar.',409);
   const now=new Date().toISOString();run('UPDATE project_contact SET phone=?,enabled=?,version=version+1,updated_at=?,updated_by=? WHERE id=1',phone,Number(p.enabled),now,actor);
   run('INSERT INTO project_contact_history(actor,old_phone,new_phone,enabled,created_at) VALUES(?,?,?,?,?)',actor,old.phone,phone,Number(p.enabled),now);
   audit(actor,'contact.settings.updated');return read();
  })}
 };
}
