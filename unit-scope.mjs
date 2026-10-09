import {fail} from './portal-domain.mjs';

export const ADMIN_UNITS=['amavale','valparaiso','vale-do-carangola'];
export const studentUnit=id=>ADMIN_UNITS[Number(String(id).match(/^UND([1-3])_\d{6}$/)?.[1])-1];

export function unitScope({db,get,all,requireRole}) {
 db.exec(`CREATE TABLE IF NOT EXISTS administrative_units(
  user_id TEXT NOT NULL REFERENCES members(user_id),
  unit TEXT NOT NULL CHECK(unit IN ('amavale','valparaiso','vale-do-carangola')),
  PRIMARY KEY(user_id,unit));
  CREATE INDEX IF NOT EXISTS administrative_units_unit ON administrative_units(unit,user_id);`);
 // Existing secretaries receive no implicit scope. An administrator assigns it explicitly.
 const units=actor=>{const m=requireRole(actor,['admin','secretary']);return m.role==='admin'?[...ADMIN_UNITS]:all('SELECT unit FROM administrative_units WHERE user_id=? ORDER BY unit',actor).map(r=>r.unit)};
 const permits=(actor,unit)=>!!unit&&units(actor).includes(unit);
 const requireUnit=(actor,unit)=>{if(!permits(actor,unit))fail('Este registro pertence a um núcleo não autorizado para sua conta.',403)};
 const validate=values=>{if(!Array.isArray(values)||!values.length||values.length>3||new Set(values).size!==values.length||values.some(u=>!ADMIN_UNITS.includes(u)))fail('Selecione pelo menos um núcleo válido para a secretaria.');return [...values].sort()};
 const sql=(actor,column)=>{const m=get('SELECT role FROM members WHERE user_id=?',actor);return m?.role==='secretary'?` AND ${column} IN (SELECT unit FROM administrative_units WHERE user_id='${actor.replaceAll("'","''")}')`:''};
 return {units,permits,requireUnit,validate,sql};
}

