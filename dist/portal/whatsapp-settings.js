export async function mountWhatsappSettings({api,el,field,action,notice},host){
 let box=host.querySelector('#whatsapp-automation');if(!box){box=el('section',undefined,{id:'whatsapp-automation'});host.append(box)}
 const load=async()=>{
  const {settings:s}=await api('/whatsapp-notices');if(!box.isConnected)return;
  box.replaceChildren(el('h3','Avisos automáticos pelo WhatsApp'),el('p',s.connected?(s.enabled?'Envio automático ativado.':'Conexão configurada; envio pausado.'):'Preparado para configurar — conexão oficial do WhatsApp pendente.',{class:s.connected&&s.enabled?'form-success':'form-error',role:'status'}));
  box.append(el('p','O número pode ser alterado quando o chip da federação chegar. Trocar o número pausa os envios até que a conexão oficial corresponda ao novo número. O contato público da secretaria continua sendo editado no formulário acima.'));
  const form=el('form');field(form,'Número que enviará os avisos (com +55 e DDD)','phone',s.phone,{type:'tel'}).required=true;
  const enabled=field(form,'Envio dos avisos','enabled',String(s.enabled),{options:{false:'Pausado',true:'Ativado'}});if(!s.connected)enabled.disabled=true;
  form.append(el('p','Somente destinatários com autorização registrada recebem avisos. Uma mensagem por ocorrência e pessoa; os detalhes do aluno ficam no painel privado. O envio pela plataforma oficial pode ter custo.'),el('button','Salvar número e configuração'));
  form.addEventListener('submit',action(async()=>{const p=await api('/whatsapp-notices',{method:'PATCH',data:{phone:form.elements.phone.value,enabled:enabled.value==='true',version:s.version}});notice(p.message);await load()}));box.append(form);
  const details=el('details');details.append(el('summary','Destinatários e autorização para receber WhatsApp'));
  const rf=el('form'),people=Object.fromEntries(s.recipients.map(r=>[r.user_id,r.email+' · '+r.role])),person=field(rf,'Pessoa da equipe','user_id','',{options:{'':'Selecione',...people}}),phone=field(rf,'WhatsApp do destinatário (com +55 e DDD)','phone','',{type:'tel'}),consent=field(rf,'Autorização confirmada para receber esses avisos','accepted','false',{options:{false:'Não autorizado / revogado',true:'Autorizado pelo destinatário'}});person.required=phone.required=true;
  person.addEventListener('change',()=>{const r=s.recipients.find(r=>r.user_id===person.value);phone.value=r?.phone||'';consent.value=String(!!r?.accepted)});rf.append(el('p','Registre a autorização somente depois de confirmar o número e a concordância da pessoa. A função e os núcleos são conferidos novamente antes de cada envio.'),el('button','Salvar preferência do destinatário'));
  rf.addEventListener('submit',action(async()=>{const r=s.recipients.find(r=>r.user_id===person.value);const p=await api('/whatsapp-notices/recipient',{method:'PATCH',data:{user_id:person.value,phone:phone.value,accepted:consent.value==='true',version:r?.version||0}});notice(p.message);await load()}));details.append(rf);box.append(details);
  const history=el('details');history.append(el('summary','Histórico dos avisos de WhatsApp'));
  for(const n of s.deliveries)history.append(el('p',n.email+' · '+({accepted:'Aceito pela Meta; entrega e leitura ainda não confirmadas',failed:'Recusado pela Meta; confira a configuração',review:'Resultado incerto; conferir antes de reenviar',sending:'Envio em processamento'}[n.status]||n.status)+' · '+new Date(n.updated_at).toLocaleString('pt-BR')));
  if(!s.deliveries.length)history.append(el('p','Nenhum envio realizado.'));box.append(history);
 };await load();
}
