import {createHash,randomUUID} from 'node:crypto';
const kinds={studentDocument:'student_document',guardianDocument:'guardian_document',medicalCertificate:'medical_certificate',photo:'photo'};
export async function persistRegistration(store,fields,attachments){
 const row={...fields,consent_version:'2026-10-07-portal'};
 row.payload_hash=createHash('sha256').update(JSON.stringify({...row,files:attachments.map(a=>({name:a.filename,hash:createHash('sha256').update(a.content).digest('hex')}))})).digest('hex');
 const prior=await store.registration(row.id);
 if(prior){if(prior.payload_hash!==row.payload_hash)throw Object.assign(Error('Este protocolo já foi usado. Atualize a página para outro envio.'),{status:409});return prior.id}
 const uploaded=[];row.documents=[];
 try{
  for(const file of attachments){
   const [key,ext]=file.filename.split('.'),id=randomUUID(),object_path=`applications/${row.id}/${id}.${ext}`;
   const bytes=Buffer.from(file.content,'base64'),mime=ext==='pdf'?'application/pdf':ext==='png'?'image/png':'image/jpeg';
   await store.upload(object_path,bytes,mime);uploaded.push(object_path);
   row.documents.push({id,kind:kinds[key],object_path,original_name:file.filename,mime,size:bytes.length});
  }
 }catch(error){for(const p of uploaded)await store.removeObject(p).catch(()=>{});throw error}
 // Em timeout de gravação, preservar objetos: a transação pode ter confirmado remotamente.
 const saved=await store.receiveRegistration(row);
 const retained=new Set(saved.documents.map(d=>d.object_path));
 for(const p of uploaded)if(!retained.has(p))await store.removeObject(p).catch(()=>{});
 return saved.id;
}
