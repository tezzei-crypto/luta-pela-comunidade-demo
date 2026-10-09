import {randomUUID} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';
import sharp from 'sharp';
import {fail} from './portal-domain.mjs';
import {contactProfiles,contactMessage,contactUnits} from './dist/contact-options.js';
import {editorPages,catalogFor,validatePageDraft,renderPage,contactHtml,previewHtml} from './site-editor-template.mjs';
export const defaultConversation={title:'Fale com a secretaria',intro:'Escolha a opção que melhor descreve seu contato. Vamos preparar uma mensagem para facilitar o atendimento.',question:'Como podemos ajudar?',unit_question:'Sobre qual núcleo? (opcional)',options:Object.entries(contactProfiles).map(([id,label])=>({id,label,message:contactMessage(id).replace(/^Luta pela Comunidade\n/,''),enabled:true}))};
export function validateConversation(p){
 const out={};for(const [key,max]of [['title',120],['intro',1000],['question',200],['unit_question',200]]){
  if(typeof p?.[key]!=='string'||!p[key].trim()||p[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(p[key]))fail('Confira os títulos e as orientações do atendimento.');out[key]=p[key].trim();
 }
 if(!Array.isArray(p.options)||p.options.length<1||p.options.length>12)fail('Cadastre entre 1 e 12 opções.');
 const seen=new Set();out.options=p.options.map(o=>{
  if(!o||typeof o.id!=='string'||!/^[a-z][a-z0-9-]{1,39}$/.test(o.id)||seen.has(o.id)||typeof o.enabled!=='boolean')fail('Opção de atendimento inválida.');seen.add(o.id);
  for(const [key,max]of [['label',120],['message',1200]])if(typeof o[key]!=='string'||!o[key].trim()||o[key].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(o[key]))fail('Preencha o nome e a mensagem de cada opção.');
  return {id:o.id,label:o.label.trim(),message:o.message.trim(),enabled:o.enabled};
 });if(!out.options.some(o=>o.enabled))fail('Mantenha pelo menos uma opção ativa.');return out;
}
export async function prepareSiteImage(file){
 if(!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>8*1024*1024)fail('Escolha uma imagem JPG, PNG ou WebP de até 8 MB.');
 try{
  const raw=Buffer.from(await file.arrayBuffer());
  const supported=raw.subarray(0,3).equals(Buffer.from([255,216,255]))||raw.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||raw.subarray(0,4).toString()==='RIFF'&&raw.subarray(8,12).toString()==='WEBP';
  if(!supported)fail('Use uma imagem JPG, PNG ou WebP.');
  const image=sharp(raw,{limitInputPixels:40000000,failOn:'warning',animated:false}),meta=await image.metadata();
  if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1||meta.width<16||meta.height<16)fail('Use uma imagem estática com pelo menos 16 × 16 pixels.');
  return await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:88}).timeout({seconds:15}).toBuffer();
 }catch(e){if(e.status)throw e;fail('Não foi possível ler a imagem. Escolha outro JPG, PNG ou WebP.');}
}
export function siteEditor({db,get,all,run,tx,requireRole,audit,objectPath}){
 db.exec(`CREATE TABLE IF NOT EXISTS cms_documents(key TEXT PRIMARY KEY,draft TEXT NOT NULL,published TEXT NOT NULL,version INTEGER NOT NULL,updated_at TEXT NOT NULL,published_at TEXT NOT NULL DEFAULT '');
 CREATE TABLE IF NOT EXISTS cms_revisions(id TEXT PRIMARY KEY,key TEXT NOT NULL,before_data TEXT NOT NULL,after_data TEXT NOT NULL,actor TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS cms_revision_document ON cms_revisions(key,created_at);
 CREATE TABLE IF NOT EXISTS cms_media(id TEXT PRIMARY KEY,object_path TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,alt TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL);`);
 const manager=actor=>requireRole(actor,['admin','secretary']);
 const base=key=>key==='contact'?structuredClone(defaultConversation):{schema_hash:catalogFor(key).schema_hash,values:[]};
 const read=key=>{const r=get('SELECT * FROM cms_documents WHERE key=?',key);return r?{...r,draft:JSON.parse(r.draft),published:JSON.parse(r.published)}:{key,draft:base(key),published:base(key),version:0,updated_at:'',published_at:''}};
 const mediaAllowed=value=>{const m=/^\/site-media\/([a-f0-9-]{36})\.webp$/.exec(value);return !!m&&!!get('SELECT id FROM cms_media WHERE id=?',m[1])};
 const validate=(key,data)=>key==='contact'?validateConversation(data):validatePageDraft(key,data,mediaAllowed);
 const checkVersion=(old,p)=>{if(!Number.isSafeInteger(p.version)||p.version!==old.version)fail('Outra pessoa atualizou este conteúdo. Recarregue antes de salvar; sua edição continua na tela.',409)};
 const result=(actor,key)=>{manager(actor);const r=read(key);return {...r,...(key==='contact'?{}:catalogFor(key)),history:all('SELECT r.id,r.reason,r.created_at,m.email AS actor_email FROM cms_revisions r LEFT JOIN members m ON m.user_id=r.actor WHERE r.key=? ORDER BY r.rowid DESC LIMIT 30',key)}};
 const published=key=>read(key).published;
 const contact=()=>{const c=published('contact');return {...c,options:c.options.filter(o=>o.enabled)}};
 function publicHtml(page){let html=renderPage(page,published(page));if(page==='/contato/')html=contactHtml(html,contact());return html}
 return {
  async editorPages(actor){manager(actor);return {pages:editorPages,media:all('SELECT id,size,alt,created_at FROM cms_media ORDER BY rowid DESC LIMIT 1000').map(m=>({...m,url:'/site-media/'+m.id+'.webp'}))}},
  async editorDocument(actor,key){return result(actor,key)},
  async saveEditorDraft(actor,key,p){return tx(()=>{manager(actor);const old=read(key);checkVersion(old,p);const draft=validate(key,p.data),now=new Date().toISOString();run('INSERT INTO cms_documents(key,draft,published,version,updated_at,published_at) VALUES(?,?,?,?,?,?) ON CONFLICT(key) DO UPDATE SET draft=excluded.draft,version=excluded.version,updated_at=excluded.updated_at',key,JSON.stringify(draft),JSON.stringify(old.published),old.version+1,now,old.published_at);audit(actor,'editor.draft:'+key);return result(actor,key)})},
  async publishEditor(actor,key,p){return tx(()=>{manager(actor);const old=read(key);checkVersion(old,p);if(typeof p.reason!=='string'||p.reason.trim().length<5||p.reason.length>500)fail('Descreva a alteração em 5 a 500 caracteres.');const data=validate(key,old.draft),now=new Date().toISOString();
   if(JSON.stringify(data)===JSON.stringify(old.published))fail('O rascunho já corresponde ao conteúdo publicado.');
   run('INSERT INTO cms_revisions VALUES(?,?,?,?,?,?,?)',randomUUID(),key,JSON.stringify(old.published),JSON.stringify(data),actor,p.reason.trim(),now);
   run('UPDATE cms_documents SET published=?,draft=?,version=version+1,updated_at=?,published_at=? WHERE key=?',JSON.stringify(data),JSON.stringify(data),now,now,key);audit(actor,'editor.published:'+key);return result(actor,key)})},
  async restoreEditor(actor,key,p){return tx(()=>{manager(actor);const old=read(key);checkVersion(old,p);const revision=get('SELECT * FROM cms_revisions WHERE id=? AND key=?',p.revision,key);if(!revision)fail('Versão não localizada.',404);const data=validate(key,JSON.parse(revision.before_data));run('UPDATE cms_documents SET draft=?,version=version+1,updated_at=? WHERE key=?',JSON.stringify(data),new Date().toISOString(),key);audit(actor,'editor.restore_draft:'+key);return result(actor,key)})},
  async editorPreview(actor,key,p){manager(actor);const data=validate(key,p.data);let html=key==='contact'?contactHtml(publicHtml('/contato/'),data):renderPage(key,data);if(key==='/contato/')html=contactHtml(html,contact());return {html:previewHtml(html,key==='contact'?'/contato/':key)}},
  async addEditorMedia(actor,file,p){manager(actor);if(p.authorized!==true||typeof p.alt!=='string'||p.alt.trim().length<3||p.alt.length>300)fail('Descreva a imagem e confirme a autorização de publicação.');
   const bytes=await prepareSiteImage(file),id=randomUUID(),key='site-media/'+id+'.webp',dest=objectPath(key);fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
   try{tx(()=>{manager(actor);if(get('SELECT COUNT(*) AS n FROM cms_media').n>=1000)fail('A biblioteca atingiu o limite de 1.000 imagens.');fs.writeFileSync(dest,bytes,{flag:'wx',mode:0o600});run('INSERT INTO cms_media VALUES(?,?,?,?,?,?,?)',id,key,'image/webp',bytes.length,p.alt.trim(),actor,new Date().toISOString());audit(actor,'editor.media:'+id)});}catch(e){if(fs.existsSync(dest))fs.unlinkSync(dest);throw e}
   return {id,url:'/site-media/'+id+'.webp',alt:p.alt.trim()};
  },
  editorPublicHtml:publicHtml,
  editorPublicMedia(id){const m=get('SELECT * FROM cms_media WHERE id=?',id);if(!m)fail('Imagem não encontrada.',404);return {bytes:fs.readFileSync(objectPath(m.object_path)),mime:m.mime}},
  publicConversation:contact,
  conversationMessage(profile,unit=''){if(unit&&!Object.hasOwn(contactUnits,unit))fail('Escolha um núcleo válido.');const o=contact().options.find(o=>o.id===profile);if(!o)fail('Escolha uma opção de atendimento ativa.');const body=o.message.replace(/^Luta pela Comunidade\s*/i,'');return 'Luta pela Comunidade\n'+(unit?body.replace(/\nPodem me orientar\?$/,'')+'\nNúcleo: '+contactUnits[unit]+'.'+(body.endsWith('\nPodem me orientar?')?'\nPodem me orientar?':''):body)}
 };
}
