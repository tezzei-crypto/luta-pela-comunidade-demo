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
async function registrations(){
 const p=await api('/registrations?status='+$('registration-status').value+'&page='+registrationPage),box=$('registration-list');box.replaceChildren();
 for(const r of p.registrations){const b=el('button',r.student_name+' · '+unitNames[r.unit]+' · '+new Date(r.created_at).toLocaleDateString('pt-BR'),{class:'registration-row secondary'});b.addEventListener('click',action(()=>review(r.id)));box.append(b)}
 if(!p.registrations.length)box.append(el('p','Nenhuma inscrição nesta situação.'));
 $('registration-page').textContent='Página '+(registrationPage+1);$('registrations-previous').disabled=registrationPage===0;$('registrations-next').disabled=!p.has_more;
 $('registrations-previous').dataset.locked=String(registrationPage===0);$('registrations-next').dataset.locked=String(!p.has_more);
}
async function review(id){
 const r=(await api('/registrations/'+id)).registration,box=$('registration-detail');box.hidden=false;box.replaceChildren(el('h3',r.student_name),el('p',`${r.age} anos · ${unitNames[r.unit]} · ${decisionNames[r.status]}`),el('p','Protocolo: '+r.id,{class:'muted'}),el('p','Responsável: '+r.guardian_name+' · '+r.relationship),el('p',r.guardian_email+' · '+r.guardian_phone));
 if(r.reason)box.append(el('p','Última decisão: '+r.reason));if(r.student_id)box.append(el('p','ID vinculado: '+r.student_id));
 for(const d of r.documents){const b=el('button','Baixar '+(kinds[d.kind]||'documento'),{class:'secondary'});b.addEventListener('click',action(async()=>download(await api('/registrations/'+id+'/documents/'+d.id,{blob:true}),'inscricao-'+d.id+(d.mime==='application/pdf'?'.pdf':d.mime==='image/png'?'.png':'.jpg'))));box.append(b)}
 if(r.status!=='approved'){
  const form=el('form');field(form,'Decisão','decision','needs_info',{options:{needs_info:'Solicitar complementação',approved:'Aprovar cadastro',rejected:'Não aprovar'}});
  const reason=field(form,'Motivo administrativo (obrigatório para complementação ou não aprovação)','reason','');reason.maxLength=500;
  const existing=field(form,'ID já existente — preencha somente se for o mesmo aluno','existing_student_id','');existing.maxLength=11;existing.placeholder='UND1_000002';
  form.append(el('p','Antes de criar um novo ID, confira se o aluno já está cadastrado. Vincular um ID existente exige conferir que se trata da mesma pessoa.',{class:'muted'}));
  const label=el('label',undefined,{class:'check-label'}),check=el('input',undefined,{type:'checkbox',name:'checked'});label.append(check,document.createTextNode('Conferi os documentos, a identidade e o email do responsável e os requisitos do projeto. A aprovação habilita esse email para acessar somente a ficha vinculada.'));form.append(label,el('button','Registrar decisão'));
  form.addEventListener('submit',action(async()=>{const values=Object.fromEntries(new FormData(form));values.version=r.version;values.checked=check.checked;const result=await api('/registrations/'+id+'/review',{method:'POST',data:values});await load();await review(id);notice(result.message+(result.student_id?' ID: '+result.student_id:''))}));box.append(form);
 }
 box.focus();
}
async function audit(){const {events}=await api('/audit');$('audit-list').replaceChildren(tableOf(['Data e hora','Autor','Ação','Aluno'],events.map(e=>[new Date(e.created_at).toLocaleString('pt-BR'),e.actor_email||e.actor,e.action,e.student_id])))}
document.addEventListener('portal:loaded',action(async()=>{
 const staff=['admin','secretary'].includes(me.role);for(const id of ['admin-nav','dashboard-area','registrations-area'])$(id).hidden=!staff;$('audit-area').hidden=me.role!=='admin';
 if(staff){await dashboard();await registrations()}if(me.role==='admin')await audit();
}));
document.addEventListener('portal:logout',()=>{for(const id of ['dashboard-cards','traffic-summary','dashboard-tables','registration-list','registration-detail','audit-list'])$(id).replaceChildren();registrationPage=0});
$('dashboard-days').addEventListener('change',action(dashboard));$('refresh-dashboard').addEventListener('click',action(dashboard));$('refresh-audit').addEventListener('click',action(audit));
$('registration-status').addEventListener('change',action(async()=>{registrationPage=0;await registrations()}));
$('registrations-previous').addEventListener('click',action(async()=>{if(registrationPage>0)registrationPage--;await registrations()}));
$('registrations-next').addEventListener('click',action(async()=>{registrationPage++;await registrations()}));
