import test from 'node:test';import assert from 'node:assert/strict';import {consumePortalBudget} from './portal-rate-budget.mjs';
test('Atualização automática tem cota própria sem impedir salvar chamada e mantém limite de login',()=>{
 const map=new Map();for(let i=0;i<300;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/sync','GET',0).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/rollcall-issues','GET',0).allowed,false);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes/id/attendance','POST',0).allowed,true);
 for(let i=0;i<20;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/auth/request','POST',0).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/auth/verify','POST',0).allowed,false);
});
test('Cotas preservam 300 operações por janela e endereço; caminho semelhante ou mutação não entra na cota de leitura',()=>{
 const map=new Map();for(let i=0;i<300;i++)assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes','POST',0).allowed,true);
 for(const [url,method]of [['/api/portal/classes','GET'],['/api/portal/sync','POST'],['/api/portal/sync/extra','GET']])assert.equal(consumePortalBudget(map,'fixture',url,method,1000).allowed,false);
 assert.equal(consumePortalBudget(map,'other','/api/portal/classes','POST',1000).allowed,true);assert.equal(consumePortalBudget(map,'fixture','/api/portal/sync','GET',1000).allowed,true);
 assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes','POST',1000).retryAfter,599);assert.equal(consumePortalBudget(map,'fixture','/api/portal/classes','POST',600000).allowed,true);
});
