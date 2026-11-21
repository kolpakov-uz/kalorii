import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function api(){
 const context=vm.createContext({});
 vm.runInContext(fs.readFileSync(new URL('../dish-catalog.js',import.meta.url),'utf8'),context);
 vm.runInContext(fs.readFileSync(new URL('../diary-backup.js',import.meta.url),'utf8'),context);
 return {catalog:vm.runInContext('DishCatalog',context),backup:vm.runInContext('DiaryBackup',context)};
}
const copy=value=>JSON.parse(JSON.stringify(value));
const entry=(id,name='Овсяная каша',meal='b')=>({id,n:name,g:200,m:meal,k:220,p:8,f:6,c:32});
const state=()=>({foods:[],log:{'2026-11-20':[]},dc:{}});

test('legacy names receive stable identities, normalized duplicates combine and migration is idempotent',()=>{
 const {catalog}=api(),s=state();
 s.foods=[{n:'Творог 1%',d:'',k:100,p:16,f:1,c:4},{n:'ТВОРОГ-1 %',d:'',k:100,p:16,f:1,c:4}];
 s.log['2026-11-20']=[entry('old','творог1 %')];
 catalog.init(s);assert.equal(s.foods.length,1);
 assert.equal(s.log['2026-11-20'][0].dishId,s.foods[0].id);
 assert.equal(s.foods[0].g,200);assert.deepEqual(copy(s.foods[0].meals),['b']);
 const before=copy(s);catalog.init(s);assert.deepEqual(copy(s),before);
 const other=state();other.foods=[{n:'Творог 1%',k:100,p:16,f:1,c:4}];catalog.init(other);assert.equal(other.foods[0].id,s.foods[0].id);
});

test('identity preserves fat percentages, preparation and ingredients',()=>{
 const {catalog}=api();
 assert.equal(catalog.normalize(' Яйцо, варёное! '),catalog.normalize('яйцо вареное'));
 assert.notEqual(catalog.normalize('Творог 1%'),catalog.normalize('Творог 5%'));
 assert.notEqual(catalog.normalize('Яйцо вареное'),catalog.normalize('Яйцо жареное'));
 assert.notEqual(catalog.normalize('Каша на молоке'),catalog.normalize('Каша на воде'));
 assert.equal(catalog.normalize('Творог 1,5 %'),'творог 1.5%');
});

test('AI identity links different descriptions and ten uses count across meals and portions',()=>{
 const {catalog}=api(),s=state();catalog.init(s);
 const first=entry('first');s.log['2026-11-20'].push(first);const food=catalog.record(s,first);
 for(let i=1;i<10;i++){
  const row=entry('other-'+i,'Каша из овсяных хлопьев',i%2?'l':'b');
  row.g=100;row.k=110;row.p=4;row.f=3;row.c=16;
  s.log['2026-11-20'].push(row);catalog.record(s,row,{foodId:food.id,alias:'На завтрак съел овсянку'});
 }
 assert.equal(s.foods.length,1);assert.equal(food.n,'Овсяная каша');
 assert.equal(catalog.match(s,'каша из овсяных хлопьев').id,food.id);
 assert.equal(catalog.match(s,'На завтрак съел овсянку').id,food.id);
 assert.equal(catalog.frequent(s,'b')[0].count,10);assert.equal(catalog.frequent(s,'l')[0].count,10);
 assert.equal(catalog.frequent(s,'d').length,0);
 s.log['2026-11-20'].pop();assert.equal(catalog.frequent(s,'b').length,0);
});

test('manual preferences and per-100g nutrition survive future AI results',()=>{
 const {catalog}=api(),s=state();catalog.init(s);
 const first=entry('one');s.log['2026-11-20'].push(first);const food=catalog.record(s,first);
 Object.assign(food,{n:'Моя овсянка',g:250,k:125,p:5,f:4,c:18,custom:true,pinned:true,meals:['b']});
 const next=entry('two','Каша из хлопьев','l');s.log['2026-11-20'].push(next);catalog.record(s,next,{foodId:food.id});
 assert.deepEqual(copy({g:food.g,k:food.k,p:food.p,f:food.f,c:food.c,meals:food.meals}),{g:250,k:125,p:5,f:4,c:18,meals:['b']});
 assert.equal(food.n,'Моя овсянка');assert.equal(catalog.frequent(s,'b').length,1);assert.equal(catalog.frequent(s,'l').length,0);
 food.meals=[];catalog.init(s);assert.equal(catalog.frequent(s,'b').length,0);
});

