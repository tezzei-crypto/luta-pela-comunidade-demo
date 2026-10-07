import {handleAccess} from './access-handler.mjs';
import {handleAgenda,agendaStatus} from './agenda-handler.mjs';
import {handleSponsorship} from './sponsorship-handler.mjs';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {handleRegistration} from './registration-handler.mjs';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');const port=Number(process.env.PORT||4174);const limits=new Map();
http.createServer(async(req,res)=>{
 const origin=new URL(process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL||`http://${req.headers.host}`).origin;
 let url;try{url=new URL(req.url,origin)}catch{res.writeHead(400).end();return}
 const send=async response=>{res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))};
 if(url.pathname==='/api/training-agenda-status'){await send(Response.json(agendaStatus(process.env),{headers:{'Cache-Control':'no-store'}}));return}
 if(['/api/registration-status','/api/sponsorship-status'].includes(url.pathname)){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled:!!(process.env.RESEND_API_KEY&&process.env.MAIL_FROM)}));return}
 if(['/api/registrations','/api/sponsorships','/api/agenda','/api/training-agenda','/api/student-access'].includes(url.pathname)){
  if(req.method!=='POST'){res.writeHead(405).end();return}
  if(!['/api/training-agenda','/api/student-access'].includes(url.pathname)&&(!process.env.RESEND_API_KEY||!process.env.MAIL_FROM)){await send(Response.json({message:'O envio de inscrições ainda está em configuração.'},{status:503}));return}
  const key=url.pathname+':'+req.socket.remoteAddress,now=Date.now(),entry=limits.get(key);if(limits.size>1000)for(const [k,v]of limits)if(now-v.start>600000)limits.delete(k);
  if(entry&&now-entry.start<600000&&entry.count>=(url.pathname==='/api/student-access'?60:5)){await send(Response.json({message:'Muitas tentativas. Aguarde alguns minutos.'},{status:429}));return}
  limits.set(key,entry&&now-entry.start<600000?{...entry,count:entry.count+1}:{start:now,count:1});
  const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>(url.pathname==='/api/student-access'?1000:['/api/agenda','/api/training-agenda'].includes(url.pathname)?4000:url.pathname==='/api/sponsorships'?16000:13*1024*1024)){res.writeHead(413,{'Content-Type':'application/json'}).end(JSON.stringify({message:'Arquivos excedem o limite de 12 MB.'}));return}chunks.push(chunk)}
  try{await send(await (url.pathname==='/api/student-access'?(request=>handleAccess(request)):['/api/agenda','/api/training-agenda'].includes(url.pathname)?handleAgenda:url.pathname==='/api/sponsorships'?handleSponsorship:handleRegistration)(new Request(url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),process.env))}catch{await send(Response.json({message:'Não foi possível processar a inscrição.'},{status:500}))}return;
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return}
 let file;try{file=path.resolve(root,'.'+decodeURIComponent(url.pathname))}catch{res.writeHead(400).end();return}
 if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403).end();return}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');if(!fs.existsSync(file)){res.writeHead(404).end();return}
 res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
}).listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`Local: http://127.0.0.1:${port}`));



