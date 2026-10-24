import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import {fail} from './portal-domain.mjs';
const kinds=['project','budget','invoice','payment','income','bank_statement','delivery','issue'];
const idOk=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(x);
const text=(x,max=1000)=>typeof x==='string'&&x.trim().length>0&&x.length<=max;
const dateOk=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const hash=b=>createHash('sha256').update(b).digest('hex');
export function financeTools({db,get,all,run,tx,requireRole,audit,objectPath}){
 db.exec(`CREATE TABLE IF NOT EXISTS finance_records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS finance_history(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(record_id,version));
 CREATE TABLE IF NOT EXISTS finance_documents(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,sha256 TEXT NOT NULL UNIQUE,size INTEGER NOT NULL,object_key TEXT NOT NULL UNIQUE,created_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS finance_invoice_key ON finance_records(json_extract(payload,'$.fiscal_key')) WHERE kind='invoice' AND json_extract(payload,'$.fiscal_key')!='';
 CREATE UNIQUE INDEX IF NOT EXISTS finance_payment_ref ON finance_records(json_extract(payload,'$.transaction_ref')) WHERE kind IN ('payment','income') AND json_extract(payload,'$.transaction_ref')!='';`);
 if(!all('PRAGMA table_info(finance_documents)').some(c=>c.name==='category'))db.exec("ALTER TABLE finance_documents ADD COLUMN category TEXT NOT NULL DEFAULT 'other'");
 const admin=a=>requireRole(a,['admin']);
 const rows=()=>all('SELECT * FROM finance_records ORDER BY created_at,id').map(r=>({...r,data:JSON.parse(r.payload),payload:undefined}));
 function validate(kind,p){
  if(!kinds.includes(kind)||!p||typeof p!=='object'||Array.isArray(p)||!text(p.label,300))fail('Tipo e descrição financeira obrigatórios.');
  const allowed=['label','amount_cents','date','budget_code','supplier','tax_id','number','fiscal_key','transaction_ref','invoice_id','disposition','notes','evidence_ids','status','severity','quantity','multiplier','unit_price_cents','process','beneficiary','benefit_cents','source_url'];
  if(Object.keys(p).some(k=>!allowed.includes(k)))fail('Campo financeiro desconhecido.');
  if(JSON.stringify(p).length>18000)fail('Registro muito extenso.');
  for(const k of ['amount_cents','benefit_cents','unit_price_cents'])if(p[k]!==undefined&&(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>100000000000))fail('Informe valores inteiros em centavos.');
  if(['invoice','payment','income','budget'].includes(kind)&&(!Number.isSafeInteger(p.amount_cents)||p.amount_cents<=0))fail('Informe um valor positivo em centavos.');
  if(p.date!==undefined&&p.date!==''&&!dateOk(p.date))fail('Data inválida.');
  if(['invoice','payment','income'].includes(kind)&&!dateOk(p.date))fail('Informe a data do documento.');
  for(const k of ['budget_code','supplier','tax_id','number','fiscal_key','transaction_ref','invoice_id','disposition','status','severity','process','beneficiary','source_url'])if(p[k]!==undefined&&(typeof p[k]!=='string'||p[k].length>500))fail('Campo financeiro inválido.');
  if(p.notes!==undefined&&(typeof p.notes!=='string'||p.notes.length>10000))fail('Observação muito extensa.');
  if(p.fiscal_key&&!/^\d{44}$/.test(p.fiscal_key))fail('A chave da NF-e deve ter 44 dígitos.');
  if(p.tax_id&&!/^\d{14}$/.test(p.tax_id))fail('Informe o CNPJ com 14 dígitos.');
  if(p.disposition&&!['current','historical','excluded'].includes(p.disposition))fail('Classificação inválida.');
  if(p.status&&!['pending','resolved'].includes(p.status))fail('Situação inválida.');
  for(const k of ['quantity','multiplier'])if(p[k]!==undefined&&(!Number.isFinite(p[k])||p[k]<=0||p[k]>1000000))fail('Quantidade inválida.');
  if(!Array.isArray(p.evidence_ids)||p.evidence_ids.length>100||p.evidence_ids.some(x=>!idOk(x)))fail('Lista de documentos inválida.');
  if(new Set(p.evidence_ids).size!==p.evidence_ids.length)fail('Documento repetido no registro.');
  if(p.evidence_ids.some(x=>!get('SELECT id FROM finance_documents WHERE id=?',x)))fail('Vincule somente documentos já arquivados.');
  if(['invoice','payment','income'].includes(kind)&&!p.evidence_ids.length)fail('Anexe o documento que sustenta o lançamento.');
  if(kind==='budget'&&!text(p.budget_code,30))fail('Informe o código da rubrica.');
  if(p.budget_code&&kind!=='budget'&&!get("SELECT id FROM finance_records WHERE kind='budget' AND json_extract(payload,'$.budget_code')=?",p.budget_code))fail('Rubrica não cadastrada.');
  if(kind==='payment'){
   const inv=get("SELECT payload FROM finance_records WHERE kind='invoice' AND id=?",p.invoice_id||'');
   if(!inv||JSON.parse(inv.payload).disposition!=='current')fail('Vincule o pagamento a uma nota atual.');
   if(!text(p.transaction_ref,150))fail('Informe o identificador bancário do pagamento.');
   if(p.budget_code!==JSON.parse(inv.payload).budget_code)fail('A rubrica deve coincidir com a nota.');
  }
  if(kind==='invoice'&&(!text(p.supplier,300)||!['current','historical','excluded'].includes(p.disposition)))fail('Informe fornecedor e classificação da nota.');
  if(kind==='issue'&&p.status==='resolved'&&!p.evidence_ids.length)fail('Vincule evidência para resolver a pendência.');
  return JSON.parse(JSON.stringify(p));
 }
 function save(actor,{id,kind,data,version=0,reason},repeated=false){
  if(!idOk(id)||!text(reason,1000))fail('Informe um identificador e o motivo do registro.');
  const old=get('SELECT * FROM finance_records WHERE id=?',id),p=validate(kind,data);
  if(old&&repeated&&old.kind===kind&&old.payload===JSON.stringify(p))return {id,repeated:true,version:old.version};
  if(!Number.isInteger(version)||version!==(old?.version||0))fail('O registro mudou. Atualize antes de salvar.',409);
  if(old&&old.kind!==kind)fail('O tipo do registro não pode ser alterado.',409);
  if(kind==='payment'){
   const inv=JSON.parse(get('SELECT payload FROM finance_records WHERE id=?',p.invoice_id).payload),paid=get("SELECT COALESCE(sum(json_extract(payload,'$.amount_cents')),0) AS n FROM finance_records WHERE kind='payment' AND json_extract(payload,'$.invoice_id')=? AND id!=?",p.invoice_id,id).n;
   if(paid+p.amount_cents>inv.amount_cents)fail('Os pagamentos excedem o valor da nota vinculada.',409);
  }
  if(kind==='invoice'&&get("SELECT COALESCE(sum(json_extract(payload,'$.amount_cents')),0) AS n FROM finance_records WHERE kind='payment' AND json_extract(payload,'$.invoice_id')=?",id).n>p.amount_cents)fail('O valor da nota não pode ficar abaixo dos pagamentos vinculados.',409);
  if(kind==='budget'&&get("SELECT id FROM finance_records WHERE kind='budget' AND json_extract(payload,'$.budget_code')=? AND id!=?",p.budget_code,id))fail('Rubrica já cadastrada.',409);
  if(kind==='invoice'&&p.disposition!=='current'&&get("SELECT id FROM finance_records WHERE kind='payment' AND json_extract(payload,'$.invoice_id')=?",id))fail('Esta nota tem pagamentos vinculados. Preserve a conciliação antes de reclassificar.',409);
  const now=new Date().toISOString(),v=version+1,j=JSON.stringify(p);
  run('INSERT INTO finance_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at',id,kind,j,v,actor,now,now);
  run('INSERT INTO finance_history(record_id,kind,payload,version,actor,reason,created_at) VALUES(?,?,?,?,?,?,?)',id,kind,j,v,actor,reason.trim(),now);
  audit(actor,'finance.'+(old?'revise:':'create:')+id);return {id,version:v,repeated:false};
 }
 function doc(actor,d){
  const category=d.category||'other';if(!['invoice','payment','income','bank_statement','authorization','delivery','other','report'].includes(category))fail('Categoria de documento inválida.');
  if(!idOk(d.id)||!text(d.name,220)||!['application/pdf','application/xml','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(d.mime)||typeof d.base64!=='string'||d.base64.length>8*1024*1024||!/^[a-f0-9]{64}$/.test(d.sha256||''))fail('Documento inválido.');
  const bytes=Buffer.from(d.base64,'base64');if(!bytes.length||bytes.length>6*1024*1024||hash(bytes)!==d.sha256)fail('Conteúdo ou hash do documento inválido.');
  const isPdf=bytes.subarray(0,5).toString()==='%PDF-',isXml=/^\s*(<\?xml|<nfeProc|<NFe)/.test(bytes.toString('utf8',0,150)),isJpg=bytes[0]===255&&bytes[1]===216,isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),isZip=bytes[0]===80&&bytes[1]===75;
  if(!(d.mime==='application/pdf'&&isPdf||d.mime==='application/xml'&&isXml||d.mime==='image/jpeg'&&isJpg||d.mime==='image/png'&&isPng||d.mime.includes('spreadsheetml')&&isZip))fail('Formato do documento não confere.');
  const sameId=get('SELECT * FROM finance_documents WHERE id=?',d.id);
  if(sameId&&sameId.sha256!==d.sha256)fail('Identificador de documento já cadastrado com outro conteúdo.',409);
  const old=sameId||get('SELECT * FROM finance_documents WHERE sha256=?',d.sha256);
  if(old)return {id:old.id,repeated:true};
  const key='finance/'+d.sha256,full=objectPath(key);fs.mkdirSync(objectPath('finance'),{recursive:true,mode:0o700});
  if(fs.existsSync(full)){if(hash(fs.readFileSync(full))!==d.sha256)fail('Arquivo existente divergente.',409)}else fs.writeFileSync(full,bytes,{flag:'wx',mode:0o600});
  run('INSERT INTO finance_documents(id,name,mime,sha256,size,object_key,created_by,created_at,category) VALUES(?,?,?,?,?,?,?,?,?)',d.id,d.name,d.mime,d.sha256,bytes.length,key,actor,new Date().toISOString(),category);audit(actor,'finance.document:'+d.id);return {id:d.id,repeated:false};
 }
 return {
  financeList:async actor=>{admin(actor);audit(actor,'finance.read');const records=rows(),invoices=records.filter(r=>r.kind==='invoice'&&r.data.disposition==='current'),payments=records.filter(r=>r.kind==='payment'),sum=a=>a.reduce((n,r)=>n+r.data.amount_cents,0);return {records,documents:all('SELECT id,name,mime,sha256,size,category,created_at FROM finance_documents ORDER BY id'),history:all('SELECT h.*,m.email AS actor_email FROM finance_history h LEFT JOIN members m ON m.user_id=h.actor ORDER BY seq DESC').map(r=>({...r,data:JSON.parse(r.payload),payload:undefined})),totals:{budget_cents:sum(records.filter(r=>r.kind==='budget')),invoice_cents:sum(invoices),payment_cents:sum(payments),income_cents:sum(records.filter(r=>r.kind==='income')),bank_balance_cents:null},generated_at:new Date().toISOString()};},
  financeSave:async(actor,p)=>{admin(actor);if(!p||typeof p!=='object'||Array.isArray(p))fail('Registro financeiro inválido.');try{return tx(()=>save(actor,p))}catch(e){if(/UNIQUE constraint/.test(e.message))fail('Chave fiscal ou transação já cadastrada.',409);throw e}},
  financeDocument:async(actor,d)=>{admin(actor);if(!d||typeof d!=='object')fail('Documento inválido.');return tx(()=>doc(actor,d))},
  financeImport:async(actor,p)=>{admin(actor);if(!p||!Array.isArray(p.records)||p.records.length>500||p.records.some(r=>!r||typeof r!=='object')||!Array.isArray(p.documents)||p.documents.length>100||p.documents.some(d=>!d||typeof d!=='object'))fail('Pacote financeiro inválido.');try{return tx(()=>{const documents=p.documents.map(d=>doc(actor,d));const records=p.records.map(r=>save(actor,r,true));return {created:records.filter(r=>!r.repeated).length,repeated:records.filter(r=>r.repeated).length,documents:documents.length}})}catch(e){if(/UNIQUE constraint/.test(e.message))fail('Chave fiscal ou transação já cadastrada.',409);throw e}},
  financeDownload:async(actor,id)=>{admin(actor);const d=get('SELECT * FROM finance_documents WHERE id=?',id);if(!d)fail('Documento não encontrado.',404);const bytes=fs.readFileSync(objectPath(d.object_key));if(hash(bytes)!==d.sha256)fail('Falha na conferência de integridade.',409);audit(actor,'finance.download:'+id);return {...d,bytes};}
 };
}
