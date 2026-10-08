import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {createSessionCache} from './dist/portal/session-cache.js';
const SIX_HOURS=21600000,sha=v=>createHash('sha256').update(v).digest('hex');
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-session-')),mail=[];
 const env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'test-only-'.repeat(5),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',RESEND_API_KEY:'fake',MAIL_FROM:'sender@example.test',PUBLIC_ORIGIN:'https://example.test'};
 const transport=async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'local-test'})};
 let store=createSqliteStore(env,{transport});const member=(await store.members())[0],db=new DatabaseSync(path.join(dir,'portal.sqlite'));
 t.after(()=>{store.close();db.close();fs.rmSync(dir,{recursive:true,force:true})});
 return {get store(){return store},env,db,member,async login(){await store.requestCode(member.email);return store.verifyCode(member.email,mail.at(-1).text.match(/\b\d{8}\b/)[0])},reopen(){store.close();store=createSqliteStore(env,{transport})}};
}
test('sessão dura seis horas absolutas, sem renovar com atividade',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T13:00:00Z')});const f=await fixture(t),start=Date.now(),s=await f.login();
 assert.equal(s.expires_in,21600);assert.equal((await f.store.user(s.access_token)).expires_at,start+SIX_HOURS);
 t.mock.timers.tick(3600001);assert.equal((await f.store.user(s.access_token)).id,f.member.user_id);
 t.mock.timers.tick(SIX_HOURS-3600002);assert.equal((await f.store.user(s.access_token)).expires_at,start+SIX_HOURS);
 t.mock.timers.tick(1);await assert.rejects(f.store.user(s.access_token),e=>e.status===401);
});
test('Sair e desativação continuam invalidando a sessão imediatamente',async t=>{
 const f=await fixture(t),s=await f.login();await f.store.logout(s.access_token);await assert.rejects(f.store.user(s.access_token),e=>e.status===401);
 f.db.prepare('DELETE FROM challenges').run();const other=await f.login();f.db.prepare('UPDATE members SET active=0 WHERE user_id=?').run(f.member.user_id);
 await assert.rejects(f.store.user(other.access_token),e=>e.status===401);
});
test('migração estende somente sessões antigas ainda ativas, uma vez',async t=>{
 const f=await fixture(t),now=Date.now(),active='a'.repeat(43),expired='b'.repeat(43);
 f.db.prepare('DELETE FROM auth_migrations').run();
 f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(active),f.member.user_id,now+1800000);
 f.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(expired),f.member.user_id,now-1);
 f.reopen();const deadline=(await f.store.user(active)).expires_at;assert.equal(deadline,now+1800000+5*3600000);
 await assert.rejects(f.store.user(expired),e=>e.status===401);f.reopen();assert.equal((await f.store.user(active)).expires_at,deadline);
});
test('API informa o vencimento da sessão autenticada e rejeita token revogado',async t=>{
 const f=await fixture(t),s=await f.login();const request=()=>handlePortal(new Request('https://example.test/api/portal/me',{headers:{Authorization:'Bearer '+s.access_token}}),f.env,f.store);
 const r=await request();assert.equal(r.status,200);const body=await r.json();assert.equal(body.session_expires_at,(await f.store.user(s.access_token)).expires_at);
 assert.equal(body.access_token,undefined);await f.store.logout(s.access_token);assert.equal((await request()).status,401);
});
function browserCache(){let time=1000000;const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};return {values,storage,clock:()=>time,advance:ms=>time+=ms};}
test('recarregar a mesma aba preserva a sessão sem prolongar seu vencimento',()=>{
 const f=browserCache(),first=createSessionCache(()=>f.storage,f.clock),token='x'.repeat(43);const saved=first.save({access_token:token,expires_in:21600});
 f.advance(3600000);const reloaded=createSessionCache(()=>f.storage,f.clock);assert.deepEqual(reloaded.read(),saved);
 f.advance(5*3600000);assert.equal(reloaded.read(),null);assert.equal(f.values.size,0);
});
test('cache limpa dados corrompidos, expirados e encerrados',()=>{
 const f=browserCache(),cache=createSessionCache(()=>f.storage,f.clock),key='lpc:portal-session:v1';
 for(const value of ['{',JSON.stringify({access_token:'bad',expires_at:f.clock()+1000}),JSON.stringify({access_token:'x'.repeat(43),expires_at:f.clock()+SIX_HOURS+1})]){f.values.set(key,value);assert.equal(cache.read(),null);assert.equal(f.values.size,0)}
 cache.save({access_token:'x'.repeat(43),expires_in:21600});cache.clear();assert.equal(cache.read(),null);
});
test('bloqueio do armazenamento da aba não impede login em memória',()=>{
 const cache=createSessionCache(()=>{throw Error('Storage unavailable')});assert.doesNotThrow(()=>cache.save({access_token:'x'.repeat(43),expires_in:21600}));assert.equal(cache.read(),null);assert.doesNotThrow(cache.clear);
});
