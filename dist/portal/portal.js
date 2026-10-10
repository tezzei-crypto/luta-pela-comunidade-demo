'use strict';
const $=id=>document.getElementById(id),labels={admin:'Administrador',secretary:'Secretaria',psychologist:'Psicologia',social_worker:'Assistência social',guardian:'Aluno ou responsável',teacher:'Professor'};
const kinds={photo:'Foto',student_document:'Documento do aluno',guardian_document:'Documento do responsável',consent:'Autorização',report_card:'Boletim escolar',medical_certificate:'Atestado médico'};
const requestFeedbackReady=import('/request-feedback.js');
const phoneLinksReady=import('/portal/phone-links.js');
function phoneContact(text,phone,label='Contato'){const p=el('p',text);phoneLinksReady.then(m=>m.appendPhoneLink(p,phone,label)).catch(()=>{});return p}
const sessionCacheReady=import('/portal/session-cache.js').then(m=>m.createSessionCache());
let sessionCache=null,sessionTimer;sessionCacheReady.then(cache=>sessionCache=cache);
let token='',me=null,students=[],chosen='',previewToken='',loginEmail='';
function el(tag,text,attrs={}){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n}
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error)}
async function api(path,{method='GET',data,form,blob=false}={}){
 const sessionToken=token,feedback=await requestFeedbackReady;
 const options={method,cache:'no-store',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:form||(data?JSON.stringify(data):undefined)};
 try{const value=blob?await (await feedback.requestResponse('/api/portal'+path,options)).blob():await feedback.requestJson('/api/portal'+path,options);if(sessionToken&&sessionToken!==token)throw Error('A sessão foi encerrada.');return value}
 catch(error){if(error.status===401&&token)reset();throw error}
}
const action=createPortalAction({notice,el});
function reset(){clearTimeout(sessionTimer);sessionCache?.clear();token='';me=null;students=[];previewToken='';chosen='';$('workspace').hidden=true;$('detail').replaceChildren();$('students').replaceChildren();$('members').replaceChildren();$('preview').replaceChildren();$('link-user').replaceChildren();$('link-student').replaceChildren();$('logout').hidden=true;$('login').hidden=false;$('code').value='';$('test-access-banner')?.remove();document.dispatchEvent(new Event('portal:logout'));notice('Sessão encerrada. Entre novamente quando precisar.')}
function download(blob,name){const url=URL.createObjectURL(blob),a=el('a','',{href:url,download:name});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
$('logout').addEventListener('click',action(async()=>{try{await api('/auth/logout',{method:'POST',data:{}})}finally{reset()}}));
$('request-code').addEventListener('submit',action(async()=>{loginEmail=$('email').value.trim().toLowerCase();const p=await api('/auth/request',{method:'POST',data:{email:loginEmail}});notice(p.message);$('verify-code').hidden=false;$('code').focus()}));
function scopeUnitNames(){const all={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};return Object.fromEntries(Object.entries(all).filter(([u])=>me?.role!=='secretary'||me.units?.includes(u)))}
async function openWorkspace(){me=await api('/me');clearTimeout(sessionTimer);if(me.session_expires_at){const remaining=me.session_expires_at-Date.now();if(remaining<=0){reset();return;}sessionTimer=setTimeout(()=>reset(),remaining);}$('login').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('identity').textContent=me.email+' · '+labels[me.role]+(me.role==='admin'?' · Todos os núcleos':me.role==='secretary'?' · '+(Object.values(scopeUnitNames()).join(', ')||'Sem núcleo atribuído — procure a administração geral'):'');$('test-access-banner')?.remove();if(me.test_access){const banner=el('p','Acesso de teste autorizado. As presenças e os relatos salvos aqui ficam registrados no sistema.',{id:'test-access-banner',class:'form-success',role:'status'});$('identity').parentElement.after(banner);}$('import-area').hidden=!['admin','secretary'].includes(me.role);$('team-area').hidden=me.role!=='admin';await load();notice(me.role==='teacher'?'Acesso autorizado. Abra a chamada ou registre uma ocorrência.':['psychologist','social_worker'].includes(me.role)?'Acesso autorizado. Consulte sua agenda e os relatos dos núcleos liberados.':'Acesso autorizado. Escolha uma opção no menu do painel.')}
$('verify-code').addEventListener('submit',action(async()=>{const p=await api('/auth/verify',{method:'POST',data:{email:loginEmail,code:$('code').value.trim()}});token=p.access_token;sessionCache=await sessionCacheReady;sessionCache.save(p);$('code').value='';await openWorkspace()}));
async function load(){students=['teacher','psychologist','social_worker'].includes(me.role)?[]:(await api('/students')).students;renderStudents();if(['admin','secretary'].includes(me.role))await loadMembers();document.dispatchEvent(new Event('portal:loaded'))}
function renderStudents(){const q=$('search').value.toLocaleLowerCase('pt-BR');$('students').replaceChildren();for(const s of students.filter(s=>(s.name+' '+s.id).toLocaleLowerCase('pt-BR').includes(q))){const b=el('button',`${s.name} · ${s.age} anos\n${s.id}`);b.addEventListener('click',action(()=>detail(s.id)));$('students').append(b)}if(!$('students').children.length)$('students').append(el('p','Nenhum aluno encontrado. Se faltar um vínculo, procure a secretaria.'))}
$('search').addEventListener('input',renderStudents);
let fieldSequence=0;
function field(form,label,name,value,{type='text',readOnly=false,options,min,max,step,htmlId}={}){const id=htmlId||'field-'+name+'-'+(++fieldSequence);form.append(el('label',label,{for:id}));const input=el(options?'select':'input',undefined,{id,name,...(!options?{type}:{})});if(options)for(const [v,t]of Object.entries(options))input.append(el('option',t,{value:v}));input.value=value??'';input.readOnly=readOnly;input.disabled=readOnly&&!!options;if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;if(step)input.step=step;if(type==='text')input.maxLength=160;if(type==='number')input.inputMode=step&&step<1?'decimal':'numeric';if(type==='email'){input.autocomplete='email';input.autocapitalize='none'}if(type==='tel')input.inputMode='tel';form.append(input);if(type==='tel')phoneLinksReady.then(m=>m.attachPhoneField(input,label)).catch(()=>{});return input}
async function detail(id){
 if(typeof showPanel==='function')showPanel('students-area',{focus:false});chosen=id;const s=(await api('/students/'+id)).student,box=$('detail');box.hidden=false;box.replaceChildren(el('h2',s.name),el('p',`${s.id} · ${s.age} anos`));
 const editable=['admin','secretary','guardian'].includes(me.role),staff=['admin','secretary'].includes(me.role);
 const back=el('button','Voltar à lista de alunos',{class:'secondary'});back.addEventListener('click',()=>{$('search').scrollIntoView({behavior:'smooth',block:'start'});$('search').focus({preventScroll:true})});box.append(el('p','Núcleo: '+({UND1:'Amavale',UND2:'Valparaíso',UND3:'Vale do Carangola'}[s.id.slice(0,4)])),back);
 if(editable)await showStudentContact(id,box);
 const form=el('form'),grid=el('div',undefined,{class:'grid'});form.append(grid);
 const make=(label,name,opts={})=>{const wrap=el('div');grid.append(wrap);return field(wrap,label,name,s[name],opts)};
 make('Nome do aluno','name',{readOnly:!staff});make('Data de nascimento','birth_date',{type:'date',readOnly:!staff});make('Situação do cadastro','status',{readOnly:!['admin','secretary'].includes(me.role),options:{approved:'Aprovado',pending:'Em análise',inactive:'Inativo'}});
 make('Peso (kg) — opcional','weight_kg',{type:'number',min:.1,max:500,step:.1,readOnly:!editable});make('Altura (cm) — opcional','height_cm',{type:'number',min:.1,max:300,step:.1,readOnly:!editable});
 for(const [k,t]of Object.entries({kimono:'Tamanho do kimono',rashguard:'Tamanho da rashguard',shorts:'Tamanho do shorts'})){const input=make(t+' — opcional',k,{readOnly:!editable});input.maxLength=30}
 if(editable){form.append(el('button','Salvar ficha'));form.addEventListener('submit',action(async()=>{const values=Object.fromEntries(new FormData(form));if(!staff)for(const k of ['name','birth_date','status'])delete values[k];values.version=s.version;await api('/students/'+id,{method:'PATCH',data:values});await load();await detail(id);notice('Ficha salva.')}))}
 box.append(form,el('h3','Documentos e foto'),el('p','Os arquivos ficam vinculados à ficha. Cada envio é uma nova versão. Envie apenas os documentos solicitados pelo projeto.',{class:'muted'}));
 const docs=(await api('/students/'+id+'/documents')).documents;
 documentChecklist(box,docs);
 for(const d of docs){const row=el('div',undefined,{class:'document'});row.append(el('strong',kinds[d.kind]),el('p',d.original_name+' · '+new Date(d.created_at).toLocaleString('pt-BR')));const b=el('button','Baixar arquivo',{class:'secondary'});b.addEventListener('click',action(async()=>download(await api('/documents/'+d.id+'/download',{blob:true}),'documento-'+d.id+(d.mime==='application/pdf'?'.pdf':d.mime==='image/png'?'.png':'.jpg'))));row.append(b);box.append(row)}
 if(!docs.length)box.append(el('p','Nenhum documento disponível para este acesso.'));
 if(editable){const upload=el('form');field(upload,'Categoria','kind','photo',{options:kinds});const file=field(upload,'Arquivo PDF, JPG ou PNG (até 5 MB)','file','',{type:'file'});file.accept='.pdf,.jpg,.jpeg,.png';file.required=true;upload.append(el('button','Enviar arquivo'));upload.addEventListener('submit',action(async()=>{if(file.files[0]?.size>5*1024*1024)throw Error('O limite por arquivo é 5 MB.');await api('/students/'+id+'/documents',{method:'POST',form:new FormData(upload)});await detail(id);notice('Arquivo recebido para conferência.')}));box.append(upload)}
 if(s.status==='approved'&&['admin','secretary','guardian'].includes(me.role)){const appointment=el('section'),button=el('button','Solicitar atendimento com os dados desta ficha');button.addEventListener('click',action(()=>showAvailableAppointments(id,appointment)));appointment.append(button);box.append(appointment)}box.focus({preventScroll:true});box.scrollIntoView({behavior:'smooth',block:'start'});
}
$('export').addEventListener('click',action(async()=>download(await api('/export.csv',{blob:true}),'alunos.csv')));
$('doc-index').addEventListener('click',action(async()=>download(await api('/documents.csv',{blob:true}),'indice-documentos.csv')));
$('import-form').addEventListener('submit',action(async()=>{
 previewToken='';$('preview').replaceChildren();const f=$('csv-file').files[0];if(!f||f.size>1024*1024)throw Error('Escolha um CSV com até 1 MB.');
 const p=await api('/import/preview',{method:'POST',data:{csv:await f.text()}});previewToken=p.token;
 const wrap=el('div',undefined,{class:'scroll'}),table=el('table'),head=el('tr');for(const t of ['ID','Nome','Operação'])head.append(el('th',t));table.append(head);for(const row of p.rows){const tr=el('tr');for(const k of ['id','name','action'])tr.append(el('td',row[k]));table.append(tr)}wrap.append(table);$('preview').append(el('h3',`${p.rows.length} fichas para conferir`),wrap);
 const button=el('button','Confirmar importação destas fichas');button.addEventListener('click',action(async()=>{const r=await api('/import/commit',{method:'POST',data:{token:previewToken}});previewToken='';$('preview').replaceChildren();await load();if(chosen)await detail(chosen);notice(r.message)}));$('preview').append(button);
}));
async function loadMembers(){
 if(me.role!=='admin')return;
 const members=(await api('/members')).members;$('members').replaceChildren();$('link-user').replaceChildren();$('link-student').replaceChildren();$('member-role').replaceChildren();
 for(const r of ['guardian'])$('member-role').append(el('option',labels[r],{value:r}));
 for(const s of students)$('link-student').append(el('option',s.id+' · '+s.name,{value:s.id}));
 for(const m of members){if(['admin','secretary'].includes(m.role))continue;const row=el('div',undefined,{class:'member'});row.append(el('p',m.email+' · '+labels[m.role]+(m.active?'':' · Desativado')));
  if(m.active&&m.role==='guardian')$('link-user').append(el('option',m.email+' · '+labels[m.role],{value:m.user_id}));
  if(['admin','secretary'].includes(me.role)&&m.role!=='admin'&&m.user_id!==me.user_id){const b=el('button',m.active?'Desativar acesso':'Reativar acesso',{class:'secondary'});b.addEventListener('click',action(async()=>{const p=await api('/members/'+m.user_id,{method:'PATCH',data:{role:m.role,active:!m.active}});await loadMembers();notice(p.message)}));row.append(b)}$('members').append(row);
 }
}
$('member-form').addEventListener('submit',action(async()=>{const p=await api('/members',{method:'POST',data:{email:$('member-email').value,role:$('member-role').value}});await loadMembers();notice(p.message)}));
$('link-form').addEventListener('submit',action(async()=>{const p=await api('/links',{method:'POST',data:{user_id:$('link-user').value,student_id:$('link-student').value}});notice(p.message)}));
api('/status').then(async p=>{if(p.enabled){
 sessionCache=await sessionCacheReady;const saved=sessionCache.read();
 if(saved){token=saved.access_token;await openWorkspace();return;}
 $('login').hidden=false;notice('Entre com o email previamente habilitado. A sessão dura até 6 horas nesta aba. Use Sair ao terminar.');
 }else notice('O portal privado está em preparação. Você pode continuar solicitando atendimento pelo link acima.')}).catch(e=>{if(!me)$('login').hidden=false;notice(e.message,true)});

import('/portal/system-sync.js').then(({startSystemSync})=>startSystemSync({api,el,active:()=>!!me&&!!token,hasDraft:()=>typeof attendanceDrafts!=='undefined'&&[...attendanceDrafts.values()].some(rows=>[...rows.values()].some(r=>r.dirty)),refresh:async()=>{
 await load();
 for(const box of document.querySelectorAll('section[id$="-detail"]')){box.hidden=true;box.replaceChildren()}
 if(chosen&&typeof currentPanel!=='undefined'&&currentPanel==='students-area'){if(students.some(s=>s.id===chosen))await detail(chosen);else{$('detail').hidden=true;$('detail').replaceChildren();chosen=''}}
}})).catch(()=>notice('A atualização automática não iniciou. Atualize a página para tentar novamente.',true));

import('/portal/absence-attention.js').then(({startAbsenceAttention})=>startAbsenceAttention({api,el,action,active:()=>me,showPanel:id=>showPanel(id)})).catch(()=>notice('Não foi possível iniciar os avisos de faltas. Atualize a página.',true));
