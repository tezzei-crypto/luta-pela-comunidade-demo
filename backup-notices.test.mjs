import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {backupNotifications} from './backup-notices.mjs';

function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(`CREATE TABLE members(user_id TEXT,email TEXT,role TEXT,active INTEGER);CREATE TABLE recovery_packages(created_at TEXT,drive_verified_at TEXT);
 INSERT INTO members VALUES('admin-a','a@example.test','admin',1),('admin-b','b@example.test','admin',1),('teacher','teacher@example.test','teacher',1),('inactive','inactive@example.test','admin',0);
 INSERT INTO recovery_packages VALUES('2026-10-10T07:00:00.000Z',NULL);`);
 let time=new Date('2026-10-10T10:59:00.000Z');const calls=[],env={RESEND_API_KEY:'fixture-only',MAIL_FROM:'sender@example.test'},state={settings:{enabled:true,configured:true,interval_hours:4,drive_connected:false},packages:[{created_at:'2026-10-10T07:00:00.000Z'}],external_pending:false,restore_pending:false,overdue:false,last_run:{state:'completed'}};
 let send=async()=>Response.json({id:'fake-provider-id'});
 const dependencies={db,env,get:(s,...p)=>db.prepare(s).get(...p),all:(s,...p)=>db.prepare(s).all(...p),run:(s,...p)=>db.prepare(s).run(...p),status:()=>state,clock:()=>time,transport:async(u,o)=>{calls.push({url:u,...o});return send(u,o)}};
 return {db,calls,env,state,dependencies,notices:backupNotifications(dependencies),time:value=>{time=new Date(value)},send:value=>{send=value}};
}
test('resumo às 8h de Brasília: um email diário por administrador ativo, inclusive após reinício',async t=>{
 const f=fixture(t);await f.notices.deliver();assert.equal(f.calls.length,0);f.time('2026-10-10T11:00:00Z');await f.notices.deliver();assert.equal(f.calls.length,2);
 const bodies=f.calls.map(c=>JSON.parse(c.body));assert.deepEqual(bodies.map(b=>b.to[0]).sort(),['a@example.test','b@example.test']);assert.match(bodies[0].subject,/Resumo diário/);assert.match(bodies[0].text,/Últimas 24 horas: 1 pacote/);assert.doesNotMatch(bodies[0].text,/fixture-only|BEGIN|Aluno|CPF/);
 await backupNotifications(f.dependencies).deliver();assert.equal(f.calls.length,2);f.time('2026-10-11T11:00:00Z');await f.notices.deliver();assert.equal(f.calls.length,4);assert.equal(f.notices.notificationStatus().last_accepted.kind,'daily');
});
test('falha, atraso e Drive pendente geram incidentes distintos e não inundam a caixa a cada backup',async t=>{
 const f=fixture(t);f.state.external_pending=true;await f.notices.deliver();assert.equal(f.calls.length,2);assert.match(JSON.parse(f.calls[0].body).text,/Conexão automática.*não configurada/);await f.notices.deliver();assert.equal(f.calls.length,2);
 f.state.last_run.state='failed';await f.notices.deliver();assert.equal(f.calls.length,4);f.state.overdue=true;await f.notices.deliver();assert.equal(f.calls.length,6);await f.notices.deliver();assert.equal(f.calls.length,6);
 f.state.last_run.state='completed';await f.notices.deliver();f.state.last_run.state='failed';await f.notices.deliver();assert.equal(f.calls.length,8);
});
test('falha de transporte mantém conteúdo e idempotência nas tentativas, sem repetir envio após 23h',async t=>{
 const f=fixture(t);f.state.external_pending=true;f.send(async()=>{throw Error('sensitive response fixture')});await f.notices.deliver();assert.equal(f.calls.length,2);assert.equal(f.notices.notificationStatus().pending,2);await f.notices.deliver();assert.equal(f.calls.length,2);
 f.time('2026-10-10T11:05:00Z');await f.notices.deliver();const first=f.calls[0],retried=f.calls.find((c,i)=>i>=2&&c.headers['Idempotency-Key']===first.headers['Idempotency-Key']);assert.equal(retried.body,first.body);
 f.time('2026-10-11T10:59:01Z');await f.notices.deliver();assert.equal(f.notices.notificationStatus().unconfirmed,2);assert.equal(f.calls.filter(c=>c.headers['Idempotency-Key']===first.headers['Idempotency-Key']).length,2);assert.doesNotMatch(JSON.stringify(f.notices.notificationStatus()),/sensitive response fixture/);
});
test('sucesso após perda de resposta usa a mesma chave; confirma aceitação e interrompe repetição',async t=>{
 const f=fixture(t);f.state.last_run.state='failed';f.send(async()=>new Response('',{status:503}));await f.notices.deliver();f.send(async()=>Response.json({id:'provider-accepted'}));f.time('2026-10-10T10:59:00Z');await f.notices.deliver();assert.equal(f.calls.length,2);
 f.time('2026-10-10T11:05:00Z');await f.notices.deliver();await f.notices.deliver();assert.equal(f.notices.notificationStatus().pending,0);assert.equal(f.db.prepare("SELECT count(*) n FROM recovery_mail_outbox WHERE state='accepted'").get().n,4);
});
test('email de falha deixa de ser enviado após resolver o problema ou revogar o administrador',async t=>{
 const f=fixture(t);f.state.external_pending=true;f.send(async()=>new Response('',{status:503}));await f.notices.deliver();f.state.external_pending=false;f.db.exec("UPDATE members SET active=0 WHERE user_id='admin-b'");f.time('2026-10-10T11:05:00Z');f.send(async()=>Response.json({id:'ok'}));await f.notices.deliver();assert.equal(f.calls.length,3);assert.equal(f.db.prepare("SELECT count(*) n FROM recovery_mail_outbox WHERE state='cancelled'").get().n,2);assert.equal(JSON.parse(f.calls[2].body).to[0],'a@example.test');
});
test('rotina pausada e falta de credenciais não enviam; rejeição permanente fica visível',async t=>{
 const f=fixture(t);f.state.external_pending=true;f.state.settings.enabled=false;await f.notices.deliver();assert.equal(f.calls.length,0);f.state.settings.enabled=true;delete f.env.MAIL_FROM;await f.notices.deliver();assert.equal(f.calls.length,0);assert.equal(f.notices.notificationStatus().configured,false);
 f.env.MAIL_FROM='sender@example.test';f.send(async()=>Response.json({name:'validation_error'},{status:422}));await f.notices.deliver();assert.equal(f.notices.notificationStatus().unconfirmed,2);assert.equal(f.notices.notificationStatus().pending,0);await f.notices.deliver();assert.equal(f.calls.length,2);
});
test('duas execuções simultâneas não duplicam avisos',async t=>{
 const f=fixture(t);f.state.external_pending=true;let resolve;const gate=new Promise(r=>{resolve=r});f.send(async()=>{await gate;return Response.json({id:'ok'})});const first=f.notices.deliver();await f.notices.deliver();assert.equal(f.calls.length,1);resolve();await first;assert.equal(f.calls.length,2);
});
