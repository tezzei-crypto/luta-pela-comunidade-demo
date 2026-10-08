import {csv,fail} from './portal-domain.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(data,status=200)=>Response.json(data,{status,headers});
export async function handleWorkforce({req,route,method,url,store,actor}){
 const body=async()=>{try{return await req.json()}catch{fail('Dados inválidos.')}};
 if(route==='/monitors'&&method==='GET')return json({monitors:await store.monitors(actor)});
 if(route==='/monitors'&&method==='POST')return json({monitor:await store.saveMonitor(actor,null,await body()),message:'Monitor cadastrado. Este registro não cria uma conta de acesso.'},201);
 const m=route.match(/^\/monitors\/([0-9a-f-]{36})$/i);if(m&&method==='PATCH')return json({monitor:await store.saveMonitor(actor,m[1],await body()),message:'Cadastro do monitor atualizado.'});
 if(route==='/workforce'&&method==='GET')return json({people:await store.workforceRoster(actor,url.searchParams.get('unit'))});
 if(route==='/workforce-sessions'&&method==='GET')return json({sessions:await store.workforceSessions(actor,url.searchParams.get('unit'))});
 if(route==='/workforce-sessions'&&method==='POST')return json({lesson:await store.createWorkforceSession(actor,await body()),message:'Chamada da equipe aberta.'},201);
 const s=route.match(/^\/workforce-sessions\/([0-9a-f-]{36})(\/history)?$/i);
 if(s&&method==='GET')return s[2]?json({history:await store.workforceHistory(actor,s[1])}):json(await store.workforceAttendance(actor,s[1]));
 if(s&&!s[2]&&method==='POST'){await store.markWorkforceAttendance(actor,s[1],(await body()).rows);return json({message:'Frequência da equipe salva.'})}
 if(route==='/workforce.csv'&&method==='GET'){const rows=await store.workforceExport(actor,url.searchParams.get('unit'),url.searchParams.get('from'),url.searchParams.get('to'));return new Response(csv(rows,['date','start_time','end_time','class','unit','person_key','name','role','status','note','version','updated_at','recorded_by']),{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="frequencia-equipe.csv"'}})}
}
