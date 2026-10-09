import {fail} from './portal-domain.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(p,status=200)=>Response.json(p,{status,headers});
export async function handleClassEvidence({req,route,method,store,actor}) {
 const m=route.match(/^\/classes\/([a-f0-9-]{36})\/photos(?:\/([a-f0-9-]{36}))?(\/review)?$/i);
 if(!m)return;
 const [,id,photo,review]=m;
 if(photo&&review&&method==='POST'){let p;try{p=await req.json()}catch{fail('Dados inválidos.')}return json({check:await store.reviewClassPhoto(actor,id,{...p,photo_id:photo}),message:'Conferência da foto registrada.'})}
 if(photo&&!review&&method==='GET')return new Response(await store.classPhoto(actor,id,photo),{headers:{...headers,'Content-Type':'image/jpeg','Content-Disposition':'inline; filename="foto-aula.jpg"'}});
 if(!photo&&!review&&method==='GET')return json(await store.classEvidence(actor,id));
 if(!photo&&!review&&method==='POST'){
  await store.classEvidence(actor,id);let data;try{data=await req.formData()}catch{fail('Arquivo inválido.')}
  const file=data.get('file');if(!file||typeof file.arrayBuffer!=='function'||!file.size||file.size>8*1024*1024)fail('Escolha uma foto de até 8 MB.');
  const result=await store.addClassPhoto(actor,id,Buffer.from(await file.arrayBuffer()),{request_id:data.get('request_id'),caption:data.get('caption')||'',version:Number(data.get('version')),mime:file.type});return json({...result,message:result.replayed?'Esta foto já havia sido recebida.':'Foto recebida para conferência. As presenças não foram alteradas.'},result.replayed?200:201);
 }
 fail('Operação de foto não disponível.',405);
}
