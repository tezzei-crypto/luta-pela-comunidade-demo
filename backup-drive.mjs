import fs from 'node:fs';
const API='https://www.googleapis.com/drive/v3/files';
const failure=message=>Object.assign(Error(message),{status:502});
export function driveConfigured(env){return ['BACKUP_DRIVE_CLIENT_ID','BACKUP_DRIVE_CLIENT_SECRET','BACKUP_DRIVE_REFRESH_TOKEN'].every(k=>typeof env[k]==='string'&&env[k].length>5)}
export async function uploadDriveBackup({env,folderId,record,transport=fetch}){
 if(!driveConfigured(env)||!/^[a-zA-Z0-9_-]{10,160}$/.test(folderId||''))throw failure('Conexão com o Drive institucional ainda não configurada.');
 const tokenResponse=await transport('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.BACKUP_DRIVE_CLIENT_ID,client_secret:env.BACKUP_DRIVE_CLIENT_SECRET,refresh_token:env.BACKUP_DRIVE_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:AbortSignal.timeout(30000)});
 if(!tokenResponse.ok)throw failure('Não foi possível autorizar a cópia no Drive.');const token=(await tokenResponse.json()).access_token;if(typeof token!=='string'||!token)throw failure('Autorização do Drive inválida.');
 const headers={Authorization:'Bearer '+token};
 const folder=await transport(API+'/'+folderId+'?fields=id,mimeType,trashed,capabilities(canAddChildren)&supportsAllDrives=true',{headers,signal:AbortSignal.timeout(30000)});
 if(!folder.ok)throw failure('Pasta institucional indisponível.');const info=await folder.json();if(info.trashed||info.mimeType!=='application/vnd.google-apps.folder'||!info.capabilities?.canAddChildren)throw failure('A conta não pode gravar nesta pasta.');
 // Find the same package before retrying a transfer whose response was lost.
 const query=new URLSearchParams({q:`'${folderId}' in parents and trashed = false and appProperties has { key='lpc_backup_id' and value='${record.id}' }`,fields:'files(id,size,md5Checksum)',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
 const existing=await transport(API+'?'+query,{headers,signal:AbortSignal.timeout(30000)});if(!existing.ok)throw failure('Não foi possível conferir cópias anteriores no Drive.');
 const files=(await existing.json()).files||[];const check=item=>item?.id&&Number(item.size)===record.size&&item.md5Checksum===record.md5;
 const found=files.find(check);if(found)return {id:found.id,verified_at:new Date().toISOString(),checksum:'md5',web_url:'https://drive.google.com/file/d/'+found.id+'/view'};
 if(files.length)throw failure('Existe uma cópia com o mesmo identificador e tamanho ou checksum divergente.');
 const init=await transport('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,size,md5Checksum',{method:'POST',headers:{...headers,'Content-Type':'application/json','X-Upload-Content-Type':'application/octet-stream','X-Upload-Content-Length':String(record.size)},body:JSON.stringify({name:record.name,parents:[folderId],mimeType:'application/octet-stream',appProperties:{lpc_backup_id:record.id,lpc_sha256:record.sha256}}),signal:AbortSignal.timeout(30000)});
 if(!init.ok)throw failure('O Drive recusou o início do backup.');let upload;try{upload=new URL(init.headers.get('location'))}catch{throw failure('Resposta de upload inválida.')}
 if(upload.protocol!=='https:'||upload.hostname!=='www.googleapis.com'||upload.username||upload.password||!upload.pathname.startsWith('/upload/drive/'))throw failure('Destino de upload inválido.');
 const sent=await transport(upload.href,{method:'PUT',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(record.size)},body:fs.createReadStream(record.file),duplex:'half',signal:AbortSignal.timeout(300000)});
 if(!sent.ok)throw failure('Cópia no Drive não confirmada. O pacote local foi preservado.');const result=await sent.json();
 if(!check(result))throw failure('O Drive não confirmou o tamanho e o checksum do arquivo.');
 return {id:result.id,verified_at:new Date().toISOString(),checksum:'md5',web_url:'https://drive.google.com/file/d/'+result.id+'/view'};
}
