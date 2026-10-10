// Complete, encrypted recovery packages. No restore operation touches a live directory.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,createPublicKey,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv,randomBytes,randomUUID,constants} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import * as tar from 'tar';

const MAGIC=Buffer.from('LPCB1\n'), MAX_BYTES=2*1024**3, MAX_ENTRIES=30000;
export const APP_ROOT=path.dirname(fileURLToPath(import.meta.url));
const ENV_KEYS=['PORTAL_SECRET','BOOTSTRAP_ADMIN_EMAIL','PUBLIC_ORIGIN','ADDITIONAL_PUBLIC_ORIGINS','RENDER_EXTERNAL_URL','RESEND_API_KEY','MAIL_FROM','PORTAL_INTAKE_ACTIVE','PORTAL_REGISTRY_ACTIVE','METRICS_ENABLED','AGENDA_EMAIL','PSYCHOLOGIST_EMAIL','SOCIAL_WORKER_EMAIL','WHATSAPP_ACCESS_TOKEN','WHATSAPP_API_VERSION','WHATSAPP_LANGUAGE','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_SENDER_PHONE','WHATSAPP_TEMPLATE','BACKUP_DRIVE_CLIENT_ID','BACKUP_DRIVE_CLIENT_SECRET','BACKUP_DRIVE_REFRESH_TOKEN'];
const err=message=>Object.assign(Error(message),{status:400});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function publicKeyInfo(pem){
 if(typeof pem!=='string'||pem.length>16000||!pem.startsWith('-----BEGIN PUBLIC KEY-----'))throw err('Informe somente a chave pública de recuperação.');
 let key;try{key=createPublicKey(pem)}catch{throw err('Chave pública de recuperação inválida.')}
 if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072||key.asymmetricKeyDetails.modulusLength>8192)throw err('Use uma chave RSA de 3072 a 8192 bits.');
 const der=key.export({type:'spki',format:'der'});return {key,pem:key.export({type:'spki',format:'pem'}).toString(),fingerprint:sha(der)};
}
export function safeRelative(name){
 if(typeof name!=='string'||name.length>600||name.includes('\\')||name.includes(':')||name.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f\x7f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)))throw err('Caminho inválido no pacote.');
 return name;
}
function within(root,file){const rel=path.relative(path.resolve(root),path.resolve(file));return !!rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)}
export async function digestFile(file,algorithm='sha256'){
 const h=createHash(algorithm);for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');
}
async function regularFile(root,name){
 safeRelative(name);const full=path.join(root,...name.split('/'));let current=path.resolve(root);
 if((await fsp.lstat(current)).isSymbolicLink())throw err('Links simbólicos não são aceitos.');
 for(const part of name.split('/')){current=path.join(current,part);if((await fsp.lstat(current)).isSymbolicLink())throw err('Links simbólicos não são aceitos.')}
 const stat=await fsp.stat(full);if(!stat.isFile()||stat.nlink>1)throw err('Tipo de arquivo não permitido.');return {full,stat};
}
function openDatabase(file,readOnly=true){
 const db=new DatabaseSync(file,{readOnly});db.function('br_day',{deterministic:true},v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date(v)));return db;
}
export function checkDatabase(file){
 const db=openDatabase(file);try{
  const integrity=db.prepare('PRAGMA integrity_check').all();if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')throw err('O banco não passou na verificação de integridade.');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw err('O banco contém vínculos inconsistentes.');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(),counts={},objects=new Set();
  for(const {name}of tables){if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))throw err('Tabela não reconhecida.');counts[name]=db.prepare(`SELECT count(*) AS n FROM "${name}"`).get().n;
   const columns=db.prepare(`PRAGMA table_info("${name}")`).all();if(columns.some(c=>c.name==='object_path'))for(const row of db.prepare(`SELECT object_path FROM "${name}"`).all())if(row.object_path)objects.add(safeRelative(row.object_path));
  }
  if('registrations'in counts)for(const row of db.prepare('SELECT documents FROM registrations').all())for(const doc of JSON.parse(row.documents))if(doc.object_path)objects.add(safeRelative(doc.object_path));
  if(!('members'in counts)||!('students'in counts))throw err('Banco de outro sistema.');
  return {counts,objects:[...objects].sort()};
 }finally{db.close()}
}
async function walk(root,prefix=''){
 const out=[];for(const item of await fsp.readdir(path.join(root,prefix),{withFileTypes:true})){
  const name=prefix?prefix+'/'+item.name:item.name;safeRelative(name);if(item.isSymbolicLink())throw err('Links simbólicos não são aceitos.');
  if(item.isDirectory())out.push(...await walk(root,name));else if(item.isFile())out.push(name);else throw err('Tipo de arquivo não permitido.');
 }return out;
}
async function copyChecked(fromRoot,name,toRoot,toName,files,budget){
 const {full,stat}=await regularFile(fromRoot,name);budget.bytes+=stat.size;if(budget.bytes>MAX_BYTES||files.length>=MAX_ENTRIES)throw err('Backup excede o limite seguro de 2 GB ou 30 mil arquivos.');
 const dest=path.join(toRoot,...safeRelative(toName).split('/'));await fsp.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await fsp.copyFile(full,dest,fs.constants.COPYFILE_EXCL);await fsp.chmod(dest,0o600);
 const after=await fsp.stat(full);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw err('Um arquivo mudou durante o backup. Tente novamente.');
 files.push({path:toName,size:stat.size,sha256:await digestFile(dest)});
}
export async function recoverySpace({dataDir,appRoot=APP_ROOT}){
 const checked=checkDatabase(path.join(dataDir,'portal.sqlite'));let bytes=(await fsp.stat(path.join(dataDir,'portal.sqlite'))).size;
 for(const name of checked.objects)bytes+=(await regularFile(path.join(dataDir,'objects'),name)).stat.size;
 for(const entry of await fsp.readdir(appRoot,{withFileTypes:true}))if(entry.isFile()&&(/\.(mjs|js|json|md|txt)$/.test(entry.name)||entry.name==='render.yaml'))bytes+=(await fsp.stat(path.join(appRoot,entry.name))).size;
 for(const directory of ['dist','data'])if(fs.existsSync(path.join(appRoot,directory)))for(const name of await walk(path.join(appRoot,directory)))bytes+=(await regularFile(appRoot,directory+'/'+name)).stat.size;
 if(bytes>MAX_BYTES)throw err('Backup excede o limite de 2 GB. Amplie a estratégia de armazenamento antes de continuar.');
 const disk=await fsp.statfs(dataDir),required=Math.ceil(bytes*2.2)+256*1024*1024,free=disk.bavail*disk.bsize;
 if(free<required)throw Object.assign(Error('Espaço insuficiente para cópia temporária e reserva de segurança.'),{status:507});return {bytes,required,free};
}
async function encryptArchive(stage,files,output,keyInfo,headerData){
 const secret=randomBytes(32),iv=randomBytes(12),header=Buffer.from(JSON.stringify({format:1,algorithm:'RSA-OAEP-SHA256+A256GCM',key_id:keyInfo.fingerprint,iv:iv.toString('base64'),wrapped_key:publicEncrypt({key:keyInfo.key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},secret).toString('base64'),...headerData}));
 const size=Buffer.alloc(4);size.writeUInt32BE(header.length);const aad=Buffer.concat([MAGIC,size,header]);
 await fsp.writeFile(output,aad,{flag:'wx',mode:0o600});const cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(aad);
 try{await pipeline(tar.c({cwd:stage,gzip:true,portable:true,noMtime:true,strict:true},files),cipher,fs.createWriteStream(output,{flags:'a',mode:0o600}));await fsp.appendFile(output,cipher.getAuthTag());}finally{secret.fill(0)}
}
export async function createRecoveryPackage({dataDir,env,publicKey,outputDir,appRoot=APP_ROOT,clock=()=>new Date()}){
 const root=path.resolve(dataDir),out=path.resolve(outputDir);if(!path.isAbsolute(dataDir)||!path.isAbsolute(outputDir)||out===root||within(root+'/objects',out)||out===path.join(root,'objects'))throw err('Destino de backup inválido.');
 publicKeyInfo(publicKey);await regularFile(root,'portal.sqlite');await recoverySpace({dataDir:root,appRoot});await fsp.mkdir(out,{recursive:true,mode:0o700});
 const stamp=clock().toISOString(),id=randomUUID(),name='backup-'+stamp.replace(/[-:.]/g,'')+'-'+id+'.lpcb',partial=path.join(out,name+'.partial'),file=path.join(out,name);
 const stage=await fsp.mkdtemp(path.join(out,'.backup-work-'));await fsp.chmod(stage,0o700);
 try{
  await fsp.mkdir(path.join(stage,'data'),{mode:0o700});const snapshot=path.join(stage,'data','portal.sqlite'),source=openDatabase(path.join(root,'portal.sqlite'));
  try{await backup(source,snapshot)}finally{source.close()}
  const snap=openDatabase(snapshot,false);try{snap.exec('PRAGMA journal_mode=DELETE; DELETE FROM sessions; DELETE FROM challenges; VACUUM;')}finally{snap.close()}
  const {counts,objects}=checkDatabase(snapshot),files=[{path:'data/portal.sqlite',size:(await fsp.stat(snapshot)).size,sha256:await digestFile(snapshot)}],budget={bytes:files[0].size};
  for(const object of objects)await copyChecked(path.join(root,'objects'),object,stage,'data/objects/'+object,files,budget);
  for(const entry of await fsp.readdir(appRoot,{withFileTypes:true}))if(entry.isFile()&&(/\.(mjs|js|json|md|txt)$/.test(entry.name)||entry.name==='render.yaml'))await copyChecked(appRoot,entry.name,stage,'app/'+entry.name,files,budget);
  for(const directory of ['dist','data'])if(fs.existsSync(path.join(appRoot,directory)))for(const item of await walk(path.join(appRoot,directory)))await copyChecked(appRoot,directory+'/'+item,stage,'app/'+directory+'/'+item,files,budget);
  const config=Object.fromEntries(ENV_KEYS.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
  if(!config.PORTAL_SECRET||config.PORTAL_SECRET.length<32)throw err('Configuração de recuperação incompleta.');
  const configBytes=Buffer.from(JSON.stringify(config,null,2));await fsp.writeFile(path.join(stage,'configuration.json'),configBytes,{mode:0o600});files.push({path:'configuration.json',size:configBytes.length,sha256:sha(configBytes)});
  // Repeat verification on the exact staged bytes used by the archive.
  const manifest={format:1,project:'luta-pela-comunidade',id,created_at:stamp,commit:env.RENDER_GIT_COMMIT||'local',node_major:24,counts,objects:objects.length,files,exclusions:['active sessions','login codes','unreferenced orphan uploads','provider accounts, DNS, email mailboxes and Google Drive contents'],configuration_keys:Object.keys(config)};
  await fsp.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
  await encryptArchive(stage,['manifest.json',...files.map(f=>f.path)],partial,publicKeyInfo(publicKey),{id,created_at:stamp});
  await fsp.rename(partial,file);return {id,name,file,created_at:stamp,sha256:await digestFile(file),md5:await digestFile(file,'md5'),size:(await fsp.stat(file)).size,files:files.length,objects:objects.length,key_id:publicKeyInfo(publicKey).fingerprint,commit:manifest.commit};
 }finally{
  if(within(out,stage)&&path.basename(stage).startsWith('.backup-work-'))await fsp.rm(stage,{recursive:true,force:true});
  await fsp.rm(partial,{force:true});
 }
}
async function decryptArchive(file,privateKey,output){
 const handle=await fsp.open(file,'r');let size,header,aad,start,tag;
 try{size=(await handle.stat()).size;if(size<64||size>MAX_BYTES+64*1024*1024)throw err('Tamanho de pacote inválido.');const prefix=Buffer.alloc(10);await handle.read(prefix,0,10,0);if(!prefix.subarray(0,6).equals(MAGIC))throw err('Formato de backup inválido.');const n=prefix.readUInt32BE(6);if(n<32||n>16000||size<10+n+16)throw err('Cabeçalho inválido.');const bytes=Buffer.alloc(n);await handle.read(bytes,0,n,10);header=JSON.parse(bytes);aad=Buffer.concat([prefix,bytes]);start=aad.length;tag=Buffer.alloc(16);await handle.read(tag,0,16,size-16);}finally{await handle.close()}
 if(header.format!==1||header.algorithm!=='RSA-OAEP-SHA256+A256GCM')throw err('Versão de criptografia não reconhecida.');
 let secret;try{secret=privateDecrypt({key:privateKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(header.wrapped_key,'base64'));const iv=Buffer.from(header.iv,'base64');if(secret.length!==32||iv.length!==12)throw Error();const decipher=createDecipheriv('aes-256-gcm',secret,iv);decipher.setAAD(aad);decipher.setAuthTag(tag);await pipeline(fs.createReadStream(file,{start,end:size-17}),decipher,fs.createWriteStream(output,{flags:'wx',mode:0o600}));}catch{throw err('Chave incorreta ou backup corrompido. Nenhum dado foi restaurado.')}finally{secret?.fill(0)}return header;
}
export async function restoreRecoveryPackage({file,privateKey,targetDir}){
 if(!path.isAbsolute(targetDir))throw err('Use um destino absoluto novo e isolado.');const target=path.resolve(targetDir);if(fs.existsSync(target))throw err('O destino já existe. A restauração nunca sobrescreve diretórios.');
 const parent=path.dirname(target);await fsp.mkdir(parent,{recursive:true,mode:0o700});const temp=await fsp.mkdtemp(path.join(parent,'.restore-work-'));await fsp.chmod(temp,0o700);
 try{
  const archive=path.join(temp,'authenticated.tar.gz'),payload=path.join(temp,'payload');await fsp.mkdir(payload,{mode:0o700});const header=await decryptArchive(file,privateKey,archive);
  let total=0;const names=new Set(),folded=new Set();
  const parser=tar.t({strict:true,onReadEntry:entry=>{try{const n=safeRelative(entry.path);if(entry.type!=='File'||names.has(n)||folded.has(n.toLowerCase())||entry.size<0||!Number.isSafeInteger(entry.size)||names.size>=MAX_ENTRIES||(total+=entry.size)>MAX_BYTES)throw err('Conteúdo inseguro ou excessivo no pacote.');names.add(n);folded.add(n.toLowerCase());}catch(error){parser.abort(error)}}});
  await pipeline(fs.createReadStream(archive),parser);
  await tar.x({file:archive,cwd:payload,strict:true,preservePaths:false,noChmod:true,noMtime:true,filter:(name,entry)=>names.has(name)&&entry.type==='File'});
  const manifest=JSON.parse(await fsp.readFile(path.join(payload,'manifest.json'),'utf8'));if(manifest.project!=='luta-pela-comunidade'||manifest.format!==1||manifest.id!==header.id||!Array.isArray(manifest.files)||manifest.files.length!==names.size-1)throw err('Manifesto inválido.');
  const listed=new Set();for(const record of manifest.files){const name=safeRelative(record.path);if(listed.has(name)||!names.has(name)||!(/^(data\/|app\/)/.test(name)||name==='configuration.json'))throw err('Arquivo inesperado no pacote.');listed.add(name);const {full,stat}=await regularFile(payload,name);if(stat.size!==record.size||await digestFile(full)!==record.sha256)throw err('Arquivo corrompido ou incompleto.');await fsp.chmod(full,0o600)}
  if(!listed.has('data/portal.sqlite')||!listed.has('configuration.json')||!listed.has('app/server.mjs')||!listed.has('app/package-lock.json'))throw err('Pacote incompleto.');
  const checked=checkDatabase(path.join(payload,'data','portal.sqlite'));if(JSON.stringify(checked.counts)!==JSON.stringify(manifest.counts)||checked.objects.length!==manifest.objects)throw err('Contagens de recuperação inconsistentes.');
  for(const object of checked.objects)if(!listed.has('data/objects/'+object))throw err('Documento ausente no backup.');
  const config=JSON.parse(await fsp.readFile(path.join(payload,'configuration.json'),'utf8'));if(typeof config.PORTAL_SECRET!=='string'||config.PORTAL_SECRET.length<32||Object.keys(config).some(k=>!ENV_KEYS.includes(k)))throw err('Configuração inválida.');
  await fsp.writeFile(path.join(payload,'ISOLATED-RESTORE.txt'),'Restauração isolada: não iniciar com a configuração de produção. Emails, WhatsApp e entrada pública devem permanecer desativados até revisão técnica.\n',{mode:0o600});
  if(fs.existsSync(target))throw err('O destino passou a existir. Operação cancelada.');await fsp.rename(payload,target);
  return {id:manifest.id,created_at:manifest.created_at,commit:manifest.commit,files:manifest.files.length,objects:manifest.objects,counts:checked.counts,sha256:await digestFile(file),integrity:'ok',target};
 }finally{if(within(parent,temp)&&path.basename(temp).startsWith('.restore-work-'))await fsp.rm(temp,{recursive:true,force:true})}
}
