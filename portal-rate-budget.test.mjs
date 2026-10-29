import test from 'node:test';import assert from 'node:assert/strict';import {consumePortalBudget} from './portal-rate-budget.mjs';
test('Atualização automática tem cota própria sem impedir salvar chamada e mantém limite de login',()=>{
 const map=new Map();for(let i=0;i<300;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/sync','GET',0).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/rollcall-issues','GET',0).allowed,false);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes/id/attendance','POST',0).allowed,true);
 for(let i=0;i<20;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/auth/request','POST',0).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/auth/verify','POST',0).allowed,false);
});
test('Cotas preservam 300 gravações por janela e endereço sem bloquear consultas',()=>{
 const map=new Map();for(let i=0;i<300;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes','POST',0).allowed,true);
 for(const method of ['POST','PATCH','PUT','DELETE','OPTIONS'])assert.equal(consumePortalBudget(map,'fixture','/api/portal/sync',method,1000).allowed,false);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes','GET',1000).allowed,true);
 assert.equal(consumePortalBudget(map,'other','/api/portal/classes','POST',1000).allowed,true);assert.equal(consumePortalBudget(map,'fixture','/api/portal/sync','GET',1000).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes','POST',1000).retryAfter,599);assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes','POST',600000).allowed,true);
});
test('Quatro chamadas com consultas, fotos e recargas continuam utilizáveis sem consumir a cota de gravação',()=>{
 const map=new Map();
 // The real workflow reloads many endpoints after each action, across classes.
 for(let action=0;action<40;action++){
  for(const resource of ['me','students','registrations','groups','members','teachers','professionals','monitors','classes','classes/id/photos','classes/id/photo','classes/id/attendance','visitors','reports','finance','backups','audit','contact','operations','schedule'])assert.equal(consumePortalBudget(map,'fixture','/api/portal/'+resource,'GET',action*1000).allowed,true);
  assert.equal(consumePortalBudget(map,'fixture','/api/portal/sync','GET',action*1000).allowed,true);
  assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes/id/attendance','POST',action*1000).allowed,true);
 }
 for(let i=40;i<300;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes/id/photos','POST',40000).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes/id/photos','POST',40000).allowed,false);
 for(let i=0;i<20;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/auth/request','POST',40000).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/auth/verify','POST',40000).allowed,false);
});
test('Consultas têm limite agregado, Retry-After e renovação; não podem usar a cota de polling por caminho parecido',()=>{
 const map=new Map();for(let i=0;i<1200;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes/'+i,'GET',0).allowed,true);
 for(const [url,method]of [['/api/portal/students','GET'],['/api/portal/sync/extra','GET'],['/api/portal/classes','HEAD']])assert.equal(consumePortalBudget(map,'fixture',url,method,1000).allowed,false);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/students','GET',1000).retryAfter,599);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/sync','GET',1000).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes/id/attendance','POST',1000).allowed,true);
 assert.equal(consumePortalBudget(map,'other','/api/portal/students','GET',1000).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/students','GET',600000).allowed,true);
});
