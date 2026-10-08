import {randomUUID} from 'node:crypto';
import {fail} from './portal-domain.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const supportId=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():randomUUID();
export const operationFor=pathname=>pathname==='/api/registrations'?'registration':pathname==='/api/sponsorships'?'sponsorship':pathname.includes('/auth/')?'login':pathname.startsWith('/api/portal/')?'portal':['/api/agenda','/api/training-agenda','/api/student-access'].includes(pathname)?'appointment':'site';
const operations=['registration','sponsorship','login','portal','appointment','site'];
export const diagnosticKinds={
 received:['Recebimento confirmado','O servidor confirmou o recebimento. A aprovação ainda depende da equipe.'],
 validation:['Dados ou arquivos inválidos','Confira os campos destacados, o formato e o tamanho dos arquivos.'],
 access:['Acesso não autorizado','Entre novamente se a sessão expirou. A equipe deve conferir as permissões.'],
 conflict:['Conflito de atualização','Confira o registro existente antes de reenviar ou atualizar.'],
 too_large:['Arquivo acima do limite','Reduza os arquivos conforme o limite informado no formulário.'],
 rate_limit:['Limite de tentativas','Aguarde alguns minutos antes de tentar novamente.'],
 unavailable:['Serviço indisponível','Tente novamente mais tarde. A equipe deve conferir o serviço.'],
 server:['Falha de processamento','A equipe deve verificar o serviço usando o código de atendimento.'],
 storage:['Falha no armazenamento','A equipe deve verificar o banco e o espaço do disco privado.'],
 email:['Aviso por email não confirmado','Confira o provedor de email. A inscrição pode estar salva no painel.'],
 disconnected:['Conexão interrompida','A confirmação não chegou ao navegador. Confira o registro antes de iniciar outra inscrição.'],
 offline:['Navegador sem conexão','Reconecte o aparelho e tente novamente sem apagar os campos.'],
 network:['Falha de conexão relatada','O navegador não conseguiu obter a resposta. A causa exata não foi confirmada.'],
 timeout:['Tempo de resposta excedido','O navegador aguardou sem confirmação. Confira o registro antes de iniciar outro envio.'],
 unexpected_response:['Resposta inesperada','A resposta recebida não tinha o formato esperado. Não é possível afirmar que a inscrição foi salva.']
};
export function kindForStatus(status){return status===413?'too_large':status===429?'rate_limit':status===409?'conflict':[401,403].includes(status)?'access':[400,404,405,415,422].includes(status)?'validation':[502,503,504].includes(status)?'unavailable':'server'}
export function causeFor(error){return ['ENOSPC','EACCES','EROFS'].includes(error?.code)||String(error?.code||'').startsWith('ERR_SQLITE')?'storage':error?.name==='AbortError'||error?.name==='TimeoutError'?'timeout':'server'}
export function sanitizeDiagnostic(raw,now=Date.now()){
 const kind=Object.hasOwn(diagnosticKinds,raw?.kind)?raw.kind:'server';
 return {support_id:supportId(raw?.support_id),created_at:new Date(now).toISOString(),source:raw?.source==='browser'?'browser':'server',operation:operations.includes(raw?.operation)?raw.operation:'site',kind,status:Number.isInteger(raw?.status)&&raw.status>=0&&raw.status<=599?raw.status:0,duration_ms:Number.isFinite(raw?.duration_ms)?Math.max(0,Math.min(600000,Math.round(raw.duration_ms))):0,release:/^[a-f0-9]{7,40}$/i.test(raw?.release||'')?raw.release.slice(0,12):''};
}
export function diagnostics({db,get,all,run,tx,requireRole,audit}){
 db.exec(`CREATE TABLE IF NOT EXISTS diagnostic_settings(id INTEGER PRIMARY KEY CHECK(id=1),retention_days INTEGER NOT NULL DEFAULT 30,version INTEGER NOT NULL DEFAULT 1);
 INSERT OR IGNORE INTO diagnostic_settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS diagnostic_events(id INTEGER PRIMARY KEY AUTOINCREMENT,support_id TEXT NOT NULL,created_at TEXT NOT NULL,source TEXT NOT NULL,operation TEXT NOT NULL,kind TEXT NOT NULL,status INTEGER NOT NULL,duration_ms INTEGER NOT NULL,release TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS diagnostic_support ON diagnostic_events(support_id);
 CREATE INDEX IF NOT EXISTS diagnostic_time ON diagnostic_events(created_at);`);
 const settings=()=>get('SELECT retention_days,version FROM diagnostic_settings WHERE id=1');
 function prune(){run('DELETE FROM diagnostic_events WHERE created_at<?',new Date(Date.now()-settings().retention_days*86400000).toISOString());run('DELETE FROM diagnostic_events WHERE id IN (SELECT id FROM diagnostic_events ORDER BY id DESC LIMIT -1 OFFSET 10000)')}
 prune();
 return {
  recordDiagnostic(raw){const e=sanitizeDiagnostic(raw);run('INSERT INTO diagnostic_events(support_id,created_at,source,operation,kind,status,duration_ms,release) VALUES(?,?,?,?,?,?,?,?)',...Object.values(e));prune();return e.support_id},
  diagnosticEvents(actor,{support_id='',kind='',page=0}={}){requireRole(actor,['admin']);if(support_id&&!UUID.test(support_id)||kind&&!Object.hasOwn(diagnosticKinds,kind)||!Number.isInteger(page)||page<0||page>200)fail('Filtro inválido.');prune();const where=[],values=[];if(support_id){where.push('support_id=?');values.push(support_id.toLowerCase())}if(kind){where.push('kind=?');values.push(kind)}const rows=all('SELECT * FROM diagnostic_events'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY id DESC LIMIT 51 OFFSET ?',...values,page*50);return {events:rows.slice(0,50).map(e=>({...e,title:diagnosticKinds[e.kind][0],guidance:diagnosticKinds[e.kind][1]})),has_more:rows.length>50,page,settings:settings(),kinds:diagnosticKinds}},
  configureDiagnostics(actor,data){requireRole(actor,['admin']);const days=Number(data.retention_days);if(![7,30,90].includes(days))fail('Escolha 7, 30 ou 90 dias.');return tx(()=>{if(data.version!==settings().version)fail('Configuração alterada. Atualize o painel.',409);run('UPDATE diagnostic_settings SET retention_days=?,version=version+1 WHERE id=1',days);prune();audit(actor,'diagnostics.retention:'+days);return settings()})}
 };
}
