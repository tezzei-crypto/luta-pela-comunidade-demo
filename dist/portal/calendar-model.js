export const calendarStatuses={waiting:'Preferência sem vaga',free:'Livre',pending:'Aguardando secretaria',confirmed:'Confirmado',completed:'Realizado',absent:'Não compareceu',withdrawn:'Horário retirado',expired:'Horário encerrado',unavailable:'Profissional indisponível'};
const zone='America/Sao_Paulo',dayMs=86400000;
export function localDay(value=new Date()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-')}
export const dayDate=day=>new Date(day+'T12:00:00Z');
export const addDays=(day,n)=>new Date(+dayDate(day)+n*dayMs).toISOString().slice(0,10);
export function shiftMonth(day,n){const d=dayDate(day),date=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(date,last));return d.toISOString().slice(0,10)}
export function period(day,view){let from=day,to=day;if(view==='week'){from=addDays(day,-((dayDate(day).getUTCDay()+6)%7));to=addDays(from,6)}else if(view==='month'){const first=day.slice(0,7)+'-01';from=addDays(first,-((dayDate(first).getUTCDay()+6)%7));to=addDays(from,41)}return {from,to}}
export const daysIn=({from,to})=>Array.from({length:Math.round((+dayDate(to)-dayDate(from))/dayMs)+1},(_,i)=>addDays(from,i));
export const dayLabel=(day,options={weekday:'long',day:'numeric',month:'long',year:'numeric'})=>dayDate(day).toLocaleDateString('pt-BR',{timeZone:'UTC',...options});
export const hourLabel=value=>new Date(value).toLocaleTimeString('pt-BR',{timeZone:zone,hour:'2-digit',minute:'2-digit'});
export function groupEvents(events){const map=new Map();for(const event of events){const day=localDay(event.start_at);if(!map.has(day))map.set(day,[]);map.get(day).push(event)}for(const rows of map.values())rows.sort((a,b)=>a.start_at.localeCompare(b.start_at)||a.professional_name.localeCompare(b.professional_name));return map}
