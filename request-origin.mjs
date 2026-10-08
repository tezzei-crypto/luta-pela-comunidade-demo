// Exact origins only. Never trust Forwarded/X-Forwarded-Host or arbitrary Host values.
export function publicOrigins(env={}) {
 const values=[env.PUBLIC_ORIGIN,env.RENDER_EXTERNAL_URL,...(env.ADDITIONAL_PUBLIC_ORIGINS||'').split(',')].filter(v=>v?.trim());
 return [...new Set(values.map(value=>{
  const url=new URL(value.trim());
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Origem pública inválida.');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Use HTTPS para o endereço público.');
  return url.origin;
 }))];
}
export function requestOrigin(host,env={}) {
 if(typeof host!=='string'||/[\s,\/\\@?#]/.test(host))throw Error('Host inválido.');
 const allowed=publicOrigins(env),match=allowed.find(origin=>new URL(origin).host.toLowerCase()===host.toLowerCase());
 if(match)return match;
 if(allowed.length||env.RENDER==='true')throw Error('Host não autorizado.');
 const local=new URL('http://'+host);
 if(!['localhost','127.0.0.1','[::1]'].includes(local.hostname))throw Error('Host local inválido.');
 return local.origin;
}
export function sameOrigin(request,env={}) {
 try{
  const origin=new URL(request.url).origin,allowed=publicOrigins(env);
  return request.headers.get('origin')===origin&&(!allowed.length||allowed.includes(origin));
 }catch{return false;}
}
