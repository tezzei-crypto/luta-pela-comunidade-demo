// Local-only UI regression harness. No production database or email service is used.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),dist=path.join(root,'dist');
http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname==='/'){
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Auditoria local da agenda — dados fictícios</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/portal/portal.css"><style>body{padding:16px}#audit-results{padding:16px;background:#eff8f1}#audit-results li{margin:8px}main{max-width:1080px;margin:auto}</style><h1>Auditoria local da agenda</h1><p>Dados fictícios. Nenhum email ou agendamento real.</p><ol id="audit-results"></ol><p id="audit-summary" role="status">Testes em execução…</p><main></main><script src="/portal/action.js"></script><script type="module" src="/browser-audit.js"></script></html>`);return;
 }
 const file=pathname==='/browser-audit.js'?path.join(root,'browser-audit.js'):path.resolve(dist,'.'+decodeURIComponent(pathname));
 if(!file.startsWith(dist+path.sep)&&file!==path.join(root,'browser-audit.js')||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/octet-stream');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file));
}).listen(4319,'127.0.0.1',()=>console.log('Auditoria isolada: http://127.0.0.1:4319/'));
