'use strict';
function setupReportFields(form,kind){
 const groups=[['Contexto do relato',['location','teacher_present','monitor_present','activity','class_running','involved','witnesses']],['Lesão e atendimento',['linked_incident','symptoms','observed_limitations','space_checked','instructions_given','teacher_witnessed','class_stopped','onsite_care','care_provider','emergency_called','emergency_service','emergency_time','arrival_time','destination_companion','care_instructions','return_restrictions']],['Comunicação e acompanhamento',['coordination_contact','followup_owner','declarant','acknowledgments']]];
 const bool=['class_running','space_checked','instructions_given','teacher_witnessed','class_stopped','onsite_care','emergency_called'];let injuryGroup;
 for(const [title,keys]of groups){const block=el('details');block.open=title==='Contexto do relato';block.append(el('summary',title));if(title==='Lesão e atendimento')injuryGroup=block;for(const k of keys){const input=bool.includes(k)?field(block,reportFieldNames[k],'extra_'+k,'',{options:{'':'Selecione',Sim:'Sim',Não:'Não','Não informado':'Não informado'}}):longField(block,reportFieldNames[k],'extra_'+k,'');input.maxLength=1200;if(['location','activity','declarant'].includes(k))input.required=true}form.querySelector('button').before(block)}
 form.querySelector('button').before(el('p','O autor e a data do envio ficam registrados. Informe a ciência das demais pessoas somente quando ela tiver ocorrido. O nome digitado não substitui assinatura de outra pessoa.',{class:'muted'}));
 const toggle=()=>{injuryGroup.hidden=kind.value!=='injury';for(const input of injuryGroup.querySelectorAll('input,select,textarea'))input.disabled=injuryGroup.hidden};kind.addEventListener('change',toggle);toggle();
}
function reportPayload(form,id){const values=Object.fromEntries(new FormData(form)),details={};for(const k of Object.keys(values))if(k.startsWith('extra_')){details[k.slice(6)]=values[k];delete values[k]}return {...values,id,details}}
const reportFieldNames={
  "location": "Local exato / turma / aula",
  "teacher_present": "Professor presente",
  "monitor_present": "Monitor presente",
  "activity": "Atividade executada ou mecanismo observado",
  "class_running": "Havia aula em andamento?",
  "involved": "Pessoas envolvidas / códigos",
  "witnesses": "Testemunhas / contatos",
  "coordination_contact": "Coordenação avisada / horário / meio",
  "followup_owner": "Responsável pelo acompanhamento e prazo",
  "linked_incident": "Protocolo da ocorrência vinculada",
  "symptoms": "Sinais e sintomas relatados",
  "observed_limitations": "Limitação observada / gravidade aparente, sem diagnóstico",
  "space_checked": "Espaço avaliado?",
  "instructions_given": "Orientações de segurança dadas?",
  "teacher_witnessed": "Professor presenciou?",
  "class_stopped": "Aula interrompida?",
  "onsite_care": "Atendimento no local?",
  "care_provider": "Quem prestou atendimento?",
  "emergency_called": "Emergência acionada?",
  "emergency_service": "Serviço / protocolo de emergência",
  "emergency_time": "Horário do acionamento",
  "arrival_time": "Horário de chegada",
  "destination_companion": "Destino / acompanhante / horário de saída",
  "care_instructions": "Referência do atendimento e orientações recebidas",
  "return_restrictions": "Retorno / restrições / referência do documento profissional / data",
  "declarant": "Nome do relator responsável pelo registro",
  "acknowledgments": "Ciência do monitor, coordenação ou responsável (nome, data e meio)"
};
