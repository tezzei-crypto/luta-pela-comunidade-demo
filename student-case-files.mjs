import {randomUUID,createHash} from 'node:crypto';
import {fail,fileType} from './portal-domain.mjs';
import {studentUnit} from './unit-scope.mjs';
const uuid='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const ownerRoute=new RegExp('^/(registrations/'+uuid+'|students/UND[1-3]_\\d{6})/restricted-support(?:/('+uuid+')/(download|withdraw))?$','i');
const correctionRoute=new RegExp('^/registrations/('+uuid+')/documents/('+uuid+')/(withdraw|restore)$','i');
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(value,status=200)=>Response.json(value,{status,headers});
const now=()=>new Date().toISOString();

export function studentCaseFiles({db,get,all,run,tx,requireRole,scope,audit,storage}){
 db.exec(`CREATE TABLE IF NOT EXISTS registration_withdrawn(id TEXT PRIMARY KEY,registration_id TEXT NOT NULL REFERENCES registrations(id),metadata TEXT NOT NULL,student_copy TEXT,object_path TEXT NOT NULL,withdrawn_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS restricted_support(id TEXT PRIMARY KEY,owner TEXT NOT NULL,unit TEXT NOT NULL,note TEXT NOT NULL,object_path TEXT,mime TEXT,request_hash TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,withdrawn_at TEXT);`);
 const registration=(actor,id)=>{requireRole(actor,['admin','secretary']);const r=get('SELECT * FROM registrations WHERE id=?',id);if(!r)fail('Inscrição não localizada.',404);scope.requireUnit(actor,r.unit);return r};
 function supportScope(actor,owner){
  const m=requireRole(actor,['admin','secretary']);
  if(m.role==='secretary'&&get('SELECT secretary_level FROM administrative_profiles WHERE user_id=?',actor)?.secretary_level!=='general')fail('Área exclusiva da administração e da secretaria geral do núcleo.',403);
  const [type,id]=owner.split('/');let unit,sid;
  if(type==='registrations'){const r=registration(actor,id);unit=r.unit;sid=r.student_id}
  else{unit=studentUnit(id);scope.requireUnit(actor,unit);if(!get('SELECT id FROM students WHERE id=?',id))fail('Aluno não localizado.',404);sid=id}
  const owners=sid?['students/'+sid,...all('SELECT id FROM registrations WHERE student_id=? AND unit=?',sid,unit).map(r=>'registrations/'+r.id)]:[owner];
  return {owners,unit};
 }
 const supportRow=(actor,owner,id)=>{const {owners,unit}=supportScope(actor,owner),r=get('SELECT * FROM restricted_support WHERE id=?',id);if(!r||r.withdrawn_at||r.unit!==unit||!owners.includes(r.owner))fail('Registro indisponível.',404);return r};
 return {
  withdrawnRegistrationFiles(actor,id){registration(actor,id);return all('SELECT id,metadata,withdrawn_at FROM registration_withdrawn WHERE registration_id=? ORDER BY withdrawn_at,id',id).map(r=>{const d=JSON.parse(r.metadata);return {id:r.id,kind:d.kind,original_name:d.original_name,created_at:d.created_at,withdrawn_at:r.withdrawn_at}})},
  correctRegistrationFile(actor,id,doc,op,p){return tx(()=>{
   const r=registration(actor,id);if(!Number.isSafeInteger(p.version)||p.version!==r.version)fail('A ficha mudou. Reabra e confira o arquivo antes de corrigir.',409);
   if(p.checked!==true)fail('Confirme o arquivo escolhido.');
   const docs=JSON.parse(r.documents),i=docs.findIndex(x=>x.id===doc);
   if(op==='withdraw'){
    if(i<0)fail('Arquivo não está ativo nesta inscrição.',404);const [x]=docs.splice(i,1),copy=get('SELECT * FROM documents WHERE id=?',doc);
    if(copy&&(copy.student_id!==r.student_id||copy.object_path!==x.object_path))fail('Vínculo do documento precisa de conferência.',409);
    run('INSERT INTO registration_withdrawn VALUES(?,?,?,?,?,?)',doc,id,JSON.stringify(x),copy?JSON.stringify(copy):null,x.object_path,now());
    if(copy)run('DELETE FROM documents WHERE id=?',doc);
   }else{
    const a=get('SELECT * FROM registration_withdrawn WHERE registration_id=? AND id=?',id,doc);if(!a||i>=0)fail('Arquivo não está retirado desta inscrição.',404);const x=JSON.parse(a.metadata);
    if(docs.length>=60)fail('Limite de arquivos ativos atingido.',409);
    if(r.student_id){const c=a.student_copy?JSON.parse(a.student_copy):{...x,student_id:r.student_id,created_by:actor,created_at:now()};run('INSERT INTO documents(id,student_id,kind,object_path,original_name,mime,size,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',doc,r.student_id,c.kind,c.object_path,c.original_name,c.mime,c.size,c.created_by,c.created_at)}
    docs.push(x);run('DELETE FROM registration_withdrawn WHERE id=?',doc);
   }
   run('UPDATE registrations SET documents=?,version=version+1 WHERE id=?',JSON.stringify(docs),id);
   audit(actor,'registration.document.'+op+':'+id+':'+doc,r.student_id);return {message:op==='withdraw'?'Arquivo retirado da ficha. Os outros anexos foram preservados.':'Arquivo restaurado na ficha.'};
  })},
  supportAccess(actor,owner){supportScope(actor,owner)},
  listRestrictedSupport(actor,owner){const {owners,unit}=supportScope(actor,owner);audit(actor,'support.list:'+owner);return all('SELECT id,note,object_path IS NOT NULL AS has_file,created_at FROM restricted_support WHERE unit=? AND owner IN ('+owners.map(()=>'?').join(',')+') AND withdrawn_at IS NULL ORDER BY created_at DESC,id',unit,...owners)},
  async saveRestrictedSupport(actor,owner,p,bytes,mime,ext){
   const {unit}=supportScope(actor,owner),hash=createHash('sha256').update(JSON.stringify([owner,p.note,mime])).update(bytes||'').digest('hex');
   const repeated=()=>{const old=get('SELECT request_hash,created_by,withdrawn_at FROM restricted_support WHERE id=?',p.id);if(!old)return false;if(old.created_by!==actor||old.request_hash!==hash||old.withdrawn_at)fail('Envio já utilizado. Reabra a ficha.',409);return true};
   if(repeated())return;
   const key=bytes?'restricted-support/'+randomUUID()+'.'+ext:null;if(key)await storage.upload(key,bytes,mime);
   let used=false;try{tx(()=>{supportScope(actor,owner);if(repeated())return;
    run('INSERT INTO restricted_support VALUES(?,?,?,?,?,?,?,?,?,NULL)',p.id,owner,unit,p.note,key,mime,hash,actor,now());audit(actor,'support.add:'+p.id);used=true})
   }catch(e){if(key)await storage.removeObject(key);throw e}if(key&&!used)await storage.removeObject(key);
  },
  async downloadRestrictedSupport(actor,owner,id){const r=supportRow(actor,owner,id);if(!r.object_path)fail('Sem laudo anexado.',404);audit(actor,'support.download:'+id);return {mime:r.mime,response:await storage.download(r.object_path)}},
  withdrawRestrictedSupport(actor,owner,id){tx(()=>{supportRow(actor,owner,id);run('UPDATE restricted_support SET withdrawn_at=? WHERE id=?',now(),id);audit(actor,'support.withdraw:'+id)})}
 };
}
export async function handleStudentCaseFiles({req,route,method,store,actor}){
 const c=route.match(correctionRoute),s=route.match(ownerRoute);if(!c&&!s)return null;
 const body=async()=>{try{const p=await req.json();if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p}catch{fail('Dados inválidos.')}};
 if(c&&method==='POST')return json(await store.correctRegistrationFile(actor,c[1].toLowerCase(),c[2].toLowerCase(),c[3],await body()));
 if(!s)return null;
 const [,owner,id,op]=s;await store.supportAccess(actor,owner);
 if(!op&&method==='GET')return json({entries:await store.listRestrictedSupport(actor,owner)});
 if(!op&&method==='POST'){
  let f;try{f=await req.formData()}catch{fail('Envio inválido.')}
  const note=f.get('note'),rid=f.get('id'),file=f.get('file');
  if(f.get('checked')!=='true'||typeof note!=='string'||note.length>1500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(note)||!new RegExp('^'+uuid+'$','i').test(rid||''))fail('Confira a finalidade, a autorização para o registro e o texto (até 1.500 caracteres).');
  let bytes=null,mime=null,ext=null;if(file&&file.size!==0){if(typeof file.arrayBuffer!=='function'||file.size>5*1024*1024)fail('Use PDF, JPG ou PNG de até 5 MB.');bytes=Buffer.from(await file.arrayBuffer());[mime,ext]=fileType(bytes);if(mime!==file.type)fail('Tipo do arquivo não confere.')}
  if(!note.trim()&&!bytes)fail('Descreva o apoio ou escolha o laudo.');
  await store.saveRestrictedSupport(actor,owner,{id:rid,note:note.trim()},bytes,mime,ext);return json({message:'Registro salvo na área restrita.'},201);
 }
 if(id&&op==='download'&&method==='GET'){const {mime,response}=await store.downloadRestrictedSupport(actor,owner,id);return new Response(response.body,{headers:{...headers,'Content-Type':mime,'Content-Disposition':'attachment; filename="laudo.'+({'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg'}[mime])+'"' }})}
 if(id&&op==='withdraw'&&method==='POST'){if((await body()).checked!==true)fail('Confirme a retirada.');await store.withdrawRestrictedSupport(actor,owner,id);return json({message:'Registro retirado da área de consulta.'})}
 return null;
}
