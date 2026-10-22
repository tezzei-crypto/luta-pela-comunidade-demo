const passivePaths=new Set(['/api/portal/sync','/api/portal/rollcall-issues','/api/portal/attendance-alerts/attention','/api/portal/class-reviews']);
// Polling must not exhaust the budget reserved for actual user work.
// Every bucket remains bounded per client address; auth and mutations retain
// their existing limits and all endpoints still enforce normal authentication.
export function consumePortalBudget(limits,address,pathname,method,now=Date.now()){
 const bucket=pathname.includes('/auth/')?'auth':method==='GET'&&passivePaths.has(pathname)?'polling':'data',limit=bucket==='auth'?20:300,key='portal:'+address+':'+bucket,window=600000;
 if(limits.size>1000)for(const [k,v]of limits)if(now-v.start>window)limits.delete(k);
 const entry=limits.get(key);
 if(entry&&now-entry.start<window&&entry.count>=limit)return {allowed:false,retryAfter:Math.max(1,Math.ceil((window-now+entry.start)/1000)),bucket};
 limits.set(key,entry&&now-entry.start<window?{...entry,count:entry.count+1}:{start:now,count:1});
 return {allowed:true,bucket};
}
