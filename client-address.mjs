import {isIP} from 'node:net';

function normalize(value){
 if(typeof value!=='string'||value.length>64||value.includes('%'))return '';
 const ip=value.trim(),version=isIP(ip);
 if(version===4)return ip;
 if(version!==6)return '';
 const canonical=new URL('http://['+ip+']/').hostname.slice(1,-1);
 // IPv4 mapped into IPv6 must share its rate limit with the IPv4 form.
 const mapped=canonical.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
 if(mapped){const high=parseInt(mapped[1],16),low=parseInt(mapped[2],16);return [high>>8,high&255,low>>8,low&255].join('.')}
 return canonical;
}

export function clientAddress(req,env={}){
 // Render's public ingress passes through Cloudflare. Its single-value header
 // avoids trusting a caller-supplied prefix in X-Forwarded-For. Outside Render
 // no proxy headers are trusted; missing/invalid headers fall back conservatively.
 // https://render.com/articles/how-render-handles-ddos-attacks
 // https://developers.cloudflare.com/fundamentals/reference/http-headers/
 if(env.RENDER==='true'){
  const edge=normalize(req.headers['cf-connecting-ip']);
  if(edge)return edge;
 }
 return normalize(req.socket?.remoteAddress)||'unknown';
}
