import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {createRecoveryPackage,publicKeyInfo,digestFile} from './backup-core.mjs';
import {driveConfigured,uploadDriveBackup} from './backup-drive.mjs';
import {fail} from './portal-domain.mjs';

export function backupTools({db,get,all,run,tx,requireRole,audit,env,transport=fetch}){
 const directory=path.join(path.resolve(env.PORTAL_DATA_DIR),'recovery-backups');let running=false;
 db.exec(`CREATE TABLE IF NOT EXISTS recovery_settings(id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL DEFAULT '',key_id TEXT NOT NULL DEFAULT '',key_saved INTEGER NOT NULL DEFAULT 0,enabled INTEGER NOT NULL DEFAULT 0,interval_hours INTEGER NOT NULL DEFAULT 24,drive_folder TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,updated_at TEXT);
 INSERT OR IGNORE INTO recovery_settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS recovery_packages(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,state TEXT NOT NULL,size INTEGER,sha256 TEXT,md5 TEXT,files INTEGER,objects INTEGER,key_id TEXT,commit_sha TEXT,drive_id TEXT,drive_verified_at TEXT,downloaded_at TEXT,verified_at TEXT,error TEXT);
 CREATE TABLE IF NOT EXISTS recovery_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,state TEXT NOT NULL,error TEXT);`);
 run("UPDATE recovery_runs SET state='failed',error='A execução foi interrompida. A cópia anterior foi preservada.' WHERE state='running'");
 const settings=()=>get('SELECT * FROM recovery_settings WHERE id=1');
 const manager=actor=>requireRole(actor,['admin']);
 const publicSettings=()=>{const s=settings();return {configured:!!s.public_key,key_id:s.key_id,key_saved:!!s.key_saved,enabled:!!s.enabled,interval_hours:s.interval_hours,drive_folder:s.drive_folder,drive_connected:driveConfigured(env),version:s.version,updated_at:s.updated_at}};
 const records=()=>all('SELECT id,name,created_at,state,size,sha256,files,objects,key_id,commit_sha,drive_id,drive_verified_at,downloaded_at,verified_at,error FROM recovery_packages ORDER BY created_at DESC LIMIT 40');
 function recordFile(row){if(!row||!/^backup-[a-zA-Z0-9-]+\.lpcb$/.test(row.name))fail('Backup não localizado.',404);return path.join(directory,row.name)}
 async function generate(actor){
  if(actor)manager(actor);if(running)fail('Há um backup em execução.',409);const s=settings();if(!s.public_key||!s.key_saved)fail('Cadastre a chave pública e confirme a guarda da chave de recuperação.');
  const last=get('SELECT created_at FROM recovery_runs ORDER BY id DESC LIMIT 1');if(actor&&last&&Date.now()-Date.parse(last.created_at)<60000)fail('Aguarde um minuto antes de gerar outro backup.',429);
  running=true;const began=new Date().toISOString();run("INSERT INTO recovery_runs(created_at,state) VALUES(?,'running')",began);const rid=get('SELECT last_insert_rowid() AS id').id;
  try{
   // Preflight: avoid filling the production disk. The copy keeps a safety reserve.
   const disk=fs.statfsSync(path.resolve(env.PORTAL_DATA_DIR));if(disk.bavail*disk.bsize<256*1024*1024)fail('Espaço insuficiente. Libere ou amplie o disco antes de gerar o backup.',507);
   const p=await createRecoveryPackage({dataDir:env.PORTAL_DATA_DIR,env,publicKey:s.public_key,outputDir:directory});
   run('INSERT INTO recovery_packages(id,name,created_at,state,size,sha256,md5,files,objects,key_id,commit_sha) VALUES(?,?,?,?,?,?,?,?,?,?,?)',p.id,p.name,p.created_at,'local_ready',p.size,p.sha256,p.md5,p.files,p.objects,p.key_id,p.commit);
   if(s.drive_folder&&driveConfigured(env))try{const result=await uploadDriveBackup({env,folderId:s.drive_folder,record:p,transport});run("UPDATE recovery_packages SET state='drive_verified',drive_id=?,drive_verified_at=? WHERE id=?",result.id,result.verified_at,p.id)}catch{run("UPDATE recovery_packages SET error='Cópia externa não confirmada; arquivo local preservado.' WHERE id=?",p.id)}
   run("UPDATE recovery_runs SET state='completed' WHERE id=?",rid);audit(actor||'system','backup.created:'+p.id);
   return {id:p.id,message:'Backup criptografado criado. Confira separadamente a cópia externa e a restauração.'};
  }catch(error){run("UPDATE recovery_runs SET state='failed',error=? WHERE id=?",'Backup não concluído. A cópia anterior foi preservada.',rid);audit(actor||'system','backup.failed');throw error.status?error:Object.assign(Error('Backup não concluído. Confira espaço, arquivos e configuração.'),{status:500})}
  finally{running=false}
 }
 return {
  backupStatus(actor){manager(actor);const packages=records(),latest=packages[0],last=get('SELECT created_at,state,error FROM recovery_runs ORDER BY id DESC LIMIT 1'),s=settings();return {settings:publicSettings(),running,last_run:last||null,packages,overdue:!latest||Date.now()-Date.parse(latest.created_at)>s.interval_hours*3600000+1800000,external_pending:!latest?.drive_verified_at,restore_pending:!packages.some(p=>p.verified_at&&p.key_id===s.key_id&&Date.now()-Date.parse(p.verified_at)<30*86400000)}},
  backupSettings(actor,p){return tx(()=>{manager(actor);const s=settings();if(!p||p.version!==s.version)fail('A configuração mudou. Atualize a tela.',409);if(typeof p.enabled!=='boolean'||![4,12,24].includes(p.interval_hours)||typeof p.drive_folder!=='string'||p.drive_folder&&!/^[a-zA-Z0-9_-]{10,160}$/.test(p.drive_folder))fail('Confira a frequência e a pasta do Drive.');
   const key=p.public_key?publicKeyInfo(p.public_key):{pem:s.public_key,fingerprint:s.key_id};if(!key.pem||p.key_saved!==true)fail('Confirme que a chave privada de recuperação está guardada separadamente.');
   run('UPDATE recovery_settings SET public_key=?,key_id=?,key_saved=1,enabled=?,interval_hours=?,drive_folder=?,version=version+1,updated_at=? WHERE id=1',key.pem,key.fingerprint,+p.enabled,p.interval_hours,p.drive_folder,new Date().toISOString());audit(actor,'backup.settings');return publicSettings();})},
  createBackup:generate,
  async backupDownload(actor,id){manager(actor);const row=get('SELECT * FROM recovery_packages WHERE id=?',id),file=recordFile(row);if(!fs.existsSync(file))fail('Arquivo local indisponível. Consulte a cópia externa.',404);if(await digestFile(file)!==row.sha256)fail('Checksum divergente. Download bloqueado; preserve a cópia externa.',409);manager(actor);run('UPDATE recovery_packages SET downloaded_at=? WHERE id=?',new Date().toISOString(),id);audit(actor,'backup.download:'+id);return {body:Readable.toWeb(fs.createReadStream(file)),name:row.name,size:row.size,sha256:row.sha256}},
  async backupDrive(actor,id){manager(actor);if(running)fail('Há um backup em execução.',409);const row=get('SELECT * FROM recovery_packages WHERE id=?',id),file=recordFile(row);if(await digestFile(file)!==row.sha256)fail('Checksum divergente.',409);running=true;try{const result=await uploadDriveBackup({env,folderId:settings().drive_folder,record:{...row,file},transport});manager(actor);run("UPDATE recovery_packages SET state='drive_verified',drive_id=?,drive_verified_at=?,error=NULL WHERE id=?",result.id,result.verified_at,id);audit(actor,'backup.drive:'+id);return {message:'Cópia do Drive conferida por tamanho e checksum.'}}finally{running=false}},
  backupVerifyReport(actor,id,p){manager(actor);const row=get('SELECT * FROM recovery_packages WHERE id=?',id);if(!row||p?.id!==id||p.sha256!==row.sha256||p.integrity!=='ok'||p.files!==row.files||p.objects!==row.objects||p.commit!==row.commit_sha)fail('O relatório não corresponde a este backup.');run('UPDATE recovery_packages SET verified_at=? WHERE id=?',new Date().toISOString(),id);audit(actor,'backup.restore_report:'+id);return {message:'Relatório de restauração registrado pelo administrador.'}},
  async backupTick(){if(running)return;const s=settings();if(!s.enabled||!s.public_key||!s.key_saved)return;const latest=get('SELECT created_at FROM recovery_packages ORDER BY created_at DESC LIMIT 1'),last=get('SELECT created_at FROM recovery_runs ORDER BY id DESC LIMIT 1');if(last&&Date.now()-Date.parse(last.created_at)<3600000)return;if(!latest||Date.now()-Date.parse(latest.created_at)>=s.interval_hours*3600000)await generate(null)},
 };
}
