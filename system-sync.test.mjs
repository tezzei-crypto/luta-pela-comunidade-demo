import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';import {loadApprovedStudents} from './access-handler.mjs';
import {createSyncController} from './dist/portal/sync-controller.js';import {formSnapshot} from './dist/portal/system-sync.js';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-sync-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'only-system-sync-tests-'.repeat(3),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false',RESEND_API_KEY:'fake',MAIL_FROM:'test@example.test',PUBLIC_ORIGIN:'https://example.test'};
 const transport=async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'test'})};let store=createSqliteStore(env,{transport});const admin=(await store.members())[0];
 t.after(()=>{store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-sync-')));fs.rmSync(dir,{recursive:true,force:true})});
 const login=async email=>{await store.requestCode(email);return (await store.verifyCode(email,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token};
 const request=token=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal/sync',{headers:{Authorization:'Bearer '+token}}),env,store);
 const revision=async()=> (await store.systemRevision(admin.user_id)).revision;
 return {get store(){return store},admin,env,dir,login,request,revision,reopen(){store.close();store=createSqliteStore(env,{transport})}};
}
test('Sincronização: revisão privada, estável nas leituras e persistente após reinício',async t=>{
 const f=await fixture(t),first=await f.revision(),token=await f.login(f.admin.email);assert.equal(await f.revision(),first);
 const response=await f.request(token),body=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(Object.keys(body).sort(),['poll_after_seconds','revision']);assert.match(body.revision,/^[0-9a-f]{64}$/);
 await f.store.students();await f.store.auditLog();assert.equal(await f.revision(),first);
 const g=await f.store.provision('guardian@example.test','guardian');assert.notEqual(await f.revision(),first);const after=await f.revision();assert.equal((await f.request(await f.login(g.email))).status,200);assert.equal(await f.revision(),after);
 f.reopen();assert.equal(await f.revision(),after);assert.equal((await f.request('invalid')).status,401);
 await f.store.setMember(f.admin.user_id,g.user_id,'guardian',false);assert.notEqual(await f.revision(),after);await assert.rejects(f.store.systemRevision(g.user_id),{status:403});
});
test('Sincronização: aprovação e revogação do aluno chegam ao cadastro público sem lista paralela',async t=>{
 const f=await fixture(t),p={id:'UND2_000001',name:'Aluno Fictício',birth_date:'2015-01-01',status:'pending',version:0};
 let old=await f.revision();await f.store.import(f.admin.user_id,[p]);assert.notEqual(await f.revision(),old);
 for(const status of ['approved','inactive']){old=await f.revision();const row=(await f.store.students()).find(s=>s.id===p.id);await f.store.import(f.admin.user_id,[{...p,status,version:row.version}]);assert.notEqual(await f.revision(),old);assert.equal((await loadApprovedStudents(f.env,()=>f.store))[0].status,status)}
});
test('Sincronização: professores e monitores refletem liberação, núcleos e desativação nas listas',async t=>{
 const f=await fixture(t),data={name:'Professor Fictício',email:'teacher@example.test',phone:'24999999999',belt_degree:'Preta',certificate_issuer:'Entidade de teste',certificate_date:'2020-01-01',status:'pending',version:0,units:['amavale']};
 let teacher=await f.store.saveTeacher(f.admin.user_id,null,data);assert.equal((await f.store.workforceRoster(f.admin.user_id,'amavale')).length,0);
 for(const kind of ['photo','black_belt_diploma'])await f.store.addTeacherDocument(f.admin.user_id,teacher.user_id,{id:randomUUID(),kind,object_path:'fake/'+randomUUID()+'.pdf',mime:'application/pdf',size:10,original_name:'fixture'});
 teacher=await f.store.teacher(f.admin.user_id,teacher.user_id);let old=await f.revision();teacher=await f.store.saveTeacher(f.admin.user_id,teacher.user_id,{...data,version:teacher.version,status:'verified',checked:true});assert.notEqual(await f.revision(),old);assert.equal((await f.store.workforceRoster(f.admin.user_id,'amavale')).length,1);
 assert.deepEqual(await f.store.availableUnits(teacher.user_id),['amavale']);assert.equal((await f.request(await f.login(data.email))).status,200);
 old=await f.revision();await f.store.saveTeacher(f.admin.user_id,teacher.user_id,{...data,version:teacher.version});assert.notEqual(await f.revision(),old);assert.equal((await f.store.workforceRoster(f.admin.user_id,'amavale')).length,0);assert.deepEqual(await f.store.availableUnits(teacher.user_id),[]);
 const m={name:'Monitor Fictício',email:'',phone:'24999999999',notes:'',active:true,version:0,units:['amavale']};let monitor=await f.store.saveMonitor(f.admin.user_id,null,m);assert.equal((await f.store.workforceRoster(f.admin.user_id,'amavale')).length,1);
 old=await f.revision();monitor=await f.store.saveMonitor(f.admin.user_id,monitor.id,{...m,units:['valparaiso'],version:monitor.version});assert.notEqual(await f.revision(),old);assert.equal((await f.store.workforceRoster(f.admin.user_id,'amavale')).length,0);assert.equal((await f.store.workforceRoster(f.admin.user_id,'valparaiso')).length,1);
 old=await f.revision();await f.store.saveMonitor(f.admin.user_id,monitor.id,{...m,active:false,version:monitor.version});assert.notEqual(await f.revision(),old);assert.equal((await f.store.workforceRoster(f.admin.user_id,'valparaiso')).length,0);
});
test('Sincronização: transação revertida não anuncia mudança e leitura não causa ciclo de atualização',async t=>{
 const f=await fixture(t),file=fs.readdirSync(f.dir).find(n=>n.endsWith('.sqlite')),db=new DatabaseSync(path.join(f.dir,file));const old=await f.revision();
 try{
 db.exec('BEGIN');db.prepare('UPDATE members SET active=0 WHERE user_id=?').run(f.admin.user_id);db.exec('ROLLBACK');assert.equal(await f.revision(),old);
 db.prepare('UPDATE members SET active=active WHERE user_id=?').run(f.admin.user_id);assert.equal(await f.revision(),old);
 }finally{db.close()}
});
test('Sincronização da tela: adia rascunhos, reúne mudanças e tenta novamente após falha',async()=>{
 let version='one',dirty=false,refreshes=0,pending=0,updated=0,errors=0,fail=false;
 const c=createSyncController({readRevision:async()=>({revision:version}),refresh:async()=>{if(fail)throw Error('offline');refreshes++},isEditing:()=>dirty,isActive:()=>true,onPending:()=>pending++,onUpdated:()=>updated++,onError:()=>errors++});
 await c.poll();await c.poll();assert.equal(refreshes,0);version='two';dirty=true;await c.poll();assert.equal(pending,1);assert.equal(refreshes,0);version='three';dirty=false;fail=true;await c.poll();assert.equal(errors,1);fail=false;await c.poll();assert.equal(refreshes,1);assert.equal(updated,1);await c.poll();assert.equal(refreshes,1);
});
test('Sincronização da tela: ignora resposta antiga depois de sair e evita solicitações sobrepostas',async()=>{
 let resolve,calls=0,refreshes=0;const c=createSyncController({readRevision:()=>{calls++;return new Promise(r=>resolve=r)},refresh:async()=>refreshes++,isEditing:()=>false,isActive:()=>true});
 const pending=c.poll();await c.poll();assert.equal(calls,1);c.reset();resolve({revision:'old'});await pending;assert.equal(refreshes,0);const next=c.poll();resolve({revision:'new'});await next;assert.equal(refreshes,0);
});
test('Sincronização preserva escolhas de presença, arquivos e campos antes de atualizar',()=>{
 let pressed='false';const input={tagName:'INPUT',name:'name',type:'text',value:'Texto'},button={tagName:'BUTTON',hasAttribute:()=>true,getAttribute:()=>pressed},file={tagName:'INPUT',type:'file',files:[]};const form={elements:[input,button,file]};const before=formSnapshot(form);pressed='true';assert.notEqual(formSnapshot(form),before);pressed='false';assert.equal(formSnapshot(form),before);file.files=[{name:'foto.jpg',size:100,lastModified:1}];assert.notEqual(formSnapshot(form),before);
});
