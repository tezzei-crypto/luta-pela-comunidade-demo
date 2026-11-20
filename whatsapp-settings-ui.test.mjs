import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountWhatsappSettings} from './dist/portal/whatsapp-settings.js';

async function view(t,deliveries,extra={}){
 const dom=new JSDOM('<main></main>');t.after(()=>dom.window.close());const d=dom.window.document;
 const el=(tag,text,attrs={})=>{const e=d.createElement(tag);if(text!==undefined)e.textContent=text;for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);return e};
 const field=(host,label,name,value,opts={})=>{const e=el(opts.options?'select':'input',undefined,{name});if(opts.options)for(const [key,text] of Object.entries(opts.options))e.append(el('option',text,{value:key}));e.value=value;host.append(e);return e};
 await mountWhatsappSettings({api:async()=>({settings:{connected:true,enabled:true,phone:'+5524999999999',recipients:[],deliveries,...extra}}),el,field,action:fn=>fn,notice:()=>{}},d.querySelector('main'));return d;
}
test('WhatsApp configurado com recusa não é apresentado como envio comprovado',async t=>{
 const d=await view(t,[{email:'teacher@example.test',status:'failed',http_status:400,error_code:10,error_subcode:2593181,updated_at:1}]);
 assert.match(d.querySelector('[role=status]').textContent,/Última tentativa recusada/);assert.doesNotMatch(d.querySelector('[role=status]').className,/form-success/);assert.match(d.body.textContent,/HTTP 400 · Meta 10\/2593181/);
});
test('Aceite posterior é distinto de entrega e leitura; falha antiga continua no histórico',async t=>{
 const d=await view(t,[{status:'accepted',updated_at:2},{status:'failed',updated_at:1}]);assert.match(d.querySelector('[role=status]').textContent,/aceita pela Meta; entrega e leitura ainda não confirmadas/);assert.match(d.body.textContent,/Recusado pela Meta/);
});
for(const status of ['review','sending',null])test('WhatsApp sem aceite não promete entrega: '+status,async t=>{
 const d=await view(t,status?[{status,updated_at:1}]:[]);assert.doesNotMatch(d.querySelector('[role=status]').className,/form-success/);assert.doesNotMatch(d.querySelector('[role=status]').textContent,/Envio automático ativado/);
});
