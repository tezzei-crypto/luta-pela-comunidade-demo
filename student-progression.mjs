import {fail} from './portal-domain.mjs';
import {localDay} from './professional-tools.mjs';

export const BELTS = ['Branca','Cinza e branca','Cinza','Cinza e preta','Amarela e branca','Amarela','Amarela e preta','Laranja e branca','Laranja','Laranja e preta','Verde e branca','Verde','Verde e preta','Azul','Roxa','Marrom','Preta'];
const cleanReason = p => {
  if(typeof p.reason !== 'string' || p.reason.trim().length < 5 || p.reason.length > 500 || /[\x00-\x1f]/.test(p.reason)) fail('Informe o motivo ou a referência da graduação (5 a 500 caracteres).');
  return p.reason.trim();
};
function keys(p, permitted) {if(!p || Array.isArray(p) || Object.keys(p).some(k=>!permitted.includes(k))) fail('Dados de graduação inválidos.');}

export function studentProgression({db,get,all,run,tx,requireRole,audit}) {
  db.exec(`CREATE TABLE IF NOT EXISTS graduation_policy(id INTEGER PRIMARY KEY CHECK(id=1),lessons_per_degree INTEGER NOT NULL,version INTEGER NOT NULL);
    INSERT OR IGNORE INTO graduation_policy VALUES(1,48,1);
    CREATE TABLE IF NOT EXISTS student_graduation(student_id TEXT PRIMARY KEY REFERENCES students(id),belt TEXT NOT NULL,degrees INTEGER NOT NULL CHECK(degrees BETWEEN 0 AND 4),last_graduation_date TEXT NOT NULL,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS graduation_history(id INTEGER PRIMARY KEY,student_id TEXT REFERENCES students(id),action TEXT NOT NULL,actor TEXT NOT NULL REFERENCES members(user_id),recorded_at TEXT NOT NULL,reason TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,evidence_json TEXT NOT NULL);`);
  const policy = () => get('SELECT lessons_per_degree,version FROM graduation_policy WHERE id=1');
  const profile = id => get('SELECT belt,degrees,last_graduation_date,version FROM student_graduation WHERE student_id=?',id) || {belt:'',degrees:0,last_graduation_date:'',version:0};
  function access(actor,id,write=false) {
    const member=requireRole(actor,write?['admin','secretary']:['admin','secretary','guardian']);
    if(member.role==='guardian'&&!get('SELECT 1 FROM links WHERE user_id=? AND student_id=?',actor,id))fail('Acesso não permitido.',403);
    const student=get('SELECT id,birth_date,status FROM students WHERE id=?',id);
    if(!student)fail('Aluno não localizado.',404);
    if(write&&student.status!=='approved')fail('Graduação disponível somente para alunos aprovados.');
    return {member,student};
  }
  function date(value, student) {
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||value>localDay()||value<student.birth_date)fail('Informe uma data válida, entre o nascimento e hoje.');
  }
  function rows(id,until=localDay()) {
    return all(`SELECT c.id AS class_id,c.day,c.time,c.label,c.unit,c.cancelled,COALESCE(a.status,'unmarked') AS status,COALESCE(a.version,0) AS version
      FROM classes c LEFT JOIN attendance a ON a.class_id=c.id AND a.student_id=?
      WHERE c.day<=? AND (a.student_id IS NOT NULL OR EXISTS(SELECT 1 FROM class_students cs WHERE cs.class_id=c.id AND cs.student_id=?))
      ORDER BY c.day DESC,c.time DESC,c.id`,id,until,id);
  }
  function count(list) {
    const totals={present:0,absent:0,justified:0,unmarked:0,cancelled:0};
    for(const row of list) {if(row.cancelled)totals.cancelled++;else totals[row.status]++;}
    const denominator=totals.present+totals.absent+totals.justified;
    return {...totals,frequency:denominator?Math.round(totals.present/denominator*1000)/10:null};
  }
  function snapshot(id,until=localDay()) {
    const p=profile(id),rule=policy(),list=rows(id,until),cycle=p.version?list.filter(r=>r.day>p.last_graduation_date):[];
    const current=count(cycle),remaining=p.version?Math.max(0,rule.lessons_per_degree-current.present):null;
    return {profile:p,policy:rule,totals:count(list),cycle:current,remaining_for_degree:p.degrees>=4?0:remaining,
      remaining_for_exam:p.version?(p.degrees>=4?0:Math.max(0,3-p.degrees)*rule.lessons_per_degree+remaining):null,
      degree_ready:!!p.version&&p.degrees<4&&remaining===0,exam_ready:!!p.version&&p.degrees===4,
      attendance:list.slice(0,200),attendance_count:list.length,
      history:all('SELECT id,action,recorded_at,before_json,after_json FROM graduation_history WHERE student_id=? ORDER BY id DESC LIMIT 100',id).map(r=>({...r,before:JSON.parse(r.before_json),after:JSON.parse(r.after_json),before_json:undefined,after_json:undefined}))};
  }
  function persist(actor,id,p,old,action,reason,evidence={}) {
    const next={belt:p.belt,degrees:p.degrees,last_graduation_date:p.last_graduation_date,version:old.version+1};
    run('INSERT INTO student_graduation VALUES(?,?,?,?,?) ON CONFLICT(student_id) DO UPDATE SET belt=excluded.belt,degrees=excluded.degrees,last_graduation_date=excluded.last_graduation_date,version=excluded.version',id,next.belt,next.degrees,next.last_graduation_date,next.version);
    run('INSERT INTO graduation_history(student_id,action,actor,recorded_at,reason,before_json,after_json,evidence_json) VALUES(?,?,?,?,?,?,?,?)',id,action,actor,new Date().toISOString(),reason,JSON.stringify(old),JSON.stringify(next),JSON.stringify(evidence));
    audit(actor,'graduation.'+action,id);
    return snapshot(id);
  }
  function version(p,old) {if(!Number.isSafeInteger(p.version)||p.version!==old.version)fail('A graduação foi alterada. Reabra a ficha antes de salvar.',409);}
  return {
    async studentProgression(actor,id) {access(actor,id);return snapshot(id)},
    async saveStudentGraduation(actor,id,p) {return tx(()=>{
      const {student}=access(actor,id,true);keys(p,['belt','degrees','last_graduation_date','version','reason','checked']);
      const old=profile(id);version(p,old);date(p.last_graduation_date,student);
      if(!BELTS.includes(p.belt)||!Number.isSafeInteger(p.degrees)||p.degrees<0||p.degrees>4||p.checked!==true)fail('Confira faixa, graus, data e a confirmação do cadastro.');
      return persist(actor,id,p,old,old.version?'correction':'initial',cleanReason(p));
    })},
    async confirmStudentGraduation(actor,id,p) {return tx(()=>{
      const {student}=access(actor,id,true);keys(p,['action','belt','date','version','policy_version','reason','checked']);
      const old=profile(id);version(p,old);date(p.date,student);const rule=policy();
      if(p.policy_version!==rule.version)fail('A regra de graduação mudou. Reabra a ficha.',409);
      if(!old.version||p.date<=old.last_graduation_date||p.checked!==true)fail('Confira a graduação e informe uma data posterior à última graduação.');
      const state=snapshot(id,p.date),evidence={policy:rule,presences:rows(id,p.date).filter(r=>!r.cancelled&&r.status==='present'&&r.day>old.last_graduation_date)};
      if(p.action==='degree') {
        if(!state.degree_ready)fail('O aluno ainda não atingiu as presenças necessárias ou já possui quatro graus.',409);
        return persist(actor,id,{...old,degrees:old.degrees+1,last_graduation_date:p.date},old,'degree',cleanReason(p),evidence);
      }
      if(p.action==='belt') {
        if(!state.exam_ready||!BELTS.includes(p.belt)||p.belt===old.belt)fail('Confirme os quatro graus e selecione a nova faixa após o exame.');
        return persist(actor,id,{belt:p.belt,degrees:0,last_graduation_date:p.date},old,'belt',cleanReason(p),evidence);
      }
      fail('Tipo de graduação inválido.');
    })},
    async saveGraduationPolicy(actor,p) {return tx(()=>{
      requireRole(actor,['admin','secretary']);keys(p,['lessons_per_degree','version','reason']);const old=policy();
      if(p.version!==old.version)fail('A regra foi alterada. Reabra a ficha.',409);
      if(!Number.isSafeInteger(p.lessons_per_degree)||p.lessons_per_degree<1||p.lessons_per_degree>500)fail('Use um número inteiro de 1 a 500 aulas.');
      const reason=cleanReason(p),next={lessons_per_degree:p.lessons_per_degree,version:old.version+1};
      run('UPDATE graduation_policy SET lessons_per_degree=?,version=? WHERE id=1',next.lessons_per_degree,next.version);
      run('INSERT INTO graduation_history(student_id,action,actor,recorded_at,reason,before_json,after_json,evidence_json) VALUES(NULL,?,?,?,?,?,?,?)','policy',actor,new Date().toISOString(),reason,JSON.stringify(old),JSON.stringify(next),'{}');
      audit(actor,'graduation.policy');return next;
    })}
  };
}
