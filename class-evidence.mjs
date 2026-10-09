import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {fail} from './portal-domain.mjs';
import {localDay} from './professional-tools.mjs';

export async function normalizeClassPhoto(bytes,mime){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)fail('Escolha uma foto de até 8 MB.');
 try{const decoder=sharp(bytes,{limitInputPixels:40000000,failOn:'warning'}),info=await decoder.metadata();
  if(!['jpeg','png','webp'].includes(info.format)||mime!=={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}[info.format]||(info.pages||1)!==1)fail('Escolha JPG, PNG ou WebP estático.');
  return await decoder.rotate().resize({width:2000,height:2000,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer();
 }catch(e){if(e.status)throw e;fail('Não foi possível ler a foto. Escolha outro JPG, PNG ou WebP de até 40 milhões de pixels.');}
}
export function classEvidence({db,get,all,run,tx,requireRole,audit,objectPath,lessonAccess}) {
 db.exec(`CREATE TABLE IF NOT EXISTS class_photos(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),object_path TEXT NOT NULL UNIQUE,request_hash TEXT NOT NULL,size INTEGER NOT NULL,created_by TEXT NOT NULL REFERENCES members(user_id),created_at TEXT NOT NULL,caption TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS class_photos_class ON class_photos(class_id,created_at);
 CREATE TABLE IF NOT EXISTS class_photo_checks(class_id TEXT PRIMARY KEY REFERENCES classes(id),version INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'empty',fingerprint TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',reviewed_by TEXT,reviewed_at TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS class_photo_history(id INTEGER PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classes(id),actor TEXT NOT NULL REFERENCES members(user_id),action TEXT NOT NULL,note TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const hash=x=>createHash('sha256').update(x).digest('hex');
 const lesson=(actor,id)=>{const c=get('SELECT * FROM classes WHERE id=?',id);if(!c)fail('Aula não localizada.',404);lessonAccess(actor,c);return c};
 const fingerprint=id=>hash(JSON.stringify(all('SELECT student_id,status,version FROM attendance WHERE class_id=? ORDER BY student_id',id)));
 const state=id=>{const r=get('SELECT * FROM class_photo_checks WHERE class_id=?',id)||{version:0,status:'empty',note:'',fingerprint:''};return {...r,status:r.fingerprint&&r.fingerprint!==fingerprint(id)?'changed':r.status}};
 const writable=(actor,id)=>{const c=lesson(actor,id);if(c.cancelled||c.day>localDay())fail('A foto deve ser vinculada a uma aula realizada e não cancelada.');return c};
 const log=(actor,id,action,note='')=>{run('INSERT INTO class_photo_history(class_id,actor,action,note,created_at) VALUES(?,?,?,?,?)',id,actor,action,note,new Date().toISOString());audit(actor,'class.photo.'+action+':'+id)};
 return {
  async classEvidence(actor,id){const c=lesson(actor,id);return {lesson:c,check:{...state(id),attendance_fingerprint:fingerprint(id)},can_review:['admin','secretary'].includes(requireRole(actor,['admin','secretary','teacher']).role),photos:all('SELECT id,caption,size,created_at FROM class_photos WHERE class_id=? ORDER BY rowid DESC',id),history:all('SELECT h.action,h.note,h.created_at FROM class_photo_history h WHERE class_id=? ORDER BY h.id DESC LIMIT 30',id)}},
  async addClassPhoto(actor,id,bytes,p){
   writable(actor,id);if(!p||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(p.request_id)||typeof p.caption!=='string'||p.caption.length>500||/[\x00-\x1f]/.test(p.caption))fail('Confira a foto, a identificação do envio e a legenda (até 500 caracteres).');
   const normalized=await normalizeClassPhoto(bytes,p.mime),requestHash=hash(Buffer.concat([normalized,Buffer.from(JSON.stringify([id,actor,p.caption.trim()]))]));
   const existing=get('SELECT * FROM class_photos WHERE id=?',p.request_id);if(existing){if(existing.request_hash!==requestHash)fail('Este envio já foi usado para outra foto. Reabra a aula.',409);lesson(actor,id);return {id:existing.id,replayed:true}}
   const key='class-photos/'+id+'/'+p.request_id+'.jpg',dest=objectPath(key);let written=false;
   try{return tx(()=>{writable(actor,id);const current=state(id);if(!Number.isSafeInteger(p.version)||current.version!==p.version)fail('A foto ou conferência mudou. Reabra a aula antes de enviar.',409);if(get('SELECT COUNT(*) AS n FROM class_photos WHERE class_id=?',id).n>=20)fail('Esta aula atingiu o limite de 20 fotos. Procure a administração.');
    fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,normalized,{flag:'wx',mode:0o600});written=true;
    run('INSERT INTO class_photos VALUES(?,?,?,?,?,?,?,?)',p.request_id,id,key,requestHash,normalized.length,actor,new Date().toISOString(),p.caption.trim());
    run("INSERT INTO class_photo_checks(class_id,version,status,fingerprint) VALUES(?,1,'pending',?) ON CONFLICT(class_id) DO UPDATE SET version=version+1,status='pending',fingerprint=excluded.fingerprint,note='',reviewed_by=NULL,reviewed_at=''",id,fingerprint(id));log(actor,id,'uploaded',p.caption.trim());return {id:p.request_id,replayed:false};
   })}catch(e){if(written)fs.unlinkSync(dest);throw e}
  },
  async classPhoto(actor,id,photo){lesson(actor,id);const row=get('SELECT * FROM class_photos WHERE class_id=? AND id=?',id,photo);if(!row)fail('Foto não localizada.',404);audit(actor,'class.photo.read:'+photo);return fs.readFileSync(objectPath(row.object_path));},
  async reviewClassPhoto(actor,id,p){return tx(()=>{requireRole(actor,['admin','secretary']);writable(actor,id);const s=state(id),latest=get('SELECT id FROM class_photos WHERE class_id=? ORDER BY rowid DESC LIMIT 1',id);if(!latest)fail('A aula ainda não tem foto.');if(!p||!Number.isSafeInteger(p.version)||s.version!==p.version||p.photo_id!==latest.id||p.attendance_fingerprint!==fingerprint(id))fail('A foto ou chamada mudou. Reabra antes de conferir.',409);if(!['approved','needs_photo'].includes(p.decision)||typeof p.note!=='string'||p.note.length>500||/[\x00-\x1f]/.test(p.note)||p.decision==='needs_photo'&&p.note.trim().length<5)fail('Confira a decisão; explique o pedido de nova foto (5 a 500 caracteres).');run('UPDATE class_photo_checks SET version=version+1,status=?,fingerprint=?,note=?,reviewed_by=?,reviewed_at=? WHERE class_id=?',p.decision,fingerprint(id),p.note.trim(),actor,new Date().toISOString(),id);log(actor,id,p.decision,p.note.trim());return state(id)})},
  classEvidenceFingerprint:fingerprint
 };
}
