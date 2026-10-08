import {readFile} from 'node:fs/promises';
import {createStore,portalConfigured} from './portal-store.mjs';
const registryPath=new URL('../../private-data/approved-students.json',import.meta.url);
export const usesPortalRegistry=env=>portalConfigured(env)||env.PORTAL_REGISTRY_ACTIVE==='true';
export async function loadApprovedStudents(env=process.env,storeFactory=createStore){
 if(usesPortalRegistry(env)){
  const rows=await storeFactory(env).students();
  return rows.map(({id,status})=>({id,status}));
 }
 const raw=env.APPROVED_STUDENTS_JSON;
 const data=JSON.parse(raw===undefined?await readFile(registryPath,'utf8'):raw);
 if(data.version!==1||!Array.isArray(data.students))throw Error('Invalid registry');
 if(data.students.some(s=>!s||!/^UND[1-3]_\d{6}$/.test(s.id)||!['approved','pending','inactive'].includes(s.status)))throw Error('Invalid student');
 if(new Set(data.students.map(s=>s.id)).size!==data.students.length)throw Error('Duplicate ID');
 return data.students;
}
export async function handleAccess(request,readRegistry=loadApprovedStudents){
 const reply=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply(405,{message:'Método não permitido.'});
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply(403,{message:'Origem não permitida.'});
 if(!request.headers.get('content-type')?.includes('application/json'))return reply(415,{message:'Formato inválido.'});
 let data;try{const raw=await request.text();if(raw.length>1000)return reply(413,{message:'Solicitação muito grande.'});data=JSON.parse(raw)}catch{return reply(400,{message:'Confira o ID informado.'})}
 const id=typeof data?.studentId==='string'?data.studentId.trim().toUpperCase():'';
 if(!id||id.length>64)return reply(400,{message:'Informe o ID recebido da coordenação.'});
 if(id==='TREINO_UND1_000001')return reply(200,{verified:false,training:true,message:'Este ID é exclusivo de treinamento. Abra a ficha fictícia no ambiente de treinamento.'});
 try{const students=await readRegistry();const matches=students.filter(s=>s.id===id);const verified=matches.length===1&&matches[0].status==='approved';return reply(200,{verified,message:verified?'Cadastro aprovado localizado. A secretaria deverá conferir a identidade do responsável para prosseguir. O atendimento só será confirmado por WhatsApp ao aluno ou responsável.':'Não foi possível liberar o acesso com o ID informado. Confira o código ou consulte a secretaria. Se você ainda não possui ID, faça a inscrição.'})}catch{return reply(503,{verified:false,message:'Não foi possível consultar o cadastro agora. Tente novamente mais tarde.'})}
}
