import {sameOrigin} from './request-origin.mjs';
import {createHmac} from 'node:crypto';
import {createStore} from './portal-store.mjs';
export const PUBLIC_PAGES=['/','/inscricao/','/agendamento/','/patrocinar/','/unidades/amavale/','/unidades/valparaiso/','/unidades/vale-do-carangola/'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const metricsEnabled=env=>env.METRICS_ENABLED==='true'&&!!env.PORTAL_DATA_DIR&&env.PORTAL_SECRET?.length>=32;
export async function handleMetrics(request,env={},store){
 const reply=(status,data)=>data?Response.json(data,{status,headers:{'Cache-Control':'no-store'}}):new Response(null,{status,headers:{'Cache-Control':'no-store'}});
 if(new URL(request.url).pathname==='/api/metrics-status'&&request.method==='GET')return reply(200,{enabled:!!metricsEnabled(env)});
 if(request.method!=='POST')return reply(405);
 if(!metricsEnabled(env))return reply(204);
 if(!sameOrigin(request,env))return reply(403);
 if(request.headers.get('sec-gpc')==='1'||request.headers.get('dnt')==='1'||/bot|crawler|spider|headless/i.test(request.headers.get('user-agent')||''))return reply(204);
 try{
  const raw=await request.text();if(Buffer.byteLength(raw)>1024)return reply(413);
  const p=JSON.parse(raw);
  if(!p||Object.keys(p).some(k=>!['page','eventId','sessionId','visitorId','consent'].includes(k))||p.consent!==true||!PUBLIC_PAGES.includes(p.page)||![p.eventId,p.sessionId,p.visitorId].every(v=>typeof v==='string'&&uuid.test(v)))return reply(400);
  const hash=(type,value)=>createHmac('sha256',env.PORTAL_SECRET).update('metrics:'+type+':'+value).digest('hex');
  await (store||createStore(env)).recordMetric({event_id:p.eventId,page:p.page,session_hash:hash('session',p.sessionId),visitor_hash:hash('visitor',p.visitorId)});
  return reply(204);
 }catch{return reply(503)}
}
