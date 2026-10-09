import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

test('Interface da agenda: regressões de concorrência, confirmação e recuperação no DOM',async t=>{
 const result=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--experimental-vm-modules','browser-audit-runner.mjs'],{cwd:new URL('.',import.meta.url),stdio:['ignore','pipe','pipe'],windowsHide:true});
  let out='',errors='';const timer=setTimeout(()=>{child.kill();reject(Error('O teste da interface excedeu 90 segundos'))},90000);
  child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>errors+=s);child.on('error',e=>{clearTimeout(timer);reject(e)});
  child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error(errors));try{resolve(JSON.parse(out))}catch(e){reject(Error('Relatório da interface inválido: '+out))}});
 });
 assert.equal(result.cases.length,10);
 for(const row of result.cases)await t.test(row.result.replace(/^PASSOU · |^FALHOU · /,''),()=>assert.equal(row.pass,true,row.result));
});
