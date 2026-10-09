export async function mountAbsenceSettings({api,el,field,action,notice,onSaved},area){
 const box=el('details',undefined,{id:'absence-settings'});box.append(el('summary','Configurar limite de faltas consecutivas'));const body=el('div');box.append(body);area.prepend(box);
 let loaded=false;
 const load=async()=>{const {settings:s}=await api('/attendance-alerts/settings');if(!box.isConnected)return;body.replaceChildren();if(!s.can_edit)return;loaded=true;
  body.append(el('p','Esta regra vale para todos os núcleos. O valor padrão é 3; escolha o limite conforme o acompanhamento da equipe. Não é um diagnóstico nem um limite científico universal.'));
  const form=el('form'),input=field(form,'Faltas consecutivas sem justificativa','threshold',s.threshold,{type:'number',min:1,max:30,step:1});input.required=true;
  const reason=field(form,'Motivo da alteração','reason','');reason.required=true;reason.minLength=5;reason.maxLength=500;
  const preview=el('button','Conferir impacto',{type:'button',class:'secondary'}),result=el('div',undefined,{role:'status','aria-live':'polite'}),save=el('button','Salvar regra');save.disabled=true;save.dataset.locked='true';let previewToken='';
  const invalidate=()=>{previewToken='';save.disabled=true;save.dataset.locked='true';result.replaceChildren()};input.addEventListener('input',invalidate);
  preview.addEventListener('click',action(async()=>{if(!input.reportValidity())return;const threshold=Number(input.value),p=await api('/attendance-alerts/settings/preview',{method:'POST',data:{threshold,version:s.version}});if(Number(input.value)!==threshold||!box.isConnected)return;previewToken=p.preview_token;result.replaceChildren(el('p','Limite: '+p.before+' → '+p.after+' faltas. Alertas ativos previstos: '+p.impact.active_before+' → '+p.impact.active_after+'.'),el('p',p.message));save.disabled=false;save.dataset.locked='false'}));
  form.append(preview,result,save);form.addEventListener('submit',action(async()=>{if(!previewToken){notice('Confira o impacto antes de salvar.',true);return}const p=await api('/attendance-alerts/settings',{method:'PATCH',data:{threshold:Number(input.value),version:s.version,reason:reason.value,preview_token:previewToken}});await load();await onSaved();notice(p.message)}));body.append(form);
  const history=el('details');history.append(el('summary','Histórico das regras'));for(const h of s.history)history.append(el('p',new Date(h.created_at).toLocaleString('pt-BR')+' · '+h.before_threshold+' → '+h.after_threshold+' faltas · '+h.actor_email+' · '+h.reason));if(!s.history.length)history.append(el('p','Nenhuma alteração registrada.'));body.append(history);
 };
 box.addEventListener('toggle',action(async()=>{if(box.open&&!loaded)await load()}));
}
