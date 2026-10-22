'use strict';
const unitNames={UND1:'Amavale',UND2:'Valparaíso',UND3:'Vale do Carangola',amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
const decisionNames={pending:'Aguardando análise',needs_info:'Complementação solicitada',approved:'Aprovada',rejected:'Não aprovada'};
let registrationPage=0;
if(location.pathname.startsWith('/administracao')){document.title='Administração | Luta pela Comunidade';document.querySelector('h1').textContent='Administração do projeto';document.querySelector('h1+p').textContent='Acompanhe inscrições, alunos, documentos, equipe e visitas em um só lugar.'}
function tableOf(headings,rows){const wrap=el('div',undefined,{class:'scroll'}),table=el('table'),head=el('thead'),tr=el('tr'),body=el('tbody');for(const h of headings)tr.append(el('th',h,{scope:'col'}));head.append(tr);table.append(head,body);for(const cells of rows){const r=el('tr');for(const cell of cells)r.append(el('td',String(cell??'')));body.append(r)}wrap.append(table);return wrap}
function card(label,value,note){const c=el('div',undefined,{class:'card'});c.append(el('p',label),el('strong',String(value)),el('small',note));return c}
async function dashboard(){
 const d=await api('/dashboard?days='+$('dashboard-days').value);$('dashboard-cards').replaceChildren(
  card('Alunos aprovados',d.approved,'Situação atual'),card('Inscrições pendentes',d.registrations.pending,'Aguardando análise'),card('Complementações',d.registrations.needs_info,'Aguardando informações'),card('Fichas a completar',d.incomplete,'Medidas ou uniformes ausentes'));
 $('dashboard-state').textContent='Atualizado em '+new Date(d.generated_at).toLocaleString('pt-BR')+'. '+(!d.intake_enabled?'A recepção de inscrições neste painel ainda não foi ativada. ':'')+(!d.registry_active?'A lista de aprovação do agendamento ainda usa a configuração anterior.':'Aprovações integradas ao agendamento.');
 const traffic=$('traffic-summary');traffic.replaceChildren();
 if(me.role==='admin'){
  traffic.append(el('h3','Visitas ao site'));
  if(!d.metrics_enabled)traffic.append(el('p','Estatísticas ainda não ativadas. Não há estimativa de visitas para exibir.'));
  else{
   const cards=el('div',undefined,{class:'cards'});cards.append(card('Páginas visualizadas',d.traffic.pageviews,'No período selecionado'),card('Sessões estimadas',d.traffic.sessions,'Nova sessão após 30 min de inatividade'),card('Visitantes estimados',d.traffic.visitors,'Navegadores com identificador permitido'));traffic.append(cards,
    el('p','Contagem apenas de quem permitiu estatísticas. Um navegador não equivale a uma pessoa. Bloqueadores, dispositivos diferentes e renovação do identificador afetam a estimativa. As visitas anteriores à ativação não são recuperadas.',{class:'muted'}));
   if(!d.traffic.first_event)traffic.append(el('p','Nenhuma visita com permissão registrada ainda.'));
   else traffic.append(el('p','Primeiro registro disponível: '+new Date(d.traffic.first_event).toLocaleString('pt-BR')+'. Dados de navegação mantidos por até 90 dias.'));
   if(d.daily.length){traffic.append(el('h3','Páginas vistas por dia'));const bars=el('div',undefined,{class:'traffic-bars'}),max=Math.max(1,...d.daily.map(r=>r.pageviews));for(const r of d.daily){const line=el('div',undefined,{class:'traffic-day'}),meter=el('meter',undefined,{min:0,max,value:r.pageviews,'aria-label':r.day+': '+r.pageviews+' visualizações'});line.append(el('span',r.day),meter,el('strong',String(r.pageviews)));bars.append(line)}traffic.append(bars,tableOf(['Dia','Visualizações','Sessões','Visitantes estimados'],d.daily.map(r=>[r.day,r.pageviews,r.sessions,r.visitors])))}
   if(d.pages.length)traffic.append(el('h3','Páginas mais acessadas'),tableOf(['Página','Visualizações'],d.pages.map(r=>[r.page,r.views])));
  }
 }
 $('dashboard-tables').replaceChildren(el('h3','Alunos por núcleo'),tableOf(['Núcleo','Alunos','Aprovados'],d.units.map(u=>[unitNames[u.unit]||u.unit,u.students,u.approved])),el('p',`${d.students} alunos no cadastro · ${d.documents} arquivos vinculados · ${d.registrations.period_received} inscrições recebidas no período.`));
}
async function registrations(){const request=Symbol(),status=$('registration-status').value,page=registrationPage;registrations.request=request;
 if(!$('registration-unit-filter')){
  const box=el('div',undefined,{id:'registration-unit-controls'});box.append(el('label','Núcleo dos candidatos',{for:'registration-unit-filter'}));const select=el('select',undefined,{id:'registration-unit-filter'}),units=['amavale','valparaiso','vale-do-carangola'].filter(u=>me.role==='admin'||me.units?.includes(u));select.append(el('option','Todos os núcleos autorizados',{value:''}));for(const u of units)select.append(el('option',unitNames[u],{value:u}));if(units.length===1)select.value=units[0];select.addEventListener('change',action(async()=>{registrationPage=0;$('registration-detail').hidden=true;await registrations()}));box.append(select);$('registration-status').before(box);
 }
 const unit=$('registration-unit-filter').value;
 const p=await api('/registrations?status='+status+'&page='+page+'&unit='+encodeURIComponent(unit)),box=$('registration-list');if(registrations.request!==request||$('registration-status').value!==status||registrationPage!==page||$('registration-unit-filter').value!==unit)return;box.replaceChildren();
 for(const r of p.registrations){const b=el('button',r.student_name+' · '+unitNames[r.unit]+' · '+new Date(r.created_at).toLocaleDateString('pt-BR'),{class:'registration-row secondary'});b.addEventListener('click',action(()=>review(r.id)));box.append(b)}
 if(!p.registrations.length)box.append(el('p','Nenhuma inscrição nesta situação.'));
 $('registration-page').textContent='Página '+(registrationPage+1);$('registrations-previous').disabled=registrationPage===0;$('registrations-next').disabled=!p.has_more;
 $('registrations-previous').dataset.locked=String(registrationPage===0);$('registrations-next').dataset.locked=String(!p.has_more);
}
async function registrationDocumentNoticeStatus(){
 if(!me||!['admin','secretary'].includes(me.role))return;
 let box=$('registration-document-notices');
 if(!box){box=el('details',undefined,{id:'registration-document-notices',class:'admin-card'});$('registration-protocol-search').after(box)}
 const request=Symbol();registrationDocumentNoticeStatus.request=request;
 box.replaceChildren(el('summary','Avisos automáticos de documentos'),el('p','Conferindo os avisos…',{role:'status'}));
 try{
  const data=await api('/registration-document-notices');if(registrationDocumentNoticeStatus.request!==request||!box.isConnected)return;
  box.replaceChildren(el('summary','Avisos automáticos de documentos'));
  box.append(el('p',data.configured?'Resumo diário a partir das 8h de Brasília. O sistema verifica a cada 5 minutos e envia uma vez por dia para cada secretaria com documentos pendentes.':'Envio automático indisponível. A administração precisa conferir o serviço de email.',{class:data.configured?'muted':'form-error'}),el('p','Remetente: '+data.sender));
  if(data.provider?.paused)box.append(el('p','Emails aguardando o limite do provedor. Nova tentativa a partir de '+new Date(data.provider.retry_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília). Os avisos permanecem na fila; continue trabalhando no painel.',{class:'form-error',role:'status'}));
  const states={pending:'Aguardando envio ou nova tentativa',sending:'Envio em processamento',accepted:'Aceito pelo serviço de email',failed:'Falha no envio — administração deve verificar',needs_attention:'Envio não confirmado — administração deve conferir antes de reenviar',cancelled:'Aviso cancelado porque os dados, o acesso ou a data mudaram'};
  for(const r of data.recipients){const card=el('div',undefined,{class:'document-notice-recipient'});card.append(el('strong',r.email),el('p',r.units.map(u=>unitNames[u]||u).join(', ')+' · '+r.pending_count+' inscrição(ões) com documentos pendentes.'));
   if(r.latest){card.append(el('p',(states[r.latest.state]||'Verificar envio')+' · resumo de '+r.latest.day.split('-').reverse().join('/'),{class:['failed','needs_attention'].includes(r.latest.state)?'form-error':'muted'}));if(r.latest.accepted_at)card.append(el('p','Aceito em '+new Date(r.latest.accepted_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+'. Aceitação não confirma entrega ou leitura.'));}
   else card.append(el('p','Ainda não há envio registrado para esta secretaria.'));
   box.append(card);
  }
  if(!data.recipients.length)box.append(el('p','Nenhuma secretaria ativa com núcleo autorizado foi encontrada. Confira Equipe e acessos.'));
  box.append(el('p','Inscrições completas, aprovadas ou não aprovadas deixam de entrar nos próximos resumos. Os avisos vão para a equipe; o contato com as famílias continua sendo feito pela secretaria.',{class:'muted'}));
 }catch{if(registrationDocumentNoticeStatus.request!==request||!box.isConnected)return;box.replaceChildren(el('summary','Avisos automáticos de documentos'),el('p','Não foi possível consultar os avisos. Tente atualizar.',{role:'alert',class:'form-error'}));}
 const refresh=el('button','Atualizar situação dos avisos',{type:'button',class:'secondary'});refresh.addEventListener('click',action(registrationDocumentNoticeStatus));box.append(refresh);
}
function setupRegistrationSearch(){
 if(!['admin','secretary'].includes(me.role)||$('registration-protocol-search'))return;
 const form=el('form',undefined,{id:'registration-protocol-search',class:'admin-card'});
 const input=field(form,'Buscar inscrição pelo protocolo','protocol','',{htmlId:'registration-protocol'});input.spellcheck=false;input.required=true;input.autocomplete='off';input.autocapitalize='none';input.maxLength=80;
 form.append(el('p','Cole o protocolo recebido por email. A busca inclui inscrições pendentes, aprovadas, em complementação ou não aprovadas nos núcleos que você pode acessar.',{class:'muted'}),el('button','Buscar protocolo',{type:'submit'}));
 form.addEventListener('submit',action(async()=>{const id=input.value.trim().toLowerCase(),box=$('registration-detail');box.hidden=true;box.replaceChildren();review.request=Symbol();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))throw Error('Cole o protocolo completo recebido por email (36 caracteres).');input.value=id;if(await review(id))notice('Inscrição localizada. Confira o nome, o núcleo e a situação da ficha abaixo.')}));
 $('registrations-area').querySelector('label[for="registration-status"]').before(form);
 openRegistrationLink();
}
function openRegistrationLink(){
 if(!me||!['admin','secretary'].includes(me.role)||!location.hash.startsWith('#registrations-area?'))return;
 const value=new URLSearchParams(location.hash.split('?')[1]).get('protocol'),form=$('registration-protocol-search');
 if(value===null||!form)return;
 $('registration-protocol').value=value;queueMicrotask(()=>{if(form.isConnected)form.requestSubmit()});
}
function registrationReviewSummary(box,r){
 const date=value=>value?new Date(value).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Não registrado';
 if(r.created_at)box.append(el('p','Inscrição recebida em '+date(r.created_at)+' (Brasília).'));
 if(r.birth_date)box.append(el('p','Nascimento: '+r.birth_date.split('-').reverse().join('/')));
 const readiness=r.readiness;
 if(readiness){
  box.append(el('h4','Autorização do responsável'));
  if(readiness.online_consent)box.append(el('p','Declarações de participação, atestado médico e tratamento dos dados aceitas no formulário pelo responsável informado. Versão: '+r.consent_version+'. Registradas em '+date(r.created_at)+'. O registro eletrônico não substitui a conferência da identidade e da responsabilidade legal.',{class:'form-success'}));
  else box.append(el('p',readiness.consent_attachment?'Comprovação de autorização anexada: confira o documento e a identidade do responsável.':'Comprovação da autorização ainda precisa ser anexada e conferida.',{class:readiness.consent_attachment?'muted':'form-error'}));
  if(r.status!=='approved')box.append(el('p',readiness.ready?'Anexos necessários recebidos. A aprovação exige conferência humana.':'Para concluir a análise, faltam: '+readiness.missing.join(', ')+'.',{class:readiness.ready?'form-success':'form-error'}));
 }
 if(r.reviewed_at)box.append(el('p','Última decisão registrada em '+date(r.reviewed_at)+' (Brasília).'));
 const status={pending:'Aviso por email aguardando envio ou nova tentativa automática.',sending:'Aviso por email em processamento.',accepted:'Aviso aceito pelo serviço de email. Isso não confirma leitura pela equipe.',failed:'Aviso por email não enviado. A administração deve verificar a configuração.',needs_attention:'O envio do aviso não pôde ser confirmado. A administração deve conferir o serviço de email antes de reenviar.'};
 if(r.notification)box.append(el('p',status[r.notification.state]||'Consulte a administração sobre o aviso por email.',{class:['failed','needs_attention'].includes(r.notification.state)?'form-error':'muted'}));
}
async function review(id){const request=Symbol(),box=$('registration-detail');review.request=request;
 if(!box)return false;box.hidden=false;box.dataset.registrationId=id;box.replaceChildren(el('p','Carregando inscrição…',{role:'status'}));
 if(typeof showPanel==='function')showPanel('registrations-area',{focus:false});
 let r;try{r=(await api('/registrations/'+id)).registration;}catch(error){if(review.request!==request)return false;box.replaceChildren();box.hidden=true;throw error;}
 if(review.request!==request||!box.isConnected)return false;
 box.dataset.registrationId=r.id;if($('registration-protocol'))$('registration-protocol').value=r.id;
 box.replaceChildren(el('h3',r.student_name),el('p',`${r.age} anos · ${unitNames[r.unit]} · ${decisionNames[r.status]}`),el('p','Protocolo: '+r.id,{class:'muted'}),el('p','Responsável: '+r.guardian_name+' · '+r.relationship),phoneContact(r.guardian_email+' · '+r.guardian_phone,r.guardian_phone,r.guardian_name));
 registrationReviewSummary(box,r);documentChecklist(box,r.documents,r);if(r.source==='staff'||r.source==='staff_draft')box.append(el('p','Origem: cadastro administrativo · '+r.source_reference));
 if(r.source==='staff_draft'&&r.status!=='approved'){
  const contact=el('form');contact.append(el('h4','Completar responsável do pré-cadastro'));
  for(const [key,label]of Object.entries({guardian_name:'Nome do responsável pelo pré-cadastro',guardian_email:'Email do responsável pelo pré-cadastro',guardian_phone:'Telefone do responsável pelo pré-cadastro',relationship:'Vínculo do responsável pelo pré-cadastro'}))field(contact,label,key,r[key],{type:key==='guardian_email'?'email':key==='guardian_phone'?'tel':'text'});
  contact.append(el('button','Salvar responsável do pré-cadastro'));
  contact.addEventListener('submit',action(async()=>{await api('/registrations/'+id+'/draft-contact',{method:'PATCH',data:{...Object.fromEntries(new FormData(contact)),version:r.version}});await review(id);notice('Contato salvo. Autorização e documentos precisam de conferência.')}));box.append(contact);
 }
 if(r.reason)box.append(el('p','Última decisão: '+r.reason));if(r.student_id){box.append(el('p','ID vinculado: '+r.student_id));const open=el('button','Abrir ficha do aluno aprovado');open.addEventListener('click',action(()=>detail(r.student_id)));box.append(open)}
 for(const d of r.documents){const b=el('button','Baixar '+(kinds[d.kind]||'documento'),{class:'secondary'});b.addEventListener('click',action(async()=>download(await api('/registrations/'+id+'/documents/'+d.id,{blob:true}),'inscricao-'+d.id+(d.mime==='application/pdf'?'.pdf':d.mime==='image/png'?'.png':'.jpg'))));box.append(b)}
 if(r.status!=='approved'){
  registrationUploader(box,id,r);
  const form=el('form');field(form,'Decisão','decision','needs_info',{options:['admin','secretary'].includes(me.role)?{needs_info:'Solicitar complementação',approved:'Aprovar candidato e gerar ID de aluno',rejected:'Não aprovar'}:{needs_info:'Solicitar complementação',rejected:'Não aprovar'}});
  if(r.readiness&&!r.readiness.ready){form.querySelector('option[value="approved"]')?.setAttribute('disabled','');form.append(el('p','A opção de aprovar ficará disponível após completar os documentos e a autorização. Você pode registrar a complementação agora.'));}
  form.append(el('p','Registrar complementação salva a pendência no painel. A equipe precisa comunicar o motivo à família pelo contato acima; esta decisão não envia mensagem automaticamente.',{class:'muted'}));
  const reason=field(form,'Motivo administrativo (obrigatório para complementação ou não aprovação)','reason','');reason.maxLength=500;
  form.append(el('p','ID automático: ao aprovar um novo aluno, o sistema gera o próximo número do núcleo. Não digite nem escolha um número. IDs já atribuídos são preservados.',{class:'form-success'}));
  const sameName=v=>v.normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim().replace(/\s+/g,' '),prefix={amavale:'UND1_',valparaiso:'UND2_',"vale-do-carangola":'UND3_'}[r.unit];
  const matches=students.filter(s=>s.id.startsWith(prefix)&&s.birth_date===r.birth_date&&sameName(s.name)===sameName(r.student_name)&&s.status==='approved');
  if(matches.length){form.append(el('p','Atenção: já existe cadastro com o mesmo nome, nascimento e núcleo. Confira o vínculo abaixo antes de aprovar para preservar o ID e o histórico.',{class:'form-error'}));const duplicate=el('details');duplicate.append(el('summary','Possível cadastro já existente — conferir antes de aprovar'),el('p','Somente use este vínculo após conferir que é a mesma pessoa. Ele preserva o ID existente.'));field(duplicate,'Vincular ao cadastro já existente','existing_student_id','',{options:{'':'Não vincular automaticamente',...Object.fromEntries(matches.map(s=>[s.id,s.name+' · '+s.id]))}});form.append(duplicate)}
  const label=el('label',undefined,{class:'check-label'}),check=el('input',undefined,{type:'checkbox',name:'checked'});label.append(check,document.createTextNode('Conferi os documentos, a identidade e o email do responsável e os requisitos do projeto. A aprovação vincula o acesso da conta de responsável à ficha. Perfis de equipe já existentes são preservados.'));form.append(label,el('button','Registrar decisão'));
  form.addEventListener('submit',action(async()=>{const values=Object.fromEntries(new FormData(form));values.version=r.version;values.checked=check.checked;const result=await api('/registrations/'+id+'/review',{method:'POST',data:values});await load();await review(id);notice(result.message+(result.student_id?' ID: '+result.student_id:''))}));box.append(form);
 }
 box.focus({preventScroll:true});box.scrollIntoView({behavior:'smooth',block:'start'});return true;
}
async function audit(){const {events}=await api('/audit');$('audit-list').replaceChildren(tableOf(['Data e hora','Autor','Ação','Aluno'],events.map(e=>[new Date(e.created_at).toLocaleString('pt-BR'),e.actor_email||e.actor,e.action,e.student_id])))}
document.addEventListener('portal:loaded',action(async()=>{
 const staff=['admin','secretary'].includes(me.role);for(const id of ['admin-nav','dashboard-area','registrations-area'])$(id).hidden=!staff;$('audit-area').hidden=me.role!=='admin';
 if(staff){setupRegistrationSearch();await dashboard();await registrations();await registrationDocumentNoticeStatus()}if(me.role==='admin')await audit();
}));
document.addEventListener('portal:logout',()=>{for(const id of ['dashboard-cards','traffic-summary','dashboard-tables','registration-list','registration-detail','audit-list'])$(id).replaceChildren();registrationPage=0;$('registration-unit-controls')?.remove();$('registration-protocol-search')?.remove();$('registration-document-notices')?.remove();registrationDocumentNoticeStatus.request=Symbol();review.request=Symbol()});
$('dashboard-days').addEventListener('change',action(dashboard));$('refresh-dashboard').addEventListener('click',action(dashboard));$('refresh-audit').addEventListener('click',action(audit));
$('registration-status').addEventListener('change',action(async()=>{registrationPage=0;await registrations()}));
$('registrations-previous').addEventListener('click',action(async()=>{if(registrationPage>0)registrationPage--;await registrations()}));
$('registrations-next').addEventListener('click',action(async()=>{registrationPage++;await registrations()}));
window.addEventListener('hashchange',openRegistrationLink);
