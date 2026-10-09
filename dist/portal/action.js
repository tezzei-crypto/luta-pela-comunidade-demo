function createPortalAction({notice,el}){
 const pending=new WeakSet();
 return fn=>async event=>{
  event?.preventDefault();const target=event?.currentTarget,form=target?.matches?.('form')?target:null;
  if(target&&pending.has(target))return;if(target)pending.add(target);
  form?.querySelector('[data-form-feedback]')?.remove();
  const button=form?(event.submitter||form.querySelector('button:not([type]),button[type=submit]')):target;
  let controls=[];
  try{
   if(button?.tagName==='BUTTON')button.disabled=true;
   // Let the handler capture FormData before disabling controls (disabled fields are omitted).
   const task=fn(event);
   if(form){controls=[...form.querySelectorAll('input,select,textarea,button')].filter(e=>e!==button).map(e=>[e,e.disabled]);controls.forEach(([e])=>e.disabled=true);form.setAttribute('aria-busy','true')}
   await task;document.dispatchEvent(new CustomEvent('portal:action-complete',{detail:{form}}));
  }catch(e){notice(e.message,true);if(form?.isConnected){const feedback=el('p',e.message,{class:'form-error',role:'alert',tabindex:'-1','data-form-feedback':''});form.append(feedback);feedback.focus({preventScroll:true});feedback.scrollIntoView({block:'nearest'})}}
  finally{controls.forEach(([e,disabled])=>{if(e.isConnected)e.disabled=disabled||e.dataset.locked==='true'});form?.removeAttribute('aria-busy');if(button?.tagName==='BUTTON')button.disabled=button.dataset.locked==='true';if(target)pending.delete(target)}
 };
}
