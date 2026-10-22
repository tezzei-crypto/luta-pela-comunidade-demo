import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {portalRelease,versionPortalHtml} from './portal-release.mjs';import {startSystemSync} from './dist/portal/system-sync.js';
test('Versão do painel usa o commit e versiona recursos privados sem duplicar parâmetros',()=>{
 assert.equal(portalRelease({RENDER_GIT_COMMIT:'ABCDEF1234567890'}),'abcdef123456');assert.match(portalRelease({}),/^[a-f0-9]{12}$/);
 const html='<html><head><link href="/portal/portal.css"><script src="/portal/portal.js?other=1"></script><script src="/public.js"></script></head><body></body></html>',once=versionPortalHtml(html,'abcdef123456'),twice=versionPortalHtml(once,'123456abcdef');
 const doc=new JSDOM(twice).window.document;assert.equal(doc.documentElement.dataset.portalRelease,'123456abcdef');assert.equal((twice.match(/data-portal-release/g)||[]).length,1);assert.equal(doc.querySelector('link').getAttribute('href'),'/portal/portal.css?v=123456abcdef');assert.equal(doc.querySelector('script').getAttribute('src'),'/portal/portal.js?other=1&v=123456abcdef');assert.match(twice,/src="\/public.js"/);assert.throws(()=>versionPortalHtml(html,'<script>'));
});
test('Nova versão avisa sem recarregar nem apagar edição; atualização depende do botão',async()=>{
 const dom=new JSDOM('<html data-portal-release="111111111111"><body><section id="workspace"><div><p id="identity"></p></div><form><input value="Rascunho preservado"></form></section></body></html>',{pretendToBeVisual:true});
 const oldDocument=globalThis.document,oldWindow=globalThis.window;globalThis.document=dom.window.document;globalThis.window=dom.window;let reloads=0,refreshes=0;
 try{const el=(tag,text,attrs={})=>{const e=document.createElement(tag);if(text)e.textContent=text;for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);return e};startSystemSync({api:async()=>({revision:'same',release:'222222222222'}),refresh:async()=>refreshes++,active:()=>true,el,hasDraft:()=>true,reload:()=>reloads++});await new Promise(r=>setImmediate(r));
 assert.equal(document.querySelectorAll('#portal-release-notice').length,1);assert.equal(reloads,0);assert.equal(refreshes,0);assert.equal(document.querySelector('input').value,'Rascunho preservado');document.querySelector('#portal-release-notice button').click();assert.equal(reloads,1);document.dispatchEvent(new window.Event('portal:logout'));assert.equal(document.querySelector('#portal-release-notice'),null);
 }finally{dom.window.document.dispatchEvent(new dom.window.Event('portal:logout'));dom.window.close();globalThis.document=oldDocument;globalThis.window=oldWindow;}
});
