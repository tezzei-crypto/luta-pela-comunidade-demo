import {createHmac,timingSafeEqual} from 'node:crypto';
export const COLUMNS=['id','name','birth_date','status','height_cm','weight_kg','kimono','rashguard','shorts','version'];
export const KINDS={photo:'Foto',student_document:'Documento do aluno',guardian_document:'Documento do responsável',consent:'Autorização',report_card:'Boletim escolar',medical_certificate:'Atestado médico'};
export const ROLES=['admin','secretary','psychologist','social_worker','guardian','teacher'];
export function fail(message,status=400){throw Object.assign(new Error(message),{status})}
export function ageAt(birth,now=new Date()){
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 const [y,m,d]=birth.split('-').map(Number);return +p.year-y-((+p.month<m||(+p.month===m&&+p.day<d))?1:0);
}
export function validateStudent(raw,{partial=false}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Cadastro inválido.');
 if(Object.keys(raw).some(k=>!COLUMNS.includes(k)))fail('O arquivo contém colunas desconhecidas.');
 const out={};
 for(const key of Object.keys(raw)){
  let v=raw[key];
  if(['height_cm','weight_kg'].includes(key)){if(v===''||v===null){out[key]=null;continue}v=Number(String(v).replace(',','.'));if(!Number.isFinite(v)||v<=0||v>(key==='height_cm'?300:500))fail(`Confira ${key}.`);out[key]=v;continue}
  if(key==='version'){if(!/^\d+$/.test(String(v)))fail('Versão ausente ou inválida.');out[key]=Number(v);continue}
  if(typeof v!=='string')fail(`Confira ${key}.`);v=v.trim();
  if(/[\x00-\x1f\x7f]/.test(v))fail(`Caractere inválido em ${key}.`);
  if(key==='id'&&!/^UND[1-3]_\d{6}$/.test(v))fail('ID fora do padrão.');
  if(key==='name'&&(v.length<3||v.length>160))fail('Confira o nome do aluno.');
  if(key==='birth_date'){const d=new Date(v+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v||ageAt(v)<0||ageAt(v)>120)fail('Data de nascimento inválida.');}
  if(key==='status'&&!['approved','pending','inactive'].includes(v))fail('Situação inválida.');
  if(['kimono','rashguard','shorts'].includes(key)&&v.length>30)fail('Tamanho de uniforme muito longo.');
  out[key]=v;
 }
 if(!partial&&['id','name','birth_date','status','version'].some(k=>out[k]===undefined))fail('Faltam colunas obrigatórias.');
 return out;
}
export function parseCsv(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>1024*1024)fail('CSV deve ter no máximo 1 MB.');
 text=text.replace(/^\uFEFF/,'');const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}
  if(c==='"'){if(cell||closed)fail('Aspas inválidas no CSV.');quoted=true;continue}
  if(c===';'||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==';'){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(v=>v!==''))rows.push(row);row=[]}continue}
  if(closed)fail('Texto após fechamento de aspas.');cell+=c;
 }
 if(quoted)fail('CSV com aspas não fechadas.');if(cell||row.length){row.push(cell);rows.push(row)}
 const header=rows.shift();if(!header||header.join(';')!==COLUMNS.join(';'))fail('Use o modelo CSV do portal, mantendo a ordem das colunas.');
 if(!rows.length||rows.length>500)fail('Importe entre 1 e 500 alunos por vez.');
 const ids=new Set();return rows.map((r,i)=>{if(r.length!==header.length)fail(`Linha ${i+2}: número de colunas incorreto.`);const p=validateStudent(Object.fromEntries(header.map((k,n)=>[k,r[n]])));if(ids.has(p.id))fail(`ID repetido na linha ${i+2}.`);ids.add(p.id);return p});
}
export function csv(rows,cols=COLUMNS){
 const quote=v=>{let s=v===null||v===undefined?'':String(v);if(/^[\s]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
 return '\uFEFF'+[cols,...rows.map(r=>cols.map(c=>r[c]))].map(r=>r.map(quote).join(';')).join('\r\n')+'\r\n';
}
export function canRead(role,linked){return ['admin','secretary'].includes(role)||role==='guardian'&&linked}
export function canEdit(role){return ['admin','secretary','guardian'].includes(role)}
export function canDocument(role,kind){return ['admin','secretary','guardian'].includes(role)}
export function fileType(bytes){if(bytes.subarray(0,5).toString()==='%PDF-')return ['application/pdf','pdf'];if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return ['image/jpeg','jpg'];if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','png'];fail('Use PDF, JPG ou PNG. O conteúdo do arquivo não corresponde a um formato aceito.');}
export function signPreview(payload,key){const value=Buffer.from(JSON.stringify(payload)).toString('base64url');return value+'.'+createHmac('sha256',key).update(value).digest('base64url')}
export function readPreview(token,key,userId){if(typeof token!=='string'||token.length>2000000||token.split('.').length!==2)fail('Prévia inválida.');const [v,sig]=token.split('.');const actual=Buffer.from(createHmac('sha256',key).update(v||'').digest('base64url'));const supplied=Buffer.from(sig||'');if(actual.length!==supplied.length||!timingSafeEqual(actual,supplied))fail('Prévia inválida.');let p;try{p=JSON.parse(Buffer.from(v,'base64url'))}catch{fail('Prévia inválida.')}if(p.actor!==userId||!Number.isFinite(p.expires)||p.expires<Date.now())fail('Prévia expirada. Valide o CSV novamente.',409);return p.rows;}
