(()=>{'use strict';
 if(document.getElementById('secretary-contact')||location.pathname==='/contato/')return;
 const a=document.createElement('a');a.id='secretary-contact';a.href='/contato/';a.textContent='WhatsApp da secretaria';a.className='secretary-contact';a.setAttribute('aria-label','Falar com a secretaria do Luta pela Comunidade pelo WhatsApp');
 const style=document.createElement('link');style.rel='stylesheet';style.href='/contact.css';document.head.append(style);document.body.append(a);
})();
