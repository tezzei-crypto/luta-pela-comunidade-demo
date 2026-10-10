const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function handleBackups({req,route,method,store,actor,requireRole}){
 if(!/^\/backups(?:\/|$)/.test(route))return null;requireRole('admin');const json=(data,status=200)=>Response.json(data,{status,headers});
 if(route==='/backups'&&method==='GET')return json(await store.backupStatus(actor));
 if(route==='/backups/settings'&&method==='PATCH')return json({settings:await store.backupSettings(actor,await req.json()),message:'Política de backup salva.'});
 if(route==='/backups'&&method==='POST')return json(await store.createBackup(actor),201);
 const m=route.match(/^\/backups\/([a-f0-9-]{36})\/(download|drive|verify)$/i);if(!m)return json({message:'Operação não encontrada.'},404);
 if(m[2]==='download'&&method==='GET'){const p=await store.backupDownload(actor,m[1]);return new Response(p.body,{headers:{...headers,'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="${p.name}"`,'Content-Length':String(p.size),'X-Backup-SHA256':p.sha256}})}
 if(m[2]==='drive'&&method==='POST')return json(await store.backupDrive(actor,m[1]));
 if(m[2]==='verify'&&method==='POST')return json(await store.backupVerifyReport(actor,m[1],await req.json()));
 return json({message:'Método não permitido.'},405);
}
