import {randomUUID} from 'node:crypto';
import {fail,fileType,csv} from './portal-domain.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'},json=(p,s=200)=>Response.json(p,{status:s,headers});
export async function handleProfessionals({req,route,method,url,store,actor}){
 const body=async()=>{try{return await req.json()}catch{fail('Dados inválidos.')}};
 if(route==='/professionals'&&method==='GET')return json({professionals:await store.professionals(actor)});
 if(route==='/professionals'&&method==='POST')return json({professional:await store.saveProfessional(actor,null,await body()),message:'Cadastro salvo. Envie os documentos para conferência.'},201);
 const professional=route.match(/^\/professionals\/([0-9a-f-]{36})(\/documents)?$/i);
 if(professional){const uid=professional[1];
  if(!professional[2]){if(method==='GET')return json({professional:await store.professional(actor,uid)});if(method==='PATCH')return json({professional:await store.saveProfessional(actor,uid,await body()),message:'Cadastro profissional salvo.'})}
  if(professional[2]&&method==='GET')return json({documents:(await store.professionalDocuments(actor,uid)).map(({object_path,...d})=>d)});
  if(professional[2]&&method==='POST'){
   await store.professional(actor,uid);let f;try{f=await req.formData()}catch{fail('Arquivo inválido.')}const kind=f.get('kind'),file=f.get('file');if(!['photo','identity','council'].includes(kind)||!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>5*1024*1024)fail('Escolha categoria e arquivo de até 5 MB.');
   const bytes=Buffer.from(await file.arrayBuffer()),[mime,ext]=fileType(bytes);if(file.type!==mime||kind==='photo'&&mime==='application/pdf')fail('Formato inválido. A foto deve ser JPG ou PNG.');const id=randomUUID(),path='professionals/'+uid+'/'+id+'.'+ext;await store.upload(path,bytes,mime);
   try{await store.addProfessionalDocument(actor,uid,{id,kind,object_path:path,mime,size:bytes.length,original_name:String(file.name).replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180)})}catch(e){await store.removeObject(path).catch(()=>{});throw e}return json({id,message:'Documento recebido. A liberação dos horários aguarda nova conferência da administração.'},201);
  }
 }
 const doc=route.match(/^\/professional-documents\/([0-9a-f-]{36})\/download$/i);
 if(doc&&method==='GET'){const d=await store.professionalDocument(actor,doc[1]);await store.audit(actor,'professional.document.download:'+d.id);const r=await store.download(d.object_path);return new Response(r.body,{headers:{...headers,'Content-Type':d.mime,'Content-Disposition':`attachment; filename="profissional-${d.id}.${d.mime==='application/pdf'?'pdf':d.mime==='image/png'?'png':'jpg'}"`}})}
 if(route==='/slots'&&method==='GET')return json({slots:await store.slots(actor,url.searchParams.get('professional'))});
 if(route==='/slots'&&method==='POST')return json({slot:await store.createSlot(actor,await body()),message:'Horário disponível para solicitação dos alunos do núcleo.'},201);
 const slot=route.match(/^\/slots\/([0-9a-f-]{36})(\/book)?$/i);
 if(slot&&method==='POST'){
  if(slot[2]){const booking=await store.bookSlot(actor,slot[1],await body());await store.sendBookingNotice(actor,booking.id);return json({booking,message:'Solicitação registrada e horário reservado enquanto aguarda a secretaria. O atendimento só estará confirmado após contato por WhatsApp.'},201)}
  await store.cancelSlot(actor,slot[1],(await body()).version);return json({message:'Horário retirado da disponibilidade.'});
 }
 if(route==='/available-slots'&&method==='GET')return json({slots:await store.availableSlots(actor,url.searchParams.get('student'))});
 if(route==='/bookings'&&method==='GET')return json({bookings:await store.bookings(actor)});
 if(route==='/appointment-calendar'&&method==='GET')return json(await store.appointmentCalendar(actor,Object.fromEntries(url.searchParams)));
 if(route==='/appointment-calendar.csv'&&method==='GET'){
  const r=await store.appointmentCalendar(actor,Object.fromEntries(url.searchParams));await store.audit(actor,'calendar.export');
  const statusNames={free:'Livre',pending:'Aguardando secretaria',confirmed:'Confirmado',completed:'Realizado',absent:'Não compareceu',withdrawn:'Horário retirado',expired:'Horário encerrado',unavailable:'Profissional indisponível'};
  const rows=r.events.map(e=>({...e,status:statusNames[e.status],date:new Intl.DateTimeFormat('pt-BR',{timeZone:r.time_zone}).format(new Date(e.start_at)),start:new Intl.DateTimeFormat('pt-BR',{timeZone:r.time_zone,hour:'2-digit',minute:'2-digit'}).format(new Date(e.start_at)),end:new Intl.DateTimeFormat('pt-BR',{timeZone:r.time_zone,hour:'2-digit',minute:'2-digit'}).format(new Date(e.end_at))}));
  return new Response(csv(rows,['date','start','end','unit','professional_name','service','status','student_id','student_name','booking_id']),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="calendario-atendimentos.csv"'}});
 }
 const booking=route.match(/^\/bookings\/([0-9a-f-]{36})$/i);
 if(booking&&method==='GET')return json({booking:await store.booking(actor,booking[1])});
 if(booking&&method==='PATCH')return json({booking:await store.reviewBooking(actor,booking[1],await body()),message:'Situação do atendimento atualizada. O registro não envia WhatsApp automaticamente.'});
 if(route==='/bookings.csv'&&method==='GET'){const m=await store.member(actor);if(!['admin','secretary'].includes(m.role))fail('Acesso não permitido.',403);const rows=await store.bookings(actor);await store.audit(actor,'bookings.export');return new Response(csv(rows,['id','student_id','student_name','professional_name','service','unit','start_at','end_at','status','contact_name','phone','reason','version']),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="agenda-restrita.csv"'}})}
 return null;
}
