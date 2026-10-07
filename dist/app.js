const toggle=document.querySelector('.unit-toggle');
const menu=document.querySelector('#unit-menu');
function closeUnits(){menu.hidden=true;toggle.setAttribute('aria-expanded','false')}
toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')==='true';menu.hidden=open;toggle.setAttribute('aria-expanded',String(!open))});
document.addEventListener('click',e=>{if(!e.target.closest('.units'))closeUnits()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){closeUnits();toggle.focus()}});
const units=[{slug:'amavale',name:'Amavale',number:'01',description:'A parceria com a AMAVALE prevê a utilização da arena quatro vezes por semana para aulas infantis e juvenis, com proposta de atendimento a 80 crianças. As atividades contemplam jiu-jítsu com e sem kimono. A distribuição das turmas e os horários devem ser consultados com a coordenação.'},{slug:'valparaiso',name:'Valparaíso',number:'02',description:'O Ginásio Poliesportivo do Valparaíso integra a proposta de implantação de uma sede para o projeto em Petrópolis. A iniciativa busca ampliar as condições de atendimento e favorecer a aproximação com as famílias e a comunidade.'},{slug:'vale-do-carangola',name:'Vale do Carangola',number:'03',description:'Vale do Carangola é um dos três núcleos previstos para o projeto em Petrópolis. As informações de local, organização das turmas e horários serão atualizadas após confirmação da coordenação.'}];
const current=units.find(u=>location.pathname.split('/').includes(u.slug));
if(current){
 document.title=`${current.name} — Luta pela Comunidade`;
 document.querySelector('meta[name=description]').content=`Conheça o núcleo ${current.name} do Luta pela Comunidade, projeto de jiu-jitsu gratuito da FJJE-Rio em Petrópolis.`;
 document.querySelector(`.unit-menu a[href="/unidades/${current.slug}/"]`).setAttribute('aria-current','page');
 document.querySelector('main').innerHTML=`<section class="detail-hero"><div class="breadcrumbs"><a href="/">Início</a> / <a href="/#unidades">Unidades</a> / ${current.name}</div><p class="eyebrow">NÚCLEO ${current.number} · PETRÓPOLIS, RJ</p><h1>${current.name.toUpperCase()}</h1><p class="lead">Jiu-jitsu e futuro, perto da nossa comunidade. Um dos três núcleos previstos para o projeto Luta pela Comunidade.</p><a class="button" href="/inscricao/?nucleo=${current.slug}">Quero participar</a></section><section class="section detail-grid" id="sobre-nucleo"><div><p class="eyebrow red">LUTA PELA COMUNIDADE</p><h2>Um espaço para aprender,<br>conviver e crescer.</h2><p>${current.description}</p><p>O projeto foi estruturado para atender, no conjunto dos três núcleos, 240 participantes ao longo de 12 meses.</p><ul class="detail-list"><li>Aulas gratuitas de jiu-jitsu com e sem kimono.</li><li>Fornecimento de trajes esportivos e lanches.</li><li>Acompanhamento de profissionais responsáveis pela formação.</li><li>Aprendizado de respeito, disciplina e responsabilidade.</li></ul></div><aside class="info-box" aria-label="Informações do núcleo"><h3>Sobre este núcleo</h3><dl><dt>UNIDADE</dt><dd>${current.name}</dd><dt>CIDADE</dt><dd>Petrópolis, Rio de Janeiro</dd><dt>PÚBLICO DO PROJETO</dt><dd>Crianças e adolescentes em situação de vulnerabilidade social</dd><dt>PARTICIPAÇÃO</dt><dd>Aulas gratuitas</dd><dt>REALIZAÇÃO</dt><dd>FJJE-Rio</dd><dt>PATROCÍNIO</dt><dd>GE Aerospace</dd></dl><p class="notice">Endereço, horários e orientações de inscrição serão divulgados nesta página.</p></aside></section><section class="section other-units"><p class="eyebrow red">O MESMO PROPÓSITO, OUTROS NÚCLEOS</p><h2>Conheça também</h2><div class="unit-cards">${units.filter(u=>u!==current).map(u=>`<a class="unit-card" href="/unidades/${u.slug}/"><span class="unit-no">${u.number}</span><span class="eyebrow">PETRÓPOLIS · RJ</span><h3>${u.name}</h3><span class="card-link">Conhecer o núcleo</span></a>`).join('')}</div></section>`;
}


// Accessible disclosure navigation: screen size, never user-agent redirects.
const siteHeader=document.querySelector('.header');
const siteNav=siteHeader.querySelector('nav');
let navButton=siteHeader.querySelector('.mobile-nav-toggle');
if(!navButton){navButton=document.createElement('button');navButton.type='button';navButton.className='mobile-nav-toggle';navButton.textContent='Menu ☰';navButton.setAttribute('aria-expanded','false');navButton.setAttribute('aria-controls','main-navigation');siteNav.id='main-navigation';siteNav.before(navButton)}
if(!document.querySelector('link[href*="/mobile.css"]')){const mobileStyles=document.createElement('link');mobileStyles.rel='stylesheet';mobileStyles.href='/mobile.css?v=20261007';document.head.append(mobileStyles)}
const viewportMeta=document.querySelector('meta[name="viewport"]');
if(viewportMeta&&!viewportMeta.content.includes('viewport-fit'))viewportMeta.content+=', viewport-fit=cover';
siteHeader.classList.add('nav-ready');
function closeNavigation(){siteHeader.classList.remove('nav-open');navButton.setAttribute('aria-expanded','false')}
navButton.addEventListener('click',()=>{const open=navButton.getAttribute('aria-expanded')!=='true';closeUnits();siteHeader.classList.toggle('nav-open',open);navButton.setAttribute('aria-expanded',String(open))});
siteNav.addEventListener('click',e=>{if(e.target.closest('a'))closeNavigation()});
document.addEventListener('click',e=>{if(!siteHeader.contains(e.target))closeNavigation()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&siteHeader.classList.contains('nav-open')){closeNavigation();navButton.focus()}});
const desktopLayout=matchMedia('(min-width:1101px)');
desktopLayout.addEventListener('change',()=>{closeNavigation();closeUnits()});
