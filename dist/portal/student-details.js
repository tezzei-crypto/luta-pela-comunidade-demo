'use strict';
async function showStudentContact(id,box){
 await showStudentProgression(id,box);
 const {contact:c}=await api('/students/'+id+'/contact'),form=el('form'),staff=['admin','secretary'].includes(me.role);form.append(el('h3','Responsável e contato'));
 for(const [name,label]of Object.entries({guardian_name:'Nome do responsável',relationship:'Vínculo com o aluno',guardian_email:'Email de contato',guardian_phone:'Telefone / WhatsApp'}))field(form,label,name,c[name],{type:name==='guardian_email'?'email':name==='guardian_phone'?'tel':'text',readOnly:!staff});
 if(staff){form.append(el('p','Complete os dados que não constavam da planilha. O email de contato não concede acesso: a conta e os vínculos são geridos em Contas e vínculos.',{class:'muted'}),el('button','Salvar contato'));form.addEventListener('submit',action(async()=>{const p=await api('/students/'+id+'/contact',{method:'PATCH',data:{...Object.fromEntries(new FormData(form)),version:c.version}});await detail(id);notice(p.message)}))}box.append(form);
}
async function showStudentProgression(id,box){
 const {progression:r}=await api('/students/'+id+'/progression'),p=r.profile,staff=['admin','secretary'].includes(me.role),section=el('section',undefined,{'aria-label':'Frequência e graduação',class:'student-progression'}),grid=el('div',undefined,{class:'progression-summary'});
 const dayLabel=value=>value?value.split('-').reverse().join('/'):'Não cadastrada';
 section.append(el('h3','Frequência e graduação'));
 for(const [label,value]of [['Presenças',r.totals.present],['Faltas sem justificativa',r.totals.absent],['Faltas justificadas',r.totals.justified],['Aulas sem chamada concluída',r.totals.unmarked],['Faixa atual',p.belt||'Não cadastrada'],['Graus confirmados',p.version?p.degrees+' de 4':'Não cadastrados']]){const card=el('div',undefined,{class:'info-box'});card.append(el('strong',String(value)),el('p',label));grid.append(card)}
 section.append(grid,el('p','Totais de todas as chamadas registradas até hoje. Aulas canceladas não contam como presença nem falta.',{class:'muted'}));
 if(p.version){
  section.append(el('p','Última graduação: '+dayLabel(p.last_graduation_date)),el('p',r.cycle.present+' presenças desde a última graduação · '+r.cycle.absent+' faltas · '+r.cycle.justified+' justificadas.'));
  if(r.exam_ready)section.append(el('strong','Quatro graus confirmados: apto para solicitar o exame de faixa.'));
  else {
   section.append(el('p',r.degree_ready?'Meta atingida: próximo grau aguardando confirmação da equipe.':`Faltam ${r.remaining_for_degree} aulas com presença para o próximo grau.`));
   section.append(el('progress',String(Math.min(r.cycle.present,r.policy.lessons_per_degree)),{value:Math.min(r.cycle.present,r.policy.lessons_per_degree),max:r.policy.lessons_per_degree,'aria-label':'Presenças para o próximo grau'}));
   section.append(el('p',`Até o exame: pelo menos ${r.remaining_for_exam} novas aulas com presença e a confirmação dos ${4-p.degrees} graus restantes.`));
  }
  section.append(el('p',`Regra do projeto: ${r.policy.lessons_per_degree} presenças por grau; 4 graus confirmados para solicitar o exame. A equipe confirma a graduação. Ao registrar um grau, a contagem recomeça após a data escolhida.`,{class:'muted'}));
 }else section.append(el('p','Cadastre a faixa, os graus e a data da última graduação para iniciar a contagem. As presenças anteriores continuam no histórico.'));
 const history=el('details');history.append(el('summary','Ver histórico de presenças e faltas'));
 const table=el('table'),thead=el('thead'),header=el('tr'),tbody=el('tbody');for(const text of ['Data','Turma / horário','Situação'])header.append(el('th',text,{scope:'col'}));thead.append(header);table.append(thead,tbody);
 const labels={present:'Presente',absent:'Falta',justified:'Falta justificada',unmarked:'Sem marcação'};
 for(const row of r.attendance){const tr=el('tr');for(const text of [dayLabel(row.day),row.label+' · '+row.time,row.cancelled?'Aula cancelada':labels[row.status]])tr.append(el('td',text));tbody.append(tr)}
 const scroll=el('div',undefined,{class:'scroll',tabindex:'0','aria-label':'Histórico de frequência'});scroll.append(table);history.append(scroll);
 if(!r.attendance.length)history.append(el('p','Nenhuma chamada registrada para este aluno.'));
 if(r.attendance_count>200)history.append(el('p','Exibindo as 200 aulas mais recentes. Os totais consideram todas as aulas registradas.'));
 section.append(history);
 const belts=Object.fromEntries(['Branca','Cinza e branca','Cinza','Cinza e preta','Amarela e branca','Amarela','Amarela e preta','Laranja e branca','Laranja','Laranja e preta','Verde e branca','Verde','Verde e preta','Azul','Roxa','Marrom','Preta'].map(x=>[x,x]));
 function checked(form,text){const label=el('label',undefined,{class:'check-label'}),input=el('input',undefined,{type:'checkbox',required:''});label.append(input,document.createTextNode(text));form.append(label);return input}
 if(staff){
  const edit=el('details');edit.open=!p.version;edit.append(el('summary',p.version?'Corrigir faixa, graus ou data de referência':'Cadastrar faixa e graus'));
  const form=el('form');field(form,'Faixa atual','belt',p.belt,{options:{'':'Selecione a faixa',...belts}}).required=true;
  field(form,'Graus já confirmados','degrees',p.degrees,{type:'number',min:0,max:4,step:1}).required=true;
  field(form,'Data da última graduação','last_graduation_date',p.last_graduation_date,{type:'date'}).required=true;
  field(form,p.version?'Motivo da correção':'Referência da graduação ou do cadastro inicial','reason','').required=true;
  form.append(el('p','Somente presenças em datas posteriores à última graduação entram no ciclo. Alterar esses dados recalcula a sugestão e fica no histórico.',{class:'muted'}));
  const confirm=checked(form,'Conferi a faixa, os graus e a data com os registros do aluno.');form.append(el('button','Salvar faixa e graus'));
  form.addEventListener('submit',action(async()=>{const data=Object.fromEntries(new FormData(form));const result=await api('/students/'+id+'/progression',{method:'PATCH',data:{...data,degrees:Number(data.degrees),version:p.version,checked:confirm.checked}});await detail(id);notice(result.message)}));edit.append(form);section.append(edit);
  if(r.degree_ready||r.exam_ready){const award=el('details');award.append(el('summary',r.exam_ready?'Registrar aprovação no exame de faixa':'Confirmar próximo grau'));
   const f=el('form'),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
   field(f,'Data da graduação','date',today,{type:'date'}).required=true;
   if(r.exam_ready)field(f,'Nova faixa após aprovação no exame','belt','',{options:{'':'Selecione a nova faixa',...belts}}).required=true;
   field(f,'Responsável pela avaliação e referência','reason','').required=true;
   const ok=checked(f,r.exam_ready?'Confirmo que o aluno foi aprovado no exame e recebeu a nova faixa.':'Confirmo a concessão de um grau após avaliação da equipe.');
   f.append(el('p','O novo ciclo começa após esta data. Aulas posteriores já registradas permanecem no novo ciclo.',{class:'muted'}),el('button',r.exam_ready?'Confirmar nova faixa':'Confirmar um grau'));
   f.addEventListener('submit',action(async()=>{const data=Object.fromEntries(new FormData(f));const result=await api('/students/'+id+'/progression/confirm',{method:'POST',data:{...data,action:r.exam_ready?'belt':'degree',version:p.version,policy_version:r.policy.version,checked:ok.checked}});await detail(id);notice(result.message)}));award.append(f);section.append(award);
  }
  const settings=el('details'),f=el('form');settings.append(el('summary','Configurar regra de graduação do projeto'));
  f.append(el('p','Esta alteração vale para todos os alunos. Mantém as faixas e graus já confirmados e recalcula as sugestões dos ciclos em andamento.'));
  field(f,'Aulas com presença para cada grau','lessons_per_degree',r.policy.lessons_per_degree,{type:'number',min:1,max:500,step:1}).required=true;field(f,'Motivo da alteração da regra','reason','').required=true;f.append(el('button','Salvar regra do projeto'));
  f.addEventListener('submit',action(async()=>{const data=Object.fromEntries(new FormData(f));const result=await api('/graduation-policy',{method:'PATCH',data:{...data,lessons_per_degree:Number(data.lessons_per_degree),version:r.policy.version}});await detail(id);notice(result.message)}));settings.append(f);section.append(settings);
 }
 if(r.history.length){const h=el('details');h.append(el('summary','Histórico de graduações e correções'));const list=el('ul');for(const entry of r.history)list.append(el('li',`${dayLabel(entry.after.last_graduation_date)} — ${entry.after.belt}, ${entry.after.degrees} grau(s) · ${{initial:'Cadastro inicial',correction:'Correção administrativa',degree:'Grau confirmado',belt:'Nova faixa'}[entry.action]||entry.action}`));h.append(list);section.append(h)}
 box.append(section);
}
function documentChecklist(box,documents){const area=el('div',undefined,{class:'document-checklist'});for(const [k,name]of Object.entries(kinds)){if(me.role==='psychologist'&&!['photo','report_card','medical_certificate'].includes(k)||me.role==='social_worker'&&!['photo','report_card','consent'].includes(k))continue;const count=documents.filter(d=>d.kind===k).length;area.append(el('p',name+' — '+(count?`${count} arquivo(s) enviado(s)`:'Ainda não enviado'),{class:count?'received':'missing'}))}box.append(area,el('p','Arquivo enviado não significa documento conferido. Confira os anexos antes de decidir a inscrição.',{class:'muted'}))}
function registrationUploader(box,id,r){const form=el('form');form.append(el('h4','Anexar documentos restantes do candidato'));field(form,'Categoria do anexo','kind','photo',{options:kinds});const file=field(form,'Arquivo do candidato (PDF, JPG ou PNG, até 5 MB)','file','',{type:'file'});file.accept='.pdf,.jpg,.jpeg,.png';file.required=true;form.append(el('button','Enviar documento do candidato'));form.addEventListener('submit',action(async()=>{const data=new FormData(form);data.set('version',r.version);const p=await api('/registrations/'+id+'/documents',{method:'POST',form:data});await review(id);notice(p.message)}));box.append(form)}
function setupManualRegistration(){if($('manual-prospect'))return;const button=el('button','Cadastrar candidato recebido por email ou presencialmente',{class:'secondary'}),box=el('section',undefined,{id:'manual-prospect',hidden:''});$('registrations-area').querySelector('h2').after(button,box);button.addEventListener('click',()=>{box.hidden=!box.hidden;if(!box.hidden)box.scrollIntoView({behavior:'smooth',block:'start'})});box.append(el('h3','Novo candidato — pendente de aprovação'),el('p','Use os dados da ficha recebida e mantenha a comprovação das declarações. O cadastro fica pendente e não recebe ID de aluno até a aprovação do administrador.'));
 const form=el('form');field(form,'Nome completo do candidato','student_name','').required=true;field(form,'Nascimento do candidato','birth_date','',{type:'date'}).required=true;field(form,'Núcleo solicitado','unit','amavale',{options:classUnits});
 for(const [k,label]of Object.entries({guardian_name:'Responsável pelo candidato',guardian_email:'Email do responsável pelo candidato',guardian_phone:'Telefone do responsável pelo candidato',relationship:'Vínculo do responsável',source_reference:'Referência da ficha original ou protocolo do email',consent_version:'Versão/data das declarações aceitas na ficha original'}))field(form,label,k,'',{type:k==='guardian_email'?'email':k==='guardian_phone'?'tel':'text'}).required=true;
 const label=el('label',undefined,{class:'check-label'}),check=el('input',undefined,{type:'checkbox'});check.required=true;label.append(check,document.createTextNode('Conferi a origem da ficha e o registro das declarações aceitas pelo responsável.'));form.append(label,el('button','Salvar candidato pendente'));let id=crypto.randomUUID();form.addEventListener('input',()=>id=crypto.randomUUID());form.addEventListener('submit',action(async()=>{const p=await api('/registrations',{method:'POST',data:{...Object.fromEntries(new FormData(form)),id,checked:check.checked}});id=crypto.randomUUID();form.reset();box.hidden=true;$('registration-status').value='pending';registrationPage=0;await load();await review(p.id);notice(p.message)}));box.append(form);
}
document.addEventListener('portal:loaded',()=>{if(['admin','secretary'].includes(me.role)){setupManualRegistration();if(!$('contacts-export')){const b=el('button','Baixar contatos CSV',{id:'contacts-export'});$('export').after(b);b.addEventListener('click',action(async()=>download(await api('/contacts.csv',{blob:true}),'contatos-restritos.csv')))}}});
document.addEventListener('portal:logout',()=>{$('manual-prospect')?.previousElementSibling?.remove();$('manual-prospect')?.remove();$('contacts-export')?.remove()});
