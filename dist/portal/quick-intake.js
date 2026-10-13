export async function mountQuickIntake({api,el,field,action,notice},box,classId){
 const data=await api('/classes/'+classId+'/visitors');if(!box.isConnected)return;
 box.replaceChildren();box.className='quick-intake';
 const editable=data.can_write&&!data.lesson.cancelled,feedback=el('p','',{role:'status','aria-live':'polite'}),list=el('div');
 box.append(el('h3','Alunos novos e visitantes'),el('p','Pré-cadastro não é matrícula aprovada. Salvar aqui também registra presença nesta aula. A secretaria completa a ficha depois.'));
 let requestId=crypto.randomUUID();
 const refresh=async()=>{const fresh=await api('/classes/'+classId+'/visitors');render(fresh);};
 function render(fresh){
  if(!box.isConnected)return;list.replaceChildren(el('h4',fresh.visitors.filter(v=>v.present).length+' visitante(s) com presença registrada'));
  for(const v of fresh.visitors){const row=el('div',undefined,{class:'visitor-row'});row.append(el('strong',v.name),el('span',v.present?'Presença salva':'Sem presença nesta aula'));
   if(v.updated_at)row.append(el('small','Último lançamento: '+v.updated_by_name+' · '+new Date(v.updated_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})));
   if(editable&&(v.status==='pending'||v.present)){const b=el('button',v.present?'Desfazer presença':'Marcar presença',{type:'button',class:'secondary'});b.addEventListener('click',action(async()=>{await api('/classes/'+classId+'/visitors',{method:'POST',data:{intake_id:v.id,present:!v.present,version:v.version}});await refresh();document.dispatchEvent(new Event('portal:quick-intake-saved'));feedback.textContent=v.present?'Presença desfeita. O pré-cadastro continua salvo.':'Presença salva.';}));row.append(b)}
   list.append(row);
  }
 }
 if(editable){
  const details=el('details',undefined,{class:'quick-entry'});details.append(el('summary','＋ Aluno novo — cadastro rápido'));
  const form=el('form'),name=field(form,'Nome do aluno (obrigatório)','name','');name.required=true;name.minLength=3;name.maxLength=160;name.autocomplete='off';name.autocapitalize='words';name.enterKeyHint='done';
  const optional=el('details');optional.append(el('summary','Idade e contato — preencher se souber'));
  field(optional,'Idade em anos (opcional)','age','',{type:'number',min:0,max:120,step:1});field(optional,'Telefone do responsável com DDD (opcional)','phone','',{type:'tel'});field(optional,'Nome do responsável (opcional)','guardian_name','');form.append(optional);
  const submit=el('button','Salvar aluno e presença',{type:'submit',class:'quick-save'});form.append(submit);
  form.append(el('p','Depois de salvar, o campo fica pronto para o próximo aluno. A presença vale somente para '+data.lesson.day.split('-').reverse().join('/')+' · '+data.lesson.time+' · '+data.lesson.label+'.',{class:'muted'}));
  form.addEventListener('submit',action(async()=>{
   const values=Object.fromEntries(new FormData(form));const payload={...values,age:values.age===''?null:Number(values.age),id:requestId,class_id:classId};
   const saved=await api('/quick-intakes',{method:'POST',data:payload});requestId=crypto.randomUUID();form.reset();
   feedback.textContent=values.name+': '+(saved.present?'aluno e presença salvos. Pode cadastrar o próximo.':'cadastro já salvo; confira a presença na lista.');notice(feedback.textContent);
   document.dispatchEvent(new Event('portal:quick-intake-saved'));
   try{if(Array.isArray(saved.visitors))render(saved);else await refresh()}catch{feedback.textContent+=' A lista não pôde ser atualizada. Use Atualizar visitantes.';}
   setTimeout(()=>{if(name.isConnected)name.focus({preventScroll:true})},0);
  }));
  details.append(form);details.addEventListener('toggle',()=>{if(details.open)name.focus({preventScroll:true})});box.append(details,feedback);
  // An explicit declaration also covers a class held without anyone attending.
  const delivered=el('details');delivered.append(el('summary','Confirmar que a aula aconteceu'));
  const delivery=el('button',data.delivery.held?'Retirar confirmação de realização':'Confirmar aula realizada',{type:'button',class:'secondary'});
  delivered.append(el('p','Use quando a aula aconteceu, inclusive se ninguém compareceu. Presenças já salvas continuam contando no resumo. Se não houve aula, registre o cancelamento.'),delivery);
  delivery.addEventListener('click',action(async()=>{await api('/classes/'+classId+'/delivery',{method:'POST',data:{held:!data.delivery.held,version:data.delivery.version}});await mountQuickIntake({api,el,field,action,notice},box,classId);document.dispatchEvent(new Event('portal:quick-intake-saved'));}));box.append(delivered);
 }
 box.append(list);render(data);const update=el('button','Atualizar visitantes',{type:'button',class:'secondary'});update.addEventListener('click',action(refresh));box.append(update);
}