test('invalid or zero-weight diary rows do not advance the frequent-dish threshold',()=>{
 const {catalog}=api(),s=state();
 s.log['2026-11-20']=Array.from({length:9},(_,index)=>entry('valid-'+index));catalog.init(s);
 const id=s.foods[0].id;
 for(const g of [0,-1,NaN])s.log['2026-11-20'].push({...entry('bad-'+g),g,dishId:id});
 assert.equal(catalog.frequent(s,'b').length,0);
 s.log['2026-11-20'].push({...entry('tenth'),dishId:id});
 assert.equal(catalog.frequent(s,'b')[0].count,10);
});

test('user alias edits survive later catalog initialization without losing linked history',()=>{
 const {catalog}=api(),s=state();catalog.init(s);
 const row=entry('one','Каша из хлопьев');s.log['2026-11-20'].push(row);const food=catalog.record(s,row);
 Object.assign(food,{n:'Моя овсянка',aliases:['Моя овсянка'],custom:true,pinned:true});
 catalog.init(s);assert.deepEqual(copy(food.aliases),['Моя овсянка']);
 assert.equal(row.dishId,food.id);assert.equal(catalog.frequent(s,'b')[0].count,1);
 const later=entry('two','Овсяная каша');s.log['2026-11-20'].push(later);catalog.record(s,later,{foodId:food.id});
 assert.equal(catalog.match(s,'Овсяная каша').id,food.id);
});

test('deleted dishes retain history and stay hidden after migration and future matching entries',()=>{
 const {catalog}=api(),s=state();catalog.init(s);
 const row=entry('one');s.log['2026-11-20'].push(row);const food=catalog.record(s,row);
 food.pinned=true;s.dc['овсяная каша']={n:food.n,g:200,k:110,p:4,f:3,c:16,dishId:food.id};
 assert.equal(catalog.remove(s,food.id),true);assert.equal(s.log['2026-11-20'].length,1);assert.equal(Object.keys(s.dc).length,0);
 const next=entry('two','Овсяная каша');s.log['2026-11-20'].push(next);catalog.record(s,next);
 catalog.init(s);assert.equal(s.foods.length,1);assert.equal(food.hidden,true);assert.equal(catalog.frequent(s,'b').length,0);
 food.hidden=false;food.pinned=true;assert.equal(catalog.frequent(s,'b').length,1);
});

test('merging dishes combines counts without changing historical portions or target settings',()=>{
 const {catalog}=api(),s=state();catalog.init(s);
 const a=entry('a','Овсянка'),b=entry('b','Овсяная каша');s.log['2026-11-20'].push(a,b);
 const first=catalog.record(s,a),second=catalog.record(s,b);
 Object.assign(first,{custom:true,pinned:true,g:300,meals:['l'],k:130});
 const before=copy(s.log);const target=catalog.merge(s,second.id,first.id);
 assert.equal(target.id,first.id);assert.equal(s.foods.filter(food=>!food.hidden).length,1);assert.equal(b.dishId,first.id);
 assert.equal(second.hidden,true);assert.equal(second.mergedInto,first.id);
 assert.equal(b.g,before['2026-11-20'][1].g);assert.equal(b.k,before['2026-11-20'][1].k);
 assert.equal(target.g,300);assert.equal(target.k,130);assert.deepEqual(copy(target.meals),['l']);
 assert.equal(catalog.match(s,'овсяная каша').id,first.id);assert.equal(catalog.frequent(s,'l')[0].count,2);
});

