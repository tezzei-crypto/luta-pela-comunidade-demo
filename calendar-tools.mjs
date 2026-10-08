import {fail} from './portal-domain.mjs';
const managers=['admin','secretary'],care=['psychologist','social_worker'];
const units=['amavale','valparaiso','vale-do-carangola'];
function validDay(value){return typeof value==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(+new Date(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value}

export function calendarTools({all,requireRole,professionalProfile,professionalApproved}){
 return {async appointmentCalendar(actor,p={}){
  const member=requireRole(actor,[...managers,...care]);
  if(!validDay(p.from)||!validDay(p.to)||p.from>p.to||(+new Date(p.to)-new Date(p.from))/86400000>62)fail('Selecione um período de até 63 dias.');
  if(p.unit&&!units.includes(p.unit))fail('Núcleo inválido.');
  if(p.status&&!['free','pending','confirmed','completed','absent','withdrawn','expired','unavailable','waiting'].includes(p.status))fail('Situação inválida.');
  if(p.professional&&!/^[0-9a-f-]{36}$/i.test(p.professional))fail('Profissional inválido.');
  if(care.includes(member.role)&&p.professional&&p.professional!==actor)fail('Acesso não permitido.',403);
  const professional=care.includes(member.role)?actor:p.professional;
  const end=new Date(+new Date(p.to+'T00:00:00-03:00')+86400000).toISOString();
  const params=[new Date(p.from+'T00:00:00-03:00').toISOString(),end];
  let where='s.start_at>=? AND s.start_at<?';
  if(professional){where+=' AND s.professional_id=?';params.push(professional)}
  if(p.unit){where+=' AND s.unit=?';params.push(p.unit)}
  const rows=all(`SELECT s.id,s.professional_id,s.unit,s.start_at,s.end_at,s.state,s.version AS slot_version,s.modality,s.location,
   p.name AS professional_name,m.role AS service,b.id AS booking_id,b.status AS booking_status,b.student_id,
   st.name AS student_name,b.version AS booking_version
   FROM appointment_slots s JOIN professional_profiles p ON p.user_id=s.professional_id JOIN members m ON m.user_id=p.user_id
   LEFT JOIN bookings b ON b.slot_id=s.id AND b.status<>'cancelled' LEFT JOIN students st ON st.id=b.student_id
   WHERE ${where} ORDER BY s.start_at,p.name,s.id LIMIT 5001`,...params);
  if(rows.length>5000)fail('Há muitos horários neste período. Escolha menos dias ou filtre por profissional.',413);
  const eligibility=new Map(),now=new Date().toISOString();
  const events=rows.map(row=>{
   if(!eligibility.has(row.professional_id)){const profile=professionalProfile(row.professional_id);eligibility.set(row.professional_id,{active:professionalApproved(row.professional_id),units:profile?.units||[]})}
   const professional=eligibility.get(row.professional_id);
   const status=row.booking_status||(row.state==='cancelled'?'withdrawn':row.start_at<=now?'expired':!professional.active||!professional.units.includes(row.unit)?'unavailable':'free');
   const {booking_status,state,...event}=row;return {...event,status};
  });
  if(managers.includes(member.role)&&!p.professional){
   const pending=all(`SELECT r.id AS request_id,r.id,r.unit,r.desired_at AS start_at,r.desired_at AS end_at,r.service,r.student_id,st.name AS student_name,'A definir pela secretaria' AS professional_name,'waiting' AS status FROM appointment_requests r JOIN students st ON st.id=r.student_id WHERE r.status='waiting' AND r.desired_at>=? AND r.desired_at<? ${p.unit?'AND r.unit=?':''} ORDER BY r.desired_at LIMIT 5001`,params[0],params[1],...(p.unit?[p.unit]:[]));
   if(pending.length>5000)fail('Há muitas solicitações. Reduza o período.',413);events.push(...pending);events.sort((a,b)=>a.start_at.localeCompare(b.start_at));
  }
  return {events:p.status?events.filter(e=>e.status===p.status):events,from:p.from,to:p.to,time_zone:'America/Sao_Paulo',generated_at:now};
 }};
}
