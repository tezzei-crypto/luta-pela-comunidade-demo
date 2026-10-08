'use strict';
(()=>{
 let page=0,settings=null,box,list,feedback,previous,next,filter,code,days;
 async function refresh(){
  const p=await api('/diagnostics?'+new URLSearchParams({page,support_id:code.value.trim().toLowerCase(),kind:filter.value}));
  settings=p.settings;days.value=String(settings.retention_days);list.replaceChildren();
  if(filter.options.length===1)for(const [value,[label]]of Object.entries(p.kinds))filter.append(el('option',label,{value}));
  feedback.textContent=`Página ${page+1}. Registros mantidos por ${settings.retention_days} dias, até 10 mil eventos. Horários de Brasília.`;
  if(!p.events.length)list.append(el('p','Nenhum registro encontrado. Os logs começam nesta atualização; não recuperam tentativas anteriores.'));
  for(const event of p.events){const card=el('article',undefined,{class:'admin-card'});card.append(el('h3',event.title),el('p',new Date(event.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})),el('p','Código de atendimento: '+event.support_id),el('p',`Origem: ${event.source==='browser'?'relato do navegador (causa não confirmada)':'servidor'} · Operação: ${{registration:'Inscrição',sponsorship:'Patrocínio',appointment:'Agendamento',portal:'Painel',login:'Login',site:'Site'}[event.operation]} · HTTP: ${event.status||'sem resposta'} · Duração: ${event.duration_ms} ms`),el('p',event.guidance));if(event.release)card.append(el('p','Versão: '+event.release));list.append(card)}
  previous.disabled=page===0;next.disabled=!p.has_more;previous.dataset.locked=String(page===0);next.dataset.locked=String(!p.has_more);
 }
 function setup(){
  if(me?.role!=='admin'){box?.remove();box=null;return;}
  if(box)return;
  box=el('section',undefined,{id:'diagnostics-area',class:'workspace-panel'});box.append(el('h2','Diagnóstico de erros'),el('p','Consulte o código informado pelo usuário. Os registros não incluem nomes, emails, documentos, senhas, códigos de login ou o conteúdo dos formulários. Um relato de conexão do navegador não prova a causa da falha.'));
  const form=el('form'),codeLabel=el('label','Código de atendimento'),kindLabel=el('label','Tipo de ocorrência');code=el('input',undefined,{type:'text',placeholder:'Cole o código exibido na mensagem',maxlength:'36',pattern:'[0-9a-fA-F-]{36}'});filter=el('select');filter.append(el('option','Todos os tipos',{value:''}));codeLabel.append(code);kindLabel.append(filter);form.append(codeLabel,kindLabel,el('button','Consultar registros',{type:'submit'}));form.addEventListener('submit',action(async()=>{page=0;await refresh()}));
  feedback=el('p','',{role:'status'});list=el('div');previous=el('button','Página anterior',{type:'button',class:'secondary'});next=el('button','Próxima página',{type:'button',class:'secondary'});previous.addEventListener('click',action(async()=>{page=Math.max(0,page-1);await refresh()}));next.addEventListener('click',action(async()=>{page++;await refresh()}));
  const retention=el('form'),label=el('label','Manter registros por');days=el('select');for(const n of [7,30,90])days.append(el('option',n+' dias',{value:String(n)}));label.append(days);retention.append(label,el('p','Ao reduzir o prazo, os registros antigos são removidos automaticamente. O histórico administrativo é separado.'),el('button','Salvar prazo',{type:'submit',class:'secondary'}));retention.addEventListener('submit',action(async()=>{if(!settings)throw Error('Aguarde a consulta dos registros antes de salvar.');await api('/diagnostics/settings',{method:'PATCH',data:{retention_days:Number(days.value),version:settings.version}});await refresh();notice('Prazo dos registros atualizado.')}));
  box.append(form,feedback,list,previous,next,retention);$('workspace').append(box);void refresh().catch(e=>{feedback.textContent=e.message});
 }
 document.addEventListener('portal:loaded',setup);document.addEventListener('portal:logout',()=>{box?.remove();box=null;page=0;settings=null});if(typeof me!=='undefined'&&me)setup();
})();
