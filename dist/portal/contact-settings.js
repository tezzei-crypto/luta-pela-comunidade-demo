'use strict';
async function loadContactSettings(){
 const {settings}=await api('/contact-settings'),box=$('contact-settings-form');box.replaceChildren();
 const form=el('form');const phone=field(form,'WhatsApp da secretaria (com código do país e DDD)','phone',settings.display_phone,{type:'tel'});phone.required=true;phone.maxLength=40;phone.autocomplete='tel';
 const enabled=field(form,'Atendimento pelo WhatsApp','enabled',String(settings.enabled),{options:{true:'Ativado',false:'Desativado temporariamente'}});
 form.append(el('p','Esse número será público no site. Use o número autorizado da secretaria. A alteração vale para as três opções de contato, sem precisar publicar o site novamente.'));
 form.append(el('p','Mensagem inicial: Luta pela Comunidade. A pessoa escolhe patrocinador, interessado em participar ou pais e responsáveis antes de abrir o WhatsApp.'));
 form.append(el('button','Salvar contato da secretaria'));
 const status=el('p','Atualizado em '+new Date(settings.updated_at).toLocaleString('pt-BR'),{class:'muted'});box.append(form,status);
 form.addEventListener('submit',action(async()=>{const p=await api('/contact-settings',{method:'PATCH',data:{phone:phone.value,enabled:enabled.value==='true',version:settings.version}});await loadContactSettings();$('contact-settings-form').prepend(el('p',p.message,{role:'status',class:'form-success'}));notice(p.message)}));
 const {mountWhatsappSettings}=await import('./whatsapp-settings.js');await mountWhatsappSettings({api,el,field,action,notice},$('contact-settings-area')); 
}
document.addEventListener('portal:loaded',()=>{
 if(me.role!=='admin')return;
 if(!$('contact-settings-area')){const box=el('section',undefined,{id:'contact-settings-area'});box.append(el('h2','Contato da secretaria'),el('p','Administradores gerais e secretaria podem manter o canal de atendimento atualizado.'),el('a','Ver a página de atendimento ↗',{href:'/contato/',target:'_blank',rel:'noopener noreferrer'}),el('button','Recarregar contato',{type:'button',id:'contact-settings-reload',class:'secondary'}),el('div',undefined,{id:'contact-settings-form'}));$('workspace').append(box);$('contact-settings-reload').addEventListener('click',action(loadContactSettings))}
 action(loadContactSettings)();
});
document.addEventListener('portal:logout',()=>{$('contact-settings-area')?.remove()});
