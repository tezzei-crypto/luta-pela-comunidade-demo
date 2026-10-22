import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {fail,validateStudent,ageAt} from './portal-domain.mjs';

const normalized=s=>s.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
const text=(v,max)=>typeof v==='string'&&v.trim().length>=1&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
export function registrationDrafts({db,get,all,run,tx,requireRole,audit,upload,removeObject}){
 db.exec('CREATE TABLE IF NOT EXISTS registration_import_keys(source_key TEXT PRIMARY KEY,registration_id TEXT NOT NULL REFERENCES registrations(id),payload_hash TEXT NOT NULL)');
 function inspect(rows){
  const seen=new Set();
  return rows.map(r=>{
   const key=r.key;
   if(seen.has(key))fail('Matrícula de origem repetida no lote.');seen.add(key);
   const prior=get('SELECT * FROM registration_import_keys WHERE source_key=?',key);
   if(prior){if(prior.payload_hash!==r.hash)fail('Matrícula de origem já importada com dados diferentes. Confira antes de repetir.',409);return {...r,id:prior.registration_id,repeated:true};}
   if(all('SELECT student_name AS name FROM registrations WHERE unit=? AND birth_date=?',r.unit,r.birth_date).some(s=>normalized(s.name)===normalized(r.student_name))||all('SELECT name FROM students WHERE birth_date=? AND id LIKE ?',r.birth_date,{amavale:'UND1_',valparaiso:'UND2_','vale-do-carangola':'UND3_'}[r.unit]+'%').some(s=>normalized(s.name)===normalized(r.student_name)))fail('Possível cadastro duplicado: confira nome, nascimento e núcleo antes de importar.',409);
   return {...r,id:randomUUID(),repeated:false};
  });
 }
 return {
  async studentDraftDirectory(actor){requireRole(actor,['admin','secretary']);return all("SELECT id,student_name AS name,birth_date,unit FROM registrations WHERE source='staff_draft' AND status IN ('pending','needs_info') AND student_id IS NULL ORDER BY student_name,id").map(r=>({...r,age:ageAt(r.birth_date),status:'incomplete',registration_id:r.id}));},
  async importRegistrationDrafts(actor,p){
   requireRole(actor,['admin']);
   if(!p||!['amavale','valparaiso','vale-do-carangola'].includes(p.unit)||!Array.isArray(p.rows)||!p.rows.length||p.rows.length>50)fail('Selecione o núcleo e um lote de 1 a 50 candidatos.');
   let total=0;const prepared=[],identities=new Set();
   for(const r of p.rows){
    if(!r||!text(r.source_key,160)||!text(r.source_reference,500))fail('Informe a matrícula e a referência de origem de cada candidato.');
    const student=validateStudent({id:'UND1_000001',name:r.student_name,birth_date:r.birth_date,status:'pending',version:0});
    const identity=normalized(student.name)+'|'+student.birth_date;if(identities.has(identity))fail('Mesmo nome e nascimento repetidos no lote.');identities.add(identity);
    let bytes=null,originalName='';
    if(r.photo){
     if(!text(r.photo.name,180)||typeof r.photo.content!=='string'||r.photo.content.length>400000||! /^[A-Za-z0-9+/]+={0,2}$/.test(r.photo.content))fail('Foto inválida ou acima de 300 KB.');
     bytes=Buffer.from(r.photo.content,'base64');if(bytes.toString('base64')!==r.photo.content)fail('Foto inválida.');
     total+=bytes.length;if(total>1200000)fail('Divida o lote: limite de 1,2 MB de fotos por envio.');
     let meta;try{meta=await sharp(bytes,{limitInputPixels:16000000}).metadata()}catch{fail('Foto inválida.');}
     if(!['jpeg','png'].includes(meta.format))fail('Use fotos JPG ou PNG.');
     // Re-encode to remove metadata and validate the entire decoded image.
     try{bytes=await sharp(bytes,{limitInputPixels:16000000}).rotate().jpeg({quality:92}).toBuffer()}catch{fail('Foto inválida.');}
     originalName=r.photo.name.replace(/[\/\\]/g,'_').replace(/\.[^.]+$/,'.jpg');
    }
    const key=p.unit+'|'+r.source_key,hash=createHash('sha256').update(JSON.stringify([student.name,student.birth_date,r.source_reference,r.photo?.content||''])).digest('hex');
    prepared.push({unit:p.unit,student_name:student.name,birth_date:student.birth_date,source_reference:r.source_reference,key,hash,bytes,originalName});
   }
   const plan=inspect(prepared),written=[];
   try{
    for(const row of plan.filter(r=>!r.repeated&&r.bytes)){
     const id=randomUUID(),object_path='registrations/'+row.id+'/'+id+'.jpg';
     await upload(object_path,row.bytes,'image/jpeg');written.push(object_path);
     row.documents=[{id,kind:'photo',object_path,original_name:row.originalName,mime:'image/jpeg',size:row.bytes.length,created_by:actor,created_at:new Date().toISOString()}];
    }
    const result=tx(()=>{
     requireRole(actor,['admin']);
     const current=inspect(prepared);let created=0;
     const records=current.map((r,i)=>{
      if(!r.repeated){const row=plan[i],stamp=new Date().toISOString();
       run("INSERT INTO registrations(id,payload_hash,student_name,birth_date,unit,guardian_name,guardian_email,guardian_phone,relationship,consent_version,documents,status,reason,source,source_reference,created_at) VALUES(?,?,?,?,?,'','','','','',?,'needs_info',?,'staff_draft',?,?)",row.id,r.hash,r.student_name,r.birth_date,r.unit,JSON.stringify(row.documents||[]),'Pré-cadastro importado. Completar contato, documentos e autorização do responsável.',r.source_reference,stamp);
       run('INSERT INTO registration_import_keys VALUES(?,?,?)',r.key,row.id,r.hash);audit(actor,'registration.draft.import:'+row.id);created++;
       return {id:row.id,name:r.student_name,repeated:false};
      }
      return {id:r.id,name:r.student_name,repeated:true};
     });
     return {created,repeated:records.length-created,records};
    });
    const used=new Set(result.records.filter(r=>!r.repeated).map(r=>r.id));
    for(const row of plan)if(row.documents&&!used.has(row.id))await removeObject(row.documents[0].object_path).catch(()=>{});
    return result;
   }catch(e){for(const key of written)await removeObject(key).catch(()=>{});throw e;}
  },
  async saveRegistrationDraftContact(actor,id,p){return tx(()=>{
   requireRole(actor,['admin','secretary']);const r=get('SELECT * FROM registrations WHERE id=?',id);
   if(!r||r.source!=='staff_draft'||r.status==='approved'||!Number.isSafeInteger(p?.version)||p.version!==r.version)fail('Pré-cadastro alterado ou indisponível. Recarregue antes de salvar.',409);
   const values={};for(const k of ['guardian_name','guardian_email','guardian_phone','relationship']){if(typeof p[k]!=='string'||p[k].length>160||/[\x00-\x1f\x7f]/.test(p[k]))fail('Contato inválido.');values[k]=p[k].trim();}
   values.guardian_email=values.guardian_email.toLowerCase();if(values.guardian_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.guardian_email))fail('Email inválido.');
   if(values.guardian_phone&&!/^\+?[\d ()-]{8,30}$/.test(values.guardian_phone))fail('Telefone inválido.');
   run('UPDATE registrations SET guardian_name=?,guardian_email=?,guardian_phone=?,relationship=?,version=version+1 WHERE id=?',...Object.values(values),id);audit(actor,'registration.draft.contact:'+id);return {id};
  })}
 };
}
