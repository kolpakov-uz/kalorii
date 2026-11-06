import test from 'node:test';
import assert from 'node:assert/strict';
import {issueBrowserAccess,verifyBrowserAccess,revokeBrowsers} from '../worker/browser-auth.js';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';

function storage(){
 const values=new Map(),writes=[];
 return {values,writes,get:async key=>values.get(key)||null,put:async(key,value,options)=>{writes.push({key,value,options});values.set(key,value)},delete:async key=>values.delete(key),list:async({prefix})=>({keys:[...values.keys()].filter(name=>name.startsWith(prefix)).map(name=>({name})),list_complete:true})};
}
function request(body){return new Request('https://example.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(body)})}

test('browser access is random, stored only as a hash and expires independently of Telegram launch',async()=>{
 const kv=storage(),env={...telegramEnvFixture,SUBS:kv},now=Date.now();
 const first=await issueBrowserAccess(111,env,now),second=await issueBrowserAccess(111,env,now);
 assert.notEqual(first.browserToken,second.browserToken);
 assert.equal(kv.writes.some(write=>JSON.stringify(write).includes(first.browserToken)),false);
 assert.deepEqual(await verifyBrowserAccess(first.browserToken,env,now+2*86400000),{ok:true,userId:111,browserKey:kv.writes[0].key});
 assert.equal((await verifyBrowserAccess(first.browserToken,env,first.expiresAt)).error,'browser_auth_expired');
 assert.equal(kv.writes[0].options.expirationTtl,365*86400);
});

test('missing, tampered, unregistered and revoked account credentials fail closed',async()=>{
 const kv=storage(),env={...telegramEnvFixture,SUBS:kv};
 const {browserToken}=await issueBrowserAccess(111,env);
 for(const token of ['',null,{},'b1.111.'+'0'.repeat(64),browserToken.replace('.111.','.222.'),browserToken+'x'])assert.equal((await verifyBrowserAccess(token,env)).ok,false);
 assert.equal((await verifyBrowserAccess(browserToken,{...env,TELEGRAM_ALLOWED_IDS:'[222]'})).status,403);
 assert.equal((await verifyBrowserAccess(browserToken,{...env,TELEGRAM_ALLOWED_IDS:'[]'})).status,503);
 assert.equal((await verifyBrowserAccess(browserToken,{...env,TELEGRAM_BOT_TOKEN:''})).status,503);
 assert.equal((await verifyBrowserAccess(browserToken,telegramEnvFixture)).status,503);
 const key=kv.writes[0].key;
 kv.values.set(key,JSON.stringify({ownerId:222,expiresAt:Date.now()+86400000}));
 assert.equal((await verifyBrowserAccess(browserToken,env)).ok,false);
});

test('only a verified allowed Telegram launch can issue browser credentials',async()=>{
 const env={...telegramEnvFixture,SUBS:storage()};
 assert.equal((await worker.fetch(request({mode:'browser_link',userId:111}),env)).status,401);
 assert.equal((await worker.fetch(request(telegramPayload({mode:'browser_link'},333)),env)).status,403);
 const response=await worker.fetch(request(telegramPayload({mode:'browser_link'})),env);
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const {browserToken}=await response.json();assert.match(browserToken,/^b1\.111\.[a-f0-9]{64}$/);
 assert.equal((await worker.fetch(request({mode:'access',browserToken}),env)).status,200);
 for(const mode of ['browser_link','browser_revoke'])assert.equal((await worker.fetch(request({mode,browserToken}),env)).status,401);
 assert.equal((await worker.fetch(request({mode:'access',browserToken,telegramInitData:'forged'}),env)).status,401);
});

test('browser can use existing API modes and push ownership without trusting a client userId',async()=>{
 const kv=storage(),env={...telegramEnvFixture,SUBS:kv};
 const owner=await issueBrowserAccess(111,env),other=await issueBrowserAccess(222,env);
 const sub={endpoint:'https://push.apple.com/browser-auth-test',keys:{p256dh:'fixture',auth:'fixture'}};
 const send=(mode,browserToken)=>worker.fetch(request({mode,browserToken,userId:333,sub,endpoint:sub.endpoint,cfg:{}}),env);
 assert.equal((await send('sync',owner.browserToken)).status,200);
 assert.equal(Object.values(JSON.parse(kv.values.get('subs')))[0].ownerId,111);
 assert.equal((await send('unsync',other.browserToken)).status,403);
 assert.equal((await send('unsync',owner.browserToken)).status,200);
 const original=globalThis.fetch;let upstream=0;
 globalThis.fetch=async()=>{upstream++;return new Response('{"candidates":[{"content":{"parts":[{"text":"fixture reply"}]}}]}')};
 try{
  const r=await worker.fetch(request({mode:'dish',browserToken:owner.browserToken,text:'Яблоко'}),env);
  assert.equal(r.status,200);assert.equal((await r.json()).text,'fixture reply');assert.equal(upstream,1);
 }finally{globalThis.fetch=original}
});

test('logout and revoke all preserve diary/subscription storage and the other account',async()=>{
 const kv=storage(),env={...telegramEnvFixture,SUBS:kv};
 const first=await issueBrowserAccess(111,env),second=await issueBrowserAccess(111,env),other=await issueBrowserAccess(222,env);
 kv.values.set('subs','{"existing":"untouched"}');
 assert.equal((await worker.fetch(request({mode:'browser_logout',browserToken:first.browserToken}),env)).status,200);
 assert.equal((await verifyBrowserAccess(first.browserToken,env)).ok,false);
 assert.equal((await verifyBrowserAccess(second.browserToken,env)).ok,true);
 await revokeBrowsers(111,env);
 assert.equal((await verifyBrowserAccess(second.browserToken,env)).ok,false);
 assert.equal((await verifyBrowserAccess(other.browserToken,env)).ok,true);
 assert.equal(kv.values.get('subs'),'{"existing":"untouched"}');
});

test('revoke all follows KV pagination and only removes matching browser sessions',async()=>{
 const deleted=[],seen=[];
 await revokeBrowsers(111,{SUBS:{list:async options=>{seen.push(options);return options.cursor?{keys:[{name:'browser:111:second'}],list_complete:true}:{keys:[{name:'browser:111:first'}],list_complete:false,cursor:'page2'}},delete:async key=>deleted.push(key)}});
 assert.deepEqual(deleted,['browser:111:first','browser:111:second']);
 assert.deepEqual(seen,[{prefix:'browser:111:'},{prefix:'browser:111:',cursor:'page2'}]);
});

test('old web push subscriptions can be reclaimed only with the matching endpoint and encryption keys',async()=>{
 const kv=storage(),env={...telegramEnvFixture,SUBS:kv};
 const {browserToken}=await issueBrowserAccess(222,env);
 const sub={endpoint:'https://push.apple.com/old-web-fixture',keys:{p256dh:'original-public-key',auth:'original-auth'}};
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint));
 const id=[...new Uint8Array(digest)].slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join('');
 kv.values.set('subs',JSON.stringify({[id]:{s:sub,tz:300,cfg:{}}}));
 const forged={...sub,keys:{...sub.keys,auth:'wrong'}};
 assert.equal((await worker.fetch(request({mode:'sync',browserToken,sub:forged}),env)).status,403);
 assert.equal(JSON.parse(kv.values.get('subs'))[id].ownerId,undefined);
 assert.equal((await worker.fetch(request({mode:'sync',browserToken,sub}),env)).status,200);
 assert.equal(JSON.parse(kv.values.get('subs'))[id].ownerId,222);
});
