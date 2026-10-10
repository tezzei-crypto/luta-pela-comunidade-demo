// Independent refresh: editing an attendance form must not freeze its warning.
export function watchAttention({active,roles,load,onData,onError,onLogout,events=[]}){
 let running=false,queued=false,epoch=0,timer,nextCheck=0,failures=0;
 const eligible=()=>roles.includes(active()?.role);
 async function refresh(force=false){
  if(!eligible()||document.visibilityState==='hidden'||!force&&Date.now()<nextCheck)return;
  if(running){queued=queued||force;return}
  const generation=epoch,identity=active()?.user_id||active()?.email;running=true;
  try{const data=await load();if(generation!==epoch||!eligible()||identity!==(active()?.user_id||active()?.email))return;failures=0;nextCheck=Date.now()+20000;onData(data)}
  catch(error){if(generation===epoch&&eligible()){nextCheck=Date.now()+Math.min(300000,20000*2**failures++);onError(error)}}
  finally{running=false;if(queued){queued=false;void refresh(true)}}
 }
 const start=()=>{if(!eligible())return;if(!timer)timer=setInterval(()=>void refresh(),20000);void refresh(true)};
 document.addEventListener('portal:loaded',start);
 for(const event of events)document.addEventListener(event,()=>void refresh(true));
 document.addEventListener('portal:logout',()=>{epoch++;queued=false;clearInterval(timer);timer=null;nextCheck=failures=0;onLogout()});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refresh(true)});
 window.addEventListener('focus',()=>void refresh());
 if(eligible())start();return {refresh};
}

export function createAttentionNotice({id,el,action}){
 let box,live,fingerprint='',lastCount=0;
 function update({count=0,title,detail='',items=[],primary,open,secondary,openAll,level='warning',stale=false}){
  if(!box?.isConnected){
   box=el('aside',undefined,{id,class:'attention-notice','aria-labelledby':id+'-title',hidden:''});
   live=el('p','',{class:'attention-announcer',role:'status','aria-live':'polite','aria-atomic':'true'});
   document.getElementById('identity').parentElement.after(box,live);
  }
  const key=JSON.stringify({count,title,detail,items,primary,secondary,level,stale});if(key===fingerprint)return;fingerprint=key;
  box.hidden=!count&&!stale;
  if(box.hidden){if(lastCount)live.textContent='Aviso encerrado: '+title;lastCount=0;return}
  lastCount=count;box.className='attention-notice attention-'+(stale?'unknown':level);
  const head=el('div',undefined,{class:'attention-heading'}),number=el('strong',stale?'!':String(count),{'aria-hidden':'true',class:'attention-count'});
  head.append(number,el('h2',title,{id:id+'-title'}));box.replaceChildren(head,el('p',detail));
  if(items.length){const list=el('ul');for(const text of items)list.append(el('li',text));box.append(list)}
  const actions=el('div',undefined,{class:'attention-actions'});
  for(const [text,fn]of [[primary,open],[secondary,openAll]])if(text&&fn){const b=el('button',text,{type:'button',class:'secondary'});b.addEventListener('click',action(fn));actions.append(b)}
  box.append(actions);live.textContent=title+'. '+detail;
 }
 return {update,remove(){box?.remove();live?.remove();box=live=null;fingerprint='';lastCount=0}};
}
