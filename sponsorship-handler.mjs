export const SPONSOR_RECIPIENTS=['patrocinador@lutapelacomunidade.com.br','tezzei@gmail.com'];
export const SUPPORT_TYPES=['Patrocínio financeiro','Materiais e equipamentos','Alimentação','Espaços e serviços','Apoio a um núcleo','Quero conhecer as possibilidades'];
const reply=(status,message,extra={})=>Response.json({message,...extra},{status,headers:{'Cache-Control':'no-store'}});
export async function handleSponsorship(request,env={},send=fetch){
 if(request.method!=='POST')return reply(405,'Método não permitido.');
 if(request.headers.get('origin')!==new URL(request.url).origin)return reply(403,'Origem não permitida.');
 if(!env.RESEND_API_KEY||!env.MAIL_FROM)return reply(503,'O formulário ainda não está disponível para envio.');
 if(!request.headers.get('content-type')?.includes('application/json'))return reply(415,'Formato inválido.');
 const raw=await request.text();if(raw.length>16000)return reply(413,'A mensagem excede o limite permitido.');
 let data;try{data=JSON.parse(raw)}catch{return reply(400,'Dados inválidos.')}
 if(!data||typeof data!=='object'||Array.isArray(data))return reply(400,'Dados inválidos.');
 const get=k=>typeof data[k]==='string'?data[k].trim():'';
 if(get('website'))return reply(400,'Envio não permitido.');
 const company=get('company'),contact=get('contact'),email=get('email'),phone=get('phone'),support=get('support'),message=get('message'),id=get('requestId'),role=get('role'),city=get('city'),unit=get('unit'),budget=get('budget');
 if([company,contact].some(v=>v.length<3||v.length>150||/[\r\n\x00-\x1f]/.test(v)))return reply(400,'Informe o nome da empresa e do contato.');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!/^\+?[\d ()-]{10,25}$/.test(phone))return reply(400,'Confira o e-mail e o telefone.');
 if(!SUPPORT_TYPES.includes(support)||!['Projeto como um todo','Amavale','Valparaíso','Vale do Carangola','A definir'].includes(unit))return reply(400,'Selecione a modalidade de apoio e o núcleo de interesse.');
 if(role.length>100||city.length>100||budget.length>120||message.length<10||message.length>3000)return reply(400,'Confira os campos. A mensagem deve ter de 10 a 3.000 caracteres.');
 if(data.consent!==true)return reply(400,'Autorize o contato e o uso dos dados para analisar a proposta.');
 if(!/^[0-9a-f-]{36}$/i.test(id))return reply(400,'Atualize a página antes de enviar.');
 const subject=`Patrocínio: ${company} — ${support}`;
 const text=`INTERESSE EM PATROCÍNIO — LUTA PELA COMUNIDADE\n\nEmpresa: ${company}\nCidade/UF: ${city||'Não informada'}\nContato: ${contact}\nCargo: ${role||'Não informado'}\nE-mail: ${email}\nTelefone: ${phone}\nModalidade: ${support}\nNúcleo: ${unit}\nValor ou recursos estimados: ${budget||'A conversar'}\n\nMENSAGEM\n${message}\n\nCONSENTIMENTO\nAutorizo a equipe do Luta pela Comunidade a usar os dados informados para analisar o interesse em patrocínio e entrar em contato comigo. Estou ciente de que os dados serão enviados a patrocinador@lutapelacomunidade.com.br e tezzei@gmail.com.\nContato declarante: ${contact}\nData UTC: ${new Date().toISOString()}\nProtocolo: ${id}\n\nEsta manifestação de interesse não formaliza contrato nem compromisso financeiro.`;
 try{const r=await send('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`sponsorship-${id}`},body:JSON.stringify({from:env.MAIL_FROM,to:SPONSOR_RECIPIENTS,reply_to:email,subject,text}),signal:AbortSignal.timeout(25000)});if(!r.ok)return reply(502,'Não foi possível confirmar o envio. Tente novamente.');const result=await r.json();if(!result.id)return reply(502,'Não foi possível confirmar o envio. Tente novamente.');return reply(200,'Seu interesse em patrocinar foi encaminhado à equipe. Retornaremos pelo contato informado.',{protocol:id})}catch{return reply(502,'Não foi possível confirmar o envio. Seus campos foram preservados; tente novamente.')}
}
