import {localDay} from './professional-tools.mjs';
import {createHash} from 'node:crypto';
import {fail} from './portal-domain.mjs';
const roles={'Psicologia':'psychologist','Assistência social':'social_worker'},units=['amavale','valparaiso','vale-do-carangola'];
const now=()=>new Date().toISOString(),uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function appointmentRequests({db,get,all,run,tx,requireRole,audit,reserve,professionalApproved,professionalProfile}){
 db.exec(`CREATE TABLE IF NOT EXISTS appointment_requests(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,student_id TEXT NOT NULL REFERENCES students(id),service TEXT NOT NULL,unit TEXT NOT NULL,requested_modality TEXT NOT NULL DEFAULT 'any',desired_at TEXT NOT NULL,contact_name TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','booked','cancelled')),booking_id TEXT REFERENCES bookings(id),reason TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,notice_state TEXT NOT NULL DEFAULT 'pending',notice_claimed_at TEXT);
 CREATE INDEX IF NOT EXISTS requests_status_date ON appointment_requests(status,desired_at);`);
 const approved=id=>{const s=get("SELECT * FROM students WHERE id=? AND status='approved'",id);if(!s)fail('ID sem aprovação ativa. Consulte a secretaria.',403);return s};
 function available(studentId,{service,unit}={}){
  approved(studentId);if(service&&!roles[service]&&!Object.values(roles).includes(service)||unit&&!units.includes(unit))fail('Confira atendimento e núcleo.');
  const rows=all(`SELECT s.id,s.unit,s.start_at,s.end_at,s.version,s.professional_id,s.modality,s.location,p.name AS professional_name,m.role AS service FROM appointment_slots s JOIN professional_profiles p ON p.user_id=s.professional_id JOIN members m ON m.user_id=p.user_id WHERE s.state='open' AND s.start_at>? AND s.start_at<? AND (?='' OR m.role=?) AND (?='' OR s.unit=?) AND m.active=1 AND m.role IN ('psychologist','social_worker') AND p.status='verified' AND p.review_until>=? AND EXISTS(SELECT 1 FROM professional_units pu WHERE pu.user_id=s.professional_id AND pu.unit=s.unit) AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status IN ('pending','confirmed')) ORDER BY s.start_at LIMIT 1001`,now(),new Date(Date.now()+367*86400000).toISOString(),roles[service]||service||'',roles[service]||service||'',unit||'',unit||'',localDay());
  if(rows.length>1000)fail('Há muitos horários. Consulte a secretaria.',413);
  return rows.filter(s=>(!service||s.service===(roles[service]||service))&&(!unit||s.unit===unit)&&professionalApproved(s.professional_id)&&professionalProfile(s.professional_id).units.includes(s.unit));
 }
 function create(p,actor=null){return tx(()=>{
  if(actor)requireRole(actor,['admin','secretary']);const student=approved(String(p.studentId||'').trim().toUpperCase());
  if(!uuid(p.requestId)||!roles[p.service]||p.consent!==true||typeof p.contactName!=='string'||p.contactName.trim().length<3||p.contactName.length>160||/[\x00-\x1f]/.test(p.contactName)||typeof p.phone!=='string'||!/^\d{10,11}$/.test(p.phone.replace(/\D/g,'')))fail('Confira aluno, atendimento, solicitante, WhatsApp e ciência.');
  const modality=p.modality||'any';if(!['any','online','in_person'].includes(modality))fail('Modalidade inválida.');
  const unit=p.unit||units[Number(student.id.slice(3,4))-1];if(!units.includes(unit))fail('Núcleo inválido.');
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(p.date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time))fail('Confira data e horário.');
  const date=new Date(p.date+'T12:00:00Z');if(!Number.isFinite(+date)||date.toISOString().slice(0,10)!==p.date||date.getUTCDay()!==Number(p.weekday))fail('Data e dia da semana não correspondem.');
  const desired=new Date(p.date+'T'+p.time+':00-03:00').toISOString();
  const values={student_id:student.id,service:roles[p.service],unit,requested_modality:modality,desired_at:desired,contact_name:p.contactName.trim(),phone:p.phone.replace(/\D/g,''),slot_id:p.slotId||null};
  const hash=createHash('sha256').update(JSON.stringify(values)).digest('hex'),old=get('SELECT * FROM appointment_requests WHERE id=?',p.requestId);
  if(old){if(old.payload_hash!==hash)fail('Protocolo já usado para outros dados.',409);return receipt(old)}
  if(desired<=now()||+new Date(desired)>Date.now()+366*86400000)fail('Escolha um horário futuro dentro de um ano.');
  if(get("SELECT 1 FROM appointment_requests WHERE student_id=? AND service=? AND desired_at=? AND status IN ('waiting','booked') AND (booking_id IS NULL OR EXISTS(SELECT 1 FROM bookings WHERE id=booking_id AND status IN ('pending','confirmed')))",student.id,values.service,desired))fail('Já existe uma solicitação para esse aluno e horário. Consulte a secretaria para acompanhar ou remarcar.',409);
  let booking=null;
  if(p.slotId){const slot=get('SELECT s.*,m.role AS service FROM appointment_slots s JOIN members m ON m.user_id=s.professional_id WHERE s.id=?',p.slotId);if(!slot||slot.service!==values.service||slot.unit!==unit||slot.start_at!==desired||(modality!=='any'&&slot.modality!==modality))fail('Horário não corresponde ao atendimento escolhido. Atualize a lista.',409);booking=reserve(actor,p.slotId,{id:p.requestId,student_id:student.id,contact_name:values.contact_name,phone:values.phone,consent:true,version:p.slotVersion},{publicRequest:!actor,allowCrossUnit:true})}
  run('INSERT INTO appointment_requests(id,payload_hash,student_id,service,unit,desired_at,contact_name,phone,status,booking_id,created_at,updated_at,notice_state,requested_modality) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',p.requestId,hash,student.id,values.service,unit,desired,values.contact_name,values.phone,booking?'booked':'waiting',booking?.id||null,now(),now(),actor?'suppressed':'pending',modality);
  audit(actor||'public','appointment.request:'+p.requestId,student.id);return receipt(get('SELECT * FROM appointment_requests WHERE id=?',p.requestId));
 })}
 function receipt(r){const booking=r.booking_id?get('SELECT status FROM bookings WHERE id=?',r.booking_id):null;return {protocol:r.id,status:booking?.status||r.status,reserved:!!booking&&['pending','confirmed'].includes(booking.status)}}
 const query='SELECT r.*,s.name AS student_name,b.status AS booking_status FROM appointment_requests r JOIN students s ON s.id=r.student_id LEFT JOIN bookings b ON b.id=r.booking_id';
 return {
  async publicAppointmentSlots(p){return available(String(p.studentId||'').trim().toUpperCase(),p)},
  async createAppointmentRequest(p,actor=null){return create(p,actor)},
  async appointmentRequests(actor,status='waiting'){requireRole(actor,['admin','secretary']);if(!['waiting','all'].includes(status))fail('Filtro inválido.');const rows=all(query+(status==='waiting'?" WHERE r.status='waiting'":'')+' ORDER BY r.desired_at DESC LIMIT 501');if(rows.length>500)fail('Mais de 500 solicitações pendentes. Consulte o suporte para exportação.',413);return rows.map(({payload_hash,...r})=>r)},
  async requestSlots(actor,id){requireRole(actor,['admin','secretary']);const r=get('SELECT * FROM appointment_requests WHERE id=?',id);if(!r)fail('Solicitação não localizada.',404);return available(r.student_id)},
  async reviewAppointmentRequest(actor,id,p){return tx(()=>{
   requireRole(actor,['admin','secretary']);const r=get('SELECT * FROM appointment_requests WHERE id=?',id);if(!r)fail('Solicitação não localizada.',404);if(r.version!==p.version||r.status!=='waiting')fail('Solicitação alterada. Atualize a agenda.',409);
   if(typeof p.reason!=='string'||p.reason.trim().length<3||p.reason.length>500||/[\x00-\x1f]/.test(p.reason))fail('Registre o motivo administrativo, sem conteúdo clínico.');
   if(p.action==='cancel'){run("UPDATE appointment_requests SET status='cancelled',reason=?,version=version+1,updated_at=? WHERE id=?",p.reason.trim(),now(),id);audit(actor,'appointment.cancel:'+id,r.student_id);return {protocol:id,status:'cancelled'}}
   if(p.action!=='reserve')fail('Ação inválida.');const s=get('SELECT s.*,m.role AS service FROM appointment_slots s JOIN members m ON m.user_id=s.professional_id WHERE s.id=?',p.slot_id);if(!s)fail('Horário não localizado.',404);
   if((s.service!==r.service||s.unit!==r.unit||s.start_at!==r.desired_at||(r.requested_modality!=='any'&&r.requested_modality!==s.modality))&&p.change_ack!==true)fail('Confirme a alteração de especialidade, núcleo ou horário antes de reservar.');
   const b=reserve(actor,s.id,{id:r.id,student_id:r.student_id,contact_name:r.contact_name,phone:r.phone,consent:true,version:p.slot_version},{allowCrossUnit:true});
   run("UPDATE appointment_requests SET status='booked',booking_id=?,reason=?,version=version+1,updated_at=? WHERE id=?",b.id,p.reason.trim(),now(),id);audit(actor,'appointment.assign:'+id,r.student_id);return {protocol:id,status:'pending',booking_id:b.id};
  })},

 };
}
