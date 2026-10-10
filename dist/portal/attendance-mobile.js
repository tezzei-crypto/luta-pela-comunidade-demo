export function mountAttendanceTools({el,field},container,{rows,draft,form}){
 const tools=el('div',undefined,{class:'attendance-toolbar'}),search=field(tools,'Buscar aluno por nome ou ID','attendance-search','',{type:'search'}),next=el('button','Próximo não marcado',{type:'button',class:'secondary'}),result=el('p','',{role:'status','aria-live':'polite',class:'muted'});
 search.autocomplete='off';tools.append(next,result);container.append(tools);
 const normalized=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
 const lines=()=>[...form.querySelectorAll('[data-student-id]')];
 search.addEventListener('input',()=>{const q=normalized(search.value.trim());let visible=0;for(const line of lines()){const r=rows.find(r=>r.id===line.dataset.studentId);line.hidden=!normalized(r.name+' '+r.id).includes(q);if(!line.hidden)visible++}result.textContent=visible+' de '+rows.length+' alunos nesta busca. As marcações dos demais continuam preservadas.'});
 let last=-1;
 next.addEventListener('click',()=>{const pending=rows.map((r,i)=>({r,i})).filter(({r})=>draft.get(r.id)?.status==='unmarked');if(!pending.length){result.textContent='Todos os alunos têm marcação. Revise e salve a chamada.';return}const target=pending.find(p=>p.i>last)||pending[0];last=target.i;search.value='';for(const l of lines())l.hidden=false;const line=lines().find(l=>l.dataset.studentId===target.r.id);line?.focus({preventScroll:true});line?.scrollIntoView({block:'center'});result.textContent='Não marcado: '+target.r.name});
 return tools;
}

// Session-only, account-bound drafts. No names, emails, tokens or free text.
export function createAttendanceDraftCache(storage,now=()=>Date.now()){
 const key='lpc-attendance-drafts-v1';
 return {
  read(user){try{const p=JSON.parse(storage.getItem(key)||'null');if(!user||p?.user!==user.user_id||!Number.isFinite(p.expires)||p.expires<=now()){storage.removeItem(key);return new Map()}return new Map(p.classes.map(([id,rows])=>[id,new Map(rows)]))}catch{return new Map()}},
  save(user,drafts){if(!user?.user_id)return;const classes=[...drafts].map(([id,rows])=>[id,[...rows].filter(([,r])=>r.dirty).map(([sid,r])=>[sid,{status:r.status,version:r.version,dirty:true}])]).filter(([,r])=>r.length);try{if(!classes.length){storage.removeItem(key);return}storage.setItem(key,JSON.stringify({user:user.user_id,expires:Math.min(user.session_expires_at||now()+21600000,now()+21600000),classes}));return true}catch{return false}},
  clear(){try{storage.removeItem(key)}catch{}}
 };
}
