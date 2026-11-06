// Fail closed. UI/storage identifiers are never evidence of authorization.
const encoder=new TextEncoder();
const denied=(error,status)=>({ok:false,error,status});
const validId=value=>Number.isSafeInteger(value)&&value>0&&value<=4503599627370495;
function allowedAccounts(raw){
 if(typeof raw!=='string'||raw.length>200)throw Error('configuration');
 const accounts=JSON.parse(raw);
 if(!Array.isArray(accounts)||accounts.length<1||accounts.length>2||accounts.some(id=>!validId(id))||new Set(accounts).size!==accounts.length)throw Error('configuration');
 return accounts;
}
export function allowedTelegramIds(env){return allowedAccounts(env.TELEGRAM_ALLOWED_IDS)}
async function hmacKey(bytes,usage){return crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,usage)}
export async function verifyTelegramAccess(initData,env,now=Math.floor(Date.now()/1000)){
 let allowed;
 try{allowed=allowedAccounts(env.TELEGRAM_ALLOWED_IDS);if(typeof env.TELEGRAM_BOT_TOKEN!=='string'||!env.TELEGRAM_BOT_TOKEN.trim())throw Error('configuration')}
 catch{return denied('private_not_configured',503)}
 if(typeof initData!=='string'||!initData||initData.length>16384)return denied('telegram_auth_required',401);
 const params=new URLSearchParams(initData),seen=new Set();
 for(const [key,value] of params){if(seen.has(key)||/[\r\n]/.test(key)||/[\r\n]/.test(value))return denied('telegram_auth_invalid',401);seen.add(key)}
 const hash=params.get('hash'),authDate=params.get('auth_date');
 if(!/^[a-f\d]{64}$/i.test(hash||'')||!/^\d{1,12}$/.test(authDate||''))return denied('telegram_auth_invalid',401);
 params.delete('hash');
 // Bot-token verification includes every signed field except hash (including signature).
 const check=[...params].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>key+'='+value).join('\n');
 const signingKey=await hmacKey(encoder.encode('WebAppData'),['sign']);
 const secret=await crypto.subtle.sign('HMAC',signingKey,encoder.encode(env.TELEGRAM_BOT_TOKEN));
 const key=await hmacKey(secret,['verify']),signature=Uint8Array.from(hash.match(/../g),byte=>parseInt(byte,16));
 if(!await crypto.subtle.verify('HMAC',key,signature,encoder.encode(check)))return denied('telegram_auth_invalid',401);
 const issued=Number(authDate);
 if(issued>now+30||now-issued>86400)return denied('telegram_auth_expired',401);
 let user;try{user=JSON.parse(params.get('user'))}catch{return denied('telegram_auth_invalid',401)}
 if(!user||!validId(user.id))return denied('telegram_auth_invalid',401);
 if(!allowed.includes(user.id))return denied('telegram_not_allowed',403);
 return {ok:true,userId:user.id};
}