test('late AI replies using a merged source ID resolve through redirect chains without recreating dishes',()=>{
 const {catalog,backup}=api(),s=state();catalog.init(s);
 const a=entry('one','Овсянка'),b=entry('two','Каша из хлопьев'),c=entry('three','Моя каша');
 s.log['2026-11-20'].push(a,b,c);
 const first=catalog.record(s,a),second=catalog.record(s,b),third=catalog.record(s,c);
 catalog.merge(s,second.id,first.id);catalog.merge(s,first.id,third.id);
 assert.equal(catalog.find(s,second.id).id,third.id);
 assert.equal(catalog.match(s,'Каша из хлопьев').id,third.id);
 const late=entry('late','Каша овсяная домашняя');s.log['2026-11-20'].push(late);
 catalog.record(s,late,{foodId:second.id});
 assert.equal(late.dishId,third.id);assert.equal(s.foods.length,3);
 const restored=backup.parse(backup.stringify(s));catalog.init(restored);
 assert.equal(catalog.find(restored,second.id).id,third.id);
 assert.equal(restored.log['2026-11-20'].every(row=>row.dishId===third.id),true);
 assert.equal(catalog.merge(restored,third.id,second.id),null);
});

test('hidden dishes can be found explicitly for manual resurrection and redirect corruption cannot loop',()=>{
 const {catalog,backup}=api(),s=state();catalog.init(s);
 const row=entry('one');s.log['2026-11-20'].push(row);const food=catalog.record(s,row);
 catalog.remove(s,food.id);assert.equal(catalog.match(s,'Овсяная каша').id,food.id);
 food.hidden=false;food.pinned=true;assert.equal(catalog.frequent(s,'b').length,1);
 food.mergedInto=food.id;assert.throws(()=>backup.parse(backup.stringify(s)));
 catalog.init(s);assert.equal(food.mergedInto,undefined);assert.equal(catalog.find(s,food.id).id,food.id);
 food.mergedInto='missing-dish';assert.throws(()=>backup.parse(backup.stringify(s)));
});

test('ambiguous manually named dishes require an explicit identity',()=>{
 const {catalog}=api(),s=state();
 s.foods=[{id:'one',n:'Плов',g:200,k:200,p:8,f:9,c:28,custom:true,meals:['l']},{id:'two',n:'Плов',g:250,k:250,p:10,f:12,c:33,custom:true,meals:['l']}];
 catalog.init(s);assert.equal(catalog.match(s,'Плов'),null);assert.equal(s.foods.length,2);
 const row=entry('dinner','Плов','l');s.log['2026-11-20'].push(row);catalog.record(s,row,{foodId:'two'});assert.equal(row.dishId,'two');
});

test('first semantic recording honors an existing ID before migrating a newly inserted diary row',()=>{
 const {catalog}=api(),s=state();
 s.foods=[{id:'known-oats',n:'Овсянка',g:100,k:110,p:4,f:3,c:16,meals:['b']}];
 const row=entry('new','Каша из овсяных хлопьев');s.log['2026-11-20'].push(row);
 catalog.record(s,row,{foodId:'known-oats'});assert.equal(s.foods.length,1);assert.equal(row.dishId,'known-oats');
});

test('catalog settings and diary links survive version-one backup while old files remain valid',()=>{
 const {catalog,backup}=api(),s=state();catalog.init(s);
 const row=entry('one');s.log['2026-11-20'].push(row);const food=catalog.record(s,row,{alias:'Овсянка утром'});
 Object.assign(food,{custom:true,pinned:true,hidden:false,g:250,meals:['b','l']});
 s.dc.oats={n:food.n,g:250,k:food.k,p:food.p,f:food.f,c:food.c,dishId:food.id};
 const restored=backup.parse(backup.stringify(s));
 assert.deepEqual(copy(restored.foods),copy(s.foods));assert.equal(restored.log['2026-11-20'][0].dishId,food.id);assert.equal(restored.dc.oats.dishId,food.id);
 const old=state();old.foods=[{n:'Рис',d:'',k:130,p:3,f:0.3,c:28}];assert.equal(backup.parse(backup.stringify(old)).foods[0].n,'Рис');
 for(const field of [{meals:['other']},{id:'bad id'},{pinned:'yes'},{aliases:[123]}]){
  const invalid=copy(s);Object.assign(invalid.foods[0],field);assert.throws(()=>backup.parse(backup.stringify(invalid)));
 }
});