// The authenticated HTTP boundary uses this allowlist. Unclassified methods are
// denied for secretaries, including future endpoints, jobs and raw database tools.
// Scope is re-read for every call; it is never taken from client input or a token.
export function scopedSecretaryStore(api,actor,{scope,get,all}) {
 const deny=()=>fail('Esta operação exige a administração geral.',403);
 const unit=u=>scope.requireUnit(actor,u),student=id=>unit(studentUnit(id));
 const record=(table,id,key='id')=>{const r=get(`SELECT * FROM ${table} WHERE ${key}=?`,id);if(!r)fail('Registro indisponível.',404);unit(r.unit);return r};
 const booking=id=>{const r=get('SELECT s.unit FROM bookings b JOIN appointment_slots s ON s.id=b.slot_id WHERE b.id=?',id);if(!r)fail('Atendimento indisponível.',404);unit(r.unit)};
 const staffUnits=(type,id)=>all(`SELECT unit FROM ${type}_units WHERE ${type==='monitor'?'monitor_id':'user_id'}=?`,id).map(r=>r.unit);
 const staff=(type,id)=>{const us=staffUnits(type,id);if(!us.length||!us.every(u=>scope.permits(actor,u)))fail('O cadastro compartilhado ou sem núcleo é gerenciado pela administração geral.',403)};
 const staffPayload=(type,id,p)=>{if(id)staff(type,id);scope.validate(p.units).forEach(unit);
  const existing=get('SELECT user_id FROM members WHERE email=?',String(p.email||'').trim().toLowerCase());
  if(!id&&existing)deny();
 };
 const filter=rows=>rows.filter(r=>scope.permits(actor,r.unit));
 const staffList=(rows,type)=>rows.flatMap(r=>{const us=r.units||staffUnits(type,r.user_id||r.id),visible=us.filter(u=>scope.permits(actor,u));if(!visible.length)return [];
  const shared=us.some(u=>!visible.includes(u));
  const result=shared?Object.fromEntries(['id','user_id','name','role','active','status','available','test_access'].filter(k=>k in r).map(k=>[k,r[k]])):r;
  return [{...result,units:visible,scope_readonly:shared}];});
 const pathCheck=(key,write=false)=>{
  const parts=String(key).split('/');
  if(studentUnit(parts[0]))return student(parts[0]);
  if(parts[0]==='registrations'){record('registrations',parts[1]);return;}
  if(['teachers','professionals'].includes(parts[0])){staff(parts[0]==='teachers'?'teacher':'professional',parts[1]);return;}
  // Approved student documents can retain their original registration object path.
  if(!write){const d=get('SELECT student_id FROM documents WHERE object_path=?',key);if(d)return student(d.student_id)}
  deny();
 };
 const rules={};
 const allow=(names,check=()=>{})=>{for(const n of names.split(' '))rules[n]=async(...args)=>{check(...args);return api[n](...args)}};
 allow('systemRevision audit rollcallSettings attendanceReport attendanceReportOptions attendanceAlerts attendanceAlert attendanceFollowup attendanceRecipients rollcallIssues');
 allow('links',id=>{if(id!==actor)deny()});
 allow('member',id=>{if(id!==actor)deny()});
 rules.availableUnits=async()=>scope.units(actor);
 rules.students=async ids=>{if(ids)ids.forEach(student);return (await api.students(ids)).filter(s=>scope.permits(actor,studentUnit(s.id)))};
 allow('student documents',student);
 rules.document=async id=>{const d=await api.document(id);if(d)student(d.student_id);return d};
 allow('studentContact saveStudentContact studentProgression saveStudentGraduation confirmStudentGraduation appointmentContext',(_,id)=>student(id));
 allow('update',(_,row)=>student(row.id));
 allow('import',(_,rows)=>rows.forEach(r=>student(r.id)));
 rules.contactExport=async()=> (await api.contactExport(actor)).filter(r=>scope.permits(actor,studentUnit(r.id)));
 rules.registrations=async(status,offset=0)=>all(`SELECT id,student_name,birth_date,unit,status,student_id,version,created_at FROM registrations WHERE status=?${scope.sql(actor,'unit')} ORDER BY created_at,id LIMIT 51 OFFSET ?`,status,offset);
 allow('registration',id=>record('registrations',id));
 allow('manualRegistration',(_,p)=>unit(p.unit));
 allow('reviewRegistration registrationUpload',(_,id,p)=>{record('registrations',id);if(p?.existing_student_id)student(p.existing_student_id)});
 allow('groups classes unitRoster reports reportsExport attendanceExport workforceRoster workforceSessions workforceExport',(_,u)=>unit(u));
 allow('group',(_,id)=>record('class_groups',id));
 allow('saveGroup',(_,id,p)=>{unit(p.unit);if(id)record('class_groups',id)});
 allow('createClass createWorkforceSession',(_,p)=>{if(p.group_id)record('class_groups',p.group_id);else unit(p.unit)});
 allow('attendance markAttendance cancelClass',(_,id)=>record('classes',id));
 allow('workforceAttendance markWorkforceAttendance workforceHistory',(_,id)=>record('workforce_sessions',id));
 allow('report updateReport',(_,id)=>record('reports',id));
 allow('createReport',(_,p)=>unit(p.unit));
 for(const [type,list,read,save] of [['teacher','teachers','teacher','saveTeacher'],['professional','professionals','professional','saveProfessional'],['monitor','monitors',null,'saveMonitor']]){
  rules[list]=async()=>staffList(await api[list](actor),type);
  if(read)allow(read,(_,id)=>staff(type,id));
  allow(save,(_,id,p)=>staffPayload(type,id,p));
  if(type==='monitor')continue;
  const upper=type[0].toUpperCase()+type.slice(1);
  allow(type+'Documents add'+upper+'Document',(_,id)=>staff(type,id));
  rules[type+'Document']=async(...args)=>{const d=await api[type+'Document'](...args);staff(type,d.user_id);return d};
 }
 allow('upload removeObject',key=>pathCheck(key,true));
 allow('download',key=>pathCheck(key));
 allow('addDocument',row=>{student(row.student_id);pathCheck(row.object_path,true);if(row.created_by!==actor)deny()});
 allow('appointmentCalendar',(_,p)=>{if(p.unit)unit(p.unit)});
 allow('appointmentRequests');
 allow('booking reviewBooking sendBookingNotice',(_,id)=>booking(id));
 allow('rescheduleBooking',(_,id,p)=>{booking(id);record('appointment_slots',p.slot_id)});
 allow('createSlot',(_,p)=>unit(p.unit));
 allow('cancelSlot updateSlot',(_,id)=>record('appointment_slots',id));
 allow('bookSlot',(_,id,p)=>{record('appointment_slots',id);student(p.student_id)});
 rules.slots=async(_,uid)=>{if(!staffUnits('professional',uid).some(u=>scope.permits(actor,u)))deny();return api.slots(actor,uid)};
 allow('bookings');
 rules.availableSlots=async(_,id)=>{student(id);return filter(await api.availableSlots(actor,id))};
 rules.publicAppointmentSlots=async p=>filter(await api.publicAppointmentSlots(p,actor));
 rules.requestSlots=async(_,id)=>{record('appointment_requests',id);return filter(await api.requestSlots(actor,id))};
 allow('reviewAppointmentRequest',(_,id,p)=>{record('appointment_requests',id);if(p.action==='reserve')record('appointment_slots',p.slot_id)});
 rules.createAppointmentRequest=async(p,who)=>{if(who!==actor)deny();student(String(p.studentId).trim().toUpperCase());unit(p.unit);if(p.slotId)record('appointment_slots',p.slotId);return api.createAppointmentRequest(p,actor)};
 // Guardians and shared identity accounts are managed centrally. Local approval
 // still creates and links a guardian through the existing atomic intake flow.
 rules.members=async()=>[];
 rules.dashboard=async(_,days)=>{
  const rows=await rules.students(),regs=all(`SELECT status,created_at FROM registrations WHERE 1=1${scope.sql(actor,'unit')}`),since=new Date(Date.now()-(days-1)*86400000).toISOString();
  return {students:rows.length,approved:rows.filter(s=>s.status==='approved').length,inactive:rows.filter(s=>s.status==='inactive').length,incomplete:rows.filter(s=>s.height_cm===null||s.weight_kg===null||!s.kimono||!s.rashguard||!s.shorts).length,
   registrations:Object.fromEntries(['pending','needs_info','approved','rejected','period_received'].map(k=>[k,regs.filter(r=>k==='period_received'?r.created_at>=since:r.status===k).length])),
   units:scope.units(actor).map(u=>({unit:'UND'+(ADMIN_UNITS.indexOf(u)+1),students:rows.filter(s=>studentUnit(s.id)===u).length,approved:rows.filter(s=>studentUnit(s.id)===u&&s.status==='approved').length})),documents:all(`SELECT student_id FROM documents`).filter(d=>scope.permits(actor,studentUnit(d.student_id))).length,generated_at:new Date().toISOString(),days,since};
 };
 const actorless=new Set('member links students student documents document registrations registration upload download removeObject addDocument members publicAppointmentSlots createAppointmentRequest'.split(' '));
 return new Proxy(Object.create(null),{get:(_,name)=>{
  if(name==='then')return undefined;
  return async(...args)=>{scope.units(actor);const fn=rules[name];if(!fn||!actorless.has(name)&&args[0]!==actor)deny();return fn(...args)};
 }});
}
