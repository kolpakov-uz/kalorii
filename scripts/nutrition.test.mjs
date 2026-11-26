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

test('label units and serving basis are normalized before applying the eaten weight',()=>{
 const n=create(),action={op:'add',name:'Кремчиз',grams:40,kcal100:930,protein100:5,fat100:22.5,carbs100:.5};
 const kj=n.normalizeAction({...action,label:{basisGrams:100,energy:930,energyUnit:'kJ',protein:5,fat:22.5,carbs:.5}});
 assert.ok(Math.abs(kj.kcal100-930/4.184)<1e-9);assert.equal(Math.round(kj.kcal100*40/100),89);assert.equal(kj.grams,40);assert.equal(n.saneAction(kj),true);
 const portion=n.normalizeAction({...action,label:{basisGrams:40,energy:90,energyUnit:'kcal',protein:2,fat:9,carbs:.2}});
 assert.equal(portion.kcal100,225);assert.equal(portion.protein100,5);assert.equal(portion.fat100,22.5);assert.equal(portion.carbs100,.5);assert.equal(portion.grams,40);
 assert.equal(n.normalizeAction(portion).kcal100,225);
});
test('a real partial label keeps its stated kcal and never invents a missing carbohydrate row',()=>{
 const n=create(),label={basisGrams:100,energy:230,energyUnit:'kcal',protein:5.8,fat:22.5};
 const result=n.normalizeAction({op:'add',name:'Кремчиз с трюфелем',grams:40,kcal100:930,protein100:6,fat100:65,carbs100:1.1,label});
 assert.equal(result.kcal100,230);assert.equal(result.protein100,5.8);assert.equal(result.fat100,22.5);assert.equal(result.carbs100,1.1);assert.equal(Object.hasOwn(result.label,'carbs'),false);assert.equal(Math.round(result.kcal100*.4),92);
 const energyOnly=n.normalizeAction({op:'edit',id:'record',label:{basisGrams:40,energy:92,energyUnit:'kcal'}});assert.equal(energyOnly.kcal100,230);assert.equal(Object.hasOwn(energyOnly,'carbs100'),false);
});
test('printed kcal take priority over inconsistent printed kJ including a zero-energy label',()=>{
 const n=create(),result=n.normalizeAction({op:'add',name:'Кремчиз',grams:40,carbs100:.1,label:{basisGrams:100,energy:930,energyUnit:'kJ',printedKcal:230,protein:5.8,fat:22.5}});
 assert.equal(result.kcal100,230);assert.equal(Math.round(result.kcal100*.4),92);assert.equal(result.carbs100,.1);assert.equal(n.normalizeAction(result).kcal100,230);
 const reserve=n.normalizeAction({label:{basisGrams:100,energy:930,energyUnit:'kJ'},printedKcal:230});assert.equal(reserve.kcal100,230);assert.equal(reserve.label.printedKcal,230);
 assert.equal(n.normalizeAction({label:{basisGrams:100,energy:1,energyUnit:'kJ',printedKcal:0}}).kcal100,0);
 assert.throws(()=>n.normalizeAction({label:{basisGrams:100,energy:930,energyUnit:'kJ',printedKcal:null}}));
});
test('gross energy errors are rejected without replacing legitimate label calories with a macro formula',()=>{
 const n=create(),cheese={n:'Кремчиз',k:222,p:5,f:22.5,c:.5};assert.equal(n.plausible({...cheese,k:930}),false);assert.equal(n.plausible(cheese),true);
 for(const value of [{n:'Масло',k:884,p:0,f:100,c:0},{n:'Клетчатка',k:190,p:1,f:0,c:90},{n:'Эритрит',k:0,p:0,f:0,c:99},{n:'Вино',k:80,p:0,f:0,c:10},{n:'Чай',k:1,p:0,f:0,c:0}])assert.equal(n.plausible(value),true,value.n);
 assert.equal(n.saneAction({op:'edit',kcal100:930},cheese),false);assert.equal(n.saneAction({op:'edit',grams:20},cheese),true);
});
test('corrupt estimates are bypassed and cannot enter the cache while manual values remain personal',()=>{
 const n=create(),bad={n:'Кремчиз',k:930,p:5,f:22.5,c:.5},s={};assert.equal(n.remember(s,bad),null);
 s.nutrition={version:1,defaults:{},rows:[{...bad,key:n.key(bad.n),origin:'estimate',checkedAt:Date.now(),updatedAt:Date.now()}]};assert.equal(n.lookup(s,'Кремчиз 40 г'),null);
 n.remember(s,{...bad,k:222});assert.equal(n.lookup(s,'Кремчиз 40 г').k,222);
 n.remember(s,bad,'','manual');assert.equal(n.lookup(s,'Кремчиз 40 г').k,930);
});
test('unreadable or inconsistent label metadata cannot silently become nutrition facts',()=>{
 const n=create(),label={basisGrams:100,energy:222,energyUnit:'kcal',protein:5,fat:22.5,carbs:.5};
 for(const invalid of [{...label,basisGrams:0},{...label,energyUnit:'unknown'},{...label,fat:null},{...label,protein:'not read'}])assert.throws(()=>n.normalizeAction({label:invalid}));
 assert.equal(n.saneAction(n.normalizeAction({op:'add',name:'Кремчиз',label:{...label,energy:930}})),false);
});
test('ready products and meals never inherit raw-grain questions or saved preparation defaults',()=>{
 const n=create(),s={};n.choose(s,'Рис 200 г','raw');n.choose(s,'Гречка 100 г','raw');n.choose(s,'Овсянка 100 г','raw');n.choose(s,'Куриная грудка 200 г','raw');
 for(const name of ['греческого йогурта','греческого салата','рисовых хлебцев','рисовой муки','рисового пудинга','гречневого хлеба','гречишного мёда','овсяного печенья','овсяноблина','овсяного киселя','рисовой каши','гречневой каши','овсяной каши','куриной грудки на пару','готовой куриной грудки','готового риса']){const text='50 г '+name;assert.equal(n.prepare({},text).choice,undefined,text);assert.equal(n.prepare(s,text).text,text,text);assert.equal(n.choose(s,text,'raw'),text,text)}
});
test('only standalone grain and chicken names ask about weighing, independent of word order',()=>{
 const n=create();for(const text of ['200 г риса','200 г белого риса','200 г бурого риса','200 г пропаренного риса','200 г крупы гречневой','200 г гречки','200 г грудки курицы','200 г овсяных хлопьев'])assert.ok(n.prepare({},text).choice,text);
 for(const text of ['200 г куриной грудки сырой','200 г риса после приготовления','200 г риса до приготовления','200 г куриной грудки не жареной'])assert.equal(n.prepare({},text).choice,undefined,text);
});
test('food nouns, negated preparation and ingredients cannot masquerade as cooking methods',()=>{
 const n=create();for(const text of ['Сыр','Сырники','Варенье','Вареники замороженные'])assert.equal(n.identity(text).prep,'',text);
 assert.equal(n.identity('Куриная грудка с сыром варёная').prep,'boiled');assert.equal(n.identity('Куриная грудка не жареная').prep,'');assert.equal(n.identity('Куриная грудка нежареная').prep,'');
 assert.equal(n.compatible('Куриная грудка не жареная','Куриная грудка жареная'),false);assert.equal(n.compatible('Куриная грудка не жареная','Куриная грудка варёная'),true);
 assert.equal(n.compatible('Рис готовый','Рис варёный'),true);assert.equal(n.compatible('Рис готовый','Рис сырой'),false);
 assert.notEqual(n.key('Варенье'),n.key('Вареники'));assert.equal(n.compatible('Варенье','Вареники'),false);
});
test('portion percentages are separate from fat and cannot poison the cached product identity',()=>{
 const n=create();for(const text of ['Съел 50% от 200 г творога 1%','50 % от 200 г творога 1%','Я съела 25% от 100 г йогурта 2%']){const q=n.parse(text);assert.ok(q,text);assert.equal(q.fat,text.includes('йогурта')?'2%':'1%',text);assert.ok(!q.brand,text)}
 assert.equal(n.compatible('Съел 50% от 200 г творога 1%','Творог 1%'),true);assert.equal(n.key('Творог 1 %'),n.key('Творог 1%'));
});
test('dairy brands stay separate, while normal flavour descriptions and milk in porridge are not brands',()=>{
 const n=create();for(const [a,b] of [['Йогурт Danone 2%','Йогурт Epica 2%'],['Йогурт 2%','Йогурт Epica 2%'],['Йогурт Простоквашино 2%','Йогурт Савушкин 2%'],['Сыр Valio 17%','Сыр President 17%'],['Кефир Vlatika 1%','Кефир Epica 1%']])assert.equal(n.compatible(a,b),false,a);
 assert.equal(n.compatible('Греческого йогурта','Греческий йогурт натуральный'),true);assert.equal(n.compatible('Йогурт клубничный 2%','Йогурт с клубникой 2%'),true);assert.equal(n.identity('Каша на молоке').brand,'');
 for(const name of ['Йогуртовый торт','Творожная запеканка','Молочный коктейль','Сметанный соус'])assert.equal(n.identity(name).brand,'',name);
});
test('old cache keys are resolved by product name without merging jam with dumplings',()=>{
 const n=create(),s={nutrition:{version:1,defaults:{},rows:[{...row('Варенье'),key:'boiled',origin:'manual',updatedAt:1,checkedAt:1,aliases:['Варенье','Вареники']}]}};
 assert.equal(n.lookup(s,'Вареники 100 г'),null);n.remember(s,row('Варенье'),'','manual',2);assert.equal(s.nutrition.rows.length,1);assert.equal(s.nutrition.rows[0].key,n.key('Варенье'));
 s.nutrition.rows[0].key='boiled';n.merge(s,[{...row('Варенье'),k:200,origin:'estimate',updatedAt:3,checkedAt:3}]);assert.equal(s.nutrition.rows[0].origin,'manual');assert.equal(s.nutrition.rows[0].k,100);
 s.nutrition.rows[0].origin='estimate';n.merge(s,[{...row('Варенье'),k:200,origin:'estimate',updatedAt:1,checkedAt:1}]);assert.equal(s.nutrition.rows[0].k,100);
});
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
