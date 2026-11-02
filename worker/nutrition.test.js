import test from 'node:test';
import assert from 'node:assert/strict';
import { createNutritionContext, resolveFood, NutritionError } from './nutrition.js';
import FOOD_INDEX from './food-index.js';
const food=(id,name,kcal=100,macros={protein:5,fat:2,carbs:15})=>({id,name,kcal,...macros});
const indexOf=(...foods)=>foods.map(f=>[f.id,f.name,`/en/${f.id}/`,'']);
const html=f=>`<button data-food-id="${f.id}"></button><span class="js-portion-label">100 g</span><span class="mvt-kcal" data-value="${f.kcal}">${f.kcal}</span><table>${[['protein',f.protein],['fat',f.fat],['carbohydrate',f.carbs]].map(([key,value])=>`<tr><td><a href="/en/${key}/">${key}</a></td><td><span data-value="${value}">${value}</span> <span class="mvt-sym">g</span></td></tr>`).join('')}</table>`;
const settings=(foods,extra={})=>({foodIndex:indexOf(...foods),fetchImpl:async url=>new Response(html(foods.find(f=>f.id===new URL(url).pathname.split('/')[2]))),...extra});
const action=(extra={})=>({op:'add',name:'Рис',query:'rice',state:'cooked',grams:250,...extra});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const first=async candidates=>candidates[0]?.id;
const rejectCode=code=>error=>error instanceof NutritionError&&error.code===code;

