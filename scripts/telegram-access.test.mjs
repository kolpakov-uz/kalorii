import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../telegram-access.js',import.meta.url),'utf8');
function setup(fetch){let rendered=0;const context=vm.createContext({API:'https://example.test',KaloriiTelegram:{requestData:body=>({...body,telegramInitData:'signed-launch'}),userId:()=>111,botUrl:'https://t.me/caloriies_ai_bot'},fetch,render:()=>rendered++,anim(){},schedSync(){}});vm.runInContext(source,context);return {access:vm.runInContext('PrivateAccess',context),renders:()=>rendered}}
test('gate unlocks only after a successful server decision and sends Telegram proof',async()=>{
 let request;const x=setup(async(_url,options)=>{request=options;return new Response(JSON.stringify({allowed:true}),{status:200})});
 assert.equal(x.access.allowed,false);await x.access.check();assert.equal(x.access.allowed,true);
 assert.deepEqual(JSON.parse(request.body),{mode:'access',telegramInitData:'signed-launch'});
});
test('unknown accounts, missing configuration, malformed replies and network failures stay locked',async()=>{
 for(const response of [()=>new Response('{"error":"telegram_not_allowed"}',{status:403}),()=>new Response('{"error":"private_not_configured"}',{status:503}),()=>new Response('{"allowed":false}'),()=>new Response('bad JSON'),()=>{throw Error('offline')}]){
  const x=setup(async()=>response());await x.access.check();assert.equal(x.access.allowed,false);assert.equal(x.access.state,'closed');
 }
});
test('API authorization revocation closes an already unlocked UI',async()=>{
 const x=setup(async()=>new Response('{"error":"telegram_auth_expired"}',{status:401}));x.access.state='allowed';
 const r=await x.access.request({mode:'dish',text:'Творог'});assert.equal(r.status,401);assert.equal(x.access.allowed,false);assert.equal(x.access.error,'telegram_auth_expired');assert.equal(x.renders(),1);
});
test('locked UI still offers export of local diary without disclosing content in the gate',()=>{
 const x=setup();x.access.state='closed';x.access.error='telegram_not_allowed';
 assert.match(x.access.markup(true),/Сохранить дневник в файл/);assert.doesNotMatch(x.access.markup(false),/Сохранить дневник в файл/);assert.match(x.access.markup(false),/111/);
});
