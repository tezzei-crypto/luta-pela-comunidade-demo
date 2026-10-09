const statuses={empty:'Sem foto',pending:'Aguardando conferência',approved:'Foto conferida',needs_photo:'Nova foto solicitada',changed:'Chamada alterada: conferir novamente'};
const historyLabels={uploaded:'Foto enviada',approved:'Foto conferida',needs_photo:'Nova foto solicitada'};
const imageUrls=new Map();
function releaseImages(all=false){for(const [img,url] of imageUrls)if(all||!img.isConnected){URL.revokeObjectURL(url);imageUrls.delete(img)}}
document.addEventListener('portal:logout',()=>releaseImages(true));
document.addEventListener('portal:action-complete',()=>releaseImages());
export async function mountClassEvidence({api,el,field,action,notice},box,id){
 let generation=0;
 const load=async()=>{
  const current=++generation,p=await api('/classes/'+id+'/photos');if(!box.isConnected||current!==generation)return;
  box.replaceChildren(el('h3','Foto da aula'),el('p',statuses[p.check.status],{role:'status'}),el('p','Registro privado para conferência da equipe. A foto não marca presenças, não confirma sozinha quem participou e não será publicada no site.',{class:'muted'}));
  releaseImages();if(p.check.note)box.append(el('p','Orientação da equipe: '+p.check.note));
  const latest=p.photos[0];
  if(latest){const img=el('img',undefined,{alt:'Foto registrada para esta aula',class:'class-photo-preview'}),caption=el('p',latest.caption||'Sem legenda');box.append(img,caption);
   const blob=await api('/classes/'+id+'/photos/'+latest.id,{blob:true});if(!box.isConnected||current!==generation)return;const imageUrl=URL.createObjectURL(blob);imageUrls.set(img,imageUrl);img.src=imageUrl;
  }
  if(!p.lesson.cancelled){
   const form=el('form'),camera=field(form,'Tirar foto com a câmera','camera','',{type:'file',accept:'image/jpeg,image/png,image/webp',capture:'environment'}),file=field(form,'Ou escolher foto no aparelho','file','',{type:'file',accept:'image/jpeg,image/png,image/webp'}),caption=field(form,'Legenda ou observação (opcional)','caption','');caption.maxLength=500;
   form.append(el('p','JPG, PNG ou WebP estático, até 8 MB. Os metadados de localização serão removidos. Use uma foto autorizada; a câmera depende do aparelho e do navegador.',{class:'muted'}));
   let requestId=crypto.randomUUID();const changed=which=>{(which===file?camera:file).value='';requestId=crypto.randomUUID()};file.addEventListener('change',()=>changed(file));camera.addEventListener('change',()=>changed(camera));caption.addEventListener('input',()=>requestId=crypto.randomUUID());
   form.append(el('button',latest?'Enviar nova foto (preserva a anterior)':'Enviar foto para conferência'));
   form.addEventListener('submit',action(async()=>{const selected=file.files[0]||camera.files[0];if(!selected||!selected.size||selected.size>8*1024*1024||!['image/jpeg','image/png','image/webp'].includes(selected.type)){throw Error('Escolha uma foto JPG, PNG ou WebP de até 8 MB.')}const data=new FormData();data.set('file',selected);data.set('caption',caption.value);data.set('version',String(p.check.version));data.set('request_id',requestId);const result=await api('/classes/'+id+'/photos',{method:'POST',form:data});await load();notice(result.message)}));box.append(form);
   if(latest&&p.can_review){const review=el('form');review.append(el('h4','Conferência pela equipe'));field(review,'Decisão sobre a foto','decision','approved',{options:{approved:'Foto conferida',needs_photo:'Solicitar nova foto'}});const note=field(review,'Motivo ou orientação','note','');note.maxLength=500;const sync=()=>{note.required=review.elements.decision.value==='needs_photo';note.minLength=note.required?5:0};review.elements.decision.addEventListener('change',sync);sync();review.append(el('button','Registrar conferência'));
    review.addEventListener('submit',action(async()=>{const result=await api('/classes/'+id+'/photos/'+latest.id+'/review',{method:'POST',data:{version:p.check.version,attendance_fingerprint:p.check.attendance_fingerprint,decision:review.elements.decision.value,note:note.value}});await load();notice(result.message)}));box.append(review);
   }
  }
  const history=el('details');history.append(el('summary','Histórico de fotos e conferências ('+p.photos.length+' fotos)'));
  for(const photo of p.photos){const button=el('button','Abrir foto de '+new Date(photo.created_at).toLocaleString('pt-BR'),{type:'button',class:'secondary'});button.addEventListener('click',action(async()=>{const blob=await api('/classes/'+id+'/photos/'+photo.id,{blob:true});if(!button.isConnected||current!==generation)return;const img=el('img',undefined,{alt:'Foto anterior da aula',class:'class-photo-preview'}),url=URL.createObjectURL(blob);imageUrls.set(img,url);img.src=url;button.replaceWith(img)}));history.append(button)}
  for(const h of p.history)history.append(el('p',new Date(h.created_at).toLocaleString('pt-BR')+' · '+(historyLabels[h.action]||h.action)+(h.note?' · '+h.note:'')));box.append(history);
 };
 await load();
}
