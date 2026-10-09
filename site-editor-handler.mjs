import {fail} from './portal-domain.mjs';
export async function handleSiteEditor({req,route,method,url,store,actor,requireRole}){
 if(!route.startsWith('/site-editor'))return null;
 requireRole('admin','secretary');
 const json=data=>Response.json(data,{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 const body=async()=>{try{return await req.json()}catch{fail('Dados inválidos.')}};
 if(route==='/site-editor/pages'&&method==='GET')return json(await store.editorPages(actor));
 if(route==='/site-editor/media'&&method==='POST'){
  let form;try{form=await req.formData()}catch{fail('Envio inválido.')}
  return json(await store.addEditorMedia(actor,form.get('file'),{alt:form.get('alt'),authorized:form.get('authorized')==='true'}));
 }
 const match=/^\/site-editor\/(page|contact)(?:\/(preview|publish|restore))?$/.exec(route);
 if(match){const key=match[1]==='contact'?'contact':url.searchParams.get('page');
  if(!match[2]&&method==='GET')return json(await store.editorDocument(actor,key));
  if(!match[2]&&method==='PATCH')return json(await store.saveEditorDraft(actor,key,await body()));
  if(match[2]==='preview'&&method==='POST')return json(await store.editorPreview(actor,key,await body()));
  if(match[2]==='publish'&&method==='POST')return json(await store.publishEditor(actor,key,await body()));
  if(match[2]==='restore'&&method==='POST')return json(await store.restoreEditor(actor,key,await body()));
 }
 fail('Operação do editor não encontrada.',404);
}
