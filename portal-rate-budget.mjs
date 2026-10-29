const passivePaths=new Set(['/api/portal/sync','/api/portal/rollcall-issues','/api/portal/attendance-alerts/attention','/api/portal/class-reviews']);
// A refresh after saving reloads several lists and private images. Reads must
// neither spend the mutation budget nor block normal multi-class work after
// a few refreshes. All buckets remain bounded per address; authentication and
// mutation limits are unchanged and endpoint authorization still applies.
const budgets={auth:20,polling:300,read:1200,write:300};
export function consumePortalBudget(limits,address,pathname,method,now=Date.now()){
 const bucket=pathname.includes('/auth/')?'auth':method==='GET'&&passivePaths.has(pathname)?'polling':method==='GET'||method==='HEAD'?'read':'write',limit=budgets[bucket],key='portal:'+address+':'+bucket,window=600000;
 if(limits.size>1000)for(const [k,v]of limits)if(now-v.start>window)limits.delete(k);
 const entry=limits.get(key);
 if(entry&&now-entry.start<window&&entry.count>=limit)return {allowed:false,retryAfter:Math.max(1,Math.ceil((window-now+entry.start)/1000)),bucket};
 limits.set(key,entry&&now-entry.start<window?{...entry,count:entry.count+1}:{start:now,count:1});
 return {allowed:true,bucket};
}
