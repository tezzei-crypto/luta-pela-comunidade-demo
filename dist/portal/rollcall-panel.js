export function startRollcallPanel({api,el,field,action,notice,active,showPanel,openCall}){
 let area,content,banner,settingsForm,settingsBaseline='',loading=false;
 const units={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
 const labels={open:'Pendente',resolved:'Concluída',cancelled:'Cancelada'};
 const snapshot=form=>JSON.stringify([...form.elements].filter(e=>e.name).map(e=>[e.name,e.type==='checkbox'?e.checked:e.value]));
 function button(text,fn){const b=el('button',text,{type:'button',class:'secondary'});b.addEventListener('click',action(fn));return b}
 function settingsEditor(s){
  const details=el('details');details.append(el('summary','Configurar avisos de chamada'));
  const form=el('form');settingsForm=form;
  const flags=[['enabled','Monitoramento ativo'],['teacher_email','Avisar professores vinculados por email'],['manager_email','Avisar administração e secretaria por email']];
  for(const [name,label]of flags){const box=el('label',undefined,{class:'check-label'}),input=el('input',undefined,{type:'checkbox',name});input.checked=s[name];box.append(input,document.createTextNode(label));form.append(box)}
  for(const [name,label,min,max]of [['grace_hours','Prazo após o fim da aula para avisar (horas)',0,48],['repeat_hours','Intervalo entre lembretes (horas)',1,168],['max_notices','Máximo de emails por pessoa e aula',1,5],['quiet_start','Pausar emails a partir de (hora de Brasília)',0,23],['quiet_end','Retomar emails às (hora de Brasília)',0,23]]){
   const input=field(form,label,name,name==='grace_hours'?s.grace_minutes/60:s[name],{type:'number'});input.min=min;input.max=max;input.step=name==='grace_hours'?0.25:1;input.required=true;
  }
  form.append(el('p','Horas iguais desativam a pausa noturna. O limite é por destinatário e aula, incluindo avisos já enviados. Alterações valem para as pendências existentes. Nenhum lembrete transforma alunos sem marcação em faltosos.'),el('button','Salvar regras dos lembretes'));
  form.addEventListener('submit',action(async()=>{
   const data={version:s.version};for(const [k]of flags)data[k]=form.elements[k].checked;
   data.grace_minutes=Math.round(Number(form.elements.grace_hours.value)*60);
   for(const k of ['repeat_hours','max_notices','quiet_start','quiet_end'])data[k]=Number(form.elements[k].value);
   const saved=await api('/rollcall-settings',{method:'POST',data});notice(saved.message);settingsBaseline=snapshot(form);await refresh(true);
  }));details.append(form);settingsBaseline=snapshot(form);return details;
 }
 function render(data){
  const {issues,settings:s}=data,open=issues.filter(i=>i.status==='open'&&!i.within_grace);
  content.replaceChildren();
  banner.replaceChildren(document.createTextNode(open.length?`${open.length} chamada(s) pendente(s) de conclusão. `:'Chamadas em dia: nenhuma pendência identificada. '),button('Ver chamadas pendentes',()=>showPanel('rollcall-area')));
  banner.hidden=!open.length;
  content.append(el('p',`${open.length} pendente(s) · verificado às ${new Date().toLocaleTimeString('pt-BR',{timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'})}`,{role:'status','aria-live':'polite'}));
  content.append(el('p',s.enabled?`Aulas verificadas a cada ${s.check_interval_minutes} minutos, ${s.grace_minutes/60} hora(s) após o término. Até ${s.max_notices} email(s) por destinatário e aula, com intervalo de ${s.repeat_hours} horas.`:'Monitoramento pausado pela administração. As pendências anteriores continuam disponíveis para conferência.',{class:s.enabled?'form-success':'form-error'}));
  if(s.quiet_start!==s.quiet_end)content.append(el('p',`Emails pausados das ${String(s.quiet_start).padStart(2,'0')}h às ${String(s.quiet_end).padStart(2,'0')}h, horário de Brasília. O painel continua disponível.`));
  if(!s.mail_configured)content.append(el('p','Envio de email indisponível: o servidor ainda precisa de configuração. As pendências permanecem visíveis neste painel.',{class:'form-error',role:'status'}));
  if(!s.teacher_email)content.append(el('p','Emails aos professores desativados. A lista no painel permanece disponível.'));
  const availableUnits=active()?.role==='secretary'?Object.fromEntries(Object.entries(units).filter(([u])=>active().units?.includes(u))):units;
  const filters=el('form');const uf=field(filters,'Núcleo','unit','',{options:{'':'Todos os núcleos permitidos',...availableUnits}}),sf=field(filters,'Situação','status','open',{options:{open:'Chamadas a concluir',resolved:'Concluídas',cancelled:'Canceladas','':'Todas'}});filters.addEventListener('submit',e=>e.preventDefault());content.append(filters);
  const list=el('div');content.append(list);
  const draw=()=>{
   list.replaceChildren();const visible=issues.filter(i=>(!uf.value||i.unit===uf.value)&&(!sf.value||i.status===sf.value));
   if(!visible.length)list.append(el('p','Nenhuma chamada nesta seleção. A verificação considera turmas ativas, dias da semana, alunos matriculados e aulas canceladas.'));
   for(const i of visible){
    const card=el('article',undefined,{class:'report-record'});
    card.append(el('h3',`${i.status==='open'&&i.within_grace?'Dentro do prazo':labels[i.status]} · ${i.label}`),el('p',`${i.day.split('-').reverse().join('/')} · ${i.start_time}–${i.end_time} · ${units[i.unit]||i.unit}`),el('p',`${i.marked} de ${i.expected} alunos com marcação · ${Math.max(0,i.expected-i.marked)} por preencher`),el('p','Professor(es): '+(i.teachers.map(t=>t.name).join(', ')||'Nenhum professor habilitado vinculado')),el('p',i.status==='open'?i.reason:i.status==='resolved'?'Pendência encerrada: todas as marcações foram feitas ou não há alunos a conferir.':'Aula cancelada ou turma desativada.'));
    if(i.status==='open')card.append(el('p','Prazo para concluir: '+new Date(i.notify_after).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília).'+(i.within_grace?' Nenhum novo aviso será enviado antes desse prazo.':'')));
    card.append(button(i.status==='open'?'Preencher chamada':'Consultar chamada',()=>openCall(i)));
    if(!i.teachers.length&&s.can_edit)card.append(button('Conferir professores da turma',()=>showPanel('groups-area')));
    const delivery=el('details');delivery.append(el('summary','Avisos e acompanhamento'));
    if(!i.notifications.length)delivery.append(el('p','Sem destinatário de email nesta ocorrência. Confira os vínculos e as regras de envio.'));
    for(const n of i.notifications){
     const state={pending:'Aguardando envio',retry:'Nova tentativa programada',sending:'Envio em andamento',accepted:'Aceito pelo provedor de email',cancelled:'Novos avisos interrompidos',review:'Conferência do envio necessária'}[n.status]||n.status;
     delivery.append(el('p',`${n.email} · ${state} · ${n.send_count} aviso(s) aceito(s)${n.last_sent?' · último em '+new Date(n.last_sent).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):''}${n.last_error?' · '+n.last_error:''}`));
    }
    delivery.append(el('small','Aceito pelo provedor não confirma leitura nem chegada à caixa de entrada. Ao completar a chamada, os próximos lembretes param. Um email já em processamento pode ainda chegar.'));card.append(delivery);list.append(card);
   }
  };uf.addEventListener('change',draw);sf.addEventListener('change',draw);draw();
  content.append(button('Atualizar chamadas pendentes',()=>refresh(true)));
  if(s.can_edit)content.append(settingsEditor(s));
 }
 async function refresh(force=false){
  if(!['admin','secretary','teacher'].includes(active()?.role)||loading)return;
  if(!force&&settingsForm?.isConnected&&snapshot(settingsForm)!==settingsBaseline)return;
  loading=true;try{
   const data=await api('/rollcall-issues');
   if(!area?.isConnected){area=el('section',undefined,{id:'rollcall-area'});area.append(el('h2','Chamadas pendentes'),el('p','Acompanhe aulas sem chamada ou com alunos ainda sem marcação. Abra a chamada, revise e salve. Se a aula não ocorreu, registre o cancelamento com motivo dentro da chamada.'));content=el('div');area.append(content);document.getElementById('team-area').before(area)}
   if(!banner?.isConnected){banner=el('div',undefined,{id:'rollcall-banner',class:'form-error',role:'status','aria-live':'polite'});document.getElementById('identity').parentElement.after(banner)}
   render(data);
  }finally{loading=false}
 }
 document.addEventListener('portal:loaded',action(()=>refresh()));
 document.addEventListener('portal:attendance-saved',action(()=>refresh()));
 document.addEventListener('portal:logout',()=>{area?.remove();banner?.remove();area=content=banner=settingsForm=null;settingsBaseline=''});
 if(active())void action(()=>refresh())();
}
