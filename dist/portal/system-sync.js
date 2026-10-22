import {createSyncController} from './sync-controller.js';
export function formSnapshot(form){return JSON.stringify(Array.from(form.elements).filter(e=>['INPUT','SELECT','TEXTAREA'].includes(e.tagName)||e.tagName==='BUTTON'&&e.hasAttribute('aria-pressed')).map(e=>[e.name,e.tagName==='BUTTON'?e.getAttribute('aria-pressed'):e.type==='checkbox'||e.type==='radio'?e.checked:e.type==='file'?Array.from(e.files||[]).map(f=>[f.name,f.size,f.lastModified]):e.value]))}
export function startSystemSync({api,refresh,active,el,hasDraft=()=>false,reload=()=>window.location.reload()}){
 const baselines=new Map();let timer,lastCheck=0,failures=0,banner;
 const snapshot=formSnapshot;
 const editableForm=target=>{const form=target?.closest?.('form');return form&&!form.closest('#login')&&form.isConnected?form:null};
 const isEditing=()=>{if(hasDraft())return true;for(const [form,old]of baselines){if(!form.isConnected||!form.querySelector('input,select,textarea,button[aria-pressed]')){baselines.delete(form);continue}if(snapshot(form)!==old)return true}return !!editableForm(document.activeElement)&&document.activeElement.matches('input:not([type=submit]):not([type=button]),select,textarea')};
 const message=text=>{if(!document.getElementById('workspace')||!active())return;if(!banner?.isConnected){banner=el('p','',{id:'system-sync-state',role:'status','aria-live':'polite',class:'form-success'});document.getElementById('identity')?.parentElement.after(banner)}banner.textContent=text};
 const readRevision=async()=>{const result=await api('/sync'),current=document.documentElement.dataset.portalRelease;
 if(current&&result.release&&current!==result.release){if(!document.getElementById('portal-release-notice')){const update=el('aside',undefined,{id:'portal-release-notice',role:'status','aria-live':'polite'}),button=el('button','Atualizar painel',{type:'button',class:'secondary'});update.append(el('strong','Nova versão do painel disponível'),el('p','Salve suas alterações e atualize para carregar as melhorias. Sua sessão será mantida nesta aba.'),button);button.addEventListener('click',reload);document.getElementById('identity')?.parentElement.after(update);}}
 else document.getElementById('portal-release-notice')?.remove();return result;};
 const controller=createSyncController({readRevision,refresh:async()=>{await refresh();baselines.clear()},isEditing,isActive:()=>active()&&document.visibilityState!=='hidden',onPending:()=>message('Há atualizações no sistema. Termine e salve sua edição; os dados serão atualizados automaticamente sem apagar o que você digitou.'),onUpdated:()=>{failures=0;message('Cadastros, autorizações e listas atualizados automaticamente às '+new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})+'.')},onError:()=>{if(++failures>=2)message('Não foi possível atualizar as listas agora. A próxima tentativa será automática; suas edições foram preservadas.')}});
 const check=force=>{if(!active()||!force&&Date.now()-lastCheck<5000)return;lastCheck=Date.now();void controller.poll()};
 const start=()=>{if(timer)return;check(true);timer=setInterval(()=>check(false),20000)};
 document.addEventListener('focusin',event=>{const form=editableForm(event.target);if(form&&!baselines.has(form))baselines.set(form,snapshot(form))});
 document.addEventListener('portal:action-complete',event=>{const form=event.detail?.form;if(form?.isConnected)baselines.set(form,snapshot(form));check(true)});
 document.addEventListener('portal:loaded',start);
 document.addEventListener('portal:logout',()=>{clearInterval(timer);timer=null;controller.reset();baselines.clear();banner?.remove();document.getElementById('portal-release-notice')?.remove();failures=0;lastCheck=0});
 window.addEventListener('focus',()=>check(false));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')check(false)});if(active())start();
}
