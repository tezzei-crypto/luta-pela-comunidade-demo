const requests=[];
window.fetch=async(url,options={})=>{
 if(url==='/api/diagnostics')return Response.json({ok:true});
 if(!['/api/agenda','/api/agenda/slots'].includes(url))throw Error('Rede externa bloqueada no teste');
 return new Promise((resolve,reject)=>requests.push({url,data:JSON.parse(options.body),resolve,reject}));
};
const {mountAppointmentForm}=await import('/appointment-form.js');
const {mountCalendar}=await import('/portal/calendar.js');
const assert=(v,message)=>{if(!v)throw Error(message)};
const settle=async predicate=>{const until=Date.now()+2500;while(!predicate()){if(Date.now()>until)throw Error('Condição não atendida no prazo do teste');await new Promise(r=>setTimeout(r,5))}};
const change=(e,value,type='change')=>{e.value=value;e.dispatchEvent(new Event(type,{bubbles:true}))};
const submit=form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const day=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const slot={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',version:1,unit:'amavale',modality:'online',professional_name:'Profissional fictício',start_at:day+'T16:10:00Z',end_at:day+'T17:10:00Z'};
const fresh=()=>{requests.length=0;mountAppointmentForm('UND2_000001');return document.querySelector('form')};
async function ready(){const f=fresh(),v=f.elements;v.contactName.value='Responsável fictício';v.phone.value='21999999999';v.consent.checked=true;change(v.service,'Assistência social');requests[0].resolve(Response.json({slots:[slot]}));await settle(()=>v.slotId.options.length===2);change(v.slotId,slot.id);return f}
let passed=0,failed=0;
async function test(name,fn){const li=document.createElement('li');document.querySelector('#audit-results').append(li);try{await fn();passed++;li.textContent='PASSOU · '+name}catch(e){failed++;li.textContent='FALHOU · '+name+': '+e.message;li.style.color='#9b1c1c'}}

await test('Limpar especialidade durante consulta libera os controles e descarta a resposta antiga',async()=>{
 const f=fresh();change(f.elements.service,'Psicologia');const old=requests[0];change(f.elements.service,'');
 assert(!f.querySelector('[type=submit]').disabled,'Envio permaneceu bloqueado');assert(!f.querySelector('#reload-slots').disabled,'Atualização permaneceu bloqueada');
 old.resolve(Response.json({slots:[slot]}));await new Promise(r=>setTimeout(r,20));assert(f.elements.slotId.options.length===1,'Resposta obsoleta reapareceu');
});
await test('Troca rápida de especialidade mantém somente a última consulta',async()=>{
 const f=fresh();change(f.elements.service,'Psicologia');change(f.elements.service,'Assistência social');requests[1].resolve(Response.json({slots:[slot]}));await settle(()=>f.elements.slotId.options.length===2);requests[0].resolve(Response.json({slots:[]}));await new Promise(r=>setTimeout(r,20));assert(f.elements.slotId.options.length===2,'Consulta antiga substituiu a nova');
});
await test('Clique repetido envia uma só reserva e mantém os campos bloqueados durante o envio',async()=>{
 const f=await ready();submit(f);submit(f);assert(requests.filter(r=>r.url==='/api/agenda').length===1,'Envio duplicado');assert(f.elements.phone.disabled,'Campo editável durante gravação');const r=requests.at(-1);r.resolve(Response.json({message:'Reserva de teste',protocol:r.data.requestId,status:'pending',reserved:true}));await settle(()=>f.querySelector('[type=submit]').textContent.includes('Vaga reservada'));assert(f.elements.phone.disabled,'Formulário confirmado deveria permanecer bloqueado');
});
await test('Resposta sem protocolo preserva os campos; nova tentativa usa o mesmo identificador',async()=>{
 const f=await ready();submit(f);const before=requests.at(-1);before.resolve(Response.json({message:'Resposta incompleta'}));await settle(()=>!f.querySelector('[type=submit]').disabled);assert(f.elements.contactName.value==='Responsável fictício','Dados perdidos');assert(!f.querySelector('[type=submit]').textContent.includes('reservada'),'Falsa confirmação');submit(f);const after=requests.at(-1);assert(before.data.requestId===after.data.requestId,'Protocolo mudou no reenvio');after.resolve(Response.json({message:'Reserva de teste',protocol:after.data.requestId,status:'pending',reserved:true}));await settle(()=>f.querySelector('[type=submit]').textContent.includes('Vaga reservada'));
});
await test('Protocolo diferente ou situação incoerente nunca confirma a reserva',async()=>{
 for(const invalid of [{protocol:crypto.randomUUID(),status:'pending',reserved:true},{status:'waiting',reserved:true}]){
  const f=await ready();submit(f);const r=requests.at(-1);r.resolve(Response.json({message:'Teste',protocol:r.data.requestId,...invalid}));await settle(()=>!f.querySelector('[type=submit]').disabled);assert(f.querySelector('#appointment-result').textContent.includes('não confirmou'),'Resposta inválida aceita');
 }
});
await test('Falha de conexão permite repetir sem alterar dados ou protocolo',async()=>{
 const f=await ready();submit(f);const before=requests.at(-1);before.reject(Error('Falha simulada'));await settle(()=>!f.querySelector('[type=submit]').disabled);submit(f);const after=requests.at(-1);assert(before.data.requestId===after.data.requestId,'Protocolo perdido');after.resolve(Response.json({message:'Teste',protocol:after.data.requestId,status:'pending',reserved:true}));await settle(()=>f.querySelector('[type=submit]').disabled&&f.querySelector('[type=submit]').textContent.includes('Vaga reservada'));
});
await test('Preferência fica explicitamente sem vaga reservada',async()=>{
 const f=await ready();change(f.elements.mode,'preference');f.elements.date.value=day;f.elements.time.value='13:10';submit(f);const r=requests.at(-1);assert(!r.data.slotId,'Preferência enviou vaga');r.resolve(Response.json({message:'Preferência registrada',protocol:r.data.requestId,status:'waiting',reserved:false}));await settle(()=>f.querySelector('[type=submit]').textContent.includes('sem vaga reservada'));
});
await test('Painel captura todos os campos, bloqueia reenvio e restaura o formulário após falha',async()=>{
 const main=document.querySelector('main');main.innerHTML='<form><input name="nome" value="Fictício"><input name="fixo" disabled><button>Salvar</button></form>';const f=main.querySelector('form');let calls=0,release;const action=createPortalAction({notice:()=>{},el});
 f.addEventListener('submit',action(async()=>{calls++;assert(new FormData(f).get('nome')==='Fictício','Campo desabilitado antes da leitura');await new Promise(r=>release=r);throw Error('Falha simulada')}));submit(f);submit(f);assert(calls===1,'Painel enviou duas vezes');assert(f.elements.nome.disabled,'Campo não bloqueado');release();await settle(()=>!f.elements.nome.disabled);assert(f.elements.fixo.disabled,'Controle originalmente bloqueado foi liberado');assert(f.querySelector('[role=alert]').textContent==='Falha simulada','Erro sem orientação');
});
function el(tag,text,attrs={}){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e}
function field(host,label,name,value,attrs={}){const line=el('label',label),e=el(attrs.options?'select':'input',undefined,{name});if(attrs.options)for(const [v,t]of Object.entries(attrs.options))e.append(new Option(t,v));else for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);e.value=value;line.append(e);host.append(line);return e}
await test('Carregamento do portal inicia todos os painéis no mesmo evento',async()=>{
 const action=createPortalAction({notice:()=>{},el}),started=[],releases=[],handlers=['agenda','chamada','turmas','equipe'].map(name=>action(async()=>{started.push(name);await new Promise(resolve=>releases.push(resolve))}));
 for(const handler of handlers)document.addEventListener('audit:portal-loaded',handler);
 document.dispatchEvent(new Event('audit:portal-loaded'));
 const count=started.length;releases.forEach(resolve=>resolve());
 for(const handler of handlers)document.removeEventListener('audit:portal-loaded',handler);
 assert(count===4,'Um painel bloqueou o carregamento dos demais');
});
await test('Calendário: resposta lenta do atendimento anterior não aparece na seleção atual',async()=>{
 const host=document.querySelector('main');host.replaceChildren();const finish={},events=[1,2].map(i=>({...slot,id:'slot-'+i,booking_id:'booking-'+i,student_name:'Aluno fictício '+i,student_id:'UND1_00000'+i,service:'social_worker',status:'pending'}));
 await mountCalendar(host,{el,field,api:async()=>({events,generated_at:new Date().toISOString()}),action:fn=>async e=>{e?.preventDefault();await fn()},download:()=>{},state:{day,view:'day'},professionals:[],units:{amavale:'Amavale'},labels:{social_worker:'Assistência social'},onBooking:async(e,record)=>{await new Promise(r=>finish[e.booking_id]=r);record.append(el('p','Detalhes de '+e.student_name))},onFree:()=>{}});
 const buttons=[...host.querySelectorAll('button')].filter(b=>b.textContent==='Ver atendimento');buttons[0].click();buttons[1].click();finish['booking-2']();await settle(()=>host.querySelector('.calendar-record').textContent.includes('Detalhes de Aluno fictício 2'));finish['booking-1']();await new Promise(r=>setTimeout(r,20));assert(!host.querySelector('.calendar-record').textContent.includes('Detalhes de Aluno fictício 1'),'Resultado antigo contaminou seleção');
});
document.querySelector('#audit-summary').textContent=`Concluído: ${passed} passaram; ${failed} falharam. Dados e serviços externos simulados.`;
