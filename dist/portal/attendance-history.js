export function mountAttendanceHistory({api,el,action},container,classId){
 const names={unmarked:'Não marcado',present:'Presente',absent:'Faltou',justified:'Justificada'};
 const roles={teacher:'Professor',admin:'Administrador',secretary:'Secretaria'};
 const details=el('details'),list=el('div'),more=el('button','Carregar histórico',{type:'button',class:'secondary'});
 details.append(el('summary','Quem lançou as presenças? Ver histórico'),el('p','Cada alteração registra a conta responsável e o horário de Brasília. Registros anteriores à implantação mostram somente a última alteração conhecida; não reconstruímos correções antigas.'),list,more);container.append(details);
 let before=null,loading=false,loaded=false;
 const load=async()=>{if(loading)return;loading=true;more.disabled=true;try{
  const data=await api('/classes/'+classId+'/attendance-history'+(before?'?before='+before:''));if(!container.isConnected)return;
  for(const r of data.changes){const card=el('article',undefined,{class:'report-record'});card.append(el('strong',r.student_name+' · '+r.student_id),el('p',r.kind==='baseline'?'Registro anterior: '+names[r.status]:(names[r.previous_status]||'Não marcado')+' → '+names[r.status]),el('p','Por '+r.actor_name+' · '+(roles[r.actor_role]||r.actor_role)),el('p',new Date(r.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})+' (Brasília) · versão '+r.version));list.append(card)}
  if(!loaded&&!data.changes.length)list.append(el('p','Nenhum lançamento registrado nesta chamada.'));loaded=true;before=data.next_before;more.hidden=!before;more.textContent='Carregar alterações anteriores';
 }finally{loading=false;more.disabled=false}};
 more.addEventListener('click',action(load));details.addEventListener('toggle',()=>{if(details.open&&!loaded)action(load)()});
}
