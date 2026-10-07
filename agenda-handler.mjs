import {loadApprovedStudents} from './access-handler.mjs';
export const AGENDA_RECIPIENTS=['agenda@lutapelacomunidade.com.br','tezzei@gmail.com'];
export const DEMO_ID='TREINO_UND1_000001';
const fields={'Psicologia':'PSYCHOLOGIST_EMAIL','Assistência social':'SOCIAL_WORKER_EMAIL'};
const defaultProfessionals={'Psicologia':'psicologa@lutapelacomunidade.com.br','Assistência social':'assistente.social@lutapelacomunidade.com.br'};
const professionalEmail=(env,service)=>env[fields[service]]||defaultProfessionals[service];
const validEmail=v=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
export function agendaStatus(env){return Object.fromEntries(Object.keys(fields).map(service=>[service,!!(env.RESEND_API_KEY&&env.MAIL_FROM&&validEmail(professionalEmail(env,service)))]))}
export async function handleAgenda(request,env={},send=fetch,readRegistry=loadApprovedStudents){
 const reply=(status,message,extra={})=>Response.json({message,...extra},{status,headers:{'Cache-Control':'no-store'}});
 if(request.method!=='POST')return reply(405,'Método não permitido.');
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply(403,'Origem não permitida.');
 if(!request.headers.get('content-type')?.includes('application/json'))return reply(415,'Formato inválido.');
 const raw=await request.text();if(raw.length>4000)return reply(413,'Solicitação muito grande.');
 let d;try{d=JSON.parse(raw)}catch{return reply(400,'Dados inválidos.')}
 if(!d||typeof d.studentId!=='string'||!Object.hasOwn(fields,d.service)||d.consent!==true||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)||!/^\d{1}$/.test(String(d.weekday))||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.requestId))return reply(400,'Confira o aluno de teste, o atendimento e os campos obrigatórios.');
 const training=d.studentId===DEMO_ID;
 if(!training){
  if(new URL(request.url).pathname!=='/api/agenda')return reply(400,'Use o formulário de atendimento do aluno.');
  d.studentId=d.studentId.trim().toUpperCase();
  if(typeof d.contactName!=='string'||d.contactName.trim().length<3||d.contactName.length>120||/[\r\n]/.test(d.contactName)||typeof d.phone!=='string'||!/^\d{10,11}$/.test(d.phone.replace(/\D/g,'')))return reply(400,'Informe o nome do solicitante e WhatsApp com DDD.');
  try{const rows=await readRegistry();if(rows.filter(s=>s.id===d.studentId&&s.status==='approved').length!==1||rows.filter(s=>s.id===d.studentId).length!==1)return reply(403,'ID sem aprovação ativa. Confira o código com a secretaria.')}catch{return reply(503,'Consulta de aprovação indisponível. Nenhuma solicitação foi enviada.')}
 }else if(new URL(request.url).pathname==='/api/agenda')return reply(400,'Utilize o ambiente de treinamento para este ID.');
 const date=new Date(d.date+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==d.date||date.getUTCDay()!==Number(d.weekday))return reply(400,'A data não corresponde ao dia da semana.');
 const now=new Date(),p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
 if(d.date+'T'+d.time<=`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`)return reply(400,'Escolha uma data e um horário futuros.');
 if(!agendaStatus(env)[d.service])return reply(503,'O email ainda não está configurado para este atendimento. Nenhuma solicitação foi enviada.');
 const professional=professionalEmail(env,d.service),to=[...new Set([...AGENDA_RECIPIENTS,professional])];
 const trainingText=`TREINAMENTO — DADOS FICTÍCIOS\nSTATUS: AGUARDANDO CONFIRMAÇÃO DA SECRETARIA. O agendamento só estará confirmado quando a secretaria enviar a confirmação por WhatsApp ao aluno ou responsável. Este email não confirma o agendamento. Não reservar atendimento real neste exercício.\n\nAluno: Aluno Teste\nID: ${DEMO_ID}\nUnidade: Amavale\nAtendimento: ${d.service}\nData solicitada: ${d.date}\nHorário solicitado: ${d.time} (America/Sao_Paulo)\nProtocolo: ${d.requestId}\n\nEste email é um exercício autorizado pela coordenação. A ficha escolar e de saúde não é anexada. Nenhuma disponibilidade profissional foi confirmada.`;
 const text=training?trainingText:`SOLICITAÇÃO DE ATENDIMENTO\nSTATUS: AGUARDANDO CONFIRMAÇÃO DA SECRETARIA POR WHATSAPP.\nA secretaria deve conferir o solicitante com o cadastro interno antes de confirmar. O ID identifica o cadastro e não comprova identidade.\n\nID do aluno: ${d.studentId}\nSolicitante (informado no formulário): ${d.contactName.trim()}\nWhatsApp informado: ${d.phone.replace(/\D/g,'')}\nAtendimento: ${d.service}\nData desejada: ${d.date}\nHorário: ${d.time} (America/Sao_Paulo)\nProtocolo: ${d.requestId}\n\nEsta solicitação não reserva vaga e não confirma o atendimento.`;
 try{const r=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`${training?'training-agenda':'student-agenda'}-${d.requestId}`},body:JSON.stringify({from:env.MAIL_FROM,to,subject:training?`[TREINAMENTO] Solicitação — Aluno Teste — ${d.service} — ${d.date} ${d.time}`:`Solicitação de atendimento — ${d.service} — ${d.date} ${d.time}`,text}),signal:AbortSignal.timeout(25000)});if(!r.ok||!(await r.json()).id)return reply(502,'Não foi possível confirmar o envio. Tente novamente.');return reply(200,training?'Email de treinamento encaminhado. Status: aguardando confirmação da secretaria por WhatsApp ao aluno ou responsável. Este exercício não reserva atendimento real.':'Solicitação enviada. Aguarde a confirmação da secretaria por WhatsApp; o atendimento ainda não está confirmado.',{protocol:d.requestId})}catch{return reply(502,'Não foi possível confirmar o envio. Tente novamente.')}
}


