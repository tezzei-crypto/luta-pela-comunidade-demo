import {createStore,portalConfigured} from './portal-store.mjs';
import {clientAddress} from './client-address.mjs';
import {supportId,operationFor,kindForStatus,causeFor,sanitizeDiagnostic} from './diagnostics.mjs';

export function recordDiagnostic(env,raw,store){
 const clean=sanitizeDiagnostic({...raw,release:env.RENDER_GIT_COMMIT});
 try{if(store)store.recordDiagnostic(clean);else if(portalConfigured(env))createStore(env).recordDiagnostic(clean)}catch{console.error(JSON.stringify({event:'diagnostic_storage_unavailable',support_id:clean.support_id}))}
 // Only the allowlisted object is written. No headers, bodies, email addresses or raw exceptions.
 if(clean.source==='server'&&clean.kind!=='received')console.warn(JSON.stringify({event:'application_error',...clean}));
 return clean.support_id;
}
export function observeRequest(req,res,env){
 const id=supportId(req.headers['x-support-id']),started=Date.now();
 req.headers['x-support-id']=id;res.setHeader('X-Support-ID',id);
 let operation='site',isApi=false,recorded=false;
 try{const pathname=new URL(req.url,'http://local.invalid').pathname;operation=operationFor(pathname);isApi=pathname.startsWith('/api/')&&pathname!=='/api/diagnostics'}catch{}
 const record=(kind,status)=>{if(recorded||!isApi)return;recorded=true;recordDiagnostic(env,{support_id:id,source:'server',operation,kind,status,duration_ms:Date.now()-started})};
 res.once('finish',()=>{if(res.statusCode>=400)record(kindForStatus(res.statusCode),res.statusCode);else if(operation==='registration'&&req.method==='POST')record('received',res.statusCode)});
 res.once('close',()=>{if(!res.writableFinished)record('disconnected',499)});
 return {id,fail(error){record(causeFor(error),500);if(res.destroyed)return;if(res.headersSent){res.destroy();return;}res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({message:'Não foi possível concluir a operação. Tente novamente.',support_id:id}))}};
}
const rates=new Map();
export async function handleClientDiagnostic(req,res,url,env){
 const reply=(status,message)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({message}))};
 if(req.method!=='POST')return reply(405,'Método não permitido.');
 if(req.headers.origin!==url.origin)return reply(403,'Origem não permitida.');
 if(!String(req.headers['content-type']).startsWith('application/json'))return reply(415,'Formato inválido.');
 const key=clientAddress(req,env),now=Date.now(),old=rates.get(key);
 if(rates.size>1000)for(const [k,v] of rates)if(now-v.at>60000)rates.delete(k);
 if(old&&now-old.at<60000&&old.count>=20)return reply(429,'Aguarde antes de tentar novamente.');
 rates.set(key,old&&now-old.at<60000?{at:old.at,count:old.count+1}:{at:now,count:1});
 let raw='',length=0;for await(const b of req){length+=b.length;if(length>1024)return reply(413,'Registro muito grande.');raw+=b}
 let data;try{data=JSON.parse(raw)}catch{return reply(400,'Dados inválidos.')}
 if(!data||!['offline','network','timeout','unexpected_response'].includes(data.kind)||!['registration','sponsorship','appointment','portal','login','site'].includes(data.operation)||typeof data.support_id!=='string'||supportId(data.support_id)!==data.support_id)return reply(400,'Registro inválido.');
 recordDiagnostic(env,{...data,source:'browser'});return reply(202,'Relato técnico recebido.');
}
