import {createStore,portalConfigured} from './portal-store.mjs';
import {contactMessage} from './dist/contact-options.js';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function handleContact(req,env=process.env,injectedStore){
 try{
  if(req.method!=='GET')return Response.json({message:'Método não permitido.'},{status:405,headers});
  if(!portalConfigured(env))return Response.json({message:'Contato temporariamente indisponível.'},{status:503,headers});
  const store=injectedStore||createStore(env),url=new URL(req.url);
  if(url.pathname==='/api/contact')return Response.json(await store.publicContact(),{headers});
  if(url.pathname==='/api/contact/whatsapp'){
   let message;try{message=contactMessage(url.searchParams.get('profile'),url.searchParams.get('unit')||'')}catch{return Response.json({message:'Escolha seu perfil e um núcleo válido.'},{status:400,headers})}
   const phone=await store.contactDestination();
   return new Response(null,{status:302,headers:{...headers,Location:'https://wa.me/'+phone+'?text='+encodeURIComponent(message)}});
  }
  return Response.json({message:'Página não encontrada.'},{status:404,headers});
 }catch(e){return Response.json({message:e.status?e.message:'Contato temporariamente indisponível. Tente novamente em alguns instantes.'},{status:e.status||503,headers})}
}
