import {allowedTelegramIds} from './telegram-auth.js';

const lifetime=365*24*60*60;
const denied=(error,status)=>({ok:false,error,status});
const tokenParts=token=>typeof token==='string'&&/^b1\.[1-9]\d{0,15}\.[a-f0-9]{64}$/.test(token)?token.split('.'):null;
async function sessionKey(token){
 const parts=tokenParts(token);
 if(!parts||!Number.isSafeInteger(+parts[1]))return null;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 return 'browser:'+parts[1]+':'+[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function issueBrowserAccess(userId,env,now=Date.now()){
 if(!env.SUBS)throw Error('browser_unavailable');
 const secret=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const browserToken=`b1.${userId}.${secret}`,expiresAt=now+lifetime*1000;
 await env.SUBS.put(await sessionKey(browserToken),JSON.stringify({ownerId:userId,expiresAt}),{expirationTtl:lifetime});
 return {browserToken,expiresAt};
}
export async function verifyBrowserAccess(token,env,now=Date.now()){
 let allowed;
 try{allowed=allowedTelegramIds(env);if(!env.TELEGRAM_BOT_TOKEN?.trim())throw Error('configuration')}
 catch{return denied('private_not_configured',503)}
 const key=await sessionKey(token);
 if(!key)return denied('browser_auth_invalid',401);
 if(!env.SUBS)return denied('browser_unavailable',503);
 let session;
 try{session=JSON.parse(await env.SUBS.get(key))}catch{return denied('browser_unavailable',503)}
 const ownerId=Number(tokenParts(token)[1]);
 if(!session||session.ownerId!==ownerId||!Number.isFinite(session.expiresAt))return denied('browser_auth_invalid',401);
 if(session.expiresAt<=now)return denied('browser_auth_expired',401);
 if(!allowed.includes(ownerId))return denied('telegram_not_allowed',403);
 return {ok:true,userId:ownerId,browserKey:key};
}
export async function revokeBrowsers(userId,env){
 if(!env.SUBS)throw Error('browser_unavailable');
 let cursor;
 do{
  const page=await env.SUBS.list({prefix:'browser:'+userId+':',...(cursor?{cursor}:{})});
  await Promise.all(page.keys.map(key=>env.SUBS.delete(key.name)));
  cursor=page.list_complete?null:page.cursor;
 }while(cursor);
}
