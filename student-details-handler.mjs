import {randomUUID} from 'node:crypto';
import {fail,KINDS,fileType,csv} from './portal-domain.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(p,s=200)=>Response.json(p,{status:s,headers});
export async function handleStudentDetails({req,route,method,store,actor}){
 const body=async()=>{try{return await req.json()}catch{fail('Dados inválidos.')}};
 const progression=route.match(/^\/students\/(UND[1-3]_\d{6})\/progression(\/confirm)?$/);
 if(progression){
  if(method==='GET'&&!progression[2])return json({progression:await store.studentProgression(actor,progression[1])});
  if(method==='PATCH'&&!progression[2])return json({progression:await store.saveStudentGraduation(actor,progression[1],await body()),message:'Faixa, graus e data de referência salvos.'});
  if(method==='POST'&&progression[2])return json({progression:await store.confirmStudentGraduation(actor,progression[1],await body()),message:'Graduação confirmada e registrada no histórico.'});
 }
 if(route==='/graduation-policy'&&method==='PATCH')return json({policy:await store.saveGraduationPolicy(actor,await body()),message:'Regra atualizada para todos os alunos. Graduações já confirmadas foram preservadas.'});
 const match=route.match(/^\/students\/(UND[1-3]_\d{6})\/contact$/);
 if(match){if(method==='GET')return json({contact:await store.studentContact(actor,match[1])});if(method==='PATCH')return json({contact:await store.saveStudentContact(actor,match[1],await body()),message:'Contato salvo. Permissões de acesso são geridas em Contas e vínculos.'})}
 if(route==='/contacts.csv'&&method==='GET')return new Response(csv(await store.contactExport(actor),['id','name','guardian_name','guardian_email','guardian_phone','relationship','version']),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="contatos-restritos.csv"'}});
 if(route==='/registrations'&&method==='POST')return json({...await store.manualRegistration(actor,await body()),message:'Candidato cadastrado para análise. Confira e anexe os documentos antes da decisão.'},201);
 const upload=route.match(/^\/registrations\/([0-9a-f-]{36})\/documents$/i);
 if(upload&&method==='POST'){
  const member=await store.member(actor);if(!member||!['admin','secretary'].includes(member.role))fail('Acesso não permitido.',403);let form;try{form=await req.formData()}catch{fail('Arquivo inválido.')}const kind=form.get('kind'),file=form.get('file'),version=Number(form.get('version'));
  if(!KINDS[kind]||!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>5*1024*1024)fail('Escolha a categoria e arquivo de até 5 MB.');const bytes=Buffer.from(await file.arrayBuffer()),[mime,ext]=fileType(bytes);if(file.type!==mime||kind==='photo'&&mime==='application/pdf')fail('Formato inválido.');
  const id=randomUUID(),path='registrations/'+upload[1]+'/'+id+'.'+ext;await store.upload(path,bytes,mime);try{await store.registrationUpload(actor,upload[1],version,{id,kind,object_path:path,mime,size:bytes.length,original_name:String(file.name).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180)})}catch(e){await store.removeObject(path).catch(()=>{});throw e}return json({id,message:'Arquivo anexado à inscrição.'},201);
 }
 return null;
}
