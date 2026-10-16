import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {quotaAwareTransport,retryAfterQuota,deferRejectedEmail} from './resend-quota.mjs';

const url='https://api.resend.com/emails',options={method:'POST'};
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());return {db,get:(sql,...p)=>db.prepare(sql).get(...p),run:(sql,...p)=>db.prepare(sql).run(...p)};}
test('Cota diária: uma recusa pausa filas concorrentes, persiste ao recriar transporte e retoma após reset UTC',async t=>{
 const f=fixture(t);let now=Date.parse('2026-10-16T12:00:00Z'),calls=0;
 const transport=async()=>{calls++;return calls===1?Response.json({name:'daily_quota_exceeded'},{status:429}):Response.json({id:'accepted'});};
 const make=()=>quotaAwareTransport({...f,transport,clock:()=>now,key:'fake'});
 let send=make();const responses=await Promise.all([send(url,options),send(url,options),send(url,options)]);
 assert.equal(calls,1);assert.ok(responses.every(r=>r.status===429));assert.equal(send.mailStatus().retry_at,'2026-10-17T00:00:05.000Z');
 send=make();await send(url,options);assert.equal(calls,1);now=Date.parse(send.mailStatus().retry_at);assert.equal((await send(url,options)).status,200);assert.equal(calls,2);assert.equal(send.mailStatus().paused,false);
});
test('Limite de velocidade respeita Retry-After; mensal usa verificação horária e não inventa renovação',async()=>{
 const now=Date.parse('2026-10-16T12:00:00Z');
 assert.equal(await retryAfterQuota(Response.json({name:'rate_limit_exceeded'},{status:429,headers:{'Retry-After':'120'}}),now),now+120000);
 assert.equal(await retryAfterQuota(Response.json({name:'monthly_quota_exceeded'},{status:429}),now),now+3600000);
 assert.equal(await retryAfterQuota(Response.json({name:'monthly_quota_exceeded'},{status:429,headers:{'Retry-After':'nonsense'}}),now),now+3600000);
 assert.equal(await retryAfterQuota(Response.json({},{status:503}),now),0);
});
test('429 preserva fila e primeira tentativa anterior; timeout não é tratado como rejeição definitiva',async t=>{
 const f=fixture(t);f.db.exec("CREATE TABLE registration_document_outbox(id TEXT PRIMARY KEY,state TEXT,attempts INTEGER,first_attempt INTEGER,next_attempt INTEGER,lease_until INTEGER,claim TEXT,last_status INTEGER)");
 for(const first of [null,1000]){
  const id=String(first),before={id,attempts:first?2:0,first_attempt:first};f.run("INSERT INTO registration_document_outbox VALUES(?,'sending',?,?,0,120000,'owner',0)",id,before.attempts+1,first||3000);
  await deferRejectedEmail(Response.json({name:'daily_quota_exceeded'},{status:429}),{...f,table:'registration_document_outbox',before,now:3000,claim:'owner'});
  const row=f.get('SELECT * FROM registration_document_outbox WHERE id=?',id);assert.equal(row.attempts,before.attempts);assert.equal(row.first_attempt,first);assert.equal(row.state,'pending');assert.equal(row.lease_until,0);assert.equal(row.last_status,429);
 }
 const send=quotaAwareTransport({...f,transport:async()=>{throw Error('timeout')},key:'fake'});await assert.rejects(send(url,options),/timeout/);assert.equal(send.mailStatus().paused,false);
});
test('Resposta não registra segredo; outros provedores e chamadas de leitura continuam funcionando',async t=>{
 const f=fixture(t),calls=[],transport=async(u)=>{calls.push(u);return Response.json({name:'daily_quota_exceeded'},{status:429})};
 const send=quotaAwareTransport({...f,transport,key:'fake-private-key'});await send(url,options);await send('https://www.googleapis.com/upload/drive/v3/files',options);await send(url,{method:'GET'});
 assert.equal(calls.length,3);assert.doesNotMatch(JSON.stringify(f.get('SELECT * FROM mail_provider_pause')),/fake-private-key/);
});
