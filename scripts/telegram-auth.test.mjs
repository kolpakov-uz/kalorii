import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyTelegramAccess} from '../worker/telegram-auth.js';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';
const now=1794000000,token='123456:fixture-only-not-a-real-token',env={TELEGRAM_BOT_TOKEN:token,TELEGRAM_ALLOWED_IDS:'[111,222]'};
function signed(id,extra={}){
 const fields={auth_date:String(now),query_id:'fixture',user:JSON.stringify({id,first_name:'Тест'}),...extra};
 const check=Object.entries(fields).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>k+'='+v).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 return new URLSearchParams({...fields,hash:createHmac('sha256',secret).update(check).digest('hex')}).toString();
}
test('only the two authorized accounts pass with a valid Telegram signature',async()=>{
 for(const id of [111,222])assert.deepEqual(await verifyTelegramAccess(signed(id),env,now),{ok:true,userId:id});
 assert.deepEqual(await verifyTelegramAccess(signed(333),env,now),{ok:false,error:'telegram_not_allowed',status:403});
});
test('a forged account ID, unsigned request, duplicate fields and wrong hash are rejected',async()=>{
 const altered=new URLSearchParams(signed(333));altered.set('user',JSON.stringify({id:111}));
 const wrong=new URLSearchParams(signed(111));wrong.set('hash','0'.repeat(64));
 for(const raw of ['',JSON.stringify({user:{id:111}}),altered.toString(),wrong.toString(),signed(111)+'&auth_date='+now,signed(111)+'&user='+encodeURIComponent('{"id":222}')]){
  const result=await verifyTelegramAccess(raw,env,now);assert.equal(result.ok,false);assert.equal(result.status,401);
 }
});
test('old and future signed launches expire, while a current signed launch is accepted',async()=>{
 for(const timestamp of [now-86401,now+31])assert.equal((await verifyTelegramAccess(signed(111,{auth_date:String(timestamp)}),env,now)).error,'telegram_auth_expired');
 assert.equal((await verifyTelegramAccess(signed(111,{auth_date:String(now-300)}),env,now)).ok,true);
});
test('missing or malformed configuration never opens access',async()=>{
 for(const config of [{},{...env,TELEGRAM_BOT_TOKEN:''},{...env,TELEGRAM_ALLOWED_IDS:'[]'},{...env,TELEGRAM_ALLOWED_IDS:'[111,222,333]'},{...env,TELEGRAM_ALLOWED_IDS:'[111,111]'},{...env,TELEGRAM_ALLOWED_IDS:'["111",222]'},{...env,TELEGRAM_ALLOWED_IDS:'not JSON'}]){
  assert.deepEqual(await verifyTelegramAccess(signed(111),config,now),{ok:false,error:'private_not_configured',status:503});
 }
});
test('all signed fields including the optional signature are verified; invalid user data is rejected',async()=>{
 assert.equal((await verifyTelegramAccess(signed(111,{signature:'optional-signed-field'}),env,now)).ok,true);
 for(const user of ['null','not JSON','{"id":"111"}','{"id":-1}'])assert.equal((await verifyTelegramAccess(signed(111,{user}),env,now)).ok,false);
});

test('every API mode rejects anonymous calls before contacting Gemini or storage',async()=>{
 const original=globalThis.fetch;let calls=0,reads=0;
 globalThis.fetch=async()=>{calls++;throw Error('must not reach upstream')};
 try{
  for(const mode of ['access','browser_link','browser_revoke','browser_logout','dish','photo','chat','transcribe','sync','unsync','test','unknown']){
   const req=new Request('https://example.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify({mode,userId:111,telegramId:111})});
   const r=await worker.fetch(req,{...telegramEnvFixture,SUBS:{get(){reads++;throw Error('must not read storage')}}});
   assert.equal(r.status,401);assert.equal((await r.json()).error,'telegram_auth_required');assert.equal(r.headers.get('Cache-Control'),'no-store');
  }
  assert.equal(calls,0);assert.equal(reads,0);
 }finally{globalThis.fetch=original}
});
test('private access admits only configured verified IDs and is closed when configuration is missing',async()=>{
 const request=(id)=>new Request('https://example.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload({mode:'access'},id))});
 assert.equal((await worker.fetch(request(111),{...telegramEnvFixture,TELEGRAM_ALLOWED_IDS:'[111]'})).status,200);
 for(const id of [222,333]){const r=await worker.fetch(request(id),{...telegramEnvFixture,TELEGRAM_ALLOWED_IDS:'[111]'});assert.equal(r.status,403);assert.equal((await r.json()).error,'telegram_not_allowed')}
 const missing=await worker.fetch(request(111),{});assert.equal(missing.status,503);
});
test('CORS preflight remains available while normal GET and wrong-origin requests stay forbidden',async()=>{
 assert.equal((await worker.fetch(new Request('https://example.test',{method:'OPTIONS'}),{})).status,200);
 assert.equal((await worker.fetch(new Request('https://example.test'),{})).status,403);
 assert.equal((await worker.fetch(new Request('https://example.test',{method:'POST',headers:{Origin:'https://untrusted.test'},body:'{}'}),telegramEnvFixture)).status,403);
});

test('subscriptions belong to the verified account and another allowed account cannot overwrite or remove them',async()=>{
 let state={};const storage={get:async()=>JSON.stringify(state),put:async(_key,value)=>{state=JSON.parse(value)}};
 const sub={endpoint:'https://push.apple.com/private-auth-fixture',keys:{p256dh:'fixture',auth:'fixture'}};
 const send=(mode,id)=>worker.fetch(new Request('https://example.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload({mode,sub,endpoint:sub.endpoint,cfg:{}},id))}),{...telegramEnvFixture,SUBS:storage});
 assert.equal((await send('sync',111)).status,200);assert.equal(Object.values(state)[0].ownerId,111);
 assert.equal((await send('sync',222)).status,403);assert.equal((await send('unsync',222)).status,403);assert.equal(Object.values(state)[0].ownerId,111);
 assert.equal((await send('unsync',111)).status,200);assert.deepEqual(state,{});
});
test('scheduled delivery skips legacy anonymous and no-longer-authorized recipients without deleting them',async()=>{
 let job,writes=0;const subs={old:{tz:'invalid',cfg:{}},other:{ownerId:333,tz:'invalid',cfg:{}}};
 await worker.scheduled({}, {...telegramEnvFixture,SUBS:{get:async()=>JSON.stringify(subs),put:async()=>{writes++}}},{waitUntil:promise=>job=promise});
 await job;assert.equal(writes,0);
});
