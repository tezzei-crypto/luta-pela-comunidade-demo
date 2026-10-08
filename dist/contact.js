import {contactProfiles,contactUnits,contactMessage} from './contact-options.js';
const form=document.getElementById('contact-form'),state=document.getElementById('contact-state'),link=document.getElementById('contact-open'),preview=document.getElementById('contact-preview');
let available=false;
function updateContact(){
 const profile=form.elements.profile.value,unit=form.elements.unit.value;
 const ready=available&&!!profile;link.hidden=!ready;preview.textContent=profile?contactMessage(profile,unit):'Escolha uma das opções acima para preparar sua mensagem.';
 if(ready)link.href='/api/contact/whatsapp?'+new URLSearchParams({profile,unit});else link.removeAttribute('href');
}
for(const [value,label]of Object.entries(contactProfiles)){
 const wrap=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='radio';input.name='profile';input.value=value;input.required=true;span.textContent=label;wrap.append(input,span);document.getElementById('contact-profiles').append(wrap);
}
for(const [value,label]of Object.entries(contactUnits)){const option=document.createElement('option');option.value=value;option.textContent=label;form.elements.unit.append(option)}
form.addEventListener('change',updateContact);form.addEventListener('submit',e=>e.preventDefault());
async function loadContact(){
 state.textContent='Consultando o contato da secretaria…';available=false;updateContact();
 try{const response=await fetch('/api/contact',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();available=data.enabled;state.textContent=available?'Secretaria do projeto · '+data.display_phone:'O atendimento pelo WhatsApp está temporariamente indisponível. Tente novamente mais tarde.'}
 catch{state.textContent='Não foi possível consultar o contato. Confira sua conexão e tente novamente.'}
 updateContact();
}
document.getElementById('contact-retry').addEventListener('click',loadContact);loadContact();
