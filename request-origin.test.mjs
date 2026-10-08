import test from 'node:test';
import assert from 'node:assert/strict';
import {publicOrigins,requestOrigin,sameOrigin} from './request-origin.mjs';
import {handlePortal} from './portal-handler.mjs';
const env={PUBLIC_ORIGIN:'https://www.lutapelacomunidade.com.br',RENDER_EXTERNAL_URL:'https://luta-pela-comunidade-demo.onrender.com',ADDITIONAL_PUBLIC_ORIGINS:'https://lutapelacomunidade.com.br'};
test('custom domain and previous Render links keep their own request origins',()=>{
 for(const origin of publicOrigins(env))assert.equal(requestOrigin(new URL(origin).host,env),origin);
 assert.throws(()=>requestOrigin('attacker.example',env));
 assert.throws(()=>requestOrigin('www.lutapelacomunidade.com.br.attacker.example',env));
 assert.throws(()=>requestOrigin('www.lutapelacomunidade.com.br@attacker.example',env));
});
test('mutations require the same configured origin; cross-site and missing Origin are rejected',()=>{
 for(const origin of publicOrigins(env))assert.equal(sameOrigin(new Request(origin+'/api/portal/auth/request',{method:'POST',headers:{origin}}),env),true);
 const url=env.PUBLIC_ORIGIN+'/api/portal/auth/request';
 for(const origin of ['https://attacker.example','null',env.RENDER_EXTERNAL_URL,'https://www.lutapelacomunidade.com.br/'])assert.equal(sameOrigin(new Request(url,{method:'POST',headers:{origin}}),env),false);
 assert.equal(sameOrigin(new Request(url,{method:'POST'}),env),false);
 assert.equal(sameOrigin(new Request('https://attacker.example/api',{headers:{origin:'https://attacker.example'}}),env),false);
});
test('local development permits loopback and fails closed for remote Host values',()=>{
 assert.equal(requestOrigin('127.0.0.1:4174',{}),'http://127.0.0.1:4174');
 assert.equal(requestOrigin('localhost:4174',{}),'http://localhost:4174');
 assert.throws(()=>requestOrigin('example.com',{}));
 assert.throws(()=>publicOrigins({PUBLIC_ORIGIN:'https://site.example/path'}));
 assert.throws(()=>publicOrigins({PUBLIC_ORIGIN:'http://site.example'}));
});
test('portal login reaches the mail service on either configured domain without changing authorization',async()=>{
 const configured={...env,PORTAL_DATA_DIR:'/private',PORTAL_SECRET:'s'.repeat(40)};let called=0;
 const store={requestCode:async()=>{called++}};
 for(const origin of publicOrigins(env)){
  const response=await handlePortal(new Request(origin+'/api/portal/auth/request',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com'})}),configured,store);
  assert.equal(response.status,200);
 }
 assert.equal(called,3);
 const rejected=await handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal/auth/request',{method:'POST',headers:{origin:'https://attacker.example','Content-Type':'application/json'},body:JSON.stringify({email:'admin@example.com'})}),configured,store);
 assert.equal(rejected.status,403);assert.equal(called,3);
});
