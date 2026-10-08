import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {localDay} from './professional-tools.mjs';

async function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-graduation-')),mail=[],env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'fictitious-only-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',RESEND_API_KEY:'fake',MAIL_FROM:'sender@example.test',PUBLIC_ORIGIN:'https://example.test'};
 let store=createSqliteStore(env,{transport:async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:randomUUID()})}});
 const admin=(await store.members())[0],guardian=await store.provision('parent@example.test','guardian'),teacher=await store.saveTeacher(admin.user_id,null,{name:'Professor Fictício',email:'teacher@example.test',phone:'24999999999',status:'pending',test_access:true,units:['amavale'],version:0});
 const id='UND1_000001';await store.import(admin.user_id,[{id,name:'Aluno Fictício',birth_date:'2015-01-01',status:'approved',version:0},{id:'UND1_000002',name:'Outro Aluno Fictício',birth_date:'2015-01-01',status:'approved',version:0}]);
 const db=new DatabaseSync(path.join(dir,'portal.sqlite'));
 db.prepare('INSERT INTO links VALUES(?,?)').run(guardian.user_id,id);
 t.after(()=>{db.close();store.close();fs.rmSync(dir,{recursive:true,force:true})});
 const date=offset=>new Date(Date.parse(localDay()+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
 function lesson(offset,status='present',cancelled=0){const lessonId=randomUUID();db.prepare('INSERT INTO classes(id,unit,day,time,label,created_by,created_at,cancelled) VALUES(?,?,?,?,?,?,?,?)').run(lessonId,'amavale',date(offset),'15:00','Aula fictícia',admin.user_id,new Date().toISOString(),cancelled);db.prepare('INSERT INTO attendance VALUES(?,?,?,?,?,?)').run(lessonId,id,status,1,admin.user_id,new Date().toISOString());return lessonId;}
 const initial=(extra={})=>store.saveStudentGraduation(admin.user_id,id,{belt:'Branca',degrees:0,last_graduation_date:date(-100),version:0,reason:'Ficha inicial fictícia',checked:true,...extra});
 const award=(version=1,extra={})=>store.confirmStudentGraduation(admin.user_id,id,{action:'degree',date:date(0),version,policy_version:1,reason:'Avaliação fictícia da equipe',checked:true,...extra});
 async function request(actorEmail,route,method='GET',data){await store.requestCode(actorEmail);const token=(await store.verifyCode(actorEmail,mail.at(-1).text.match(/\b\d{8}\b/)[0])).access_token;return handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,store)}
 return {get store(){return store},db,env,admin,guardian,teacher,id,date,lesson,initial,award,request,reopen(){store.close();store=createSqliteStore(env,{transport:async()=>Response.json({id:'fake'})})}};
}

test('47/48 presenças, faltas, justificativas, data de referência e cancelamentos são distintos',async t=>{
 const f=await setup(t);f.lesson(-101);f.lesson(-100);for(let i=1;i<=47;i++)f.lesson(-i);f.lesson(-60,'absent');f.lesson(-61,'justified');f.lesson(-62,'unmarked');f.lesson(-63,'present',1);f.lesson(1);
 let r=await f.store.studentProgression(f.admin.user_id,f.id);assert.equal(r.remaining_for_degree,null);assert.equal(r.degree_ready,false);
 r=await f.initial();assert.equal(r.cycle.present,47);assert.equal(r.totals.present,49);assert.equal(r.cycle.absent,1);assert.equal(r.cycle.justified,1);assert.equal(r.cycle.unmarked,1);assert.equal(r.totals.cancelled,1);assert.equal(r.remaining_for_degree,1);assert.equal(r.remaining_for_exam,145);assert.equal(r.degree_ready,false);
 await assert.rejects(f.award(),e=>e.status===409);
 f.lesson(-48);r=await f.store.studentProgression(f.admin.user_id,f.id);assert.equal(r.degree_ready,true);assert.equal(r.remaining_for_exam,144);
 const granted=await f.award();assert.equal(granted.profile.degrees,1);assert.equal(granted.cycle.present,0);assert.equal(granted.remaining_for_degree,48);assert.equal(granted.remaining_for_exam,144);
 await assert.rejects(f.award(),e=>e.status===409);assert.equal(granted.history.length,2);
});

test('quarto grau libera sugestão de exame; nova faixa exige confirmação e reinicia graus',async t=>{
 const f=await setup(t);await f.initial({degrees:3});for(let i=1;i<=48;i++)f.lesson(-i);
 let r=await f.award(1,{date:f.date(-1)});assert.equal(r.exam_ready,true);assert.equal(r.remaining_for_exam,0);assert.equal(r.degree_ready,false);
 await assert.rejects(f.award(2,{date:f.date(0)}),e=>e.status===409);
 r=await f.award(2,{action:'belt',belt:'Cinza e branca'});assert.equal(r.profile.belt,'Cinza e branca');assert.equal(r.profile.degrees,0);assert.equal(r.exam_ready,false);assert.equal(r.remaining_for_exam,192);
 f.reopen();assert.equal((await f.store.studentProgression(f.admin.user_id,f.id)).profile.belt,'Cinza e branca');
});

test('correção de chamada revoga sugestão; política configurável protege versões e não altera graus',async t=>{
 const f=await setup(t);await f.initial();const a=f.lesson(-2);await f.store.saveGraduationPolicy(f.admin.user_id,{version:1,lessons_per_degree:1,reason:'Teste de regra configurável'});
 assert.equal((await f.store.studentProgression(f.admin.user_id,f.id)).degree_ready,true);
 await assert.rejects(f.award(),e=>e.status===409);
 await f.store.markAttendance(f.admin.user_id,a,[{id:f.id,status:'absent',version:1}]);
 assert.equal((await f.store.studentProgression(f.admin.user_id,f.id)).degree_ready,false);
 await assert.rejects(f.award(1,{policy_version:2}),e=>e.status===409);
 for(const n of [0,1.5,501])await assert.rejects(f.store.saveGraduationPolicy(f.admin.user_id,{version:2,lessons_per_degree:n,reason:'Teste inválido'}));
 assert.equal((await f.store.studentProgression(f.admin.user_id,f.id)).profile.degrees,0);
});

test('ficha e API protegem vínculos, perfis, datas e edições simultâneas',async t=>{
 const f=await setup(t);await f.initial();const route='/students/'+f.id+'/progression';
 assert.equal((await f.request('parent@example.test',route)).status,200);
 assert.equal((await f.request('teacher@example.test',route)).status,403);
 await assert.rejects(f.store.studentProgression(f.guardian.user_id,'UND1_000002'),e=>e.status===403);
 await assert.rejects(f.store.saveStudentGraduation(f.guardian.user_id,f.id,{}),e=>e.status===403);
 await assert.rejects(f.store.saveGraduationPolicy(f.guardian.user_id,{}),e=>e.status===403);
 await assert.rejects(f.initial(),e=>e.status===409);
 for(const value of ['2025-02-30','2014-01-01',f.date(1)])await assert.rejects(f.initial({version:1,last_graduation_date:value}));
 await assert.rejects(f.initial({version:1,degrees:5}));await assert.rejects(f.initial({version:1,checked:false}));
 const r=await f.initial({version:1,degrees:2,reason:'Correção documental fictícia'});assert.equal(r.history[0].before.degrees,0);assert.equal(r.history[0].after.degrees,2);
 const evidence=JSON.parse(f.db.prepare("SELECT evidence_json FROM graduation_history WHERE action='initial'").get().evidence_json);assert.deepEqual(evidence,{});
});
