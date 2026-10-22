import fs from 'node:fs';import {createHash} from 'node:crypto';
let localRelease;
export function portalRelease(env=process.env){
 if(/^[a-f0-9]{12,64}$/i.test(env.RENDER_GIT_COMMIT||''))return env.RENDER_GIT_COMMIT.slice(0,12).toLowerCase();
 if(!localRelease){const dir=new URL('./dist/portal/',import.meta.url),hash=createHash('sha256');for(const name of fs.readdirSync(dir).filter(n=>/\.(js|css|html)$/.test(n)).sort())hash.update(name).update(fs.readFileSync(new URL(name,dir)));localRelease=hash.digest('hex').slice(0,12);}
 return localRelease;
}
export function versionPortalHtml(source,release){
 if(!/^[a-f0-9]{12}$/i.test(release))throw Error('Invalid portal release');
 return source.replace(/\sdata-portal-release="[^"]*"/gi,'').replace(/<html\b/i,'<html data-portal-release="'+release+'"').replace(/\b(src|href)="(\/portal\/[^"?#]+\.(?:js|css)(?:\?[^"#]*)?)"/g,(_,attr,path)=>{const url=new URL(path,'https://portal.invalid');url.searchParams.set('v',release);return attr+'="'+url.pathname+url.search+'"';});
}
