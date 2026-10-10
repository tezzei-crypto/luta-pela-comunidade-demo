import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {fixtureTeacher} from './school-fixtures.mjs';
const units=['amavale','valparaiso','vale-do-carangola'];
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-authority-')),env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'synthetic-secret-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test'};
 let store=createSqliteStore(env);const db=new DatabaseSync(path.join(dir,'portal.sqlite'));t.after(()=>{db.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-authority-')));fs.rmSync(dir,{recursive:true,force:true})});
 const admin=(await store.members())[0],tokens=new Map();
 const token=m=>{const v=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(v).digest('hex'),m.user_id,Date.now()+3600000);tokens.set(m.user_id,v)};token(admin);
 const account=(email,role='secretary',level='local',us=units)=>({name:'Pessoa Fictícia '+email.split('@')[0],email,phone:'24999999999',role,secretary_level:level,units:us,active:true,version:0});
 const local=await store.saveStaffAccount(admin.user_id,null,account('local@example.test')),general=await store.saveStaffAccount(admin.user_id,null,account('general@example.test','secretary','general')),admin2=await store.saveStaffAccount(admin.user_id,null,account('admin2@example.test','admin'));
 const teacher=await fixtureTeacher(store,admin.user_id,['amavale']),other=await fixtureTeacher(store,admin.user_id,units,'other@example.test');
 for(const m of [local,general,admin2,teacher,other])token(m);
 await store.import(admin.user_id,units.map((u,i)=>({id:`UND${i+1}_000001`,name:'Aluno Fictício '+i,birth_date:'2018-01-01',status:'approved',version:0})));
 const groups=[],classes=[];for(let i=0;i<3;i++){const g=await store.saveGroup(admin.user_id,null,{unit:units[i],label:'Turma '+i,teachers:[i===0?teacher.user_id:other.user_id],students:[`UND${i+1}_000001`],active:true,version:0,weekdays:[0,1,2,3,4,5,6],start_time:'15:00',end_time:'16:00'});groups.push(g);classes.push(await store.createClass(admin.user_id,{group_id:g.id,day:'2020-01-01'}))}
 const req=(m,url,method='GET',data)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+url,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+tokens.get(m.user_id),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,store);
 const mark=(m,i,status,version=0)=>req(m,'/classes/'+classes[i].id+'/attendance','POST',{rows:[{id:`UND${i+1}_000001`,status,version,updated_by:admin.user_id,actor_name:'FORGED'}]});
 return {dir,db,admin,admin2,local,general,teacher,other,groups,classes,req,mark,account,token,get store(){return store},reopen(){store.close();store=createSqliteStore(env)}};
}
test('Chamada: todos os administradores e secretaria geral lançam nos três núcleos; autoria vem da sessão',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++){assert.equal((await f.mark(f.admin2,i,'present')).status,200);assert.equal((await f.mark(f.general,i,'justified',1)).status,200);const data=await (await f.req(f.admin,'/classes/'+f.classes[i].id+'/attendance')).json();assert.equal(data.students[0].updated_by,f.general.user_id);assert.equal(data.students[0].updated_by_name,f.general.name);assert.ok(data.students[0].updated_at);const h=await f.store.attendanceHistory(f.admin.user_id,f.classes[i].id);assert.deepEqual(h.changes.map(r=>[r.previous_status,r.status,r.actor]),[['present','justified',f.general.user_id],['unmarked','present',f.admin2.user_id]])}
});
test('Chamada: secretaria local mesmo com três núcleos consulta, mas não abre, marca, cancela nem se promove',async t=>{
 const f=await fixture(t);for(let i=0;i<3;i++){assert.equal((await f.mark(f.local,i,'present')).status,403);assert.equal((await f.req(f.local,'/classes','POST',{group_id:f.groups[i].id,day:'2020-01-02'})).status,403);assert.equal((await f.req(f.local,'/classes/'+f.classes[i].id+'/cancellation','POST',{cancelled:true,reason:'Não permitido'})).status,403);const r=await (await f.req(f.local,'/classes/'+f.classes[i].id+'/attendance')).json();assert.equal(r.can_write,false);assert.equal(r.students[0].status,'unmarked')}
 assert.equal((await f.req(f.local,'/staff-accounts/'+f.local.user_id,'PATCH',{...f.local,secretary_level:'general'})).status,403);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM attendance_changes').get().n,0);
});
test('Chamada: professor só lança na própria turma e unidade; revogação tem efeito com sessão ainda aberta',async t=>{
 const f=await fixture(t);assert.equal((await f.mark(f.teacher,0,'present')).status,200);assert.equal((await f.mark(f.other,0,'absent',1)).status,403);
 for(let i=1;i<3;i++){assert.equal((await f.mark(f.teacher,i,'present')).status,403);assert.equal((await f.req(f.teacher,'/classes/'+f.classes[i].id+'/attendance-history')).status,403)}
 await f.store.saveGroup(f.admin.user_id,f.groups[0].id,{...f.groups[0],teachers:[f.other.user_id],students:['UND1_000001']});assert.equal((await f.mark(f.teacher,0,'absent',1)).status,403);assert.equal((await f.mark(f.other,0,'absent',1)).status,200);
 f.db.prepare("UPDATE teacher_profiles SET test_access=0,status='pending' WHERE user_id=?").run(f.other.user_id);assert.equal((await f.mark(f.other,0,'present',2)).status,403);assert.equal((await f.req(f.other,'/classes/'+f.classes[0].id+'/cancellation','POST',{cancelled:true,reason:'Revogação de teste'})).status,403);
});
test('Secretaria geral: não inferir do escopo, exige três núcleos e revoga a escrita na mesma sessão',async t=>{
 const f=await fixture(t);await assert.rejects(f.store.saveStaffAccount(f.admin.user_id,f.local.user_id,{...f.local,secretary_level:'general',units:['amavale']}),{status:400});
 const before=await f.store.systemRevision(f.general.user_id);await f.store.saveStaffAccount(f.admin.user_id,f.general.user_id,{...f.general,secretary_level:'local'});assert.notEqual((await f.store.systemRevision(f.general.user_id)).revision,before.revision);assert.equal((await f.mark(f.general,0,'present')).status,403);assert.equal((await f.req(f.general,'/me')).status,200);
});
test('Turmas: ativa exige professor habilitado do núcleo; rascunho inativo e turma legada ficam preservados',async t=>{
 const f=await fixture(t),p={...f.groups[0],version:0,students:[],teachers:[]};await assert.rejects(f.store.saveGroup(f.admin.user_id,null,p),{status:400});const draft=await f.store.saveGroup(f.admin.user_id,null,{...p,active:false});assert.equal(draft.active,false);await assert.rejects(f.store.saveGroup(f.admin.user_id,null,{...p,unit:'valparaiso',teachers:[f.teacher.user_id]}),{status:403});
 f.db.prepare('DELETE FROM group_teachers WHERE group_id=?').run(f.groups[0].id);f.reopen();assert.deepEqual((await f.store.group(f.admin.user_id,f.groups[0].id)).teachers,[]);await assert.rejects(f.store.createClass(f.admin.user_id,{group_id:f.groups[0].id,day:'2020-01-02'}),{status:409});assert.equal((await f.mark(f.admin,0,'present')).status,200);
 await assert.rejects(f.store.createClass(f.admin.user_id,{unit:'amavale',day:'2020-01-02',label:'Sem turma',time:'10:00'}),{status:400});
});
test('Histórico: repetição não duplica, conflito e lote inválido revertem presença e autoria juntos',async t=>{
 const f=await fixture(t);assert.equal((await f.mark(f.teacher,0,'present')).status,200);assert.equal((await f.mark(f.teacher,0,'present',1)).status,200);assert.equal((await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id)).changes.length,1);
 assert.equal((await f.mark(f.admin,0,'absent',0)).status,409);const bad=await f.req(f.admin,'/classes/'+f.classes[0].id+'/attendance','POST',{rows:[{id:'UND1_000001',status:'absent',version:1},{id:'UND2_000001',status:'present',version:0}]});assert.equal(bad.status,403);assert.equal((await f.store.attendance(f.admin.user_id,f.classes[0].id)).students[0].status,'present');assert.equal((await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id)).changes.length,1);
});
test('Histórico: concorrência entre contas aceita uma gravação, preserva autor e a outra recebe conflito',async t=>{
 const f=await fixture(t),r=await Promise.all([f.mark(f.teacher,0,'present'),f.mark(f.admin2,0,'absent')]);assert.deepEqual(r.map(x=>x.status).sort(),[200,409]);const h=await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id);assert.equal(h.changes.length,1);assert.equal(h.changes[0].actor,f.teacher.user_id);
});
test('Histórico: paginação não repete, identidade gravada permanece após edição e reinício',async t=>{
 const f=await fixture(t);for(let i=0;i<103;i++)await f.store.markAttendance(f.admin2.user_id,f.classes[0].id,[{id:'UND1_000001',status:i%2?'absent':'present',version:i}]);
 await f.store.saveStaffAccount(f.admin.user_id,f.admin2.user_id,{...f.admin2,name:'Nome Novo'});f.reopen();const a=await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id),b=await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id,a.next_before);assert.equal(a.changes.length,100);assert.equal(b.changes.length,3);assert.equal(b.next_before,null);assert.equal(new Set([...a.changes,...b.changes].map(r=>r.id)).size,103);assert.ok(a.changes.every(r=>r.actor_name===f.admin2.name));await assert.rejects(f.store.attendanceHistory(f.admin.user_id,f.classes[0].id,-1),{status:400});
});
test('Histórico legado: só último estado conhecido, migração idempotente e sem inventar situação anterior',async t=>{
 const f=await fixture(t);await f.mark(f.admin2,0,'present');await f.mark(f.admin2,0,'absent',1);f.db.exec("DROP TABLE attendance_changes; DELETE FROM auth_migrations WHERE name='attendance_history_baseline_v1'");f.reopen();let h=await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id);assert.equal(h.changes.length,1);assert.equal(h.changes[0].kind,'baseline');assert.equal(h.changes[0].previous_status,null);assert.equal(h.changes[0].status,'absent');assert.equal(h.changes[0].version,2);f.reopen();assert.equal((await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id)).changes.length,1);await f.mark(f.general,0,'justified',2);assert.equal((await f.store.attendanceHistory(f.admin.user_id,f.classes[0].id)).changes.length,2);
});
test('Histórico e CSV: consulta limitada ao núcleo, guardião não acessa e CSV informa o responsável',async t=>{
 const f=await fixture(t);await f.mark(f.admin2,0,'present');const exportData=await f.store.attendanceExport(f.admin.user_id,'amavale','2020-01-01','2020-01-02');assert.equal(exportData[0].updated_by_name,f.admin2.name);
 const guardian=await f.store.provision('guardian@example.test','guardian');f.token(guardian);assert.equal((await f.req(guardian,'/classes/'+f.classes[0].id+'/attendance-history')).status,403);
 const local=await f.store.saveStaffAccount(f.admin.user_id,f.local.user_id,{...f.local,units:['valparaiso']});f.token(local);assert.equal((await f.req(local,'/classes/'+f.classes[0].id+'/attendance-history')).status,403);assert.equal((await f.req(local,'/classes/'+f.classes[1].id+'/attendance-history')).status,200);
});
