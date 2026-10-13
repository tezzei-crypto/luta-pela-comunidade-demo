import {fail} from './portal-domain.mjs';
const json=data=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
export async function handleQuickIntake({req,route,method,url,store,actor}){
 const body=async()=>{try{const p=await req.json();if(!p||typeof p!=='object'||Array.isArray(p))throw Error();return p}catch{fail('Dados inválidos.')}};
 if(route==='/quick-intakes'){
  if(method==='GET')return json({intakes:await store.quickList(actor,url.searchParams.get('unit'))});
  if(method==='POST'){const p=await body(),saved=await store.quickCreate(actor,p);return json({...saved,...await store.visitors(actor,p.class_id),message:'Aluno e presença salvos. A secretaria concluirá a matrícula.'});}
 }
 const intake=route.match(/^\/quick-intakes\/([a-f0-9-]{36})$/i);
 if(intake&&method==='PATCH')return json({...await store.quickUpdate(actor,intake[1],await body()),message:'Pré-cadastro atualizado.'});
 const lesson=route.match(/^\/classes\/([a-f0-9-]{36})\/(visitors|delivery)$/i);
 if(lesson){
  if(lesson[2]==='visitors'&&method==='GET')return json(await store.visitors(actor,lesson[1]));
  if(lesson[2]==='visitors'&&method==='POST')return json(await store.markVisitor(actor,lesson[1],await body()));
  if(lesson[2]==='delivery'&&method==='POST')return json(await store.classDelivery(actor,lesson[1],await body()));
 }
 if(route==='/operations'&&method==='GET')return json(await store.operationsSummary(actor,url.searchParams.get('day')));
 return null;
}
