const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const queueKey='lpc:technical-errors:v1';
const safeId=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():crypto.randomUUID();
const operationFor=url=>url==='/api/registrations'?'registration':url==='/api/sponsorships'?'sponsorship':url.includes('/auth/')?'login':url.startsWith('/api/portal/')?'portal':['/api/agenda','/api/training-agenda','/api/student-access'].includes(url)?'appointment':'site';
const messages={offline:'O aparelho está sem conexão. Reconecte-se e tente novamente.',network:'A conexão não trouxe uma confirmação. Confira sua internet e tente novamente.',timeout:'A confirmação demorou mais que o esperado. Aguarde um pouco e tente novamente.',unexpected_response:'O serviço enviou uma resposta que não pôde ser confirmada. Tente novamente em alguns minutos.'};
function queueRead(){try{const rows=JSON.parse(sessionStorage.getItem(queueKey)||'[]');return Array.isArray(rows)?rows.filter(r=>r&&UUID.test(r.support_id)&&Object.hasOwn(messages,r.kind)&&Date.now()-r.queued_at<86400000).slice(-10):[]}catch{return []}}
function queueWrite(rows){try{sessionStorage.setItem(queueKey,JSON.stringify(rows.slice(-10)))}catch{}}
function cleanEvent(event){return {support_id:safeId(event.support_id),operation:['registration','sponsorship','appointment','portal','login','site'].includes(event.operation)?event.operation:'site',kind:Object.hasOwn(messages,event.kind)?event.kind:'network',status:Number.isInteger(event.status)?event.status:0,duration_ms:Number.isFinite(event.duration_ms)?event.duration_ms:0}}
let flushing=false;
export async function flushDiagnostics(fetcher=fetch){
 if(flushing||globalThis.navigator?.onLine===false)return;flushing=true;
 try{const rows=queueRead();for(const row of rows){try{const r=await fetcher('/api/diagnostics',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(cleanEvent(row)),signal:AbortSignal.timeout(5000)});if(!r.ok)break;queueWrite(queueRead().filter(e=>e.support_id!==row.support_id))}catch{break}}}finally{flushing=false}
}
export function reportDiagnostic(event){const row={...cleanEvent(event),queued_at:Date.now()};queueWrite([...queueRead().filter(e=>e.support_id!==row.support_id),row]);void flushDiagnostics();}
export class RequestFailure extends Error{
 constructor(message,{support_id,status=0,kind='network'}={}){super(`${message} Código de atendimento: ${support_id}.`);this.name='RequestFailure';this.support_id=support_id;this.status=status;this.kind=kind;}
}
export function createRequestFeedback({fetcher=fetch,report=reportDiagnostic,online=()=>globalThis.navigator?.onLine!==false,timeoutMs=120000}={}){
 const responseIds=new WeakMap();
 async function requestResponse(url,options={}){
  const id=safeId(options.headers?.['X-Support-ID']),started=Date.now(),controller=new AbortController();
  const headers=new Headers(options.headers);headers.set('X-Support-ID',id);
  const timer=setTimeout(()=>controller.abort(),timeoutMs);let response;
  try{
   const incoming=await fetcher(url,{...options,headers,signal:controller.signal});
   // Receiving headers does not mean the confirmation/download has finished.
   // Keep the timeout active until the entire body has arrived.
   const body=await incoming.arrayBuffer();
   response=new Response(body.byteLength?body:null,{status:incoming.status,statusText:incoming.statusText,headers:incoming.headers});
  }
  catch{
   const kind=!online()?'offline':controller.signal.aborted?'timeout':'network';
   report({support_id:id,operation:operationFor(url),kind,status:0,duration_ms:Date.now()-started});
   throw new RequestFailure(messages[kind],{support_id:id,kind});
  }finally{clearTimeout(timer)}
  const support_id=safeId(response.headers.get('X-Support-ID')||id);
  responseIds.set(response,support_id);
  if(!response.ok){
   let data;try{data=await response.json()}catch{}
   const fallback=response.status===413?'Os arquivos ultrapassaram o limite permitido. Reduza-os antes de reenviar.':response.status===429?'Houve muitas tentativas. Aguarde alguns minutos.':response.status===401?'Sua sessão expirou. Entre novamente.':response.status>=500?'O serviço está temporariamente indisponível. Tente novamente em alguns minutos.':'Não foi possível concluir. Confira os dados informados.';
   const message=typeof data?.message==='string'?data.message.slice(0,500):fallback;
   if(!data)report({support_id,operation:operationFor(url),kind:'unexpected_response',status:response.status,duration_ms:Date.now()-started});
   throw new RequestFailure(message,{support_id,status:response.status,kind:'http'});
  }
  return response;
 }
 async function requestJson(url,options={},confirmKey){
  const response=await requestResponse(url,options),id=responseIds.get(response);let data;
  try{data=await response.json();if(!data||typeof data!=='object'||confirmKey&&(!data[confirmKey]||typeof data[confirmKey]!=='string'))throw Error('Unconfirmed response')}
  catch{report({support_id:id,operation:operationFor(url),kind:'unexpected_response',status:response.status});throw new RequestFailure(messages.unexpected_response,{support_id:id,status:response.status,kind:'unexpected_response'})}
  return data;
 }
 return {requestResponse,requestJson};
}
export const {requestResponse,requestJson}=createRequestFeedback();
if(typeof window!=='undefined'){window.addEventListener('online',()=>void flushDiagnostics());void flushDiagnostics();}
