import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import sharp from 'sharp';
import {createSqliteStore} from './portal-sqlite.mjs';import {handlePortal} from './portal-handler.mjs';import {registrationReadiness} from './registration-readiness.mjs';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lpc-draft-import-')),env={PORTAL_DATA_DIR:dir,PORTAL_SECRET:'isolated-draft-'.repeat(4),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',BOOTSTRAP_STUDENTS_FILE:'',BOOTSTRAP_CONTACTS_FILE:'',BOOTSTRAP_AMAVALE_GROUPS:'false'},store=createSqliteStore(env),db=new DatabaseSync(path.join(dir,'portal.sqlite'));
 t.after(()=>{db.close();store.close();assert.ok(dir.startsWith(path.join(os.tmpdir(),'lpc-draft-import-')));fs.rmSync(dir,{recursive:true,force:true})});
 const admin=(await store.members())[0],staff=async(email,units)=>store.saveStaffAccount(admin.user_id,null,{name:'Pessoa Fictícia',email,phone:'24999999999',role:'secretary',secretary_level:'local',units,active:true,version:0});
 const local=await staff('local@example.test',['vale-do-carangola']),other=await staff('other@example.test',['amavale']),guardian=await store.provision('guardian@example.test','guardian');
 const tokens=new Map();for(const m of [admin,local,other,guardian]){const token=randomBytes(32).toString('base64url');db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),m.user_id,Date.now()+3600000);tokens.set(m.user_id,token);}
 const req=(m,route,method='GET',data)=>handlePortal(new Request(env.PUBLIC_ORIGIN+'/api/portal'+route,{method,headers:{Origin:env.PUBLIC_ORIGIN,Authorization:'Bearer '+tokens.get(m.user_id),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),env,store);
 const bytes=await sharp({create:{width:12,height:16,channels:3,background:'#38c'}}).jpeg().toBuffer();
 const row={student_name:'Criança Fictícia',birth_date:'2018-01-02',source_key:'instituicao-teste|RM-001',source_reference:'Arquivo fictício · RM-001 · Manhã',photo:{name:'RM-001.jpg',content:bytes.toString('base64')}},packet={unit:'vale-do-carangola',rows:[row]};
 return {dir,store,db,env,admin,local,other,guardian,req,row,packet};
}
test('Pré-cadastros: importa foto e origem sem responsável, consentimento ou ID; repetir e concorrer não duplica',async t=>{
 const f=await fixture(t),responses=await Promise.all([f.req(f.admin,'/registration-drafts/import','POST',f.packet),f.req(f.admin,'/registration-drafts/import','POST',f.packet)]);assert.ok(responses.every(r=>r.status===201));const results=await Promise.all(responses.map(r=>r.json()));assert.equal(results.reduce((n,r)=>n+r.created,0),1);assert.equal(results[0].records[0].id,results[1].records[0].id);
 const id=results[0].records[0].id,r=await f.store.registration(id);assert.equal(r.status,'needs_info');assert.equal(r.source,'staff_draft');assert.equal(r.student_id,null);assert.equal(r.guardian_email,'');assert.equal(r.consent_version,'');assert.equal(r.source_reference,f.row.source_reference);assert.equal(r.documents.length,1);assert.equal(r.documents[0].kind,'photo');assert.equal((await f.store.students()).length,0);assert.equal((await f.store.members()).filter(m=>m.role==='guardian').length,1);
 assert.equal((await f.req(f.local,'/registrations/'+id)).status,200);assert.equal((await f.req(f.other,'/registrations/'+id)).status,403);assert.equal((await f.req(f.guardian,'/registrations/'+id)).status,403);
 const queue=await f.req(f.local,'/registrations?status=needs_info&unit=vale-do-carangola');assert.equal(queue.status,200);assert.equal((await queue.json()).registrations.length,1);
 assert.equal((await f.req(f.local,'/registrations?status=needs_info&unit=amavale')).status,403);assert.equal((await f.req(f.admin,'/registrations?status=needs_info&unit=invalid')).status,400);assert.equal((await (await f.req(f.admin,'/registrations?status=needs_info&unit=amavale')).json()).registrations.length,0);
 const photo=await f.req(f.local,'/registrations/'+id+'/documents/'+r.documents[0].id);assert.equal(photo.status,200);assert.match(photo.headers.get('Cache-Control'),/no-store/);assert.equal((await sharp(Buffer.from(await photo.arrayBuffer())).metadata()).width,12);
 assert.equal((await f.req(f.other,'/registrations/'+id+'/documents/'+r.documents[0].id)).status,403);
 const after=createSqliteStore(f.env);try{assert.equal((await after.importRegistrationDrafts(f.admin.user_id,f.packet)).created,0)}finally{after.close()}
 assert.equal(f.db.prepare('SELECT count(*) n FROM registrations').get().n,1);
 const objects=fs.readdirSync(path.join(f.dir,'objects','registrations',id));assert.equal(objects.length,1);
});
test('Pré-cadastros: importação apenas geral, rejeita conflitos, fotos inválidas e lote repetido sem gravar parcialmente',async t=>{
 const f=await fixture(t);for(const m of [f.local,f.other,f.guardian])assert.equal((await f.req(m,'/registration-drafts/import','POST',f.packet)).status,403);
 for(const packet of [{...f.packet,unit:'outro'},{...f.packet,rows:[f.row,f.row]},{...f.packet,rows:[f.row,{...f.row,source_key:'outro'}]},{...f.packet,rows:[f.row,{...f.row,student_name:'Outra Fictícia',source_key:'outro',birth_date:'invalid'}]},{...f.packet,rows:[{...f.row,photo:{name:'x.jpg',content:Buffer.from('not-an-image').toString('base64')}}]}])assert.equal((await f.req(f.admin,'/registration-drafts/import','POST',packet)).status,400);
 assert.equal(f.db.prepare('SELECT count(*) n FROM registrations').get().n,0);await f.store.importRegistrationDrafts(f.admin.user_id,f.packet);
 assert.equal((await f.req(f.admin,'/registration-drafts/import','POST',{...f.packet,rows:[{...f.row,student_name:'Alteração Fictícia'}]})).status,409);
 assert.equal((await f.req(f.admin,'/registration-drafts/import','POST',{...f.packet,rows:[{...f.row,source_key:'outra-origem'}]})).status,409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM registrations').get().n,1);
});
test('Pré-cadastros: contato editável só no núcleo, exige versão e mantém aprovação bloqueada até responsável e documentos completos',async t=>{
 const f=await fixture(t),result=await f.store.importRegistrationDrafts(f.admin.user_id,f.packet),id=result.records[0].id;let r=await f.store.registration(id);
 const group=await f.store.saveGroup(f.admin.user_id,null,{unit:f.packet.unit,label:'Manhã Fictícia',weekdays:[1,3],start_time:'10:30',end_time:'11:30',active:false,students:[],teachers:[],registrations:[id],version:0});
 const contact={guardian_name:'Responsável Fictício',guardian_email:'family@example.test',guardian_phone:'24999999999',relationship:'Mãe',version:r.version};
 assert.equal((await f.req(f.other,'/registrations/'+id+'/draft-contact','PATCH',contact)).status,403);
 assert.equal((await f.req(f.guardian,'/registrations/'+id+'/draft-contact','PATCH',contact)).status,403);
 assert.equal((await f.req(f.local,'/registrations/'+id+'/draft-contact','PATCH',{...contact,guardian_email:'invalid'})).status,400);
 // Documents alone cannot grant a guardian access or approve this draft.
 for(const kind of ['student_document','guardian_document','medical_certificate','consent']){r=await f.store.registration(id);await f.store.registrationUpload(f.admin.user_id,id,r.version,{id:randomBytes(16).toString('hex'),kind,object_path:'fixture/'+kind,original_name:'FICTICIO.pdf',mime:'application/pdf',size:20});}
 r=await f.store.registration(id);assert.equal(registrationReadiness(r).ready,false);assert.ok(registrationReadiness(r).missing.includes('Nome do responsável'));
 await assert.rejects(f.store.reviewRegistration(f.admin.user_id,id,{version:r.version,decision:'approved',reason:'',checked:true}),{status:400});
 contact.version=r.version;assert.equal((await f.req(f.local,'/registrations/'+id+'/draft-contact','PATCH',contact)).status,200);assert.equal((await f.req(f.local,'/registrations/'+id+'/draft-contact','PATCH',contact)).status,409);
 r=await f.store.registration(id);assert.equal(registrationReadiness(r).ready,true);const approved=await f.store.reviewRegistration(f.admin.user_id,id,{version:r.version,decision:'approved',reason:'',checked:true});assert.equal(approved.student_id,'UND3_000001');assert.equal((await f.store.documents(approved.student_id)).filter(d=>d.kind==='photo').length,1);
 const enrolled=await f.store.group(f.admin.user_id,group.id);assert.ok(enrolled.students.find(s=>s.id===approved.student_id).enrolled);assert.equal(enrolled.version,2);assert.equal(enrolled.registrations.length,0);assert.equal(f.db.prepare('SELECT count(*) n FROM group_registrations').get().n,0);assert.equal((await f.store.groups(f.admin.user_id,f.packet.unit))[0].enrolled,1);
 assert.equal((await f.req(f.local,'/registrations/'+id+'/draft-contact','PATCH',{...contact,version:r.version+1})).status,409);
});

test('Alunos inclui pré-cadastros importados para contato posterior, sem duplicar ficha aprovada nem vazar outro núcleo',async t=>{
 const f=await fixture(t);await f.req(f.admin,'/registration-drafts/import','POST',f.packet);
 const local=await (await f.req(f.local,'/students')).json();assert.equal(local.students.length,0);assert.equal(local.drafts.length,1);assert.equal(local.drafts[0].status,'incomplete');assert.equal(local.drafts[0].name,f.row.student_name);
 assert.equal((await (await f.req(f.other,'/students')).json()).drafts.length,0);assert.equal((await (await f.req(f.guardian,'/students')).json()).drafts.length,0);
 f.db.prepare("UPDATE registrations SET status='rejected'").run();assert.equal((await (await f.req(f.admin,'/students')).json()).drafts.length,0);
});


test('Turmas: pré-cadastro incompleto fica vinculado sem aprovação, foto preservada e uma turma por criança',async t=>{
 const f=await fixture(t),imported=await f.store.importRegistrationDrafts(f.admin.user_id,f.packet),id=imported.records[0].id;
 const data={unit:f.packet.unit,label:'Manhã Fictícia',weekdays:[1,3],start_time:'10:30',end_time:'11:30',active:false,students:[],teachers:[],registrations:[id],version:0};
 const response=await f.req(f.local,'/groups','POST',data);assert.equal(response.status,201);const group=(await response.json()).group;
 let list=(await (await f.req(f.local,'/groups?unit='+f.packet.unit)).json()).groups;assert.equal(list[0].provisional_enrolled,1);assert.equal(list[0].enrolled,0);
 const draft=await f.store.registration(id);assert.equal(draft.status,'needs_info');assert.equal(draft.student_id,null);assert.equal(draft.documents.length,1);assert.equal((await f.store.students()).length,0);
 assert.equal((await (await f.req(f.local,'/students')).json()).drafts[0].provisional_group_label,data.label);
 assert.equal((await f.req(f.other,'/groups/'+group.id)).status,403);assert.equal((await f.req(f.guardian,'/groups/'+group.id)).status,403);
 assert.equal((await f.req(f.local,'/groups','POST',{...data,label:'Tarde Fictícia',start_time:'15:00',end_time:'16:00'})).status,409);
 assert.equal((await f.req(f.local,'/groups/'+group.id,'PATCH',{...data,version:1,registrations:[id,id]})).status,400);
 assert.equal((await f.req(f.local,'/groups','POST',{...data,unit:'amavale'})).status,403);
 const {registrations,...legacy}=data;assert.equal((await f.req(f.local,'/groups/'+group.id,'PATCH',{...legacy,version:1})).status,200);assert.equal((await f.store.groups(f.admin.user_id,f.packet.unit))[0].provisional_enrolled,1);
 assert.equal((await f.req(f.local,'/groups/'+group.id,'PATCH',{...data,version:1})).status,409);
 assert.equal((await f.req(f.local,'/groups/'+group.id,'PATCH',{...data,version:2,registrations:[]})).status,200);assert.equal((await f.store.groups(f.admin.user_id,f.packet.unit))[0].provisional_enrolled,0);
});


test('Turmas: decisão de não aprovação retira vínculo provisório e invalida edição antiga da turma',async t=>{
 const f=await fixture(t),imported=await f.store.importRegistrationDrafts(f.admin.user_id,f.packet),id=imported.records[0].id;
 const g=await f.store.saveGroup(f.admin.user_id,null,{unit:f.packet.unit,label:'Turma Fictícia',weekdays:[1],start_time:'10:30',end_time:'11:30',active:false,students:[],teachers:[],registrations:[id],version:0});
 await f.store.reviewRegistration(f.admin.user_id,id,{decision:'rejected',reason:'Decisão fictícia de teste',version:1});assert.equal(f.db.prepare('SELECT count(*) n FROM group_registrations').get().n,0);assert.equal((await f.store.group(f.admin.user_id,g.id)).version,2);assert.equal((await f.store.groups(f.admin.user_id,f.packet.unit))[0].provisional_enrolled,0);
});
