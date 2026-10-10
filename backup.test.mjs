import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,createHash,randomBytes,publicEncrypt,createCipheriv,constants} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {Header} from 'tar';
import {createSqliteStore} from './portal-sqlite.mjs';
import {handlePortal} from './portal-handler.mjs';
import {createRecoveryPackage,restoreRecoveryPackage,digestFile,publicKeyInfo,safeRelative,recoverySpace} from './backup-core.mjs';
import {uploadDriveBackup} from './backup-drive.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync(path.join(process.platform==='win32'?import.meta.dirname:os.tmpdir(),'.backup-test-')),dataDir=path.join(root,'source'),appRoot=path.join(root,'app');fs.mkdirSync(appRoot);fs.mkdirSync(path.join(appRoot,'dist'));fs.writeFileSync(path.join(appRoot,'server.mjs'),'// fixture code');fs.writeFileSync(path.join(appRoot,'package-lock.json'),'{}');fs.writeFileSync(path.join(appRoot,'dist','index.html'),'<h1>Fixture</h1>');fs.writeFileSync(path.join(appRoot,'.env'),'excluded-secret');
 const env={PORTAL_DATA_DIR:dataDir,PORTAL_SECRET:'isolated-test-secret-'.repeat(3),BOOTSTRAP_ADMIN_EMAIL:'admin@example.test',PUBLIC_ORIGIN:'https://example.test',RESEND_API_KEY:'never-send',MAIL_FROM:'sender@example.test',RENDER_GIT_COMMIT:'fixture-revision'},mail=[];
 const store=createSqliteStore(env,{transport:async(u,o)=>{mail.push(JSON.parse(o.body));return Response.json({id:'test'})}}),db=new DatabaseSync(path.join(dataDir,'portal.sqlite')),admin=db.prepare('SELECT user_id FROM members WHERE role=?').get('admin').user_id;
 db.prepare('INSERT INTO students(id,name,birth_date,status,updated_at) VALUES(?,?,?,?,?)').run('UND1_000001','Aluno fictício confidencial','2014-04-04','approved',new Date().toISOString());
 fs.writeFileSync(path.join(dataDir,'objects','fixture.pdf'),'%PDF-1.7 confidential fixture');
 db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run('test-document','UND1_000001','student_document','fixture.pdf','fixture.pdf','application/pdf',29,admin,new Date().toISOString());
 db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash('a'.repeat(43)),admin,Date.now()+3600000);
 t.after(()=>{store.close();db.close();fs.rmSync(root,{recursive:true,force:true})});
 return {root,dataDir,appRoot,env,store,db,admin,mail,create:()=>createRecoveryPackage({dataDir,env,appRoot,publicKey:keys.publicKey,outputDir:path.join(root,'packages')})};
}
test('pacote completo restaura banco, documentos, código e configuração; não copia sessões ou .env',async t=>{
 const f=fixture(t);const p=await f.create(),bytes=fs.readFileSync(p.file);assert.equal(bytes.subarray(0,6).toString(),'LPCB1\n');assert.equal(bytes.includes(Buffer.from('Aluno fictício')),false);assert.equal(bytes.includes(Buffer.from(f.env.PORTAL_SECRET)),false);
 const r=await restoreRecoveryPackage({file:p.file,privateKey:keys.privateKey,targetDir:path.join(f.root,'restored')});assert.equal(r.integrity,'ok');assert.equal(r.counts.students,1);assert.equal(r.objects,1);assert.equal(r.counts.sessions,0);assert.equal(r.sha256,p.sha256);assert.equal(fs.readFileSync(path.join(r.target,'data/objects/fixture.pdf'),'utf8'),'%PDF-1.7 confidential fixture');assert.equal(fs.existsSync(path.join(r.target,'app/.env')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(r.target,'configuration.json'))).PORTAL_SECRET,f.env.PORTAL_SECRET);assert.equal(f.db.prepare('SELECT count(*) n FROM sessions').get().n,1);assert.equal((await f.store.user('a'.repeat(43))).id,f.admin);
 assert.deepEqual(fs.readdirSync(path.join(f.root,'packages')),[p.name]);
});
test('chave incorreta, truncamento e alteração de ciphertext falham sem destino parcial',async t=>{
 const f=fixture(t),p=await f.create(),bytes=fs.readFileSync(p.file),wrong=generateKeyPairSync('rsa',{modulusLength:3072});
 await assert.rejects(restoreRecoveryPackage({file:p.file,privateKey:wrong.privateKey,targetDir:path.join(f.root,'wrong')}),/Chave incorreta/);assert.equal(fs.existsSync(path.join(f.root,'wrong')),false);
 bytes[bytes.length-50]^=1;const changed=path.join(f.root,'tampered.lpcb');fs.writeFileSync(changed,bytes);
 await assert.rejects(restoreRecoveryPackage({file:changed,privateKey:keys.privateKey,targetDir:path.join(f.root,'tampered')}),/corrompido/);
 fs.writeFileSync(changed,bytes.subarray(0,20));await assert.rejects(restoreRecoveryPackage({file:changed,privateKey:keys.privateKey,targetDir:path.join(f.root,'truncated')}));assert.equal(fs.readdirSync(f.root).some(n=>n.startsWith('.restore-work-')),false);
});
test('restauração nunca sobrescreve destino existente',async t=>{const f=fixture(t),p=await f.create();await assert.rejects(restoreRecoveryPackage({file:p.file,privateKey:keys.privateKey,targetDir:f.dataDir}),/já existe/);assert.equal(f.db.prepare('SELECT count(*) n FROM students').get().n,1)});
test('snapshot inclui alterações confirmadas no WAL e preserva transação ainda não confirmada',async t=>{
 const f=fixture(t);f.db.exec('PRAGMA journal_mode=WAL');f.db.prepare('UPDATE students SET weight_kg=35').run();f.db.exec('BEGIN');f.db.prepare('UPDATE students SET weight_kg=36').run();
 const p=await f.create();f.db.exec('ROLLBACK');const r=await restoreRecoveryPackage({file:p.file,privateKey:keys.privateKey,targetDir:path.join(f.root,'wal')});const db=new DatabaseSync(path.join(r.target,'data/portal.sqlite'));try{assert.equal(db.prepare('SELECT weight_kg FROM students').get().weight_kg,35)}finally{db.close()}
});
test('documento ausente impede backup completo e preserva cópia anterior',async t=>{
 const f=fixture(t),p=await f.create();fs.renameSync(path.join(f.dataDir,'objects/fixture.pdf'),path.join(f.root,'document.pdf'));await assert.rejects(f.create());assert.equal(await digestFile(p.file),p.sha256);
});
test('arquivo-fonte com hardlink é rejeitado', {skip:process.platform==='win32'?'Sandbox Windows não permite criar hardlinks; verificado no build Linux.':false},async t=>{const f=fixture(t);fs.linkSync(path.join(f.dataDir,'objects/fixture.pdf'),path.join(f.root,'linked.pdf'));await assert.rejects(f.create(),/Tipo de arquivo/)});
test('preflight mantém reserva de espaço; caminhos perigosos e chave privada não são aceitos',async t=>{
 const f=fixture(t),s=await recoverySpace(f);assert.ok(s.required>s.bytes*2);assert.ok(s.free>=s.required);
 for(const n of ['../a','/etc/passwd','a/../b','a\\b','c:a','a//b','AUX.txt','a.','a/COM1','a\x00b'])assert.throws(()=>safeRelative(n));assert.equal(safeRelative('docs/file.pdf'),'docs/file.pdf');assert.throws(()=>publicKeyInfo(keys.privateKey),/somente/);
});
function maliciousArchive(entries){const chunks=[];for(const e of entries){const b=Buffer.alloc(512),content=Buffer.from(e.content||'');new Header({path:e.path,type:e.type||'File',size:e.size??content.length,mode:0o600,mtime:new Date(0),linkpath:e.linkpath||''}).encode(b);chunks.push(b,content);if(content.length%512)chunks.push(Buffer.alloc(512-content.length%512))}return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]))}
function encryptedPayload(payload){const key=randomBytes(32),iv=randomBytes(12),h=Buffer.from(JSON.stringify({format:1,algorithm:'RSA-OAEP-SHA256+A256GCM',id:'test',iv:iv.toString('base64'),wrapped_key:publicEncrypt({key:keys.publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64')})),len=Buffer.alloc(4);len.writeUInt32BE(h.length);const aad=Buffer.concat([Buffer.from('LPCB1\n'),len,h]),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);return Buffer.concat([aad,cipher.update(payload),cipher.final(),cipher.getAuthTag()])}
test('arquivo autenticado com traversal, symlink, duplicação ou tamanho excessivo é rejeitado antes de extrair',async t=>{
 const f=fixture(t),cases=[[{path:'../escape',content:'bad'}],[{path:'link',type:'SymbolicLink',linkpath:'../source'}],[{path:'same',content:'a'},{path:'same',content:'b'}],[{path:'Case',content:'a'},{path:'case',content:'b'}],[{path:'bomb',size:3*1024**3}]];
 for(let i=0;i<cases.length;i++){const file=path.join(f.root,'malicious-'+i+'.lpcb');fs.writeFileSync(file,encryptedPayload(maliciousArchive(cases[i])));await assert.rejects(restoreRecoveryPackage({file,privateKey:keys.privateKey,targetDir:path.join(f.root,'reject-'+i)}));assert.equal(fs.existsSync(path.join(f.root,'reject-'+i)),false)}assert.equal(fs.existsSync(path.join(f.root,'escape')),false);
});
function request(route,method='GET',body,token='a'.repeat(43)){return new Request('https://example.test/api/portal'+route,{method,headers:{Origin:'https://example.test',Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})}
test('rotas de backup negam todos os papéis não administradores e ausência de sessão',async t=>{
 const f=fixture(t);assert.equal((await handlePortal(request('/backups','GET',null,''),f.env,f.store)).status,401);
 for(const role of ['teacher','guardian','psychologist','social_worker','secretary']){f.db.prepare('UPDATE members SET role=? WHERE user_id=?').run(role,f.admin);for(const [route,method]of [['/backups','GET'],['/backups','POST'],['/backups/settings','PATCH'],['/backups/11111111-1111-4111-8111-111111111111/download','GET']])assert.equal((await handlePortal(request(route,method,method==='GET'?null:{}),f.env,f.store)).status,403,role+' '+route)}
});
test('configuração administrativa exige versão, confirmação de guarda e frequência válida',async t=>{
 const f=fixture(t),policy={public_key:keys.publicKey,key_saved:true,enabled:true,interval_hours:4,drive_folder:'',version:1};assert.throws(()=>f.store.backupSettings(f.admin,{...policy,key_saved:false}));assert.throws(()=>f.store.backupSettings(f.admin,{...policy,interval_hours:1}));assert.throws(()=>f.store.backupSettings(f.admin,{...policy,version:0}),e=>e.status===409);
 const response=await handlePortal(request('/backups/settings','PATCH',policy),f.env,f.store);assert.equal(response.status,200);assert.equal(f.store.backupStatus(f.admin).settings.interval_hours,4);assert.doesNotMatch(JSON.stringify(f.store.backupStatus(f.admin)),/BEGIN PUBLIC|never-send|PORTAL_SECRET/);
 assert.equal((await handlePortal(new Request('https://example.test/api/portal/backups/settings',{method:'PATCH',headers:{Origin:'https://evil.test',Authorization:'Bearer '+'a'.repeat(43)},body:JSON.stringify(policy)}),f.env,f.store)).status,403);
});
test('geração, download conferido, relatório e agendador; falha mantém backup anterior',async t=>{
 const f=fixture(t);await f.store.backupTick();assert.equal(f.store.backupStatus(f.admin).packages.length,0);f.store.backupSettings(f.admin,{public_key:keys.publicKey,key_saved:true,enabled:true,interval_hours:4,drive_folder:'',version:1});
 const creating=f.store.createBackup(f.admin);await assert.rejects(f.store.createBackup(f.admin),e=>e.status===409);const result=await creating,status=f.store.backupStatus(f.admin),p=status.packages[0];assert.equal(result.id,p.id);assert.equal(status.external_pending,true);assert.equal(status.restore_pending,true);
 await assert.rejects(f.store.createBackup(f.admin),e=>e.status===429);await f.store.backupTick();assert.equal(f.store.backupStatus(f.admin).packages.length,1);
 const response=await handlePortal(request('/backups/'+p.id+'/download'),f.env,f.store);assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.equal(hash(bytes),p.sha256);assert.equal(response.headers.get('cache-control'),'no-store');
 const r=await restoreRecoveryPackage({file:path.join(f.dataDir,'recovery-backups',p.name),privateKey:keys.privateKey,targetDir:path.join(f.root,'store-restore')});f.store.backupVerifyReport(f.admin,p.id,r);assert.equal(f.store.backupStatus(f.admin).restore_pending,false);assert.throws(()=>f.store.backupVerifyReport(f.admin,p.id,{...r,sha256:'wrong'}));
 f.db.exec("UPDATE recovery_runs SET created_at='2020-01-01'; UPDATE recovery_packages SET created_at='2020-01-01'");fs.renameSync(path.join(f.dataDir,'objects/fixture.pdf'),path.join(f.root,'missing.pdf'));await assert.rejects(f.store.backupTick());assert.equal(f.store.backupStatus(f.admin).last_run.state,'failed');assert.equal(await digestFile(path.join(f.dataDir,'recovery-backups',p.name)),p.sha256);
 fs.appendFileSync(path.join(f.dataDir,'recovery-backups',p.name),'bad');await assert.rejects(f.store.backupDownload(f.admin,p.id),e=>e.status===409);
});
const driveEnv={BACKUP_DRIVE_CLIENT_ID:'client-test',BACKUP_DRIVE_CLIENT_SECRET:'secret-test',BACKUP_DRIVE_REFRESH_TOKEN:'refresh-test'};
test('Drive confere checksum, evita duplicata e rejeita redirecionamento ou resposta divergente',async t=>{
 const f=fixture(t),p=await f.create();let puts=0,existing=false,wrong=false,evil=false;
 const transport=async(url,o)=>{if(url.includes('oauth2'))return Response.json({access_token:'test-access'});if(url.includes('capabilities'))return Response.json({mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});if(o?.method==='POST')return new Response('',{headers:{location:evil?'https://evil.test/upload/drive/x':'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'}});if(o?.method==='PUT'){puts++;const chunks=[];for await(const c of o.body)chunks.push(c);assert.equal(hash(Buffer.concat(chunks)),p.sha256);return Response.json({id:'drive-file',size:String(p.size),md5Checksum:wrong?'wrong':p.md5})}return Response.json({files:existing?[{id:'existing',size:String(p.size),md5Checksum:p.md5}]:[]})};
 const args={env:driveEnv,folderId:'folder-institutional',record:p,transport};assert.equal((await uploadDriveBackup(args)).id,'drive-file');assert.equal(puts,1);existing=true;assert.equal((await uploadDriveBackup(args)).id,'existing');assert.equal(puts,1);existing=false;wrong=true;await assert.rejects(uploadDriveBackup(args),/checksum/);evil=true;await assert.rejects(uploadDriveBackup(args),/Destino/);
 await assert.rejects(uploadDriveBackup({...args,env:{}}),/configurada/);await assert.rejects(uploadDriveBackup({...args,transport:async()=>new Response('',{status:401})}),/autorizar/);
});
