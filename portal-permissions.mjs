import {fail} from './portal-domain.mjs';
export const MANAGERS=['admin','secretary'];
export const CARE_ROLES=['psychologist','social_worker'];
// Functional boundary in addition to each resource's ownership/unit checks.
// New endpoints are denied by default for restricted staff profiles.
export function requireRouteAccess(role,route,method){
 if(/^\/backups(?:\/|$)/.test(route)&&role!=='admin')fail('Esta operação exige a administração geral.',403);
 if(role==='secretary'){
  if(/^\/(staff-accounts|members|links|audit|site-editor|contact-settings|graduation-policy|diagnostics)(?:\/|$)/.test(route)||route==='/rollcall-settings'&&method!=='GET')fail('Esta operação exige a administração geral.',403);
  return;
 }
 if(role==='admin'||role==='guardian')return;
 if(role==='teacher'&&/^\/classes\/[a-f0-9-]{36}\/attendance-history$/i.test(route)&&method==='GET')return;
 if(route==='/sync'&&method==='GET')return;
 if((role==='teacher'||CARE_ROLES.includes(role))&&route==='/attendance-alerts/attention'&&method==='GET')return;
 if(role==='teacher'&&/^\/classes\/[a-f0-9-]{36}\/photos(?:\/[a-f0-9-]{36})?$/i.test(route)&&['GET','POST'].includes(method))return;
 if(role==='teacher'&&route==='/rollcall-issues'&&method==='GET')return;
 if(['/me','/auth/verify','/auth/logout'].includes(route))return;
 if(CARE_ROLES.includes(role)&&method==='GET'&&(['/appointment-calendar','/appointment-calendar.csv'].includes(route)||/^\/bookings\/[0-9a-f-]{36}$/i.test(route)))return;
 const reports=route==='/reports'&&['GET','POST'].includes(method)||/^\/reports\/[0-9a-f-]{36}$/i.test(route)&&['GET','POST'].includes(method);
 if((role==='teacher'||CARE_ROLES.includes(role))&&(reports||['/units','/unit-roster'].includes(route)&&method==='GET'))return;
 if(CARE_ROLES.includes(role)&&((['/attendance-alerts/settings','/attendance-report','/attendance-report/options','/attendance-report.xlsx','/attendance-alerts'].includes(route)&&method==='GET')||/^\/attendance-alerts\/[0-9a-f-]{36}$/i.test(route)&&['GET','POST'].includes(method)))return;
 if(role==='teacher'&&/^\/classes\/[0-9a-f-]{36}\/cancellation$/i.test(route)&&method==='POST')return;
 if(role==='teacher'&&(route==='/groups'&&method==='GET'||/^\/groups\/[0-9a-f-]{36}$/i.test(route)&&method==='GET'||route==='/classes'&&['GET','POST'].includes(method)||/^\/classes\/[0-9a-f-]{36}\/attendance$/i.test(route)&&['GET','POST'].includes(method)||route==='/attendance.csv'&&method==='GET'))return;
 if(CARE_ROLES.includes(role)&&(route==='/professionals'&&method==='GET'||route==='/slots'&&['GET','POST'].includes(method)||/^\/slots\/[0-9a-f-]{36}$/i.test(route)&&['POST','PATCH'].includes(method)||route==='/bookings'&&method==='GET'))return;
 fail('Este recurso não está disponível para o seu perfil.',403);
}
