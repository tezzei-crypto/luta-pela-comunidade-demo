import {contactUnits} from './contact-options.js';
const form=document.getElementById('contact-form'),state=document.getElementById('contact-state'),link=document.getElementById('contact-open'),preview=document.getElementById('contact-preview');
let available=false,conversation=null;
function updateContact(){
 const profile=form.elements.profile?.value,unit=form.elements.unit.value,option=conversation?.options.find(o=>o.id===profile);
 const ready=available&&!!option;link.hidden=!ready;
 const body=option?.message.replace(/^Luta pela Comunidade\s*/i,'');
 preview.textContent=option?'Luta pela Comunidade\n'+(unit?body.replace(/\nPodem me orientar\?$/,'')+'\nNúcleo: '+contactUnits[unit]+'.'+(body.endsWith('\nPodem me orientar?')?'\nPodem me orientar?':''):body):'Escolha uma das opções acima para preparar sua mensagem.';
 if(ready)link.href='/api/contact/whatsapp?'+new URLSearchParams({profile,unit});else link.removeAttribute('href');
}
for(const [value,label]of Object.entries(contactUnits)){const option=document.createElement('option');option.value=value;option.textContent=label;form.elements.unit.append(option)}
form.addEventListener('change',updateContact);form.addEventListener('submit',e=>e.preventDefault());
async function loadContact(){
 state.textContent='Consultando o contato da secretaria…';available=false;updateContact();
 try{
  const [response,questions]=await Promise.all([fetch('/api/contact',{cache:'no-store'}),fetch('/api/contact/conversation',{cache:'no-store'})]);
  if(!response.ok||!questions.ok)throw Error();const data=await response.json();conversation=await questions.json();available=data.enabled;
  for(const [id,key]of [['contact-title','title'],['contact-intro','intro'],['contact-question','question'],['contact-unit-label','unit_question']])document.getElementById(id).textContent=conversation[key];
  const selected=form.elements.profile?.value,box=document.getElementById('contact-profiles');box.replaceChildren();
  for(const o of conversation.options){const wrap=document.createElement('label'),input=document.createElement('input'),span=document.createElement('span');input.type='radio';input.name='profile';input.value=o.id;input.required=true;input.checked=o.id===selected;span.textContent=o.label;wrap.append(input,span);box.append(wrap)}
  state.textContent=available?'Secretaria do projeto · '+data.display_phone:'O atendimento pelo WhatsApp está temporariamente indisponível. Tente novamente mais tarde.';
 }catch{state.textContent='Não foi possível consultar o contato. Confira sua conexão e tente novamente.'}
 updateContact();
}
document.getElementById('contact-retry').addEventListener('click',loadContact);loadContact();
