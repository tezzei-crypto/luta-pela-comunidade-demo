'use strict';
const panelItems=[
 ['dashboard-area','Visão geral',['admin','secretary']],['students-area','Alunos',['admin','secretary','guardian']],
 ['registrations-area','Candidatos',['admin','secretary']],['teacher-area','Professores',['admin','secretary']],['monitors-area','Monitores',['admin','secretary']],['workforce-area','Frequência da equipe',['admin','secretary']],
 ['professionals-area','Psicologia e assistência social',['admin','secretary']],['schedule-area','Agenda',['admin','secretary','guardian','psychologist','social_worker']],
 ['groups-area','Turmas e matrículas',['admin','secretary']],['attendance-area','Presença',['admin','secretary','teacher']],['rollcall-area','Chamadas pendentes',['admin','secretary','teacher']],['attendance-report-area','Relatório de presença',['admin','secretary','psychologist','social_worker']],['absence-attention-area','Avisos de faltas',['admin','secretary','teacher','psychologist','social_worker']],['reports-area','Ocorrências e lesões',['admin','secretary','teacher','psychologist','social_worker']],
 ['team-area','Equipe e acessos',['admin']],['import-area','Planilhas',['admin','secretary']],['site-editor-area','Editar site',['admin']],['contact-settings-area','Contato da secretaria',['admin']],['audit-area','Histórico',['admin']],['diagnostics-area','Diagnóstico de erros',['admin']]
];
let currentPanel='';
function showPanel(id,{focus=true,history=true}={}){
 if(!me||!panelItems.some(p=>p[0]===id&&p[2].includes(me.role)))return;
 currentPanel=id;for(const [key]of panelItems){const box=$(key);if(box)box.classList.toggle('is-current',key===id)}
 for(const a of $('workspace-menu')?.querySelectorAll('a')||[]){if(a.hash==='#'+id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}
 const title=panelItems.find(p=>p[0]===id)[1];$('panel-title').textContent=title;
 if($('workspace-menu-toggle')){$('workspace-menu-toggle').textContent='Menu do painel · '+title;$('workspace-menu-toggle').setAttribute('aria-expanded','false');$('workspace-nav-shell').classList.add('is-collapsed')}
 if(history)window.history.replaceState(null,'','#'+id);
 if(focus){$('panel-title').focus({preventScroll:true});$('panel-title').scrollIntoView({block:'start'})}
}
function setupNavigation(){
 if(!$('students-area')){const box=el('section',undefined,{id:'students-area'});$('search').before(box);box.append(el('h2','Alunos'),document.querySelector('label[for="search"]'),$('search'),$('students'),$('detail'))}
 if(!$('workspace-menu')){const menu=el('nav',undefined,{id:'workspace-menu','aria-label':'Menu principal do painel'}),title=el('h2','',{id:'panel-title',tabindex:'-1'}),shell=el('div',undefined,{id:'workspace-nav-shell',class:'is-collapsed'}),toggle=el('button','Menu do painel',{id:'workspace-menu-toggle',type:'button','aria-controls':'workspace-menu','aria-expanded':'false'});toggle.addEventListener('click',()=>{const closed=shell.classList.toggle('is-collapsed');toggle.setAttribute('aria-expanded',String(!closed))});shell.append(toggle,menu);$('identity').parentElement.after(shell,title)}
 if(!$('download-controls')){const downloads=el('details',undefined,{id:'download-controls'});downloads.append(el('summary','Baixar planilhas e documentos'));$('students-area').querySelector('h2').after(downloads)}
 for(const id of ['export','doc-index','contacts-export'])if($(id))$('download-controls').append($(id));
 $('admin-nav').classList.add('legacy-nav');$('teaching-nav')?.classList.add('legacy-nav');
 for(const [id]of panelItems)$(id)?.classList.add('workspace-panel');
 $('workspace-menu').replaceChildren();for(const [id,label,roles]of panelItems)if(roles.includes(me.role)){const a=el('a',label,{href:'#'+id});a.addEventListener('click',e=>{e.preventDefault();showPanel(id)});$('workspace-menu').append(a)}
 if(!$('quick-actions')&&['admin','secretary'].includes(me.role)){const quick=el('div',undefined,{id:'quick-actions',class:'quick-actions'});$('dashboard-area').prepend(quick);for(const [id,label,roles]of panelItems.filter(p=>['teacher-area','professionals-area','registrations-area','groups-area','attendance-area','rollcall-area','attendance-report-area','workforce-area'].includes(p[0])&&p[2].includes(me.role))){const b=el('button',label,{class:'secondary',type:'button'});b.addEventListener('click',()=>showPanel(id));quick.append(b)}}
 let target=currentPanel||location.hash.slice(1);if(!panelItems.some(p=>p[0]===target&&p[2].includes(me.role)))target=me.role==='teacher'?'attendance-area':['psychologist','social_worker'].includes(me.role)?'schedule-area':['admin','secretary'].includes(me.role)?'dashboard-area':'students-area';showPanel(target,{focus:false});
}
document.addEventListener('portal:loaded',setupNavigation);
document.addEventListener('portal:logout',()=>{currentPanel='';$('workspace-menu')?.replaceChildren();$('quick-actions')?.remove()});
window.addEventListener('hashchange',()=>{if(me)showPanel(location.hash.slice(1),{history:false})});
new MutationObserver(changes=>{if(!me)return;let added=false;for(const c of changes)for(const node of c.addedNodes)if(node.nodeType===1&&panelItems.some(p=>p[0]===node.id)){node.classList.add('workspace-panel');added=true}if(added)showPanel(currentPanel,{focus:false,history:false});$('teaching-nav')?.classList.add('legacy-nav')}).observe($('workspace'),{childList:true});
document.addEventListener('invalid',e=>{for(let p=e.target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true},true);
