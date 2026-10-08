import {fail} from './portal-domain.mjs';
import {excelWorkbook} from './excel-export.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json=(data,status=200)=>Response.json(data,{status,headers});
const names={present:'Presente',absent:'Faltou',justified:'Justificada',unmarked:'Não marcado'};
const units={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
const cols=o=>Object.entries(o).map(([key,label])=>({key,label,width:['name','class','recorded_by'].includes(key)?36:22}));
export async function handleAttendanceInsights({req,route,method,url,store,actor}){
 if(!route.startsWith('/attendance-report')&&!route.startsWith('/attendance-alert')&&!route.startsWith('/rollcall'))return;
 const p=Object.fromEntries(url.searchParams),body=async()=>{try{return await req.json()}catch{fail('Dados inválidos.')}};
 if(route==='/attendance-report/options'&&method==='GET')return json(await store.attendanceReportOptions(actor));
 if(route==='/attendance-report'&&method==='GET')return json(await store.attendanceReport(actor,p));
 if(route==='/attendance-report.xlsx'&&method==='GET'){
  const r=await store.attendanceReport(actor,p),book=excelWorkbook([
   {name:'Resumo por aluno',columns:cols({unit:'Unidade',class:'Turma',student_id:'ID do aluno',name:'Aluno',present:'Presenças',absent:'Faltas sem justificativa',justified:'Faltas justificadas',unmarked:'Sem marcação',frequency:'Frequência (%)',completion:'Preenchimento (%)',total:'Aulas na lista'}),rows:r.summary.map(x=>({...x,unit:units[x.unit],frequency:x.frequency??'Sem dados',completion:x.completion??'Sem aulas'}))},
   {name:'Lançamentos',columns:cols({day:'Data da aula',time:'Horário',unit:'Unidade',label:'Turma',student_id:'ID do aluno',name:'Aluno',status:'Situação',cancelled:'Aula cancelada',recorded_by:'Registrado por',updated_at:'Gravação (UTC)'}),rows:r.records.map(x=>({...x,unit:units[x.unit],status:names[x.status],cancelled:x.cancelled?'Sim':'Não'}))},
   {name:'Critérios',columns:cols({item:'Item',value:'Descrição'}),rows:[{item:'Período',value:r.from+' a '+r.to},{item:'Unidade',value:r.unit?units[r.unit]:'Todas as unidades autorizadas'},{item:'Turma',value:r.group_id||'Todas as turmas'},{item:'Exportado em UTC',value:r.generated_at},{item:'Frequência',value:'Presenças / (presenças + faltas + justificadas). Sem marcação não entra no denominador.'},{item:'Cobertura',value:'Somente aulas abertas e suas listas históricas. Aulas canceladas ficam fora dos totais. Registro antigo sem turma contém apenas as marcações salvas.'},{item:'Alerta',value:'3 faltas sem justificativa consecutivas na mesma turma. Presença, justificativa ou marcação desconhecida interrompem a sequência.'}]}
  ]);return new Response(book,{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="relatorio-presenca.xlsx"'}});
 }
 if(route==='/attendance-alerts'&&method==='GET')return json({alerts:await store.attendanceAlerts(actor,p),recipients:await store.attendanceRecipients(actor,p)});
 const match=route.match(/^\/attendance-alerts\/([0-9a-f-]{36})$/i);
 if(match&&method==='GET')return json({alert:await store.attendanceAlert(actor,match[1])});
 if(match&&method==='POST')return json({alert:await store.attendanceFollowup(actor,match[1],await body()),message:'Acompanhamento registrado. Nenhuma mensagem foi enviada à família.'});
 if(route==='/rollcall-issues'&&method==='GET')return json({issues:await store.rollcallIssues(actor,p)});
}
