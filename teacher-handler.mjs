import {randomUUID} from 'node:crypto';
import {fail,fileType,csv} from './portal-domain.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(p,s=200)=>Response.json(p,{status:s,headers});
export async function handleTeaching({route,method,req,url,store,actor}){
 const body=async()=>{try{return await req.json()}catch{fail('Dados inválidos.')}};
 if(route==='/units'&&method==='GET')return json({units:await store.availableUnits(actor)});
 if(route==='/unit-roster'&&method==='GET')return json({students:await store.unitRoster(actor,url.searchParams.get('unit'))});
 if(route==='/teachers'&&method==='GET')return json({teachers:await store.teachers(actor)});
 if(route==='/teachers'&&method==='POST')return json({teacher:await store.saveTeacher(actor,null,await body()),message:'Professor cadastrado para conferência.'},201);
 const match=route.match(/^\/teachers\/([0-9a-f-]{36})(\/documents)?$/i);
 if(match){
  const uid=match[1];
  if(!match[2]){if(method==='GET')return json({teacher:await store.teacher(actor,uid)});if(method==='PATCH')return json({teacher:await store.saveTeacher(actor,uid,await body()),message:'Cadastro do professor salvo.'})}
  if(match[2]){
   if(method==='GET')return json({documents:(await store.teacherDocuments(actor,uid)).map(({object_path,...d})=>d)});
   if(method==='POST'){
    await store.teacher(actor,uid);let f;try{f=await req.formData()}catch{fail('Arquivo inválido.')}
    const kind=f.get('kind'),file=f.get('file');if(!['photo','black_belt_diploma','first_aid_certificate'].includes(kind)||!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>5*1024*1024)fail('Escolha categoria e arquivo de até 5 MB.');
    const bytes=Buffer.from(await file.arrayBuffer()),[mime,ext]=fileType(bytes);if(file.type!==mime||kind==='photo'&&mime==='application/pdf')fail('Formato inválido. Fotos devem ser JPG ou PNG.');
    const id=randomUUID(),path='teachers/'+uid+'/'+id+'.'+ext;await store.upload(path,bytes,mime);
    try{await store.addTeacherDocument(actor,uid,{id,kind,object_path:path,mime,size:bytes.length,original_name:String(file.name).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180)})}catch(e){await store.removeObject(path).catch(()=>{});throw e}
    return json({id,message:'Documento recebido. O cadastro aguarda nova conferência da administração.'},201);
   }
  }
 }
 const doc=route.match(/^\/teacher-documents\/([0-9a-f-]{36})\/download$/i);
 if(doc&&method==='GET'){const d=await store.teacherDocument(actor,doc[1]);await store.audit(actor,'teacher.document.download:'+d.id);const r=await store.download(d.object_path);return new Response(r.body,{headers:{...headers,'Content-Type':d.mime,'Content-Disposition':`attachment; filename="professor-${d.id}.${d.mime==='application/pdf'?'pdf':d.mime==='image/png'?'png':'jpg'}"`}})}
 if(route==='/reports'&&method==='GET')return json({reports:await store.reports(actor,url.searchParams.get('unit'))});
 if(route==='/reports'&&method==='POST')return json({...await store.createReport(actor,await body()),message:'Relato registrado. A equipe deve ser avisada diretamente em situações urgentes.'},201);
 const report=route.match(/^\/reports\/([0-9a-f-]{36})$/i);
 if(report&&method==='GET')return json({report:await store.report(actor,report[1])});
 if(report&&method==='POST')return json({...await store.updateReport(actor,report[1],await body()),message:'Acompanhamento registrado; relato original preservado.'});
 if(route==='/reports.csv'&&method==='GET'){const rows=await store.reportsExport(actor,url.searchParams.get('unit'));return new Response(csv(rows,['id','kind','unit','student_id','student_name','occurred_at','category','description','actions','guardian_contact','referral','status','version','author_email','created_at','updates_json']),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="relatos-restritos.csv"'}})}
 return null;
}
