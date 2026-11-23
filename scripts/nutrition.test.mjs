import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {nutritionSync,searchProduct,refreshNutrition} from '../worker/nutrition-store.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';
import worker from '../worker/index.js';
const create=()=>{const c=vm.createContext({Date});vm.runInContext(fs.readFileSync(new URL('../nutrition.js',import.meta.url),'utf8'),c);return c.Nutrition};
const macros={k:100,p:15,f:1,c:4},row=n=>({n,...macros});
const kv=()=>{const m=new Map();return {m,get:async k=>m.get(k)||null,put:async(k,v)=>{m.set(k,v)},delete:async k=>m.delete(k),list:async({prefix})=>({keys:[...m.keys()].filter(k=>k.startsWith(prefix)).map(name=>({name}))})}};
test('fat, brand, raw and cooked products remain distinct, including brandless tvorog',()=>{
 const n=create(),s={};for(const name of ['Творог 1%','Творог 5%','Творог Vlatika 1%','Творог Доброе деревенское утро 1%','Куриная грудка сырая','Куриная грудка варёная'])n.remember(s,row(name));
 assert.equal(s.nutrition.rows.length,6);
 assert.equal(n.lookup(s,'200 гр творог 1%').n,'Творог 1%');
 assert.equal(n.lookup(s,'Творог Vlatika 1%, 200 г').n,'Творог Vlatika 1%');
 assert.equal(n.lookup(s,'Куриная грудка 200 г'),null);
 assert.equal(n.lookup(s,'Куриная грудка жареная 200 г'),null);
 assert.equal(n.compatible('Творог Vlatika 1%','Творог Доброе деревенское утро 1%'),false);
 assert.equal(n.compatible('Творог 1%','Творог Vlatika 1%'),false);
 assert.equal(n.lookup({foods:[{...row('Творог Vlatika 1%'),custom:true,aliases:['Творог 1%']}]},'Творог 1% 200 г'),null);
});
test('preparation choice is remembered per product family and explicit preparation overrides it',()=>{
 const n=create(),s={};assert.equal(n.prepare(s,'Куриная грудка 200 гр').choice.family,'chicken');
 const text=n.choose(s,'Куриная грудка 200 гр','raw');assert.match(text,/сырой/);
 assert.match(n.prepare(s,'Куриная грудка 300 г').text,/сырой/);
 assert.equal(n.prepare(s,'Куриная грудка жареная 200 г').text,'Куриная грудка жареная 200 г');
 assert.equal(n.prepare(s,'Рис 200 г').choice.family,'rice');
 n.remember(s,row('Куриная грудка сырая'));assert.equal(n.lookup(s,text).g,200);
});
test('local lookup rejects multi-food, volume, fraction, count and correction requests',()=>{
 const n=create(),s={};n.remember(s,row('Банан'));
 for(const text of ['Банан 100 г и творог 200 г','Банан 200 мл','Половина банана 100 г','Исправь банан 100 г','Банан 100 г и масло','2 банана по 100 г','Банан 100 г на штуку'])assert.equal(n.lookup(s,text),null,text);
 assert.equal(n.lookup(s,'Я съел банан 0,2 кг').g,200);
});
test('per-100 values do not change with portion; estimates expire and manual corrections survive refresh',()=>{
 const n=create(),s={},now=Date.now();n.remember(s,row('Творог 1%'),'', 'estimate',now);
 assert.equal(n.lookup(s,'Творог 1% 33 г',now).k,100);assert.equal(n.lookup(s,'Творог 1% 999 г',now).k,100);
 assert.equal(n.lookup(s,'Творог 1% 100 г',now+n.week+1),null);
 n.remember(s,{...row('Творог 1%'),k:77},'','manual',now+1);
 n.merge(s,[{...row('Творог 1%'),k:200,key:'test',aliases:[],origin:'usda',checkedAt:now+100,updatedAt:now+100}]);
 assert.equal(n.lookup(s,'Творог 1% 100 г',now+2*n.week).k,77);
 assert.equal(n.lookup({},'Творог 1% 100 г'),null);
});
test('nutrition sync keeps users isolated and never trusts a client claim of a verified source',async()=>{
 const n=create(),env={SUBS:kv()},s={};n.remember(s,row('Сюзьма 5%'),'','manual');
 await nutritionSync(env,'alice',s.nutrition.rows);const bob=await nutritionSync(env,'bob');
 assert.equal(bob.some(r=>r.n==='Сюзьма 5%'),false);
 assert.equal((await nutritionSync(env,'alice')).find(r=>r.n==='Сюзьма 5%').origin,'manual');
 const fake={...s.nutrition.rows[0],n:'Fake',origin:'usda',key:'fake'};
 const result=await nutritionSync(env,'bob',[fake]);assert.equal(result.find(r=>r.n==='Fake').origin,'estimate');
 await nutritionSync(env,'bob',undefined,true);assert.equal((await nutritionSync(env,'bob')).some(r=>r.n==='Fake'),false);assert.equal((await nutritionSync(env,'alice')).some(r=>r.n==='Сюзьма 5%'),true);
});
test('OFF search requires one exact brand/fat/preparation match and complete per-100 nutrition',async()=>{
 const original=globalThis.fetch;let products=[];
 globalThis.fetch=async()=>Response.json({products});
 try{
  const item={code:'1234567890123',product_name:'Творог 1%',brands:'Vlatika',nutriments:{'energy-kcal_100g':90,proteins_100g:16,fat_100g:1,carbohydrates_100g:3}};
  products=[item];assert.equal((await searchProduct(row('Творог Vlatika 1%'))).k,90);
  assert.equal(await searchProduct(row('Творог 1%')),null);
  assert.equal(await searchProduct(row('Творог Vlatika 5%')),null);
  products=[item,item];assert.equal(await searchProduct(row('Творог Vlatika 1%')),null);
  products=[{...item,nutriments:{}}];assert.equal(await searchProduct(row('Творог Vlatika 1%')),null);
 }finally{globalThis.fetch=original}
});
test('weekly source failure retains verified values and does not touch manual corrections',async()=>{
 const original=globalThis.fetch,env={SUBS:kv()},state={};Nutrition.remember(state,row('Сюзьма'),'','manual');
 await env.SUBS.put('nutrition:v1:reference',JSON.stringify([{n:'keep'}]));await env.SUBS.put('nutrition:v1:user:alice',JSON.stringify(state.nutrition));
 globalThis.fetch=async()=>{throw Error('offline')};
 try{await refreshNutrition(env);assert.deepEqual(JSON.parse(await env.SUBS.get('nutrition:v1:reference')),[{n:'keep'}]);assert.equal(JSON.parse(await env.SUBS.get('nutrition:v1:user:alice')).rows[0].origin,'manual')}finally{globalThis.fetch=original}
});
test('nutrition endpoint is authenticated and shares neither private rows nor diary records',async()=>{
 const env={...telegramEnvFixture,SUBS:kv()},url='https://worker.test/';
 const req=data=>new Request(url,{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io','Content-Type':'application/json'},body:JSON.stringify(data)});
 assert.equal((await worker.fetch(req({mode:'nutrition'}),env)).status,401);
 const payload=telegramPayload({mode:'nutrition'});const response=await worker.fetch(req(payload),env);assert.equal(response.status,200);const data=JSON.parse((await response.json()).text);assert.equal(data.rows.length,10);
});