test('catalogue contains search metadata only, no nutritional answers',()=>{
 assert.ok(FOOD_INDEX.length>2000);for(const row of FOOD_INDEX){assert.equal(row.length,4);for(const field of row)assert.equal(typeof field,'string');assert.match(row[2],/^\/en\/[a-z0-9-]+\/$/);}
});
test('new queries fetch fresh food page, past result is unchanged',async()=>{
 let calls=0;const options=settings([food('rice','Rice, cooked')],{fetchImpl:async(url,options)=>{assert.equal(url,'https://www.matvaretabellen.no/en/rice/');assert.equal(options.cache,'no-store');return new Response(html(food('rice','Rice, cooked',++calls===1?130:140)));}});
 const oldEntry=await resolveFood(action(),{},options),newEntry=await resolveFood(action(),{},options);assert.equal(calls,2);assert.equal(oldEntry.kcal,325);assert.equal(newEntry.kcal,350);assert.equal(oldEntry.nutrition.per100.kcal,130);
});
test('same request repeated foods also fetch fresh page',async()=>{
 let calls=0;const context=createNutritionContext({},settings([food('rice','Rice, cooked')],{fetchImpl:async()=>{calls++;return new Response(html(food('rice','Rice, cooked')));}}));await context.resolve(action());await context.resolve(action());assert.equal(calls,2);
});
test('selector cannot override raw/cooked or invent ID; sees no calories',async()=>{
 const foods=[food('raw','Rice, raw',360),food('ready','Rice, cooked',130)];
 await assert.rejects(resolveFood(action(),{},settings(foods,{selectCandidate:async candidates=>{assert.deepEqual(candidates.map(x=>x.id),['mat:ready']);assert.equal(candidates[0].per100,undefined);return'mat:raw';}})),rejectCode('no_match'));
 await assert.rejects(resolveFood(action(),{},settings(foods,{selectCandidate:async()=> 'mat:invented'})),rejectCode('no_match'));
});
test('decimal fat percentages remain separate',async()=>{
 const foods=[food('05','Curd, 0.5% fat'),food('15','Curd, 1.5% fat'),food('5','Curd, 5% fat')];const result=await resolveFood(action({query:'curd',state:'ready',fatPercent:0.5}),{},settings(foods,{selectCandidate:async candidates=>{assert.deepEqual(candidates.map(x=>x.id),['mat:05']);return candidates[0].id;}}));assert.equal(result.nutrition.sources[0].id,'mat:05');
});
test('missing/null/blank macros are not zero; actual zero accepted',async()=>{
 for(const protein of [null,undefined,''])await assert.rejects(resolveFood(action(),{},settings([food('rice','Rice, cooked',100,{protein,fat:2,carbs:15})])),rejectCode('no_match'));
 const result=await resolveFood(action({query:'oil',state:'ready',grams:10}),{},settings([food('oil','Olive oil',900,{protein:0,fat:100,carbs:0})]));assert.equal(result.protein,0);assert.equal(result.fat,10);
});
test('page requires matching ID, explicit100g and known HTML schema',async()=>{
 for(const content of [html(food('other','Rice, cooked')),html(food('rice','Rice, cooked')).replace('100 g','100 ml'),'<h1>Unavailable</h1>'])await assert.rejects(resolveFood(action(),{},settings([food('rice','Rice, cooked')],{fetchImpl:async()=>new Response(content)})),rejectCode('no_match'));
});
test('rate/network failures never substitute model numbers or old data',async()=>{
 for(const fetchImpl of [async()=>json({},429),async()=>{throw Error('network');}])await assert.rejects(resolveFood(action({kcal100:111,protein100:1,fat100:1,carbs100:1}),{},settings([food('rice','Rice, cooked')],{fetchImpl})),rejectCode('lookup_unavailable'));
});
test('recipe computes by ingredient mass and final cooked yield',async()=>{
 const result=await resolveFood(action({name:'Блюдо',query:'',grams:200,yieldGrams:500,ingredients:[{name:'Рис',query:'rice',state:'raw',grams:100},{name:'Масло',query:'oil',state:'ready',grams:20}]}),{},settings([food('rice','Rice, raw',360,{protein:7,fat:1,carbs:80}),food('oil','Olive oil',900,{protein:0,fat:100,carbs:0})]));assert.equal(result.nutrition.method,'recipe');assert.equal(result.kcal100,108);assert.equal(result.kcal,216);assert.equal(result.protein,2.8);assert.equal(result.fat,8.4);assert.equal(result.nutrition.recipe.ingredients.length,2);assert.equal(result.nutrition.sources.length,2);
});
test('recipe needs yield and gram quantities; inferred composition stays estimate',async()=>{
 await assert.rejects(resolveFood(action({ingredients:[{name:'Рис',query:'rice',grams:100}]}),{}),rejectCode('needs_details'));
 await assert.rejects(resolveFood(action({yieldGrams:500,ingredients:[{name:'Молоко',unit:'ml',grams:100}]}),{}),rejectCode('needs_details'));
 const result=await resolveFood(action({estimatedRecipe:true,yieldGrams:300,ingredients:[{name:'Рис',query:'rice',state:'cooked',grams:300}]}),{},settings([food('rice','Rice, cooked')],{photo:true}));assert.equal(result.nutrition.method,'estimate');assert.equal(result.nutrition.estimatedPortion,true);
});
test('quantity under one and untrusted source URL are rejected',async()=>{
 await assert.rejects(resolveFood(action({grams:0.5}),{}),rejectCode('needs_details'));
 await assert.rejects(resolveFood(action(),{},{foodIndex:[['rice','Rice','https://evil.example/','']],fetchImpl:()=>{throw Error('must not fetch')}}),rejectCode('no_match'));
});
const barcode='1234567890123';
const offProduct=(extra={})=>({code:barcode,product_name:'Milk BrandX 1.5%',brands:'BrandX',nutrition:{input_sets:[{source:'packaging',preparation:'as_sold',per:'100ml',nutrients:{'energy-kj':{value:188.28,unit:'kJ'},proteins:{value:3,unit:'g'},fat:{value:1.5,unit:'g'},carbohydrates:{value:4.8,unit:'g'}}}]},...extra});
const milk=extra=>action({name:'Молоко BrandX',query:'milk',state:'ready',unit:'ml',grams:200,barcode,brand:'BrandX',fatPercent:1.5,...extra});
test('OFF barcode reads v3.6 labeled data and convertskJ',async()=>{
 const result=await resolveFood(milk(),{},{fetchImpl:async(url,options)=>{assert.equal(url,`https://world.openfoodfacts.org/api/v3.6/product/${barcode}.json`);assert.match(options.headers['User-Agent'],/^Kalorii\//);return json({product:offProduct()});}});assert.equal(result.nutrition.unit,'ml');assert.equal(result.kcal,90);assert.equal(result.fat,3);assert.equal(result.nutrition.sources[0].provider,'OpenFoodFacts');
});
test('ml never silently becomes grams',async()=>{
 await assert.rejects(resolveFood(milk({unit:'g'}),{},{fetchImpl:async()=>json({product:offProduct()})}),rejectCode('no_match'));await assert.rejects(resolveFood(action({unit:'ml'}),{}),rejectCode('needs_details'));
});
test('brand search always fetches fresh detail, not search numeric fields',async()=>{
 const urls=[];const result=await resolveFood(milk({barcode:undefined}),{},{selectCandidate:first,fetchImpl:async url=>{urls.push(url);return url.includes('/api/v2/search')?json({products:[{...offProduct(),nutrition:undefined,nutriments:{'energy-kcal_100g':999}}]}):json({product:offProduct()});}});assert.equal(urls.length,2);assert.match(urls[0],/brands_tags=brandx/);assert.equal(result.kcal,90);
});
test('OFF rejects estimate/prepared/missing macros/wrong brand or barcode',async()=>{
 const estimated=offProduct();estimated.nutrition.input_sets[0].source='estimate';const prepared=offProduct();prepared.nutrition.input_sets[0].preparation='prepared';const incomplete=offProduct();delete incomplete.nutrition.input_sets[0].nutrients.proteins;
 for(const product of [estimated,prepared,incomplete,offProduct({brands:'OtherBrand'}),offProduct({code:'9999999999999'})])await assert.rejects(resolveFood(milk(),{},{fetchImpl:async()=>json({product})}),rejectCode('no_match'));
});
test('OFF serving values normalized to matching explicit unit',async()=>{
 const product=offProduct(),set=product.nutrition.input_sets[0];set.per='serving';set.per_unit='ml';set.per_quantity=200;const result=await resolveFood(milk(),{},{fetchImpl:async()=>json({product})});assert.equal(result.kcal,45);assert.equal(result.protein,3);
});
