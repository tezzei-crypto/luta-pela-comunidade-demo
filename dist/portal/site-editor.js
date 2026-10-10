'use strict';
(()=>{
 let area,doc=null,library=[],pages=[],patch=new Map(),conversation=null,baseline='',previewed='',revision=0,pageNumber=0,opening=0;
 const kindNames={text:'Texto',link:'Link',image:'Imagem',alt:'Descrição da imagem',title:'Título da página',description:'Descrição para pesquisa'};
 const input=(parent,label,name,value,max=8000)=>{const id='editor-'+name+'-'+crypto.randomUUID().slice(0,8),n=el('textarea',undefined,{id,name,rows:'3',maxlength:String(max)});n.value=value??'';parent.append(el('label',label,{for:id}),n);return n};
 const endpoint=(suffix='')=>'/site-editor/'+(doc.key==='contact'?'contact':'page')+suffix+(doc.key==='contact'?'':'?page='+encodeURIComponent(doc.key));
 const data=()=>doc?.key==='contact'?structuredClone(conversation):{schema_hash:doc.schema_hash,values:[...patch].map(([id,value])=>({id,value})).sort((a,b)=>a.id.localeCompare(b.id))};
 const snapshot=()=>JSON.stringify(data());
 const dirty=()=>!!doc&&snapshot()!==baseline;
 const status=(text,error=false)=>{const n=$('editor-state');if(n){n.textContent=text;n.className=error?'editor-warning':'editor-status'}};
 function changed(){revision++;$('editor-reviewed').checked=false;status('Alterações ainda não salvas. Salve o rascunho e confira a prévia antes de publicar.');}
 function endpointFor(key){return '/site-editor/'+(key==='contact'?'contact':'page?page='+encodeURIComponent(key))}
 function collect(d){doc=d;patch=new Map((d.draft.values||[]).map(v=>[v.id,v.value]));conversation=d.key==='contact'?structuredClone(d.draft):null;baseline=snapshot();previewed='';revision++;$('editor-reviewed').checked=false}
 async function refreshLibrary(){const r=await api('/site-editor/pages');pages=r.pages;library=r.media;return r}
 async function preview(){
  if(!doc)return;const value=data(),key=doc.key,ticket=++opening,stamp=JSON.stringify(value);status('Preparando prévia…');
  const r=await api(endpoint('/preview'),{method:'POST',data:{data:value}});
  if(!doc||doc.key!==key||ticket!==opening)return;$('editor-preview').srcdoc=r.html;previewed=stamp;status(dirty()?'Prévia atualizada. Há alterações ainda não salvas.':'Prévia atualizada. Rascunho salvo; publique quando estiver pronto.');
 }
 async function open(key,{force=false}={}){
  if(dirty()&&!force){$('editor-page').value=doc.key;status('Salve o rascunho antes de trocar de página, ou use “Descartar alterações locais”.',true);return}
  const ticket=++opening;status('Carregando editor…');const d=await api(endpointFor(key));if(ticket!==opening)return;
  collect(d);$('editor-page').value=key;pageNumber=0;$('editor-search').value='';$('editor-kind').value='';$('editor-filter').hidden=key==='contact';
  draw();drawHistory();$('editor-reason').value='';await preview();
 }
 function draw(){
  const target=$('editor-fields');target.replaceChildren();if(!doc)return;
  if(doc.key==='contact'){drawConversation(target);return}
  if(doc.draft.schema_hash!==doc.schema_hash&&doc.draft.values.length){status('A estrutura da página mudou desde este rascunho. Reabra os campos e confira cada alteração antes de salvar.',true)}
  const query=$('editor-search').value.toLocaleLowerCase('pt-BR'),kind=$('editor-kind').value;
  const values=doc.fields.filter(f=>(!kind||f.kind===kind)&&(f.section+' '+f.label+' '+(patch.get(f.id)??f.value)).toLocaleLowerCase('pt-BR').includes(query));
  const max=Math.max(0,Math.ceil(values.length/15)-1);pageNumber=Math.min(pageNumber,max);
  $('editor-count').textContent=values.length+' campos · '+patch.size+' personalizados · página '+(pageNumber+1)+' de '+(max+1);
  for(const f of values.slice(pageNumber*15,pageNumber*15+15)){
   const details=el('details',undefined,{class:'editor-card'});details.append(el('summary',kindNames[f.kind]+' · '+f.label),el('p',f.section,{class:'muted'}));
   let control;const current=patch.get(f.id)??f.value;
   if(f.kind==='image'){
    const thumb=el('img',undefined,{src:current,alt:f.label,class:'editor-thumbnail'});details.append(thumb);
    const options={'':'Imagem original desta página'};for(const m of library)options[m.url]=m.alt;
    control=field(details,'Imagem para usar','image-'+f.id,patch.has(f.id)?current:'',{options});
    control.addEventListener('change',()=>{if(control.value)patch.set(f.id,control.value);else patch.delete(f.id);thumb.src=control.value||f.value;changed()});
    details.append(el('p','Para outra imagem, envie o arquivo na Biblioteca de imagens públicas e volte a este campo.',{class:'muted'}));
   }else{
    control=input(details,f.kind==='link'?'Destino do link':'Conteúdo',f.id,current,f.kind==='text'?8000:2000);
    control.addEventListener('input',()=>{if(control.value===f.value)patch.delete(f.id);else patch.set(f.id,control.value);changed()});
   }
   const original=el('details');original.append(el('summary','Consultar conteúdo original'),el('p',f.kind==='image'?'Imagem original da página':f.value,{class:'editor-current'}));details.append(original);
   const restore=el('button','Usar original neste campo',{type:'button',class:'secondary'});restore.addEventListener('click',()=>{patch.delete(f.id);changed();draw()});details.append(restore);target.append(details);
  }
  const nav=el('div',undefined,{class:'editor-actions'}),previous=el('button','Campos anteriores',{type:'button',class:'secondary'}),next=el('button','Próximos campos',{type:'button',class:'secondary'});previous.disabled=pageNumber===0;next.disabled=pageNumber>=max;
  previous.addEventListener('click',()=>{pageNumber--;draw()});next.addEventListener('click',()=>{pageNumber++;draw()});nav.append(previous,next);target.append(nav);
 }
 function drawConversation(target){
  $('editor-count').textContent='Perguntas, opções e mensagens da página de contato';
  for(const [key,label,max]of [['title','Título da página',120],['intro','Orientação inicial',1000],['question','Pergunta principal',200],['unit_question','Pergunta sobre o núcleo',200]]){
   const n=input(target,label,key,conversation[key],max);n.required=true;n.addEventListener('input',()=>{conversation[key]=n.value;changed()});
  }
  target.append(el('h3','Opções de atendimento'),el('p','A ordem abaixo será a ordem do site. As mensagens começam com Luta pela Comunidade e chegam ao WhatsApp da secretaria.'));
  conversation.options.forEach((o,i)=>{
   const box=el('fieldset',undefined,{class:'editor-card editor-option'});box.append(el('legend','Opção '+(i+1)));
   const label=input(box,'Nome da opção','option-label-'+i,o.label,120),message=input(box,'Mensagem inicial no WhatsApp','option-message-'+i,o.message,1200),enabled=field(box,'Situação','option-enabled-'+i,String(o.enabled),{options:{true:'Ativada',false:'Desativada'}});
   label.required=message.required=true;const sample=el('p','Luta pela Comunidade\n'+o.message,{class:'editor-current'}),sampleBox=el('details');sampleBox.append(el('summary','Prévia da mensagem'),sample);box.append(sampleBox);
   label.addEventListener('input',()=>{o.label=label.value;changed()});message.addEventListener('input',()=>{o.message=message.value;sample.textContent='Luta pela Comunidade\n'+message.value;changed()});enabled.addEventListener('change',()=>{o.enabled=enabled.value==='true';changed()});
   const actions=el('div',undefined,{class:'editor-actions'});for(const [name,delta]of [['Mover para cima',-1],['Mover para baixo',1]]){const b=el('button',name,{type:'button',class:'secondary'});b.disabled=i+delta<0||i+delta>=conversation.options.length;b.addEventListener('click',()=>{[conversation.options[i],conversation.options[i+delta]]=[conversation.options[i+delta],conversation.options[i]];changed();draw()});actions.append(b)}
   const remove=el('button','Retirar esta opção do rascunho',{type:'button',class:'secondary'});remove.disabled=conversation.options.length<=1;remove.addEventListener('click',()=>{conversation.options.splice(i,1);changed();draw()});actions.append(remove);box.append(actions);target.append(box);
  });
  const add=el('button','Adicionar opção de atendimento',{type:'button',class:'secondary'});add.disabled=conversation.options.length>=12;add.addEventListener('click',()=>{conversation.options.push({id:'opcao-'+crypto.randomUUID().slice(0,8),label:'Nova opção',message:'Olá! Gostaria de falar com a secretaria.',enabled:true});changed();draw()});target.append(add);
 }
 function drawHistory(){const target=$('editor-history');target.replaceChildren();if(!doc.history.length){target.append(el('p','Nenhuma publicação pelo editor ainda.'));return}
  for(const r of doc.history){const row=el('article',undefined,{class:'editor-history'});row.append(el('p',new Date(r.created_at).toLocaleString('pt-BR')+' · '+r.actor_email),el('p',r.reason));const b=el('button','Recuperar versão anterior como rascunho',{type:'button',class:'secondary'});
   b.addEventListener('click',action(async()=>{if(dirty())throw Error('Salve ou descarte as alterações locais antes de recuperar uma versão.');collect(await api(endpoint('/restore'),{method:'POST',data:{version:doc.version,revision:r.id}}));draw();drawHistory();await preview();notice('Versão anterior recuperada como rascunho. Confira e publique para aplicá-la ao site.')}));row.append(b);target.append(row)}
 }
 function init(){
  if(!me||me.role!=='admin'||$('site-editor-area'))return;
  if(!document.querySelector('link[href="/portal/site-editor.css"]'))document.head.append(el('link',undefined,{rel:'stylesheet',href:'/portal/site-editor.css'}));
  area=el('section',undefined,{id:'site-editor-area'});area.append(el('h2','Editar site'),el('p','Luta pela Comunidade · textos, imagens, links e perguntas de contato. Cada página tem seu próprio rascunho. Os cadastros e horários continuam nos seus painéis administrativos.'));
  const steps=el('ol',undefined,{class:'editor-progress'});for(const step of ['1. Escolha e edite','2. Salve o rascunho','3. Confira a prévia','4. Publique'])steps.append(el('li',step));area.append(steps);
  const selector=field(area,'Página ou atendimento para editar','page','',{options:{},htmlId:'editor-page'});selector.addEventListener('change',action(()=>open(selector.value)));
  area.append(el('p','Carregando…',{id:'editor-state',role:'status','aria-live':'polite',class:'editor-status'}));
  const libraryBox=el('details',undefined,{class:'editor-card'});libraryBox.append(el('summary','Biblioteca de imagens públicas'),el('p','Envie JPG, PNG ou WebP de até 8 MB. A imagem mantém transparência quando houver. O arquivo só aparece na página depois de selecionado e publicado.'));
  const upload=el('form');const file=field(upload,'Arquivo da imagem','file','',{type:'file'});file.accept='image/jpeg,image/png,image/webp';file.required=true;
  const alt=input(upload,'Descrição acessível da imagem','alt','',300);alt.required=true;alt.minLength=3;const permission=el('label'),check=el('input',undefined,{type:'checkbox',name:'authorized',required:''});permission.append(check,document.createTextNode(' Tenho autorização para publicar esta imagem no site.'));upload.append(permission,el('button','Enviar imagem para a biblioteca'));
  upload.addEventListener('submit',action(async()=>{const f=new FormData(upload);f.set('authorized','true');await api('/site-editor/media',{method:'POST',form:f});await refreshLibrary();upload.reset();draw();notice('Imagem recebida. Abra o campo de imagem da página para selecioná-la.')}));libraryBox.append(upload);area.append(libraryBox);
  const filters=el('div',undefined,{id:'editor-filter',class:'grid'}),search=field(filters,'Pesquisar conteúdo','search','',{type:'search',htmlId:'editor-search'}),kind=field(filters,'Tipo de campo','kind','',{options:{'':'Todos',...kindNames},htmlId:'editor-kind'});search.addEventListener('input',()=>{pageNumber=0;draw()});kind.addEventListener('change',()=>{pageNumber=0;draw()});area.append(filters,el('p','',{id:'editor-count',role:'status'}));
  const editForm=el('form');editForm.append(el('div',undefined,{id:'editor-fields'}),el('button','Salvar rascunho'));editForm.addEventListener('submit',action(async()=>{
   if(!doc)return;const before=snapshot(),stamp=revision,key=doc.key;const d=await api(endpoint(),{method:'PATCH',data:{version:doc.version,data:data()}});
   if(!doc||doc.key!==key)return;if(stamp===revision){const prev=previewed;collect(d);previewed=prev===before?baseline:'';drawHistory();status('Rascunho salvo. Confira a prévia e publique para atualizar o site.')}else{doc.version=d.version;doc.history=d.history;baseline=JSON.stringify(d.draft);status('Rascunho salvo. Há novas alterações na tela que ainda precisam ser salvas.')}notice('Rascunho salvo; o conteúdo público continua na versão publicada.');
  }));area.append(editForm);
  const actions=el('div',undefined,{class:'editor-actions'}),previewButton=el('button','Atualizar prévia',{type:'button',class:'secondary'}),discard=el('button','Descartar alterações locais',{type:'button',class:'secondary'});previewButton.addEventListener('click',action(preview));discard.addEventListener('click',action(()=>open(doc.key,{force:true})));actions.append(previewButton,discard);area.append(actions);
  const previewBox=el('details',undefined,{class:'editor-card'});previewBox.open=true;previewBox.append(el('summary','Prévia da página'),el('p','Prévia visual: botões, links e envios estão desativados.'));
  const size=field(previewBox,'Largura da prévia','preview-width','',{options:{'':'Ajustar à tela',mobile:'Celular — 375 px',wide:'Computador — 1100 px'}}),frameWrap=el('div',undefined,{class:'editor-preview-box'}),frame=el('iframe',undefined,{id:'editor-preview',class:'editor-preview',title:'Prévia do rascunho',sandbox:'',referrerpolicy:'no-referrer'});size.addEventListener('change',()=>frame.className='editor-preview '+size.value);frameWrap.append(frame);previewBox.append(frameWrap);area.append(previewBox);
  const publish=el('form',undefined,{class:'editor-card'});publish.append(el('h3','Publicar no site'));const reason=input(publish,'Descreva a alteração','reason','',500);reason.id='editor-reason';publish.querySelector('label').htmlFor=reason.id;reason.required=true;reason.minLength=5;
  const label=el('label'),reviewed=el('input',undefined,{id:'editor-reviewed',type:'checkbox',required:''});label.append(reviewed,document.createTextNode(' Conferi a prévia desta versão.'));publish.append(label,el('button','Publicar alterações'));
  publish.addEventListener('submit',action(async()=>{if(dirty())throw Error('Salve o rascunho antes de publicar.');if(previewed!==snapshot())throw Error('Atualize e confira a prévia desta versão antes de publicar.');collect(await api(endpoint('/publish'),{method:'POST',data:{version:doc.version,reason:reason.value}}));reason.value='';draw();drawHistory();await preview();notice('Conteúdo publicado no Luta pela Comunidade.')}));area.append(publish);
  const history=el('details',undefined,{class:'editor-card'});history.append(el('summary','Histórico de publicações e recuperação'),el('div',undefined,{id:'editor-history'}));area.append(history);$('workspace').append(area);
  const contact=$('contact-settings-area');if(contact&&!$('editor-contact-shortcut')){const b=el('button','Editar perguntas e mensagens do WhatsApp',{id:'editor-contact-shortcut',type:'button',class:'secondary'});b.addEventListener('click',action(async()=>{showPanel('site-editor-area');await open('contact')}));contact.append(b)}
  if(typeof setupNavigation==='function')setupNavigation();
  action(async()=>{await refreshLibrary();selector.replaceChildren(...pages.map(p=>el('option',p.label,{value:p.page})),el('option','Perguntas e mensagens do WhatsApp',{value:'contact'}));await open('/')})();
 }
 document.addEventListener('portal:loaded',init);
 document.addEventListener('portal:logout',()=>{area?.remove();$('editor-contact-shortcut')?.remove();doc=null;patch.clear();conversation=null;baseline='';opening++});
 window.addEventListener('beforeunload',e=>{if(dirty()){e.preventDefault();e.returnValue=''}});
 if(typeof me!=='undefined'&&me)init();
})();
