import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {JSDOM} from 'jsdom';
function fixture(t,role='admin',units=[]){
 const dom=new JSDOM('<section><label for="search">Buscar aluno</label><input id="search"><div id="students"></div><div id="detail">Ficha antiga</div></section>',{url:'https://example.test/administracao/',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window,c=dom.getInternalVMContext();w.$=id=>w.document.getElementById(id);w.me={role,units};w.students=[{id:'UND1_000001',name:'João Fictício',age:8,status:'approved'},{id:'UND2_000001',name:'Joana Fictícia',age:9,status:'pending'},{id:'UND3_000001',name:'João Outro Fictício',age:7,status:'approved'}];const names={amavale:'Amavale',valparaiso:'Valparaíso','vale-do-carangola':'Vale do Carangola'};w.scopeUnitNames=()=>Object.fromEntries(Object.entries(names).filter(([u])=>role==='admin'||units.includes(u)));w.action=f=>f;w.detail=()=>{};
 const source=fs.readFileSync(new URL('./dist/portal/portal.js',import.meta.url),'utf8');vm.runInContext(source.slice(source.indexOf('function el('),source.indexOf('function notice(')),c);vm.runInContext(source.slice(source.indexOf('function renderStudents()'),source.indexOf("$('search').addEventListener")),c);const render=()=>vm.runInContext('renderStudents()',c);render();return {w,render,c};
}
test('Alunos: agrupamento por núcleo, contagem, busca sem acento e atualização preserva seleção',t=>{
 const f=fixture(t),select=f.w.$('student-unit-filter');assert.equal(select.options.length,4);assert.equal(f.w.$('students').querySelectorAll('section').length,3);assert.match(select.options[3].textContent,/Vale do Carangola \(1\)/);
 select.value='vale-do-carangola';select.dispatchEvent(new f.w.Event('change'));assert.match(f.w.$('students').textContent,/João Outro/);assert.doesNotMatch(f.w.$('students').textContent,/Joana|UND1/);assert.equal(f.w.$('detail').hidden,true);
 f.w.$('search').value='joao';f.render();assert.equal(select.value,'vale-do-carangola');assert.equal(f.w.$('students').querySelectorAll('button').length,1);assert.match(f.w.$('student-directory-count').textContent,/1 de 1/);
 f.w.$('search').value='inexistente';f.render();assert.match(f.w.$('students').textContent,/Nenhum aluno corresponde/);assert.match(f.w.$('student-directory-count').textContent,/0 de 1/);
});
test('Alunos: secretaria recebe somente seu núcleo e estado vazio orienta conclusão de candidatos',t=>{
 const f=fixture(t,'secretary',['amavale']),select=f.w.$('student-unit-filter');assert.equal(select.options.length,2);assert.equal(select.value,'amavale');assert.doesNotMatch(f.w.$('students').textContent,/Valparaíso|Carangola/);
 f.w.students=[];f.render();assert.match(f.w.$('students').textContent,/Consulte Candidatos/);assert.match(select.options[1].textContent,/Amavale \(0\)/);
});
test('Alunos: navegação mantém filtros dentro da seção correta, inclusive no primeiro carregamento',t=>{
 const f=fixture(t),w=f.w,workspace=w.document.createElement('section');workspace.id='workspace';workspace.innerHTML='<div><p id="identity"></p></div><nav id="admin-nav"></nav><section id="dashboard-area"></section>';
 const original=w.document.querySelector('section');workspace.append(...original.childNodes);w.document.body.append(workspace);original.remove();
 const c=f.c;vm.runInContext(fs.readFileSync(new URL('./dist/portal/navigation.js',import.meta.url),'utf8'),c);vm.runInContext('setupNavigation()',c);
 assert.equal(w.$('student-directory-tools').parentElement.id,'students-area');assert.equal(w.$('students-area').classList.contains('is-current'),false);
});

test('Alunos mostra pré-cadastro no núcleo e abre a ficha de complementação',async t=>{
 const f=fixture(t),w=f.w;w.studentDrafts=[{id:'draft-ficticio',registration_id:'draft-ficticio',name:'Criança Importada',unit:'vale-do-carangola',age:8,status:'incomplete'}];let opened='';w.review=id=>{opened=id};w.showPanel=()=>{};f.render();const select=w.$('student-unit-filter');select.value='vale-do-carangola';select.dispatchEvent(new w.Event('change'));assert.match(select.selectedOptions[0].textContent,/\(2\)/);const button=[...w.$('students').querySelectorAll('button')].find(b=>b.textContent.includes('Criança Importada'));assert.match(button.textContent,/Cadastro incompleto/);button.click();await new Promise(r=>setImmediate(r));assert.equal(opened,'draft-ficticio');
});
