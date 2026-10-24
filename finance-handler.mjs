import {csv,fail} from './portal-domain.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function handleFinance({req,route,method,store,actor,requireRole}){
 if(!/^\/finance(?:\/|$)/.test(route))return null;requireRole('admin');const json=(d,s=200)=>Response.json(d,{status:s,headers});
 const body=async()=>{try{return await req.json()}catch{fail('JSON financeiro inválido.')}};
 if(route==='/finance'&&method==='GET')return json(await store.financeList(actor));
 if(route==='/finance/records'&&method==='POST')return json(await store.financeSave(actor,await body()),201);
 if(route==='/finance/import'&&method==='POST')return json(await store.financeImport(actor,await body()),201);
 if(route==='/finance/documents'&&method==='POST')return json(await store.financeDocument(actor,await body()),201);
 if(route==='/finance/export'&&method==='GET'){const data=await store.financeList(actor);return new Response(JSON.stringify(data,null,2),{headers:{...headers,'Content-Type':'application/json','Content-Disposition':'attachment; filename="financeiro-auditoria.json"'}})}
 if(route==='/finance/ledger.csv'&&method==='GET'){const data=await store.financeList(actor),rows=data.records.map(r=>({id:r.id,tipo:r.kind,versao:r.version,...r.data,evidence_ids:r.data.evidence_ids.join(' | '),valor_reais:r.data.amount_cents===undefined?'':(r.data.amount_cents/100).toFixed(2)}));return new Response(csv(rows,['id','tipo','versao','date','budget_code','label','supplier','number','fiscal_key','transaction_ref','invoice_id','disposition','valor_reais','status','evidence_ids','notes']),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="livro-financeiro.csv"'}})}
 const m=route.match(/^\/finance\/documents\/([\w-]{1,90})$/);if(m&&method==='GET'){const d=await store.financeDownload(actor,m[1]);return new Response(d.bytes,{headers:{...headers,'Content-Type':d.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(d.name.replace(/[\r\n]/g,''))}`,'Content-Length':String(d.size),'X-Document-SHA256':d.sha256}})}
 return json({message:'Operação financeira não encontrada.'},404);
}
