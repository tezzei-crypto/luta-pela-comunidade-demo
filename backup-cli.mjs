import fs from 'node:fs/promises';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {publicKeyInfo,restoreRecoveryPackage,createRecoveryPackage,digestFile} from './backup-core.mjs';
const [command,...args]=process.argv.slice(2);
try{
 if(command==='keygen'){
  const folder=args[0];if(!folder||!path.isAbsolute(folder))throw Error('Informe um diretório absoluto novo para guardar as chaves.');await fs.mkdir(folder,{mode:0o700});
  const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  await fs.writeFile(path.join(folder,'luta-recovery.private.pem'),keys.privateKey,{flag:'wx',mode:0o600});await fs.writeFile(path.join(folder,'luta-recovery.public.pem'),keys.publicKey,{flag:'wx',mode:0o600});
  await fs.writeFile(path.join(folder,'LEIA-ME.txt'),'A chave privada abre todos os backups desta chave. Guarde uma segunda cópia em mídia separada, protegida e sob responsabilidade da administração. Não envie a chave privada ao Drive que contém os backups, ao servidor, ao GitHub ou por WhatsApp. Perder todas as cópias da chave impede a recuperação. Apenas a chave pública vai para o painel.\n',{mode:0o600});
  console.log(JSON.stringify({created:true,fingerprint:publicKeyInfo(keys.publicKey).fingerprint,folder}));
 }else if(command==='create'){
  const [publicFile,directory]=args;if(!publicFile||!directory)throw Error('Use create arquivo-publico.pem diretorio-absoluto.');const r=await createRecoveryPackage({dataDir:process.env.PORTAL_DATA_DIR,env:process.env,publicKey:await fs.readFile(publicFile,'utf8'),outputDir:directory});console.log(JSON.stringify(r));
 }else if(command==='restore'){
  const [file,privateFile,destination]=args;if(!file||!privateFile||!destination)throw Error('Use restore backup.lpcb chave-privada.pem destino-absoluto-novo.');
  const start=Date.now(),r=await restoreRecoveryPackage({file,privateKey:await fs.readFile(privateFile,'utf8'),targetDir:destination}),report={...r,duration_ms:Date.now()-start,verified_at:new Date().toISOString()};
  await fs.writeFile(path.join(destination,'restore-report.json'),JSON.stringify(report,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
 }else if(command==='copy'){
  const [file,destination]=args;if(!file?.endsWith('.lpcb')||!destination||!path.isAbsolute(destination))throw Error('Use copy backup.lpcb pasta-absoluta-do-HD.');
  await fs.mkdir(destination,{recursive:true,mode:0o700});const dest=path.join(destination,path.basename(file));await fs.copyFile(file,dest,1);
  const expected=await digestFile(file);if(await digestFile(dest)!==expected)throw Error('Checksum divergente na cópia.');console.log(JSON.stringify({copied:true,sha256:expected,destination:dest}));
 }else throw Error('Use: keygen | create | restore | copy. Leia BACKUP_RECUPERACAO.md antes de recuperar um ambiente.');
}catch(error){console.error(error.status?error.message:'Operação não concluída. Confira os caminhos, permissões e a documentação.');process.exitCode=1}
