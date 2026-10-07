// Métricas opcionais, apenas das páginas públicas e sem conteúdo dos formulários.
(()=>{
 const pages=['/','/inscricao/','/agendamento/','/patrocinar/','/unidades/amavale/','/unidades/valparaiso/','/unidades/vale-do-carangola/'];
 const page=location.pathname.endsWith('/')?location.pathname:location.pathname+'/';
 if(!pages.includes(page)||navigator.globalPrivacyControl===true||navigator.doNotTrack==='1')return;
 const prefKey='lpc:metrics-choice:v1',visitorKey='lpc:metrics-visitor:v1',sessionKey='lpc:metrics-session:v1';
 const read=(storage,key)=>{try{return JSON.parse(storage.getItem(key))}catch{return null}};
 const write=(storage,key,value)=>{try{storage.setItem(key,JSON.stringify(value));return true}catch{return false}};
 let sent=false;
 async function record(){
  if(sent||document.visibilityState!=='visible')return;
  const choice=read(localStorage,prefKey);if(choice?.value!=='yes'||choice.until<Date.now())return;
  const now=Date.now();let visitor=read(localStorage,visitorKey),session=read(sessionStorage,sessionKey);
  if(!visitor||visitor.until<now){visitor={id:crypto.randomUUID(),until:now+30*86400000};if(!write(localStorage,visitorKey,visitor))return}
  if(!session||now-session.last>30*60000)session={id:crypto.randomUUID(),last:now};session.last=now;if(!write(sessionStorage,sessionKey,session))return;
  sent=true;await fetch('/api/metrics',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({page,eventId:crypto.randomUUID(),sessionId:session.id,visitorId:visitor.id,consent:true}),keepalive:true}).catch(()=>{});
 }
 function options(){
  if(document.getElementById('metrics-choice'))return;
  const panel=document.createElement('section');panel.id='metrics-choice';panel.setAttribute('aria-label','Preferências de estatísticas');
  const p=document.createElement('p');p.textContent='Você permite estatísticas de navegação para melhorar o projeto? Contamos páginas, sessões e navegadores com identificadores aleatórios. Não coletamos nomes, dados dos formulários ou documentos. Sua escolha não afeta inscrições ou atendimento.';panel.append(p);
  for(const [label,value]of [['Permitir estatísticas','yes'],['Continuar sem estatísticas','no']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{write(localStorage,prefKey,{value,until:Date.now()+180*86400000});if(value==='no'){try{localStorage.removeItem(visitorKey);sessionStorage.removeItem(sessionKey)}catch{}}panel.remove();if(value==='yes')record()});panel.append(b)}
  (document.querySelector('footer')||document.body).append(panel);
 }
 fetch('/api/metrics-status',{cache:'no-store'}).then(r=>r.json()).then(p=>{
  if(!p.enabled)return;const link=document.createElement('button');link.type='button';link.className='metrics-settings';link.textContent='Preferências de estatísticas';link.addEventListener('click',options);(document.querySelector('footer')||document.body).append(link);
  const choice=read(localStorage,prefKey);if(!choice||choice.until<Date.now())options();else if(choice.value==='yes')record();
  document.addEventListener('visibilitychange',record);
 }).catch(()=>{});
})();
