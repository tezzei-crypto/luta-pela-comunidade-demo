// Click-to-chat does not send a message or change the stored contact.
export function normalizeWhatsAppPhone(value){
 const raw=String(value??'').trim();
 if(!raw||!/^\+?[\d\s().-]+$/.test(raw))return '';
 const digits=raw.replace(/\D/g,'');
 if(raw.startsWith('+')&&!digits.startsWith('55'))return /^[1-9]\d{7,14}$/.test(digits)?digits:'';
 const national=raw.startsWith('+')?digits.slice(2):digits.length===12||digits.length===13?digits.startsWith('55')?digits.slice(2):'':digits;
 const ddds=new Set('11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' '));
 if(!ddds.has(national.slice(0,2))||!/^\d{2}(?:[2-5]\d{7}|9\d{8})$/.test(national))return '';
 return '55'+national;
}
export function whatsAppUrl(phone){const number=normalizeWhatsAppPhone(phone);return number?'https://wa.me/'+number:''}
const iconPath='M16.04 3A12.91 12.91 0 0 0 4.87 22.39L3 29l6.78-1.78A12.98 12.98 0 1 0 16.04 3Zm0 23.67a10.73 10.73 0 0 1-5.47-1.5l-.39-.23-4.03 1.06 1.07-3.93-.25-.4a10.72 10.72 0 1 1 9.07 5Zm5.88-8.03c-.32-.16-1.91-.94-2.21-1.05-.29-.11-.51-.16-.72.16-.22.32-.84 1.05-1.03 1.26-.18.22-.37.24-.69.08-.32-.16-1.36-.5-2.59-1.6-.96-.85-1.6-1.91-1.79-2.23-.19-.32-.02-.5.14-.66.15-.14.32-.37.48-.56.16-.19.22-.32.32-.54.11-.21.05-.4-.03-.56-.08-.16-.73-1.75-1-2.4-.26-.63-.53-.54-.73-.55h-.63c-.22 0-.57.08-.86.4-.3.32-1.13 1.1-1.13 2.69s1.16 3.12 1.32 3.34c.16.21 2.28 3.48 5.52 4.88.77.33 1.37.53 1.84.68.77.24 1.48.21 2.04.13.62-.09 1.91-.78 2.18-1.53.27-.75.27-1.4.19-1.53-.08-.13-.3-.21-.62-.37Z';
function link(){
 const a=document.createElement('a');a.className='phone-whatsapp';a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 32 32');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('fill','currentColor');path.setAttribute('d',iconPath);svg.append(path);a.append(svg);return a;
}
function update(a,phone,label){const url=whatsAppUrl(phone);a.hidden=!url;if(url){a.href=url;const text='Conversar no WhatsApp — '+label+' ('+String(phone).trim()+'). Abre em nova aba.';a.setAttribute('aria-label',text);a.title=text}else a.removeAttribute('href')}
export function appendPhoneLink(parent,phone,label='Contato'){
 if(!whatsAppUrl(phone))return;
 const a=link();update(a,phone,label);parent.classList.add('phone-contact');parent.append(a);return a;
}
export function attachPhoneField(input,label='Contato'){
 if(input.dataset.whatsappReady)return;input.dataset.whatsappReady='true';
 const wrap=document.createElement('div');wrap.className='phone-field';input.before(wrap);wrap.append(input);
 const a=link();wrap.append(a);const refresh=()=>update(a,input.value,label);input.addEventListener('input',refresh);input.addEventListener('change',refresh);refresh();
}
