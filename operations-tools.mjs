import {deferRejectedEmail} from './resend-quota.mjs';
import {createHash} from 'node:crypto';
import {fail,ageAt} from './portal-domain.mjs';
import {ADMIN_UNITS} from './unit-scope.mjs';

const names={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};
function validDay(day){const date=new Date(day+'T12:00:00Z');if(typeof day!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(+date)||date.toISOString().slice(0,10)!==day)fail('Selecione uma data válida.');return day;}
export function operationsTools({db,get,all,run,requireRole,scope,env,transport,emailAllowed=()=>true,officialStart=()=>'',clock=()=>new Date()}){
 db.exec(`CREATE TABLE IF NOT EXISTS operations_outbox(id TEXT PRIMARY KEY,day TEXT NOT NULL,user_id TEXT NOT NULL,email TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,first_attempt_at TEXT,next_attempt_at TEXT,accepted_at TEXT,provider_id TEXT,error TEXT);`);
 const configured=()=>!!(env.RESEND_API_KEY&&env.MAIL_FROM);
 const recipients=()=>all("SELECT user_id,lower(email) AS email FROM members WHERE role='admin' AND active=1 ORDER BY email").filter(r=>emailAllowed(r.user_id)).filter(r=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email));
 const mailState=()=>({configured:configured(),hour:8,period:'previous_day',time_zone:'America/Sao_Paulo',recipients:recipients().map(r=>r.email),pending:get("SELECT count(*) AS n FROM operations_outbox WHERE state='pending'").n,failed:get("SELECT count(*) AS n FROM operations_outbox WHERE state IN ('failed','uncertain')").n,last_accepted:get("SELECT day,accepted_at FROM operations_outbox WHERE state='accepted' ORDER BY accepted_at DESC LIMIT 1")||null});
 function summary(day,units){
  validDay(day);const weekday=new Date(day+'T12:00:00Z').getUTCDay();
  const allClasses=all('SELECT * FROM classes WHERE day=? ORDER BY time,id',day).filter(c=>units.includes(c.unit));
  const groups=all("SELECT * FROM class_groups WHERE active=1 AND (created_day='' OR created_day<=?) ORDER BY unit,start_time,label",day).filter(g=>units.includes(g.unit)&&JSON.parse(g.weekdays).includes(weekday));
  const work=day<officialStart()?[]:[...groups.map(g=>({g,c:allClasses.find(c=>c.group_id===g.id)})),...allClasses.filter(c=>!groups.some(g=>g.id===c.group_id)).map(c=>({g:{id:c.group_id,unit:c.unit,label:c.label,start_time:c.time},c}))];
  const people=new Map();let registered=0,visitors=0,childVisits=0;
  const lessons=work.map(({g,c})=>{
   const enrolled=c?all("SELECT s.id,s.birth_date,COALESCE(a.status,'unmarked') AS status FROM (SELECT student_id FROM class_students WHERE class_id=? UNION SELECT student_id FROM attendance WHERE class_id=?) roster JOIN students s ON s.id=roster.student_id LEFT JOIN attendance a ON a.class_id=? AND a.student_id=roster.student_id",c.id,c.id,c.id).concat(all('SELECT id,birth_date,status,resolved_student_id,provisional FROM provisional_class_roster WHERE class_id=?',c.id)):[];
   // Linked visitors and enrolled students share one identity in this lesson and in the daily total.
   const roster=new Map();for(const s of enrolled.filter(s=>s.status==='present'))roster.set(s.resolved_student_id||s.id,{kind:s.provisional?'visitor':'registered',age:ageAt(s.birth_date,new Date(day+'T12:00:00Z'))});
   if(c)for(const v of all("SELECT q.id,q.student_id,q.age,q.created_at,s.birth_date FROM visitor_attendance a JOIN quick_intakes q ON q.id=a.intake_id LEFT JOIN students s ON s.id=q.student_id WHERE a.class_id=? AND a.present=1",c.id)){const key=v.student_id||'visitor:'+v.id;if(!roster.has(key))roster.set(key,{kind:'visitor',age:v.birth_date?ageAt(v.birth_date,new Date(day+'T12:00:00Z')):v.age});}
   const held=c&&get('SELECT held FROM class_delivery WHERE class_id=?',c.id)?.held;
   let state=c?.cancelled?'cancelled':roster.size||held?'held':'unconfirmed';
   if(state==='cancelled')roster.clear();
   const reg=[...roster.values()].filter(p=>p.kind==='registered').length,visit=roster.size-reg;
   registered+=reg;visitors+=visit;
   for(const [key,p]of roster){people.set(key,p);if(p.age!==null&&p.age<18)childVisits++;}
   return {id:c?.id||null,group_id:g.id,unit:g.unit,label:g.label,time:g.start_time,state,registered_present:reg,visitors_present:visit,total_present:roster.size,roster_size:enrolled.length,unmarked:enrolled.filter(s=>s.status==='unmarked').length,attendance_complete:!!c&&!c.cancelled&&enrolled.length>0&&enrolled.every(s=>s.status!=='unmarked')};
  });
  const bookings=all('SELECT b.status,s.unit,s.start_at,m.role FROM bookings b JOIN appointment_slots s ON s.id=b.slot_id JOIN members m ON m.user_id=s.professional_id WHERE s.start_at>=? AND s.start_at<?',new Date(day+'T00:00:00-03:00').toISOString(),new Date(Date.parse(day+'T00:00:00-03:00')+86400000).toISOString()).filter(b=>units.includes(b.unit));
  const count=(rows,key,value)=>rows.filter(r=>r[key]===value).length;
  return {day,official_start_date:officialStart(),testing:day<officialStart(),generated_at:clock().toISOString(),time_zone:'America/Sao_Paulo',totals:{scheduled:lessons.length,held:count(lessons,'state','held'),cancelled:count(lessons,'state','cancelled'),unconfirmed:count(lessons,'state','unconfirmed'),registered_present:registered,visitors_present:visitors,participations:registered+visitors,unique_people:people.size,children:[...people.values()].filter(p=>p.age!==null&&p.age<18).length,age_unknown:[...people.values()].filter(p=>p.age===null).length,child_participations:childVisits,appointments_completed:count(bookings,'status','completed'),appointments_waiting:bookings.filter(b=>['confirmed','pending'].includes(b.status)).length},lessons,units:units.map(unit=>({unit,lessons:lessons.filter(c=>c.unit===unit).length,held:lessons.filter(c=>c.unit===unit&&c.state==='held').length,participations:lessons.filter(c=>c.unit===unit).reduce((n,c)=>n+c.total_present,0),appointments_completed:bookings.filter(b=>b.unit===unit&&b.status==='completed').length})),appointments:Object.fromEntries(['completed','confirmed','pending','absent','cancelled'].map(status=>[status,count(bookings,'status',status)])),pending_intakes:all("SELECT unit FROM quick_intakes WHERE status='pending'").filter(r=>units.includes(r.unit)).length};
 }
 let sending=false;
 async function deliver(){
  if(sending||!configured())return;sending=true;
  try{
   const now=clock(),stamp=now.toISOString(),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Sao_Paulo',hour:'2-digit',hourCycle:'h23'}).format(now));if(hour<8)return;
   const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now),day=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10),report=summary(day,ADMIN_UNITS),t=report.totals;
   const body=`Resumo de ${day.split('-').reverse().join('/')} (Brasília). Dados conferidos em ${now.toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}.\n\nAulas previstas/abertas: ${t.scheduled}. Com realização/presença registrada: ${t.held}. Canceladas: ${t.cancelled}. Sem confirmação: ${t.unconfirmed}.\nPresenças: ${t.participations} participações (${t.registered_present} na chamada de matriculados e ${t.visitors_present} de visitantes). Cadastros distintos com presença: ${t.unique_people}. Menores de 18 anos com idade informada: ${t.children}; pessoas com idade não informada: ${t.age_unknown}.\nAtendimentos com situação Realizado: ${t.appointments_completed}. Agendados ainda sem conclusão: ${t.appointments_waiting}.\nPré-cadastros aguardando secretaria: ${report.pending_intakes}.\n\n${report.units.map(u=>names[u.unit]+': '+u.held+' aula(s) com realização/presença registrada, '+u.participations+' participações, '+u.appointments_completed+' atendimento(s) realizado(s).').join('\n')}\n\nChamada pendente não significa ausência. Cadastro e agendamento não comprovam atendimento. Uma pessoa em duas aulas gera duas participações; IDs de núcleos diferentes não são conciliados automaticamente. Idade do pré-cadastro é informada, ainda sem conferência documental.\nConfira os números atuais e as pendências:\nhttps://www.lutapelacomunidade.com.br/administracao/#operations-area\n\nResumo administrativo sem nomes, contatos ou conteúdo dos atendimentos. Lançamentos posteriores aparecem no painel; este email é uma fotografia do momento.`;
   for(const r of day<officialStart()?[]:recipients()){const id=createHash('sha256').update(day+'\n'+r.email).digest('hex');run('INSERT OR IGNORE INTO operations_outbox(id,day,user_id,email,payload) VALUES(?,?,?,?,?)',id,day,r.user_id,r.email,JSON.stringify({from:env.MAIL_FROM,to:[r.email],subject:'Resumo das atividades — '+day.split('-').reverse().join('/')+' — Luta pela Comunidade',text:body}));}
   for(const item of all("SELECT * FROM operations_outbox WHERE state='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY day,id LIMIT 20",stamp)){
    if(!emailAllowed(item.user_id)||item.day<officialStart()||!get("SELECT 1 FROM members WHERE user_id=? AND role='admin' AND active=1 AND lower(email)=?",item.user_id,item.email)){run("UPDATE operations_outbox SET state='cancelled' WHERE id=?",item.id);continue;}
    if(item.first_attempt_at&&now-Date.parse(item.first_attempt_at)>=23*3600000){run("UPDATE operations_outbox SET state='uncertain',error='Confira o provedor antes de repetir o envio.' WHERE id=?",item.id);continue;}
    run('UPDATE operations_outbox SET attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,?) WHERE id=?',stamp,item.id);
    try{const res=await transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'operations-'+item.id},body:item.payload,signal:AbortSignal.timeout(10000)});
     if(await deferRejectedEmail(res,{run,table:'operations_outbox',before:item,now:+now}))continue;const data=await res.json().catch(()=>({}));if(res.ok&&typeof data.id==='string'&&data.id){run("UPDATE operations_outbox SET state='accepted',accepted_at=?,provider_id=?,error=NULL WHERE id=?",stamp,data.id,item.id);continue;}
     if(res.status>=400&&res.status<500&&res.status!==429&&!(res.status===409&&data.name==='concurrent_idempotent_requests')){run("UPDATE operations_outbox SET state='failed',error='Provedor recusou o envio. Confira a configuração.' WHERE id=?",item.id);continue;}
    }catch{}
    run("UPDATE operations_outbox SET next_attempt_at=?,error='Sem confirmação; nova tentativa programada.' WHERE id=?",new Date(+now+Math.min(60,5*2**Math.min(item.attempts,4))*60000).toISOString(),item.id);
   }
  }finally{sending=false;}
 }
 return {async operationsSummary(actor,day){const m=requireRole(actor,['admin','secretary']);return {...summary(day,scope.units(actor)),...(m.role==='admin'?{notifications:mailState()}:{} )}},deliverOperationsNotices:deliver};
}
