export async function mountAppointmentInbox(host,c){
 const {el,field,api,action,units,labels,students,phoneContact,refresh}=c;
 const dateTime=v=>new Date(v).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
 const slotLabel=s=>dateTime(s.start_at)+' · '+labels[s.service]+' · '+s.professional_name+' · '+(s.modality==='online'?'Online':'Presencial')+' · '+units[s.unit];
 const {requests}=await api('/appointment-requests');
 host.append(el('h3','Solicitações sem vaga reservada ('+requests.length+')'),el('p','Preferências enviadas pelo site aparecem aqui e no calendário. Selecione uma vaga para reservar; depois confirme o atendimento com a família.'));
 if(!requests.length)host.append(el('p','Nenhuma preferência aguardando escolha de horário.'));
 for(const r of requests){
  const card=el('details',undefined,{class:'calendar-publish','data-request-id':r.id});card.append(el('summary',r.student_name+' · '+dateTime(r.desired_at)+' · '+labels[r.service]+' · '+units[r.unit]));
  let loaded=false;card.addEventListener('toggle',action(async()=>{if(!card.open||loaded)return;const {slots}=await api('/appointment-requests/'+r.id+'/slots');
   card.append(el('p','Modalidade desejada: '+({any:'Presencial ou online',in_person:'Presencial',online:'Online'}[r.requested_modality]||'A definir')));
   card.append(phoneContact('Solicitante: '+r.contact_name+' · '+r.phone,r.phone,r.contact_name),el('p','Protocolo: '+r.id));
   if(r.notice_state==='review')card.append(el('p','O envio do aviso por email precisa de conferência no provedor. A solicitação está salva neste painel.',{class:'muted'}));
   const form=el('form');field(form,'Decisão','action','reserve',{options:{reserve:'Reservar um horário publicado',cancel:'Encerrar esta solicitação'}});
   const pick=field(form,'Horário para atendimento','slot_id','',{options:{'':'Escolha uma vaga',...Object.fromEntries(slots.map(s=>[s.id,slotLabel(s)]))}});
   const line=el('label',undefined,{class:'check-label'}),ack=el('input',undefined,{type:'checkbox'});line.append(ack,document.createTextNode('Conferi com o solicitante qualquer mudança de especialidade, núcleo, modalidade ou horário.'));form.append(line);
   field(form,'Motivo administrativo (sem informações clínicas)','reason','').required=true;form.append(el('button','Salvar decisão'));
   form.addEventListener('submit',action(async()=>{const data=Object.fromEntries(new FormData(form)),slot=slots.find(s=>s.id===pick.value);if(data.action==='reserve'&&!slot)throw Error('Escolha uma vaga disponível.');await api('/appointment-requests/'+r.id,{method:'PATCH',data:{...data,version:r.version,slot_version:slot?.version,change_ack:ack.checked}});await refresh()}));card.append(form);loaded=true;
  }));host.append(card);
 }
 const manual=el('details',undefined,{class:'calendar-publish'}),form=el('form');manual.append(el('summary','Registrar pedido recebido por email ou WhatsApp'),el('p','Preserve o protocolo do email, quando houver. Este registro não envia mensagens nem confirma atendimento.'),form);
 field(form,'Aluno','studentId','',{options:{'':'Selecione',...Object.fromEntries(students.filter(s=>s.status==='approved').map(s=>[s.id,s.name+' · '+s.id]))}}).required=true;
 field(form,'Protocolo original (opcional)','requestId','');field(form,'Nome do solicitante','contactName','').required=true;field(form,'WhatsApp do solicitante','phone','',{type:'tel'}).required=true;
 field(form,'Atendimento solicitado','service','Psicologia',{options:{'Psicologia':'Psicologia','Assistência social':'Assistência social'}});
 field(form,'Modalidade desejada','modality','any',{options:{any:'Presencial ou online',in_person:'Presencial',online:'Online'}});field(form,'Núcleo desejado','unit','amavale',{options:units});field(form,'Data desejada','date','',{type:'date'}).required=true;field(form,'Horário desejado','time','',{type:'time'}).required=true;
 const consent=el('input',undefined,{type:'checkbox',required:''}),line=el('label',undefined,{class:'check-label'});line.append(consent,document.createTextNode('Conferi o pedido recebido e a ciência de que aguarda confirmação.'));form.append(line,el('button','Registrar solicitação recebida'));
 let fallbackId=crypto.randomUUID();form.addEventListener('input',()=>{fallbackId=crypto.randomUUID()});form.addEventListener('submit',action(async()=>{const data=Object.fromEntries(new FormData(form));await api('/appointment-requests',{method:'POST',data:{...data,requestId:data.requestId.trim()||fallbackId,weekday:new Date(data.date+'T12:00:00Z').getUTCDay(),consent:consent.checked}});await refresh()}));host.append(manual);
 const history=el('details',undefined,{class:'calendar-publish'});history.append(el('summary','Histórico de pedidos públicos e recebidos por outros canais'));let seen=false;history.addEventListener('toggle',action(async()=>{if(!history.open||seen)return;const data=await api('/appointment-requests?status=all');for(const r of data.requests)history.append(el('p',r.student_name+' · '+dateTime(r.desired_at)+' · '+(r.booking_status||r.status)+' · '+r.id+(r.reason?' · '+r.reason:'')));seen=true}));host.append(history);
}

export function meetingFields(form,p,c){const {field}=c;field(form,'Modalidade','modality',p.modality||'in_person',{options:{in_person:'Presencial',online:'Online'}});field(form,'Endereço ou sala presencial (opcional)','location',p.location||'');const link=field(form,'Link da sala online — visível somente na área protegida','meeting_url',p.meeting_url||'',{type:'url'});link.placeholder='https://';}

export async function appendReschedule(formHost,b,c){
 const {el,field,api,action,refresh,units,labels}=c,wrapper=el('details',undefined,{class:'calendar-publish'});wrapper.append(el('summary','Remarcar este atendimento'));let loaded=false;
 wrapper.addEventListener('toggle',action(async()=>{if(!wrapper.open||loaded)return;const {slots}=await api('/bookings/'+b.id+'/reschedule'),form=el('form');
  const pick=field(form,'Novo horário','slot_id','',{options:{'':'Selecione',...Object.fromEntries(slots.map(s=>[s.id,new Date(s.start_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' · '+labels[s.service]+' · '+s.professional_name+' · '+units[s.unit]+' · '+(s.modality==='online'?'Online':'Presencial')]))}});pick.required=true;
  field(form,'Motivo da remarcação','reason','').required=true;const ack=el('input',undefined,{type:'checkbox',required:''}),line=el('label',undefined,{class:'check-label'});line.append(ack,document.createTextNode('Conferi a alteração. O novo horário precisará de confirmação com a família.'));form.append(line,el('button','Remarcar e liberar a vaga anterior'));
  form.addEventListener('submit',action(async()=>{const data=Object.fromEntries(new FormData(form)),s=slots.find(s=>s.id===pick.value);if(!s)throw Error('Escolha um horário.');await api('/bookings/'+b.id+'/reschedule',{method:'PATCH',data:{...data,version:b.version,slot_version:s.version,change_ack:ack.checked}});await refresh()}));wrapper.append(form);loaded=true;
 }));formHost.append(wrapper);
}
