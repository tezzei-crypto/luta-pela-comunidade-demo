import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {clientAddress} from './client-address.mjs';

const request=(edge,xff='198.51.100.99')=>({headers:{'cf-connecting-ip':edge,'x-forwarded-for':xff},socket:{remoteAddress:'::ffff:10.0.0.1'}});
test('Endereço: cabeçalhos de proxy só são aceitos no ingresso do Render',()=>{
 assert.equal(clientAddress(request('203.0.113.2')),'10.0.0.1');
 assert.equal(clientAddress(request('203.0.113.2'),{RENDER:'false'}),'10.0.0.1');
 assert.equal(clientAddress(request('203.0.113.2'),{RENDER:'true'}),'203.0.113.2');
 for(const value of [undefined,'','bad','1.2.3.4, 5.6.7.8',['1.2.3.4'],'fe80::1%eth0','1'.repeat(65)])assert.equal(clientAddress(request(value),{RENDER:'true'}),'10.0.0.1');
 assert.equal(clientAddress(request('::ffff:203.0.113.2'),{RENDER:'true'}),'203.0.113.2');
 assert.equal(clientAddress(request('2001:0DB8:0:0:0:0:0:2'),{RENDER:'true'}),'2001:db8::2');
 // A spoofed XFF prefix never overrides the value supplied by Cloudflare.
 assert.equal(clientAddress(request('203.0.113.2','192.0.2.42, 203.0.113.2'),{RENDER:'true'}),'203.0.113.2');
});

test('Servidor: clientes distintos no mesmo proxy têm limites separados em formulários, login, métricas e diagnóstico',async t=>{
 const child=spawn(process.execPath,['server.mjs'],{cwd:import.meta.dirname,env:{...process.env,PORT:'0',HOST:'127.0.0.1',PUBLIC_ORIGIN:'https://example.test',RENDER_EXTERNAL_URL:'',ADDITIONAL_PUBLIC_ORIGINS:'',RENDER:'true',PORTAL_DATA_DIR:'',PORTAL_SECRET:'',PORTAL_INTAKE_ACTIVE:'false',RESEND_API_KEY:'not-a-real-key',MAIL_FROM:'test@example.test',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false',METRICS_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 child.stderr.resume();
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited}});
 let stdout='';const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Test server timeout')),10000);child.once('error',reject);child.stdout.on('data',b=>{stdout+=b;const match=stdout.match(/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(match[1])}})});
 const send=(route,ip,spoof='198.51.100.99')=>new Promise((resolve,reject)=>{const req=httpRequest('http://127.0.0.1:'+port+route,{method:'POST',headers:{host:'example.test',origin:'https://example.test','content-type':'application/json','cf-connecting-ip':ip,'x-forwarded-for':spoof}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode))});req.on('error',reject);req.end('{}')});
 for(const [route,limit,status]of [['/api/registrations',5,415],['/api/portal/auth/request',20,503],['/api/metrics',120,204],['/api/diagnostics',20,400]]){
  for(let i=0;i<limit;i++)assert.equal(await send(route,'203.0.113.2'),status,route+' before limit');
  assert.equal(await send(route,'203.0.113.2'),429,route+' same client blocked');
  assert.equal(await send(route,'203.0.113.3'),status,route+' other client unaffected');
  assert.equal(await send(route,'203.0.113.2','192.0.2.9, 203.0.113.2'),429,route+' cannot reset using XFF');
 }
});
