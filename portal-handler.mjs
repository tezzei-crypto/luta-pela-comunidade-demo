import {sameOrigin} from './request-origin.mjs';
import {handleSiteEditor} from './site-editor-handler.mjs';
import {handleAttendanceInsights} from './attendance-insights-handler.mjs';
import {recordDiagnostic} from './diagnostic-http.mjs';
import {requireRouteAccess} from './portal-permissions.mjs';
import {handleWorkforce} from './workforce-handler.mjs';
import {handleProfessionals} from './professional-handler.mjs';
import {handleStudentDetails} from './student-details-handler.mjs';
import {handleTeaching} from './teacher-handler.mjs';
import {handleAgenda} from './agenda-handler.mjs';
import {randomUUID} from 'node:crypto';
import {createStore,portalConfigured} from './portal-store.mjs';
import {metricsEnabled} from './metrics-handler.mjs';
import {COLUMNS,KINDS,ROLES,fail,ageAt,validateStudent,parseCsv,csv,canRead,canEdit,canDocument,fileType,signPreview,readPreview} from './portal-domain.mjs';
const privateHeaders={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers:privateHeaders});
const enabled=portalConfigured;
const clean=row=>Object.fromEntries(COLUMNS.map(k=>[k,row[k]]));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function handlePortal(req,env=process.env,injectedStore){
 try{
  const url=new URL(req.url),route=url.pathname.replace(/^\/api\/portal/,'');
  const method=req.method;
  if(route==='/status'&&method==='GET')return json({enabled:enabled(env)});
  if(!enabled(env))return json({message:'O portal privado ainda está em configuração. O agendamento continua disponível.'},503);
  if(!['GET','POST','PATCH'].includes(method))return json({message:'Método não permitido.'},405);
  if(method!=='GET'){
   if(!sameOrigin(req,env))fail('Origem não permitida.',403);
  }
  const store=injectedStore||createStore(env);
  const body=async()=>{try{const p=await req.json();if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p}catch{fail('Dados inválidos.')}};
  if(route==='/auth/request'&&method==='POST'){
   const {email}=await body();if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail('Informe um email válido.');
   // Mesma resposta para contas ausentes, evitando enumeração de responsáveis.
   await store.requestCode(email.trim().toLowerCase()).catch(error=>{recordDiagnostic(env,{support_id:req.headers.get('x-support-id'),source:'server',operation:'login',kind:error.status===429?'rate_limit':'email',status:error.status||502},store)});
   return json({message:'Se este email estiver habilitado, você receberá um código. Confira também o spam.'});
  }
  let user,member,session;
  if(route==='/auth/verify'&&method==='POST'){
   const {email,code}=await body();if(typeof email!=='string'||email.length>254||typeof code!=='string'||!/^\d{6,10}$/.test(code))fail('Confira o email e o código.');
   try{session=await store.verifyCode(email.trim().toLowerCase(),code);user=await store.user(session.access_token)}catch{fail('Código inválido ou expirado.',401)}
  }else{
   const token=req.headers.get('authorization')?.match(/^Bearer (\S{20,8192})$/)?.[1];if(!token)fail('Entre para acessar sua ficha.',401);
   try{user=await store.user(token)}catch{fail('Sessão expirada. Entre novamente.',401)}
  }
  if(!user?.id)fail('Sessão inválida.',401);
  member=await store.member(user.id);if(!member||!ROLES.includes(member.role))fail('Conta sem acesso ativo. Procure a secretaria.',403);
  if(route==='/auth/logout'&&method==='POST'){await store.logout(req.headers.get('authorization').slice(7));return json({message:'Sessão encerrada.'})}
  const role=member.role,actor=user.id,staff=['admin','secretary'].includes(role);
  const requireRole=(...roles)=>{if(!roles.includes(role))fail('Acesso não permitido.',403)};
  requireRouteAccess(role,route,method);
  const editorResponse=await handleSiteEditor({req,route,method,url,store,actor,requireRole});if(editorResponse)return editorResponse;
  if(route==='/sync'&&method==='GET')return json(await store.systemRevision(actor));
  if(route==='/diagnostics'&&method==='GET'){requireRole('admin');return json(store.diagnosticEvents(actor,{support_id:url.searchParams.get('support_id')||'',kind:url.searchParams.get('kind')||'',page:Number(url.searchParams.get('page')||0)}));}
  if(route==='/diagnostics/settings'&&method==='PATCH'){requireRole('admin');return json({settings:store.configureDiagnostics(actor,await body())});}

  if(route==='/contact-settings'){requireRole('admin','secretary');if(method==='GET')return json({settings:await store.contactSettings(actor)});if(method==='PATCH')return json({settings:await store.saveContactSettings(actor,await body()),message:'Contato da secretaria atualizado no site.'});}
  const attendanceInsights=await handleAttendanceInsights({req,route,method,url,store,actor});if(attendanceInsights)return attendanceInsights;
  const workforce=await handleWorkforce({req,route,method,url,store,actor});if(workforce)return workforce;
  const linked=(await store.links(actor)).map(l=>l.student_id);
  const student=async id=>{
   if(!/^UND[1-3]_\d{6}$/.test(id)||!canRead(role,linked.includes(id)))fail('Aluno indisponível para esta conta.',403);
   const row=await store.student(id);if(!row)fail('Aluno não localizado.',404);return row;
  };
  const roster=async()=>staff?store.students():linked.length?store.students(linked):[];
  if(route==='/auth/verify'&&method==='POST')return json({access_token:session.access_token,expires_in:session.expires_in,role,email:member.email});
  if(route==='/me'&&method==='GET')return json({role,email:member.email,user_id:actor,session_expires_at:user.expires_at,...(role==='teacher'?{test_access:await store.teacherTestAccess(actor)}:{})});
  const professionals=await handleProfessionals({req,route,method,url,store,actor});if(professionals)return professionals;
  const details=await handleStudentDetails({req,route,method,store,actor});if(details)return details;
  const teaching=await handleTeaching({route,method,req,url,store,actor});if(teaching)return teaching;
  if(route==='/dashboard'&&method==='GET'){
   requireRole('admin','secretary');const days=Number(url.searchParams.get('days')||30);if(![7,30,90].includes(days))fail('Período inválido.');
   const result=await store.dashboard(actor,days);
   // Administrators and the secretary share the management dashboard.
   return json({...result,metrics_enabled:staff&&!!metricsEnabled(env),intake_enabled:env.PORTAL_INTAKE_ACTIVE==='true',registry_active:usesPortalRegistry(env)});
  }
  if(route==='/audit'&&method==='GET'){requireRole('admin','secretary');return json({events:await store.auditLog()})}
  if(route==='/registrations'&&method==='GET'){
   requireRole('admin','secretary');const status=url.searchParams.get('status')||'pending',page=Number(url.searchParams.get('page')||0);
   if(!['pending','needs_info','approved','rejected'].includes(status)||!Number.isInteger(page)||page<0||page>10000)fail('Filtro inválido.');
   const rows=await store.registrations(status,page*50);return json({registrations:rows.slice(0,50),has_more:rows.length>50,page});
  }
  const registrationMatch=route.match(/^\/registrations\/([0-9a-f-]+)(?:\/(review|documents\/([0-9a-f-]+)))?$/i);
  if(registrationMatch){
   requireRole('admin','secretary');const id=registrationMatch[1];if(!uuid(id))fail('Protocolo inválido.');
   const registration=await store.registration(id);if(!registration)fail('Inscrição não localizada.',404);
   if(!registrationMatch[2]&&method==='GET'){
    const {payload_hash,documents,...data}=registration;await store.audit(actor,'registration.read:'+id);
    return json({registration:{...data,age:ageAt(data.birth_date),documents:documents.map(({object_path,...d})=>d)}});
   }
   if(registrationMatch[2]==='review'&&method==='POST'){
    const p=await body();
    if(!Number.isSafeInteger(p.version)||p.version<1||!['approved','needs_info','rejected'].includes(p.decision)||typeof p.reason!=='string'||p.reason.length>500||/[\x00-\x1f]/.test(p.reason))fail('Confira a decisão e o motivo.');
    if(p.decision==='approved'&&p.checked!==true)fail('Confirme a conferência dos documentos e da identidade do responsável.');
    if(p.decision!=='approved'&&p.reason.trim().length<5)fail('Informe o motivo administrativo da decisão.');
    if(p.existing_student_id&&!/^UND[1-3]_\d{6}$/.test(p.existing_student_id))fail('Confira o ID existente.');
    const result=await store.reviewRegistration(actor,id,p);return json({message:'Decisão registrada. O contato com a família deve ser feito pela equipe.',...result});
   }
   if(registrationMatch[3]&&method==='GET'){
    const d=registration.documents.find(d=>d.id===registrationMatch[3]);if(!d)fail('Documento não localizado.',404);
    await store.audit(actor,'registration.document:'+id);
    const response=await store.download(d.object_path);return new Response(response.body,{headers:{...privateHeaders,'Content-Type':d.mime,'Content-Disposition':`attachment; filename="inscricao-${d.id}.${d.mime==='application/pdf'?'pdf':d.mime==='image/png'?'png':'jpg'}"`}});
   }
  }
  if(route==='/groups'&&method==='GET')return json({groups:await store.groups(actor,url.searchParams.get('unit'))});
  if(route==='/groups'&&method==='POST')return json({group:await store.saveGroup(actor,null,await body()),message:'Turma e matrículas salvas.'},201);
  const groupMatch=route.match(/^\/groups\/([0-9a-f-]{36})$/i);
  if(groupMatch&&method==='GET')return json({group:await store.group(actor,groupMatch[1])});
  if(groupMatch&&method==='PATCH')return json({group:await store.saveGroup(actor,groupMatch[1],await body()),message:'Turma e matrículas atualizadas. Aulas já abertas preservam a lista registrada.'});
  if(route==='/classes'&&method==='GET'){requireRole('admin','secretary','teacher');return json({classes:await store.classes(actor,url.searchParams.get('unit'))})}
  if(route==='/classes'&&method==='POST'){requireRole('admin','secretary','teacher');return json({lesson:await store.createClass(actor,await body())},201)}
  if(route==='/attendance.csv'&&method==='GET'){
   requireRole('admin','secretary','teacher');const rows=await store.attendanceExport(actor,url.searchParams.get('unit'),url.searchParams.get('from'),url.searchParams.get('to'));
   return new Response(csv(rows,['date','time','class','unit','student_id','name','status','version','updated_at']),{headers:{...privateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="presencas.csv"'}});
  }
  const cancelMatch=route.match(/^\/classes\/([0-9a-f-]{36})\/cancellation$/i);if(cancelMatch&&method==='POST')return json({lesson:await store.cancelClass(actor,cancelMatch[1],await body()),message:'Situação da aula atualizada.'});
  const classMatch=route.match(/^\/classes\/([0-9a-f-]+)\/attendance$/i);
  if(classMatch){requireRole('admin','secretary','teacher');if(!uuid(classMatch[1]))fail('Aula inválida.');if(method==='GET')return json(await store.attendance(actor,classMatch[1]));if(method==='POST'){await store.markAttendance(actor,classMatch[1],(await body()).rows);return json({message:'Chamada salva.'})}}
  const appointmentMatch=route.match(/^\/students\/(UND[1-3]_\d{6})\/appointment$/);
  if(appointmentMatch){
   requireRole('admin','secretary','guardian');const context=await store.appointmentContext(actor,appointmentMatch[1]);
   if(method==='GET')return json({student:{id:context.student.id,name:context.student.name,age:ageAt(context.student.birth_date)},contact:context.contact});
   if(method==='POST'){
    const p=await body();const internal=new Request(url.origin+'/api/agenda',{method:'POST',headers:{origin:req.headers.get('origin'),'Content-Type':'application/json'},body:JSON.stringify({...p,studentId:context.student.id})});
    const result=await handleAgenda(internal,env,fetch,async()=>[{id:context.student.id,status:context.student.status}],context.student);
    if(result.ok)await store.audit(actor,'appointment.request',context.student.id);return result;
   }
  }
  if(route==='/students'&&method==='GET'&&role==='teacher')return json({students:[]});
  if(route==='/students'&&method==='GET')return json({students:(await roster()).map(r=>({...clean(r),age:ageAt(r.birth_date)}))});
  let match=route.match(/^\/students\/(UND[1-3]_\d{6})(\/documents)?$/);
  if(match){
   const row=await student(match[1]);
   if(match[2]){
    if(method==='GET')return json({documents:(await store.documents(row.id)).filter(d=>canDocument(role,d.kind)).map(({object_path,...d})=>d)});
    if(method==='POST'){
     requireRole('admin','secretary','guardian');
     let form;try{form=await req.formData()}catch{fail('Envio de arquivo inválido.')}
     const kind=form.get('kind'),file=form.get('file');
     if(!KINDS[kind]||!file||typeof file.arrayBuffer!=='function')fail('Escolha a categoria e um arquivo.');
     if(file.size<1||file.size>5*1024*1024)fail('Cada arquivo deve ter até 5 MB.');
     const bytes=Buffer.from(await file.arrayBuffer()),[mime,ext]=fileType(bytes);
     if(file.type!==mime||(kind==='photo'&&mime==='application/pdf'))fail('O tipo informado não corresponde ao arquivo. Fotos devem ser JPG ou PNG.');
     const id=randomUUID(),path=`${row.id}/${id}.${ext}`;
     await store.upload(path,bytes,mime);
     try{await store.addDocument({id,student_id:row.id,kind,object_path:path,original_name:String(file.name).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180),mime,size:bytes.length,created_by:actor})}
     catch(error){await store.removeObject(path).catch(()=>{});throw error}
     await store.audit(actor,'document.upload',row.id);
     return json({message:'Arquivo recebido. A conferência será feita pela equipe.',id},201);
    }
   }else{
    if(method==='GET')return json({student:{...clean(row),age:ageAt(row.birth_date)}});
    if(method==='PATCH'){
     if(!canEdit(role))fail('Acesso não permitido.',403);
     const patch=validateStudent(await body(),{partial:true});
     if(patch.version===undefined)fail('Atualize a página antes de salvar.',409);
     if(patch.id&&patch.id!==row.id)fail('O ID não pode mudar.');
     if(role==='guardian'&&Object.keys(patch).some(k=>!['version','height_cm','weight_kg','kimono','rashguard','shorts'].includes(k)))fail('A secretaria atualiza os dados de identificação.',403);
     await store.update(actor,validateStudent({...clean(row),...patch}));return json({message:'Ficha atualizada.'});
    }
   }
  }
  match=route.match(/^\/documents\/([0-9a-f-]+)\/download$/i);
  if(match&&method==='GET'){
   if(!uuid(match[1]))fail('Documento inválido.');
   const d=await store.document(match[1]);if(!d)fail('Documento indisponível.',404);
   await student(d.student_id);if(!canDocument(role,d.kind))fail('Acesso não permitido.',403);
   await store.audit(actor,'document.download:'+d.id,d.student_id);
   const response=await store.download(d.object_path);
   return new Response(response.body,{headers:{...privateHeaders,'Content-Type':d.mime,'Content-Disposition':`attachment; filename="documento-${d.id}.${d.mime==='application/pdf'?'pdf':d.mime==='image/png'?'png':'jpg'}"`}});
  }
  if(route==='/export.csv'&&method==='GET'){
   if(role==='teacher')fail('Use a exportação de presenças do núcleo.',403);
   const rows=await roster();await store.audit(actor,'csv.export');return new Response(csv(rows),{headers:{...privateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="alunos.csv"'}});
  }
  if(route==='/documents.csv'&&method==='GET'){
   if(role==='teacher')fail('Acesso não permitido.',403);
   const rows=[];for(const r of await roster())for(const d of await store.documents(r.id))if(canDocument(role,d.kind))rows.push({student_id:r.id,document_id:d.id,kind:KINDS[d.kind],name:d.original_name,created_at:d.created_at});
   await store.audit(actor,'documents.export');return new Response(csv(rows,['student_id','document_id','kind','name','created_at']),{headers:{...privateHeaders,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="indice-documentos.csv"'}});
  }
  if(route==='/import/preview'&&method==='POST'){
   requireRole('admin','secretary');const rows=parseCsv((await body()).csv),existing=new Map((await store.students()).map(r=>[r.id,r]));
   for(const r of rows)if(!existing.has(r.id))fail('Novos alunos recebem ID automático na aprovação em Candidatos. Use o CSV apenas para atualizar IDs já cadastrados.');
   for(const r of rows)if((existing.get(r.id)?.version||0)!==r.version)fail(`Versão desatualizada: ${r.id}. Exporte um CSV novo.`,409);
   const token=signPreview({actor,rows,expires:Date.now()+600000},env.PORTAL_SECRET);
   return json({token,rows:rows.map(r=>({id:r.id,name:r.name,action:existing.has(r.id)?'Atualizar':'Criar'}))});
  }
  if(route==='/import/commit'&&method==='POST'){
   requireRole('admin','secretary');const rows=readPreview((await body()).token,env.PORTAL_SECRET,actor);
   if(!Array.isArray(rows)||!rows.length||rows.length>500)fail('Prévia inválida.');
   const existingIds=new Set((await store.students()).map(r=>r.id));if(rows.some(r=>!existingIds.has(r.id)))fail('Novos alunos devem ser aprovados em Candidatos para gerar um ID automático.');
   await store.import(actor,rows.map(r=>validateStudent(r)));return json({message:`${rows.length} fichas importadas. Nenhum aluno ausente do CSV foi apagado.`});
  }
  if(route==='/staff-accounts'&&method==='GET'){requireRole('admin','secretary');return json({accounts:await store.staffAccounts(actor)})}
  if(route==='/staff-accounts'&&method==='POST'){requireRole('admin','secretary');return json({account:await store.saveStaffAccount(actor,null,await body()),message:'Conta cadastrada. O titular pode solicitar seu código pelo email informado.'},201)}
  const staffMatch=route.match(/^\/staff-accounts\/([0-9a-f-]{36})$/i);
  if(staffMatch&&method==='PATCH'){requireRole('admin','secretary');return json({account:await store.saveStaffAccount(actor,staffMatch[1],await body()),message:'Cadastro e acesso atualizados.'})}
  if(route==='/members'&&method==='GET'){
   requireRole('admin','secretary');return json({members:await store.members()});
  }
  if(route==='/members'&&method==='POST'){
   requireRole('admin','secretary');const {email,role:newRole}=await body();
   if(newRole!=='guardian')fail('Função não permitida.',403);
   if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail('Email inválido.');
   const m=await store.provision(email.trim().toLowerCase(),newRole);await store.audit(actor,'member.provision:'+m.user_id);
   return json({message:'Conta cadastrada. Nenhum convite foi enviado. O titular poderá pedir um código no portal.',member:m},201);
  }
  if(route==='/links'&&method==='POST'){
   requireRole('admin','secretary');const {user_id,student_id}=await body();if(!uuid(user_id))fail('Conta inválida.');await student(student_id);
   await store.link(actor,user_id,student_id);return json({message:'Vínculo cadastrado.'});
  }
  match=route.match(/^\/members\/([0-9a-f-]+)$/i);
  if(match&&method==='PATCH'){
   requireRole('admin','secretary');if(!uuid(match[1])||match[1]===actor)fail('Não é possível alterar a própria conta.');
   const {role:newRole,active}=await body();if(!['psychologist','social_worker','guardian','teacher'].includes(newRole)||typeof active!=='boolean')fail('Conta inválida.');
   await store.setMember(actor,match[1],newRole,active);return json({message:'Conta atualizada. Os vínculos anteriores foram removidos; vincule novamente se necessário.'});
  }
  return json({message:'Operação não encontrada.'},404);
 }catch(e){return json({message:e.status?e.message:'Não foi possível concluir. Tente novamente.'},e.status||500)}
}
import {usesPortalRegistry} from './access-handler.mjs';
