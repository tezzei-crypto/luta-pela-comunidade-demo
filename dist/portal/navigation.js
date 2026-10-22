'use strict';
const panelItems=[
 ['dashboard-area','Visão geral',['admin','secretary']],['students-area','Alunos',['admin','secretary','guardian']],
 ['operations-area','Atividades do projeto',['admin','secretary']],['class-review-area','Conferências das aulas',['admin','secretary']],['quick-intakes-area','Matrículas pendentes',['admin','secretary']],
 ['registrations-area','Candidatos',['admin','secretary']],['teacher-area','Professores',['admin','secretary']],['monitors-area','Monitores',['admin','secretary']],['workforce-area','Frequência da equipe',['admin','secretary']],
 ['professionals-area','Psicologia e assistência social',['admin','secretary']],['schedule-area','Agenda',['admin','secretary','guardian','psychologist','social_worker']],
 ['groups-area','Turmas e matrículas',['admin','secretary']],['attendance-area','Presença',['admin','secretary','teacher']],['rollcall-area','Chamadas pendentes',['admin','secretary','teacher']],['attendance-report-area','Relatório de presença',['admin','secretary','psychologist','social_worker']],['absence-attention-area','Avisos de faltas',['admin','secretary','teacher','psychologist','social_worker']],['reports-area','Ocorrências e lesões',['admin','secretary','teacher','psychologist','social_worker']],
 ['team-area','Equipe e acessos',['admin']],['import-area','Planilhas',['admin','secretary']],['site-editor-area','Editar site',['admin']],['contact-settings-area','Contato da secretaria',['admin']],['backup-area','Backup e recuperação',['admin']],['audit-area','Histórico',['admin']],['diagnostics-area','Diagnóstico de erros',['admin']]
];
let currentPanel='';
function showPanel(id,{focus=true,history=true}={}){
 if(!me||!panelItems.some(p=>p[0]===id&&p[2].includes(me.role)))return;
 currentPanel=id;for(const [key]of panelItems){const box=$(key);if(box)box.classList.toggle('is-current',key===id)}
 for(const a of $('workspace-menu')?.querySelectorAll('a')||[]){if(a.hash==='#'+id)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')}
 const title=panelItems.find(p=>p[0]===id)[1];$('panel-title').textContent=title;
 if($('workspace-menu-toggle')){$('workspace-menu-toggle').textContent='Menu do painel · '+title;$('workspace-menu-toggle').setAttribute('aria-expanded','false');$('workspace-nav-shell').classList.add('is-collapsed')}
 if(typeof applyWorkspaceUnit==='function')applyWorkspaceUnit(id);
 if(history)window.history.replaceState(null,'','#'+id);
 if(focus){$('panel-title').focus({preventScroll:true});$('panel-title').scrollIntoView({block:'start'})}
}
function setupNavigation(){
 if(!$('students-area')){const box=el('section',undefined,{id:'students-area'});$('search').before(box);box.append(el('h2','Alunos'),document.querySelector('label[for="search"]'),$('search'),$('students'),$('detail'))}
 if($('student-directory-tools'))document.querySelector('label[for="search"]').before($('student-directory-tools'));
 if(!$('workspace-menu')){const menu=el('nav',undefined,{id:'workspace-menu','aria-label':'Menu principal do painel'}),title=el('h2','',{id:'panel-title',tabindex:'-1'}),shell=el('div',undefined,{id:'workspace-nav-shell',class:'is-collapsed'}),toggle=el('button','Menu do painel',{id:'workspace-menu-toggle',type:'button','aria-controls':'workspace-menu','aria-expanded':'false'});toggle.addEventListener('click',()=>{const closed=shell.classList.toggle('is-collapsed');toggle.setAttribute('aria-expanded',String(!closed))});shell.append(toggle,menu);$('identity').parentElement.after(shell,title)}
 if(!$('download-controls')){const downloads=el('details',undefined,{id:'download-controls'});downloads.append(el('summary','Baixar planilhas e documentos'));$('students-area').querySelector('h2').after(downloads)}
 for(const id of ['export','doc-index','contacts-export'])if($(id))$('download-controls').append($(id));
 $('admin-nav').classList.add('legacy-nav');$('teaching-nav')?.classList.add('legacy-nav');
 for(const [id]of panelItems)$(id)?.classList.add('workspace-panel');
 $('workspace-menu').replaceChildren();for(const [id,label,roles]of panelItems)if(roles.includes(me.role)){const a=el('a',label,{href:'#'+id});a.addEventListener('click',e=>{e.preventDefault();showPanel(id)});$('workspace-menu').append(a)}
 if(!$('quick-actions')&&['admin','secretary'].includes(me.role)){const quick=el('div',undefined,{id:'quick-actions',class:'quick-actions'});$('dashboard-area').prepend(quick);for(const [id,label,roles]of panelItems.filter(p=>['operations-area','quick-intakes-area','attendance-area','teacher-area','professionals-area','registrations-area','groups-area','rollcall-area','attendance-report-area','workforce-area'].includes(p[0])&&p[2].includes(me.role))){const b=el('button',label,{class:'secondary',type:'button'});b.addEventListener('click',()=>showPanel(id));quick.append(b)}}
 setupUnitWorkspace();
 let target=currentPanel||location.hash.slice(1).split('?')[0];if(!panelItems.some(p=>p[0]===target&&p[2].includes(me.role)))target=me.role==='teacher'?'attendance-area':['psychologist','social_worker'].includes(me.role)?'schedule-area':['admin','secretary'].includes(me.role)?'dashboard-area':'students-area';showPanel(target,{focus:false});
}
document.addEventListener('portal:loaded',setupNavigation);
document.addEventListener('portal:logout',()=>{currentPanel='';$('workspace-menu')?.replaceChildren();$('quick-actions')?.remove()});
window.addEventListener('hashchange',()=>{if(me)showPanel(location.hash.slice(1).split('?')[0],{history:false})});
new MutationObserver(changes=>{if(!me)return;let added=false;for(const c of changes)for(const node of c.addedNodes)if(node.nodeType===1&&panelItems.some(p=>p[0]===node.id)){node.classList.add('workspace-panel');added=true}if(added)showPanel(currentPanel,{focus:false,history:false});$('teaching-nav')?.classList.add('legacy-nav')}).observe($('workspace'),{childList:true});
document.addEventListener('invalid',e=>{for(let p=e.target.parentElement;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true},true);

// Work context filters existing lists; server authorization remains authoritative.
let workspaceUnit='',workspaceHoursRequest=0;
const workspaceUnitFilters={
 'students-area':'#student-unit-filter','registrations-area':'#registration-unit-filter',
 'groups-area':'#groups-unit','quick-intakes-area':'#quick-queue-unit',
 'class-review-area':'#review-unit','attendance-report-area':'#attendance-report-unit',
 'schedule-area':'select[name="calendar_unit"]','rollcall-area':'select[name="unit"]'
};
function getWorkspaceUnit(){return workspaceUnit&&scopeUnitNames()[workspaceUnit]?workspaceUnit:''}
function unitContextRows(rows){const u=getWorkspaceUnit();return u?rows.filter(r=>r.units?.includes(u)):rows}
function applyWorkspaceUnit(id){
 if(!$('unit-workspace')||!['admin','secretary'].includes(me?.role))return;
 const panel=$(id),selector=workspaceUnitFilters[id],pick=selector?panel?.querySelector(selector):null,u=getWorkspaceUnit();
 if(pick&&Array.from(pick.options).some(o=>o.value===u)&&pick.value!==u){pick.value=u;pick.dispatchEvent(new Event('change',{bubbles:true}));}
 const scoped=!!pick&&pick.value===u||['teacher-area','monitors-area','professionals-area'].includes(id);
 $('unit-workspace-scope').textContent=scoped?'Esta lista acompanha o núcleo de trabalho.':'Este módulo apresenta a visão dos núcleos autorizados ou utiliza filtros próprios. Confira o núcleo indicado no formulário antes de salvar.';
 if(id==='teacher-area'&&typeof teacherList==='function')teacherList().catch(e=>notice(e.message,true));
 if(id==='monitors-area'&&typeof monitorList==='function')monitorList().catch(e=>notice(e.message,true));
 if(id==='professionals-area'&&typeof professionalList==='function')professionalList().catch(e=>notice(e.message,true));
}
function updateUnitWorkspace(){
 const names=scopeUnitNames(),pick=$('workspace-unit');if(!pick)return;if(!names[workspaceUnit])workspaceUnit=Object.keys(names).length===1?Object.keys(names)[0]:'';
 pick.replaceChildren();if(Object.keys(names).length!==1)pick.append(el('option','Todos os núcleos autorizados',{value:''}));for(const [u,name]of Object.entries(names))pick.append(el('option',name,{value:u}));pick.value=workspaceUnit;
 const records=(typeof students==='undefined'?[]:students).concat(typeof studentDrafts==='undefined'?[]:studentDrafts),unitOf=r=>r.unit||({UND1:'amavale',UND2:'valparaiso',UND3:'vale-do-carangola'}[r.id.slice(0,4)]),visible=records.filter(r=>names[unitOf(r)]&&(!workspaceUnit||unitOf(r)===workspaceUnit));
 $('unit-workspace-summary').textContent=(names[workspaceUnit]||'Todos os núcleos autorizados')+' · '+visible.length+' cadastros · '+visible.filter(r=>r.registration_id).length+' para completar com as famílias.';
 if($('unit-workspace-hours').open)loadWorkspaceHours();
}
async function loadWorkspaceHours(){
 const own=++workspaceHoursRequest,host=$('unit-workspace-timetable'),names=scopeUnitNames(),units=getWorkspaceUnit()?[getWorkspaceUnit()]:Object.keys(names);host.replaceChildren(el('p','Carregando horários…',{role:'status'}));
 try{const results=await Promise.all(units.map(async unit=>({unit,...await api('/groups?unit='+unit)})));if(own!==workspaceHoursRequest||!host.isConnected)return;host.replaceChildren();
 for(const {unit,groups}of results){const card=el('article',undefined,{class:'unit-timetable'});card.append(el('h4',names[unit]));if(!groups.length)card.append(el('p','Nenhum horário cadastrado neste núcleo.'));
 for(const g of groups){const days=g.weekdays.map(d=>['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][d]).join(' e ');card.append(el('p',g.label+' · '+days+' · '+g.start_time+'–'+g.end_time),el('p',(g.active?'Ativa':'Planejada — turma inativa')+' · '+((g.responsible_teachers||[]).map(t=>t.name).join(', ')||'Professor pendente de liberação')+' · '+g.enrolled+' matriculados'+(g.provisional_enrolled?' · '+g.provisional_enrolled+' vínculos provisórios':'' )));}host.append(card);}
 }catch(e){if(own!==workspaceHoursRequest)return;host.replaceChildren(el('p','Não foi possível carregar os horários. '+e.message,{role:'alert'}));const retry=el('button','Tentar carregar horários novamente',{type:'button',class:'secondary'});retry.addEventListener('click',action(loadWorkspaceHours));host.append(retry);}
}
function setupUnitWorkspace(){
 if(!['admin','secretary'].includes(me?.role))return;
 if(!$('unit-workspace')){const box=el('section',undefined,{id:'unit-workspace','aria-label':'Organização por núcleo'}),pick=el('select',undefined,{id:'workspace-unit'});box.append(el('label','Núcleo de trabalho',{for:'workspace-unit'}),pick,el('p','',{id:'unit-workspace-summary',role:'status','aria-live':'polite'}),el('p','',{id:'unit-workspace-scope',class:'muted'}));
 const hours=el('details',undefined,{id:'unit-workspace-hours'});hours.append(el('summary','Horários das aulas por núcleo'),el('p','Horários de Brasília. Turmas planejadas ainda não estão disponíveis para abrir chamadas.'),el('div',undefined,{id:'unit-workspace-timetable'}));hours.addEventListener('toggle',()=>{if(hours.open)loadWorkspaceHours()});const open=el('button','Abrir turmas e matrículas deste núcleo',{type:'button',class:'secondary'});open.addEventListener('click',()=>showPanel('groups-area'));hours.append(open);box.append(hours);$('workspace-nav-shell').before(box);
 pick.addEventListener('change',()=>{workspaceUnit=pick.value;for(const id of ['detail','registration-detail','teacher-detail','monitor-detail','professional-detail','group-detail'])if($(id))$(id).hidden=true;updateUnitWorkspace();applyWorkspaceUnit(currentPanel);});
 }
 updateUnitWorkspace();
}
document.addEventListener('change',e=>{
 if(!$('unit-workspace')||!['admin','secretary'].includes(me?.role))return;
 const panel=e.target.closest('section.workspace-panel'),selector=workspaceUnitFilters[panel?.id];
 if(!selector||!e.target.matches(selector))return;const value=e.target.value;if(value&&!scopeUnitNames()[value])return;if(value===workspaceUnit)return;workspaceUnit=value;updateUnitWorkspace();
});
document.addEventListener('portal:logout',()=>{workspaceUnit='';++workspaceHoursRequest;$('unit-workspace')?.remove()});
