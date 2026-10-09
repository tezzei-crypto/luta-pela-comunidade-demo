import {parse,parseFragment,serialize} from 'parse5';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {fail} from './portal-domain.mjs';

export const publicRoot=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
export const editorPages=Object.freeze([
 ['/', 'Página inicial'],['/inscricao/','Inscrição de alunos'],['/patrocinar/','Patrocínio'],
 ['/agendamento/','Agendamento'],['/treinamento/','Treinamento'],['/transparencia/','Transparência'],
 ['/contato/','Contato da secretaria'],['/unidades/amavale/','Núcleo Amavale'],
 ['/unidades/valparaiso/','Núcleo Valparaíso'],['/unidades/vale-do-carangola/','Núcleo Vale do Carangola']
].filter(([page])=>fs.existsSync(path.join(publicRoot,page,'index.html'))).map(([page,label])=>({page,label})));
const excluded=new Set(['script','style','noscript','svg','template','select','option','textarea']);
const managedIds=new Set(['contact-title','contact-intro','contact-question','contact-unit-label','contact-profiles','contact-preview','contact-state','contact-open','age-help']);
const attr=(node,name)=>node.attrs?.find(a=>a.name===name)?.value;
const setAttr=(node,name,value)=>{const found=node.attrs?.find(a=>a.name===name);if(found)found.value=value;else node.attrs?.push({name,value})};
const hash=s=>createHash('sha256').update(s).digest('hex');
const cache=new Map();
const pageTemplates=JSON.parse(fs.readFileSync(new URL('./site-page-templates.json',import.meta.url),'utf8'));
export function pageTemplate(page){
 if(!editorPages.some(p=>p.page===page))fail('Página não disponível no editor.',404);
 const file=path.join(publicRoot,page,'index.html'),stamp=fs.statSync(file).mtimeMs;
 if(cache.get(page)?.stamp===stamp)return cache.get(page).template;
 let html=fs.readFileSync(file,'utf8');const pageData=pageTemplates[page];
 if(pageData){const doc=parse(html);function visit(n){
  if(n.tagName==='html')setAttr(n,'data-site-rendered',page);
  if(n.tagName==='main'){n.childNodes=parseFragment(pageData.main).childNodes;for(const c of n.childNodes)c.parentNode=n;return}
  if(n.tagName==='title')n.childNodes=[{nodeName:'#text',value:pageData.title,parentNode:n}];
  if(n.tagName==='meta'&&attr(n,'name')==='description'&&pageData.description)setAttr(n,'content',pageData.description);
  for(const c of n.childNodes||[])visit(c);
 }visit(doc);html=serialize(doc)}
 const template={html,hash:hash(html)};
 cache.set(page,{stamp,template});return template;
}
function inspect(html){
 const doc=parse(html),fields=[],bindings=new Map();
 const add=(node,kind,value,key,section,label)=>{
  const id=hash(key+'|'+kind).slice(0,24);
  const f={id,kind,value,section,label:(label||value||'Imagem sem descrição').replace(/\s+/g,' ').trim().slice(0,140)};
  fields.push(f);bindings.set(id,{node,kind});
 };
 const text=n=>(n.childNodes||[]).map(c=>c.nodeName==='#text'?c.value:text(c)).join(' ').trim();
 function walk(node,key='',blocked=false,section='Conteúdo'){
  const tag=node.tagName,id=attr(node,'id');
  const off=blocked||excluded.has(tag)||managedIds.has(id)||['privacy-note','honeypot','file-feedback'].some(c=>(attr(node,'class')||'').split(/\s+/).includes(c))||attr(node,'aria-live')!==undefined||['status','alert'].includes(attr(node,'role'));
  if(tag==='header')section='Cabeçalho';else if(tag==='footer')section='Rodapé';else if(tag==='nav')section='Navegação';
  else if(tag==='section'){const heading=(node.childNodes||[]).find(c=>/^h[1-6]$/.test(c.tagName));section=heading?text(heading).slice(0,100):'Seção '+(id||'da página')}
  if(!off){
   if(node.nodeName==='#text'&&node.value.trim()&&node.parentNode?.tagName!=='title')add(node,'text',node.value,key,section,node.value);
   if(tag==='title')add(node,'title',text(node),key,'Pesquisa e compartilhamento','Título da página');
   if(tag==='meta'&&attr(node,'name')==='description')add(node,'description',attr(node,'content')||'',key,'Pesquisa e compartilhamento','Descrição para pesquisa');
   if(tag==='img'){
    add(node,'image',attr(node,'src')||'',key,section,attr(node,'alt')||'Imagem');
    add(node,'alt',attr(node,'alt')||'',key,section,'Descrição: '+(attr(node,'alt')||'imagem'));
   }
   if(tag==='a'&&attr(node,'href'))add(node,'link',attr(node,'href'),key,section,'Destino: '+(text(node)||attr(node,'aria-label')||attr(node,'href')));
  }
  const counts={};for(const child of node.childNodes||[]){const name=child.tagName||child.nodeName;counts[name]=(counts[name]||0)+1;walk(child,key+'/'+name+':'+counts[name],off||tag==='title',section)}
 }
 walk(doc);return {doc,fields,bindings};
}
export function catalogFor(page){const t=pageTemplate(page);return {schema_hash:t.hash,fields:inspect(t.html).fields.filter(f=>page!=='/contato/'||f.kind!=='title')}}
export function validEditorLink(value){
 if(typeof value!=='string'||value.length>2000||/[\x00-\x20\x7f\\]/.test(value))return false;
 if(value.startsWith('/')&&!value.startsWith('//')||/^#[a-zA-Z0-9_-]*$/.test(value))return true;
 if(/^mailto:[^?<>\s]+@[^?<>\s]+(?:\?[^<>]*)?$/.test(value)||/^tel:\+?[\d().-]+$/.test(value))return true;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password}catch{return false}
}
export function validatePageDraft(page,data,mediaAllowed){
 const c=catalogFor(page),byId=new Map(c.fields.map(f=>[f.id,f]));
 if(!data||data.schema_hash!==c.schema_hash)fail('A estrutura desta página mudou. Reabra a página antes de editar.',409);
 if(!Array.isArray(data.values)||data.values.length>1200)fail('Conteúdo inválido.');
 const seen=new Set();const values=data.values.map(v=>{
  const f=byId.get(v?.id);if(!f||seen.has(v.id)||typeof v.value!=='string'||v.value.length>(f.kind==='text'?8000:2000)||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v.value))fail('Confira os campos de conteúdo.');seen.add(v.id);
  if(f.kind==='link'&&!validEditorLink(v.value))fail('Use um link interno, HTTPS, email ou telefone válido.');
  if(f.kind==='image'&&v.value!==f.value&&!mediaAllowed(v.value))fail('Escolha uma imagem enviada à biblioteca pública.');
  if(f.kind==='title'&&!v.value.trim())fail('Preencha o título da página.');
  return {id:v.id,value:v.value};
 });return {schema_hash:c.schema_hash,values:values.filter(v=>v.value!==byId.get(v.id).value).sort((a,b)=>a.id.localeCompare(b.id))};
}
export function renderPage(page,data,{preview=false}={}){
 const template=pageTemplate(page);
 if(!preview&&(!data?.values?.length||data.schema_hash!==template.hash))return template.html;
 const {doc,bindings}=inspect(template.html);
 if(data?.schema_hash===template.hash)for(const v of data.values||[]){
  const b=bindings.get(v.id);if(!b)continue;const {node,kind}=b;
  if(kind==='text')node.value=v.value;
  else if(kind==='title'){node.childNodes=[{nodeName:'#text',value:v.value,parentNode:node}]}
  else if(kind==='description')setAttr(node,'content',v.value);
  else if(kind==='link')setAttr(node,'href',v.value);
  else if(kind==='alt')setAttr(node,'alt',v.value);
  else if(kind==='image'){
   setAttr(node,'src',v.value);node.attrs=node.attrs.filter(a=>!['srcset','sizes'].includes(a.name));
   if(node.parentNode?.tagName==='picture')node.parentNode.childNodes=node.parentNode.childNodes.filter(n=>n.tagName!=='source');
  }
 }
 if(preview)sanitizePreview(doc,page);return serialize(doc);
}
export function contactHtml(html,c){
 const doc=parse(html),fields={'contact-title':c.title,'contact-intro':c.intro,'contact-question':c.question,'contact-unit-label':c.unit_question};
 const textNode=(value,parent)=>({nodeName:'#text',value,parentNode:parent});
 const element=(tag,parent,attrs=[])=>({nodeName:tag,tagName:tag,namespaceURI:'http://www.w3.org/1999/xhtml',attrs,parentNode:parent,childNodes:[]});
 function visit(n){const id=attr(n,'id');if(Object.hasOwn(fields,id))n.childNodes=[textNode(fields[id],n)];
  if(n.tagName==='title')n.childNodes=[textNode(c.title+' | Luta pela Comunidade',n)];
  if(id==='contact-profiles'){n.childNodes=c.options.filter(o=>o.enabled).map(o=>{const label=element('label',n),input=element('input',label,[{name:'type',value:'radio'},{name:'name',value:'profile'},{name:'value',value:o.id},{name:'required',value:''}]),span=element('span',label);span.childNodes=[textNode(o.label,span)];label.childNodes=[input,span];return label})}
  for(const child of n.childNodes||[])visit(child)}visit(doc);return serialize(doc);
}
export function previewHtml(html,page){const doc=parse(html);sanitizePreview(doc,page);return serialize(doc)}
function sanitizePreview(doc,page){
 function visit(n){
  if(n.childNodes)n.childNodes=n.childNodes.filter(c=>!['script','iframe','object','embed','base'].includes(c.tagName)&&!(c.tagName==='meta'&&attr(c,'http-equiv')));
  if(n.attrs){n.attrs=n.attrs.filter(a=>!/^on/.test(a.name)&&!['action','formaction','srcdoc','autofocus','target'].includes(a.name));
   if(n.tagName==='a'){n.attrs=n.attrs.filter(a=>a.name!=='href');setAttr(n,'aria-disabled','true')}
   if(['button','input','select','textarea'].includes(n.tagName))setAttr(n,'disabled','');
   for(const a of n.attrs){if(['src','href','poster'].includes(a.name)&&a.value&&!a.value.startsWith('data:')){try{const u=new URL(a.value,'https://www.lutapelacomunidade.com.br'+page);if(u.origin==='https://www.lutapelacomunidade.com.br')a.value=u.pathname+u.search}catch{}}}
  }for(const child of n.childNodes||[])visit(child);
 }visit(doc);
}
