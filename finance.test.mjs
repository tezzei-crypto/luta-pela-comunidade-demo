import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {DatabaseSync} from 'node:sqlite';
import {JSDOM} from 'jsdom';
const pdf=Buffer.from('%PDF-1.7\nFictional test evidence only');
const evidence={id:'DOC-TEST',name:'ficticio.pdf',mime:'application/pdf',sha256:createHash('sha256').update(pdf).digest('hex'),base64:pdf.toString('base64')};
const base=(id,kind,data)=>({id,kind,data:{label:'Registro fictício',evidence_ids:['DOC-TEST'],...data},reason:'Conferência fictícia de teste'});
const budget=base('budget','budget',{budget_code:'2.1',amount_cents:10000});
const invoice=base('invoice','invoice',{date:'2026-10-01',budget_code:'2.1',amount_cents:10000,supplier:'Fornecedor fictício',disposition:'current',fiscal_key:'1'.repeat(44)});
const payment=base('payment','payment',{date:'2026-10-02',budget_code:'2.1',amount_cents:6000,invoice_id:'invoice',transaction_ref:'PIX-FICTICIO'});
async function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-finance-test-')),mail=[],env={PORTAL_DATA_DIR:root,PORTAL_SECRET:'fictional-secret-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test'};const store=createSqliteStore(env,{transport:async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'fake'})}}),admin=(await store.members())[0];t.after(()=>{store.close();if(!path.resolve(root).startsWith(path.join(os.tmpdir(),'lpc-finance-test-')))throw Error('Unsafe');fs.rmSync(root,{recursive:true,force:true})});return {root,env,store,admin,mail}}
test('Financeiro: importação atômica, repetição, centavos, revisão e persistência',async t=>{
 const {env,store,admin}=await fixture(t),a=admin.user_id,packet={documents:[evidence],records:[budget,invoice,payment]};
 assert.equal((await store.financeImport(a,packet)).created,3);assert.equal((await store.financeImport(a,packet)).repeated,3);
 let r=await store.financeList(a);assert.equal(r.totals.payment_cents,6000);assert.equal(r.totals.bank_balance_cents,null);assert.equal(r.history.length,3);
 await assert.rejects(store.financeSave(a,{...payment,data:{...payment.data,amount_cents:1.5},version:1}),{status:400});
 await assert.rejects(store.financeSave(a,{...payment,data:{...payment.data,amount_cents:7000},version:0}),{status:409});
 await store.financeSave(a,{...payment,data:{...payment.data,amount_cents:7000},version:1,reason:'Correção fictícia documentada'});
 r=await store.financeList(a);assert.equal(r.totals.payment_cents,7000);assert.equal(r.history.length,4);assert.equal(r.history.find(h=>h.record_id==='payment'&&h.version===1).data.amount_cents,6000);
 const other=createSqliteStore(env);assert.equal((await other.financeList(a)).totals.payment_cents,7000);other.close();
 assert.deepEqual((await store.financeDownload(a,'DOC-TEST')).bytes,pdf);
});
test('Financeiro: duplicatas, integridade, referências e rollback não geram lançamentos',async t=>{
 const {store,admin}=await fixture(t),a=admin.user_id;await store.financeImport(a,{documents:[evidence],records:[budget,invoice,payment]});
 await assert.rejects(store.financeSave(a,{...invoice,id:'dupe'}),{status:409});await assert.rejects(store.financeSave(a,{...payment,id:'dupe'}),{status:409});
 await assert.rejects(store.financeDocument(a,{...evidence,id:'other',base64:Buffer.from('malware').toString('base64')}),{status:400});
 await assert.rejects(store.financeSave(a,{...invoice,id:'missing',data:{...invoice.data,evidence_ids:['unknown']}}),{status:400});
 await assert.rejects(store.financeSave(a,{...payment,id:'bad',data:{...payment.data,invoice_id:'absent'}}),{status:400});
 await assert.rejects(store.financeSave(a,{...invoice,version:1,data:{...invoice.data,disposition:'historical'}}),{status:409});
 await assert.rejects(store.financeSave(a,{...payment,id:'over',data:{...payment.data,amount_cents:5000,transaction_ref:'OVER'}}),{status:409});
 await assert.rejects(store.financeSave(a,base('issue','issue',{status:'resolved',evidence_ids:[]})),{status:400});
 await assert.rejects(store.financeImport(a,{documents:[null],records:[]}),{status:400});
 await assert.rejects(store.financeImport(a,{documents:[],records:[base('will-rollback','issue',{}),{...payment,id:'bad',data:{...payment.data,date:'2026-02-30'}}]}));assert.equal((await store.financeList(a)).records.length,3);
});
test('Financeiro: todos os perfis não administrativos são barrados na API e no armazenamento',async t=>{
 const {store,env,root,admin,mail}=await fixture(t);await store.financeImport(admin.user_id,{documents:[evidence],records:[budget,invoice,payment]});
 for(const role of ['secretary','teacher','guardian','psychologist','social_worker']){const email=role+'@example.test';let m;if(role==='teacher'){const db=new DatabaseSync(path.join(root,'portal.sqlite'));db.prepare('INSERT INTO members(user_id,email,role,active) VALUES(?,?,?,1)').run('test-teacher',email,role);db.close();m={user_id:'test-teacher'}}else m=await store.provision(email,role);
  await assert.rejects(store.financeList(m.user_id),{status:403});await assert.rejects(store.financeDocument(m.user_id,evidence),{status:403});await assert.rejects(store.financeSave(m.user_id,budget),{status:403});await assert.rejects(store.financeDownload(m.user_id,'DOC-TEST'),{status:403});await assert.rejects(store.financeImport(m.user_id,{documents:[],records:[]}),{status:403});
  await store.requestCode(email);const code=mail.at(-1).text.match(/\b\d{8}\b/)[0],session=await store.verifyCode(email,code);
  for(const [route,method]of [['/finance','GET'],['/finance/export','GET'],['/finance/ledger.csv','GET'],['/finance/documents/DOC-TEST','GET'],['/finance/records','POST'],['/finance/import','POST'],['/finance/documents','POST']]){const r=await handlePortal(new Request('https://example.test/api/portal'+route,{method,headers:{authorization:'Bearer '+session.access_token,origin:'https://example.test','content-type':'application/json'},...(method==='POST'?{body:'{}'}:{})}),env,store);assert.equal(r.status,403,role+route);assert.equal(r.headers.get('cache-control'),'no-store')}
 }
});
test('Financeiro: interface usa texto seguro, oculta financeiro de não administradores e exige evidência',async()=>{
 const script=fs.readFileSync(new URL('./dist/portal/finance.js',import.meta.url),'utf8'),dom=new JSDOM('<div id="workspace"></div>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
 w.eval(`let me={role:'teacher'};const $=id=>document.getElementById(id);function action(f){return f};${script}`);w.document.dispatchEvent(new w.Event('portal:loaded'));assert.equal(w.document.getElementById('finance-area'),null);assert.ok(!script.includes('innerHTML'));
});
