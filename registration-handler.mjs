import {createStore} from './portal-store.mjs';
import {persistRegistration} from './registration-persistence.mjs';
export const RECIPIENTS=['participante@lutapelacomunidade.com.br','tezzei@gmail.com'];
const UNITS={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
const FILES={studentDocument:'Documento do aluno',guardianDocument:'Documento do responsável',medicalCertificate:'Atestado médico',photo:'Foto de registro'};
export function ageAt(birthDate,now=new Date()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate))return -1;
 const [y,m,d]=birthDate.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
 if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return -1;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(now).map(p=>[p.type,p.value]));
 const age=Number(parts.year)-y-((Number(parts.month)<m||(Number(parts.month)===m&&Number(parts.day)<d))?1:0);
 return age;
}
function reply(status,message,extra={}){return Response.json({message,...extra},{status,headers:{'Cache-Control':'no-store'}})}
function fileKind(bytes){if(bytes[0]===0x25&&bytes[1]===0x50&&bytes[2]===0x44&&bytes[3]===0x46&&bytes[4]===0x2d)return 'pdf';if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpg';if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'png';return null}
export async function handleRegistration(request,env={},send=fetch,injectedStore){
 if(request.method!=='POST')return reply(405,'Método não permitido.');
 const origin=request.headers.get('origin');
 if(!origin||origin!==new URL(request.url).origin)return reply(403,'Origem não permitida.');
 if(env.PORTAL_INTAKE_ACTIVE!=='true'&&(!env.RESEND_API_KEY||!env.MAIL_FROM))return reply(503,'O serviço de envio está temporariamente indisponível. Entre em contato com participante@lutapelacomunidade.com.br.');
 if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))return reply(415,'Formato de envio inválido.');
 if(Number(request.headers.get('content-length'))>13*1024*1024)return reply(413,'O envio deve ter até 12 MB em arquivos.');
 let data;try{data=await request.formData()}catch{return reply(400,'Não foi possível ler os dados enviados.')}
 const get=k=>typeof data.get(k)==='string'?data.get(k).trim():'';
 if(get('website'))return reply(400,'Envio não permitido.');
 const student=get('studentName'),guardian=get('guardianName'),birth=get('birthDate'),unit=UNITS[get('unit')],email=get('guardianEmail'),phone=get('guardianPhone'),relationship=get('relationship');
 if([student,guardian].some(v=>v.length<3||v.length>120||/[\r\n\x00-\x1f]/.test(v)))return reply(400,'Informe os nomes completos do aluno e do responsável.');
 const age=ageAt(birth);if(age<0||age>17)return reply(400,'A inscrição é destinada a participantes com até 17 anos. Confira a data de nascimento.');
 if(!unit)return reply(400,'Selecione um núcleo válido.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!/^\+?[\d ()-]{10,25}$/.test(phone)||!['Mãe','Pai','Responsável legal'].includes(relationship))return reply(400,'Confira o contato e o vínculo do responsável.');
 if(['participationConsent','medicalConsent','dataConsent'].some(k=>get(k)!=='on'))return reply(400,'As três declarações do responsável são obrigatórias.');
 const id=get('requestId');if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,'Atualize a página antes de enviar.');
 const attachments=[];let total=0;
 for(const [key,label] of Object.entries(FILES)){
  const file=data.get(key);if(!file||typeof file.arrayBuffer!=='function'||file.size===0)return reply(400,`Anexe: ${label}.`);
  if(file.size>3*1024*1024)return reply(413,`${label}: o limite é 3 MB por arquivo.`);
  total+=file.size;if(total>12*1024*1024)return reply(413,'O total de arquivos deve ter até 12 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer()),kind=fileKind(bytes);
  if(!kind||(key==='photo'&&kind==='pdf'))return reply(400,`${label}: formato não permitido. Use ${key==='photo'?'JPG ou PNG':'PDF, JPG ou PNG'}.`);
  attachments.push({filename:`${key}.${kind}`,content:Buffer.from(bytes).toString('base64')});
 }
 if(env.PORTAL_INTAKE_ACTIVE==='true'){
  try{
   await persistRegistration(injectedStore||createStore(env),{id,student_name:student,birth_date:birth,unit:get('unit'),guardian_name:guardian,guardian_email:email,guardian_phone:phone,relationship},attachments);
   // O registro privado é a confirmação principal; email é somente um aviso, sem anexos.
   if(env.RESEND_API_KEY&&env.MAIL_FROM)await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`registration-private-${id}`},body:JSON.stringify({from:env.MAIL_FROM,to:RECIPIENTS,subject:'Nova inscrição para análise — Luta pela Comunidade',text:`Uma nova inscrição foi recebida no painel administrativo. Protocolo: ${id}. Entre na área de administração do site para conferir os documentos e decidir sobre a aprovação.`}),signal:AbortSignal.timeout(15000)}).catch(()=>{});
   return reply(200,'Inscrição recebida no painel da coordenação. Aguarde a análise dos documentos e o contato da equipe. O recebimento não garante vaga.',{protocol:id});
  }catch(error){return reply(error.status===409?409:503,error.status===409?error.message:'Não foi possível confirmar o registro. Seus campos foram preservados; tente novamente.')}
 }
 const subject=`Aluno: ${student} — ${unit} — ${age} anos`;
 const timestamp=new Date().toISOString();
 const text=`SOLICITAÇÃO DE INSCRIÇÃO — LUTA PELA COMUNIDADE\n\nAluno: ${student}\nNascimento: ${birth}\nIdade: ${age} anos\nNúcleo: ${unit}\n\nResponsável: ${guardian}\nVínculo: ${relationship}\nE-mail: ${email}\nTelefone: ${phone}\n\nDECLARAÇÕES ACEITAS (versão 2026-10-05)\n1. Declaro ser mãe, pai ou responsável legal e autorizo a participação do aluno nas atividades do projeto, após avaliação da documentação e confirmação da vaga.\n2. Estou ciente da exigência de atestado médico que declare aptidão para práticas esportivas e de que a participação depende da conferência desse documento pela equipe.\n3. Autorizo o tratamento dos dados e documentos enviados, incluindo o atestado médico e a foto, para análise da inscrição, conferência documental e registro interno. A foto não está autorizada para divulgação pública. Estou ciente do envio aos dois e-mails da coordenação indicados no formulário.\n\nResponsável declarante: ${guardian}\nRegistrado em UTC: ${timestamp}\nProtocolo: ${id}\n\nA inscrição não garante vaga. A equipe deve conferir os documentos, a responsabilidade legal e a aptidão indicada no atestado antes da participação.\nDocumentos pessoais e informação de saúde: acesso restrito à equipe responsável.`;
 try{
  const response=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`registration-${id}`},body:JSON.stringify({from:env.MAIL_FROM,to:RECIPIENTS,reply_to:email,subject,text,attachments}),signal:AbortSignal.timeout(25000)});
  if(!response.ok)return reply(502,'O serviço de e-mail não confirmou o envio. Seus campos foram preservados; tente novamente.');
  const result=await response.json();if(!result.id)return reply(502,'Não foi possível confirmar o envio. Tente novamente.');
  return reply(200,'Sua solicitação foi encaminhada à coordenação. O envio não garante vaga; aguarde a conferência dos documentos e o contato da equipe.',{protocol:id});
 }catch{return reply(502,'Não foi possível confirmar o envio. Seus campos foram preservados; tente novamente.')}
}

