import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../telegram-access.js',import.meta.url),'utf8');
function setup(fetch,options={}){
 let rendered=0;const values=options.values||new Map(),notices=[],button={disabled:false,textContent:''};
 const storage=options.storage||{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 const context=vm.createContext({API:'https://example.test',KaloriiTelegram:{active:options.active!==false,requestData:body=>({...body,telegramInitData:options.active===false?'':'signed-launch'}),userId:()=>111,botUrl:'https://t.me/caloriies_ai_bot'},localStorage:storage,document:{getElementById:()=>button},fetch,toast:(...args)=>notices.push(args),render:()=>rendered++,anim(){},schedSync(){}});
 vm.runInContext(source,context);return {access:vm.runInContext('PrivateAccess',context),renders:()=>rendered,values,notices,button};
}
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

test('a forbidden resource does not log a valid account out of its diary',async()=>{
 const x=setup(async()=>new Response('{"error":"forbidden"}',{status:403}));x.access.state='allowed';
 await x.access.request({mode:'sync'});assert.equal(x.access.allowed,true);assert.equal(x.renders(),0);
});
test('locked UI still offers export of local diary without disclosing content in the gate',()=>{
 const x=setup();x.access.state='closed';x.access.error='telegram_not_allowed';
 assert.match(x.access.markup(true),/Сохранить дневник в файл/);assert.doesNotMatch(x.access.markup(false),/Сохранить дневник в файл/);assert.match(x.access.markup(false),/111/);
});

const browserToken='b1.111.'+'a'.repeat(64);
test('browser remembers successful connection across reloads without modifying existing diary',async()=>{
 const values=new Map([['kalorii-v1','existing diary']]),requests=[];
 const fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return new Response('{"allowed":true}')};
 const first=setup(fetch,{active:false,values});await first.access.connect(' '+browserToken+' ');
 assert.equal(first.access.allowed,true);assert.equal(values.get(first.access.storageKey),browserToken);assert.equal(values.get('kalorii-v1'),'existing diary');
 const reloaded=setup(fetch,{active:false,values});await reloaded.access.check();assert.equal(reloaded.access.allowed,true);
 assert.equal(requests[0].browserToken,browserToken);assert.equal(requests[1].browserToken,browserToken);assert.equal(requests[1].telegramInitData,'');
 await reloaded.access.request({mode:'dish',text:'Яблоко',browserToken:'forged'});
 assert.equal(requests[2].browserToken,browserToken);
});

test('Telegram proof takes precedence and never sends a stored or caller-supplied browser key',async()=>{
 let sent;const x=setup(async(_url,options)=>{sent=JSON.parse(options.body);return new Response('{}')},{values:new Map([['kalorii-browser-access-v1',browserToken]])});
 await x.access.request({mode:'access',browserToken:'forged'});assert.equal(sent.telegramInitData,'signed-launch');assert.equal('browserToken' in sent,false);
});

test('bad codes, denied responses, network errors and blocked browser storage never unlock the UI',async()=>{
 let calls=0;const malformed=setup(async()=>{calls++;return new Response('{}')},{active:false});await malformed.access.connect('bad');assert.equal(calls,0);
 for(const fetch of [async()=>new Response('{"error":"browser_auth_invalid"}',{status:401}),async()=>new Response('{"allowed":false}'),async()=>{throw Error('offline')}]){
  const x=setup(fetch,{active:false});await x.access.connect(browserToken);assert.equal(x.access.allowed,false);assert.equal(x.values.has(x.access.storageKey),false);assert.equal(x.button.disabled,false);
 }
 const blocked=setup(async()=>new Response('{"allowed":true}'),{active:false,storage:{getItem:()=>null,setItem(){throw Error('blocked')}}});
 await blocked.access.connect(browserToken);assert.equal(blocked.access.allowed,false);assert.ok(blocked.notices.length);
});

test('browser gate offers connection and preserves diary export; Telegram gate has no browser form',()=>{
 const browser=setup(null,{active:false});browser.access.state='closed';
 assert.match(browser.access.markup(true),/Код подключения/);assert.match(browser.access.markup(true),/Сохранить дневник в файл/);
 assert.doesNotMatch(setup().access.markup(false),/id="browser-code"/);
});
