'use strict';
async function loadStaffAccounts(){
 const {accounts}=await api('/staff-accounts');const box=$('staff-account-list');box.replaceChildren();
 for(const a of accounts){const card=el('div',undefined,{class:'member'});card.append(el('strong',a.name||'Nome ainda não informado'),el('p',a.email+' · '+labels[a.role]+' · '+(a.active?'Ativo':'Desativado')));
  if(me.role==='admin'||a.role==='secretary'){const b=el('button','Editar cadastro e acesso',{class:'secondary'});b.addEventListener('click',()=>staffAccountForm(a));card.append(b)}box.append(card)}
}
function staffAccountForm(a={version:0,role:'secretary',active:true}){
 const box=$('staff-account-detail');box.hidden=false;box.replaceChildren(el('h3',a.user_id?'Editar secretaria ou administrador':'Cadastrar secretaria ou administrador'),el('p','O titular entra com o próprio email e um código de uso único. Não há senha fixa. O cadastro não envia convite automaticamente.'));
 const form=el('form');field(form,'Nome completo','name',a.name).required=true;const email=field(form,'Email de acesso','email',a.email,{type:'email',readOnly:!!a.user_id});email.maxLength=254;email.required=true;
 field(form,'Telefone / WhatsApp com DDD','phone',a.phone,{type:'tel'}).required=true;
 const own=a.user_id===me.user_id;const role=field(form,'Função de acesso','role',a.role,{options:me.role==='admin'?{secretary:'Secretaria',admin:'Administrador geral'}:{secretary:'Secretaria'},readOnly:own});
 const active=field(form,'Situação do acesso','active',String(a.active),{options:{true:'Ativo — pode entrar',false:'Desativado — acesso bloqueado'},readOnly:own});
 form.append(el('p',own?'Você pode completar seus dados. A própria função e o próprio acesso não podem ser desativados nesta tela.':'Desativar bloqueia a entrada e encerra as sessões da conta. Os registros e o histórico são preservados.',{class:'muted'}));
 const save=el('button',a.user_id?'Salvar cadastro e acesso':'Cadastrar acesso');form.append(save);
 form.addEventListener('submit',action(async()=>{const data={...Object.fromEntries(new FormData(form)),role:role.value,active:active.value==='true',version:a.version};const p=await api('/staff-accounts'+(a.user_id?'/'+a.user_id:''),{method:a.user_id?'PATCH':'POST',data});await loadMembers();await loadStaffAccounts();staffAccountForm(p.account);box.prepend(el('p',p.message,{role:'status',class:'form-success'}));notice(p.message)}));
 const cancel=el('button','Fechar cadastro',{type:'button',class:'secondary'});cancel.addEventListener('click',()=>{box.hidden=true;$('staff-account-new').focus()});form.append(cancel);box.append(form);box.scrollIntoView({block:'start'});box.querySelector('input')?.focus({preventScroll:true});
}
function setupStaffAccounts(){
 if($('staff-account-list'))return;
 const section=el('section',undefined,{id:'staff-accounts'});section.append(el('h3','Secretaria e administradores gerais'),el('p','Cadastre a equipe administrativa pelo nome e email. Somente administradores gerais podem criar, alterar ou desativar outros administradores.'),el('button',me.role==='admin'?'Cadastrar secretaria ou administrador':'Cadastrar secretaria',{id:'staff-account-new'}),el('div',undefined,{id:'staff-account-list'}),el('section',undefined,{id:'staff-account-detail',hidden:''}));
 $('member-form').before(section,el('h3','Acesso dos responsáveis',{id:'guardian-accounts-title'}));$('staff-account-new').addEventListener('click',()=>staffAccountForm());
}
document.addEventListener('portal:loaded',()=>{if(!['admin','secretary'].includes(me?.role))return;setupStaffAccounts();$('staff-account-new').textContent=me.role==='admin'?'Cadastrar secretaria ou administrador':'Cadastrar secretaria';action(loadStaffAccounts)()});
document.addEventListener('portal:logout',()=>{$('staff-accounts')?.remove();$('guardian-accounts-title')?.remove()});
