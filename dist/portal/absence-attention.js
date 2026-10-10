import {watchAttention,createAttentionNotice} from './attention.js';
export function startAbsenceAttention({api,el,action,active,showPanel}){
 const banner=createAttentionNotice({id:'absence-banner',el,action});let area,last,rendered='';
 const units={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
 function update(data,stale=false){
  const alerts=data?.alerts||[],count=new Set(alerts.map(a=>a.student_id)).size;
  banner.update({count,stale,level:'urgent',title:stale?'Não foi possível atualizar os avisos de faltas':count?`${count} aluno(s) precisam de acompanhamento`:'Nenhum alerta ativo de faltas consecutivas',detail:stale?'A informação pode estar desatualizada. A próxima tentativa será automática.':`${data?.threshold||3} ou mais faltas consecutivas registradas. Confira os lançamentos e combine o apoio com a equipe.`,primary:stale?'Tentar atualizar':count?'Ver alunos e providências':null,open:stale?()=>watcher.refresh(true):()=>showPanel('absence-attention-area')});
 }
 const watcher=watchAttention({active,roles:['admin','secretary','teacher','psychologist','social_worker'],load:()=>api('/attendance-alerts/attention'),events:['portal:attendance-saved','portal:absence-followup-saved'],onData:data=>{
  last=data;update(data);const key=JSON.stringify(data);if(key===rendered&&area?.isConnected)return;rendered=key;
  if(!area?.isConnected){area=el('section',undefined,{id:'absence-attention-area'});document.getElementById('team-area').before(area)}
  area.replaceChildren(el('h2','Faltas consecutivas: apoio ao aluno'),el('p',`Regra do projeto: ${data.threshold} faltas sem justificativa seguidas na mesma turma. Presença, justificativa ou marcação desconhecida interrompem a sequência. Aula cancelada não conta. Confira os registros antes de entrar em contato.`));
  area.append(el('p','O aviso permanece durante o acompanhamento. Sai automaticamente quando há retorno, correção da sequência, matrícula inativa ou encerramento registrado pela equipe. O histórico permanece no relatório.'));
  if(!data.alerts.length)area.append(el('p','Nenhum alerta ativo nos seus núcleos e turmas.',{class:'form-success'}));
  for(const a of data.alerts){const card=el('article',undefined,{class:'report-record'});card.append(el('h3',a.name+' · '+a.student_id),el('p',units[a.unit]+' · '+a.label+' · '+a.streak+' faltas consecutivas'),el('p','Datas: '+a.evidence.map(e=>e.day.split('-').reverse().join('/')).join(', ')),el('p',a.workflow==='pending'?'A equipe ainda precisa registrar uma providência.':'Em acompanhamento pela equipe.'),el('p',a.next_contact?'Próxima revisão: '+a.next_contact.split('-').reverse().join('/'):'Sem próxima revisão agendada.'));
   if(active().role!=='teacher'){const b=el('button','Conferir contato e registrar providência',{type:'button',class:'secondary'});b.addEventListener('click',action(async()=>{showPanel('attendance-report-area');document.dispatchEvent(new CustomEvent('portal:open-absence-alert',{detail:{id:a.id}}))}));card.append(b)}
   else card.append(el('p','Confira suas chamadas e combine a providência com a secretaria. Os contatos e registros de acompanhamento são acessados pela equipe responsável.'));
   area.append(card);
  }
 },onError:()=>update(last,true),onLogout:()=>{banner.remove();area?.remove();area=last=null;rendered=''}});
 return watcher;
}
