import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const root=path.dirname(fileURLToPath(import.meta.url));
const dom=new JSDOM('<!doctype html><html><body><ol id="audit-results"></ol><p id="audit-summary"></p><main></main></body></html>',{url:'http://audit.invalid/',runScripts:'outside-only',pretendToBeVisual:true});
const context=dom.getInternalVMContext(),modules=new Map();
Object.assign(dom.window,{Response,Request,Headers,AbortController,AbortSignal,TextEncoder,TextDecoder,matchMedia:()=>({matches:false})});
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
vm.runInContext(fs.readFileSync(path.join(root,'dist/portal/action.js'),'utf8'),context);
function moduleFor(url){
 if(modules.has(url))return modules.get(url);
 const file=url==='/browser-audit.js'?path.join(root,'browser-audit.js'):path.join(root,'dist',url);
 const m=new vm.SourceTextModule(fs.readFileSync(file,'utf8'),{context,identifier:url,importModuleDynamically:async(specifier,referencing)=>{
  const target=moduleFor(new URL(specifier,'http://audit.invalid'+referencing.identifier).pathname);
  if(target.status==='unlinked')await target.link(link);if(target.status==='linked')await target.evaluate();return target;
 }});modules.set(url,m);return m;
}
const link=(specifier,referencing)=>moduleFor(new URL(specifier,'http://audit.invalid'+referencing.identifier).pathname);
try{
 const suite=moduleFor('/browser-audit.js');await suite.link(link);await suite.evaluate();
 const cases=[...dom.window.document.querySelectorAll('#audit-results li')].map(e=>({pass:e.textContent.startsWith('PASSOU'),result:e.textContent}));
 console.log(JSON.stringify({engine:'jsdom',scope:'DOM em memória; não verifica layout nem motores de navegadores móveis',cases}));
}finally{dom.window.close()}
