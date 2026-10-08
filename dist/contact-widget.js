(()=>{'use strict';
 if(document.getElementById('secretary-contact'))return;
 const a=document.createElement('a');a.id='secretary-contact';a.className='secretary-contact';
 a.href=location.pathname.replace(/\/$/,'')==='/contato'?'#contact-profiles':'/contato/';
 a.setAttribute('aria-label','WhatsApp da secretaria — Luta pela Comunidade');
 a.innerHTML='<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path fill="currentColor" d="M16.04 3A12.91 12.91 0 0 0 4.87 22.39L3 29l6.78-1.78A12.98 12.98 0 1 0 16.04 3Zm0 23.67a10.73 10.73 0 0 1-5.47-1.5l-.39-.23-4.03 1.06 1.07-3.93-.25-.4a10.72 10.72 0 1 1 9.07 5Zm5.88-8.03c-.32-.16-1.91-.94-2.21-1.05-.29-.11-.51-.16-.72.16-.22.32-.84 1.05-1.03 1.26-.18.22-.37.24-.69.08-.32-.16-1.36-.5-2.59-1.6-.96-.85-1.6-1.91-1.79-2.23-.19-.32-.02-.5.14-.66.15-.14.32-.37.48-.56.16-.19.22-.32.32-.54.11-.21.05-.4-.03-.56-.08-.16-.73-1.75-1-2.4-.26-.63-.53-.54-.73-.55h-.63c-.22 0-.57.08-.86.4-.3.32-1.13 1.1-1.13 2.69s1.16 3.12 1.32 3.34c.16.21 2.28 3.48 5.52 4.88.77.33 1.37.53 1.84.68.77.24 1.48.21 2.04.13.62-.09 1.91-.78 2.18-1.53.27-.75.27-1.4.19-1.53-.08-.13-.3-.21-.62-.37Z"/></svg><span class="secretary-contact-tooltip" aria-hidden="true">Fale com a secretaria</span>';
 if(!document.querySelector('link[href^="/contact.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/contact.css';document.head.append(css)}
 document.body.classList.add('has-secretary-contact');document.documentElement.classList.add('has-secretary-contact');document.body.append(a);
 // Keep the shortcut above the on-screen keyboard and sticky attendance actions.
 let scheduled=false;
 function place(){scheduled=false;const vv=window.visualViewport;const visibleBottom=vv?vv.height+vv.offsetTop:innerHeight;let bottom=Math.max(0,innerHeight-visibleBottom);
  for(const bar of document.querySelectorAll('.save-call')){const r=bar.getBoundingClientRect();if(r.width&&r.height&&r.top<visibleBottom&&r.bottom>visibleBottom-24&&r.top>visibleBottom*.35)bottom=Math.max(bottom,innerHeight-r.top)}
  a.style.setProperty('--contact-obstruction',`${Math.ceil(bottom)}px`);
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(place)}}
 addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule,{passive:true});
 window.visualViewport?.addEventListener('resize',schedule,{passive:true});window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
 document.addEventListener('focusin',e=>{schedule();requestAnimationFrame(()=>{if(!(e.target instanceof HTMLElement)||a.contains(e.target))return;const r=e.target.getBoundingClientRect(),b=a.getBoundingClientRect();if(r.right>b.left&&r.left<b.right&&r.bottom>b.top&&r.top<b.bottom)e.target.scrollIntoView({block:'center',behavior:'auto'})})});
 new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});schedule();
})();
