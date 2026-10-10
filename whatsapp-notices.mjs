import {fail} from './portal-domain.mjs';
import {normalizeContactPhone} from './contact-settings.mjs';
// The approved template has no variables: it only points staff to the private portal.
export function whatsappNotices({db,get,all,run,tx,requireRole,audit,env,transport,targets}){
 db.exec(`CREATE TABLE IF NOT EXISTS whatsapp_settings(id INTEGER PRIMARY KEY CHECK(id=1),phone TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS whatsapp_optins(user_id TEXT PRIMARY KEY REFERENCES members(user_id),phone TEXT NOT NULL,accepted INTEGER NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,actor TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS whatsapp_notices(kind TEXT NOT NULL,issue_id TEXT NOT NULL,user_id TEXT NOT NULL,phone TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT NOT NULL DEFAULT '',updated_at INTEGER NOT NULL,PRIMARY KEY(kind,issue_id,user_id));`);
 run('INSERT OR IGNORE INTO whatsapp_settings(id,phone) VALUES(1,?)',get('SELECT phone FROM project_contact WHERE id=1')?.phone||'');
 const read=()=>get('SELECT * FROM whatsapp_settings WHERE id=1');
 const connected=s=>!!(env.WHATSAPP_ACCESS_TOKEN&&/^\d{5,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID||'')&&/^v\d{1,3}\.0$/.test(env.WHATSAPP_API_VERSION||'')&&/^[a-z0-9_]{1,512}$/.test(env.WHATSAPP_TEMPLATE||'')&&/^[a-z]{2}(?:_[A-Z]{2})?$/.test(env.WHATSAPP_LANGUAGE||'')&&env.WHATSAPP_SENDER_PHONE===s.phone);
 const permitted=['admin','secretary','teacher','psychologist','social_worker'];
 function settings(actor){requireRole(actor,['admin']);const s=read();return {...s,enabled:!!s.enabled,connected:connected(s),recipients:all(`SELECT m.user_id,m.email,m.role,COALESCE(o.phone,'') AS phone,COALESCE(o.accepted,0) AS accepted,COALESCE(o.version,0) AS version FROM members m LEFT JOIN whatsapp_optins o ON o.user_id=m.user_id WHERE m.active=1 AND m.role<>'guardian' ORDER BY m.role,m.email`),deliveries:all('SELECT n.kind,n.status,n.updated_at,m.email FROM whatsapp_notices n JOIN members m ON m.user_id=n.user_id ORDER BY n.updated_at DESC LIMIT 50')}}
 let running=false;
 return {
  async whatsappSettings(actor){return settings(actor)},
  async saveWhatsappSettings(actor,p){return tx(()=>{requireRole(actor,['admin']);const old=read(),phone=normalizeContactPhone(p.phone);if(p.version!==old.version)fail('Configuração alterada. Recarregue antes de salvar.',409);if(typeof p.enabled!=='boolean')fail('Confira a ativação.');
   const enabled=phone===old.phone&&p.enabled;if(enabled&&!connected({...old,phone}))fail('Conecte este número, o token e o modelo aprovado da Meta antes de ativar.',409);
   run('UPDATE whatsapp_settings SET phone=?,enabled=?,version=version+1 WHERE id=1',phone,Number(enabled));audit(actor,'whatsapp.settings.updated');return settings(actor);
  })},
  async saveWhatsappRecipient(actor,p){return tx(()=>{requireRole(actor,['admin']);const m=get('SELECT * FROM members WHERE user_id=? AND active=1',p.user_id),old=get('SELECT * FROM whatsapp_optins WHERE user_id=?',p.user_id);if(!m||!permitted.includes(m.role))fail('Conta da equipe indisponível.',400);if(p.version!==(old?.version||0))fail('Preferência alterada. Recarregue antes de salvar.',409);if(typeof p.accepted!=='boolean')fail('Registre a autorização do destinatário.');const phone=normalizeContactPhone(p.phone);
   run('INSERT INTO whatsapp_optins VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,accepted=excluded.accepted,version=excluded.version,updated_at=excluded.updated_at,actor=excluded.actor',p.user_id,phone,Number(p.accepted),(old?.version||0)+1,new Date().toISOString(),actor);audit(actor,'whatsapp.recipient.'+(p.accepted?'opted_in:':'opted_out:')+p.user_id);return settings(actor);
  })},
  async deliverWhatsappNotices(){
   if(running)return;running=true;
   try{
    const s=read();if(!s.enabled||!connected(s))return;
    run("UPDATE whatsapp_notices SET status='review' WHERE status='sending' AND updated_at<?",Date.now()-120000);
    const candidates=targets().filter(t=>!get('SELECT 1 FROM whatsapp_notices WHERE kind=? AND issue_id=? AND user_id=?',t.kind,t.issue_id,t.user_id));
    for(const candidate of candidates.slice(0,100)){
     // Re-check scope, resolution, consent and sender immediately before claiming each send.
     const current=read();if(!current.enabled||!connected(current))break;
     if(!targets().some(t=>t.kind===candidate.kind&&t.issue_id===candidate.issue_id&&t.user_id===candidate.user_id))continue;
     const o=get('SELECT o.* FROM whatsapp_optins o JOIN members m ON m.user_id=o.user_id WHERE o.user_id=? AND o.accepted=1 AND m.active=1',candidate.user_id);if(!o)continue;
     const claimed=tx(()=>run("INSERT OR IGNORE INTO whatsapp_notices(kind,issue_id,user_id,phone,status,updated_at) VALUES(?,?,?,?,'sending',?)",candidate.kind,candidate.issue_id,candidate.user_id,o.phone,Date.now()).changes);if(!claimed)continue;
     let id='',status='review';
     try{const response=await transport(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`,{method:'POST',headers:{Authorization:'Bearer '+env.WHATSAPP_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:o.phone.slice(1),type:'template',template:{name:env.WHATSAPP_TEMPLATE,language:{code:env.WHATSAPP_LANGUAGE}}}),signal:AbortSignal.timeout(10000)});
      if(response.ok){id=(await response.json()).messages?.[0]?.id||'';status=id?'accepted':'review'}else status='failed';
     }catch{}
     // Meta does not promise idempotency here. Ambiguous results require review, never blind resend.
     run('UPDATE whatsapp_notices SET status=?,provider_id=?,updated_at=? WHERE kind=? AND issue_id=? AND user_id=?',status,id,Date.now(),candidate.kind,candidate.issue_id,candidate.user_id);audit('system','whatsapp.notice.'+status+':'+candidate.kind+':'+candidate.issue_id+':'+candidate.user_id);
    }
   }finally{running=false}
  }
 };
}
