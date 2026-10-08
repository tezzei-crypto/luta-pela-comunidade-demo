import {fail} from './portal-domain.mjs';
export const MANAGERS=['admin','secretary'];
export const CARE_ROLES=['psychologist','social_worker'];
// Functional boundary in addition to each resource's ownership/unit checks.
// New endpoints are denied by default for restricted staff profiles.
export function requireRouteAccess(role,route,method){
 if(MANAGERS.includes(role)||role==='guardian')return;
 if(['/me','/auth/verify','/auth/logout'].includes(route))return;
 const reports=route==='/reports'&&['GET','POST'].includes(method)||/^\/reports\/[0-9a-f-]{36}$/i.test(route)&&['GET','POST'].includes(method);
 if((role==='teacher'||CARE_ROLES.includes(role))&&(reports||['/units','/unit-roster'].includes(route)&&method==='GET'))return;
 if(role==='teacher'&&(route==='/groups'&&method==='GET'||/^\/groups\/[0-9a-f-]{36}$/i.test(route)&&method==='GET'||route==='/classes'&&['GET','POST'].includes(method)||/^\/classes\/[0-9a-f-]{36}\/attendance$/i.test(route)&&['GET','POST'].includes(method)||route==='/attendance.csv'&&method==='GET'))return;
 if(CARE_ROLES.includes(role)&&(route==='/professionals'&&method==='GET'||route==='/slots'&&['GET','POST'].includes(method)||/^\/slots\/[0-9a-f-]{36}$/i.test(route)&&method==='POST'||route==='/bookings'&&method==='GET'))return;
 fail('Este recurso não está disponível para o seu perfil.',403);
}
