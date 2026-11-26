import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {aiFailure,foodText} from '../worker/ai-errors.js';
import {foodRequest} from '../worker/food.js';

test('partial label facts and estimated macros remain distinct in the API answer',()=>{
 const action={op:'add',name:'Кремчиз с трюфелем',grams:40,kcal100:930,protein100:6,fat100:65,carbs100:1.1,label:{basisGrams:100,energy:930,energyUnit:'kJ',printedKcal:230,protein:5.8,fat:22.5}};
 const response=JSON.parse(foodText({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({actions:[action],reply:'Всё с этикетки'})}]}}]}));
 assert.equal(response.actions[0].kcal100,230);assert.equal(response.actions[0].carbs100,1.1);assert.equal(Object.hasOwn(response.actions[0].label,'carbs'),false);assert.match(response.reply,/углеводы.*приблизительная оценка/i);assert.doesNotMatch(response.reply,/Всё с этикетки/);
});

function setup(){
 let id=0,now=0;const timeouts=new Map(),delays=[];
 const context=vm.createContext({AbortController,DOMException,Date:{now:()=>now},setTimeout(callback,delay){const token=++id;if(delay===45000)timeouts.set(token,callback);else{delays.push(delay);queueMicrotask(callback)}return token},clearTimeout:token=>timeouts.delete(token)});
 vm.runInContext(fs.readFileSync(new URL('../food-request.js',import.meta.url),'utf8'),context);
 return {client:vm.runInContext('FoodRequest',context),timeouts,delays,advance:milliseconds=>now+=milliseconds};
}

test('temporary errors use bounded backoff, respect the server delay and release all timeouts',async()=>{
 const x=setup();let calls=0;const progress=[];
 const value=await x.client.run(async()=>{
  if(++calls<3)throw x.client.failure({status:503},{error:'unavailable',retryable:true,retryAfter:5});
  return '{"actions":[]}';
 },JSON.parse,status=>progress.push(status));
 assert.equal(calls,3);assert.equal(value.actions.length,0);assert.ok(x.delays[0]>=5000);assert.ok(x.delays[1]>=6000);assert.equal(x.timeouts.size,0);assert.ok(progress.includes('Продолжаю считать…'));
});

test('a timed out request is aborted and the next successful response is returned',async()=>{
 const x=setup();let calls=0,firstSignal;
 const pending=x.client.run(signal=>{
  if(++calls===1){firstSignal=signal;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))))}
  return Promise.resolve('ready');
 },value=>value);
 x.timeouts.values().next().value();assert.equal(await pending,'ready');assert.equal(firstSignal.aborted,true);assert.equal(calls,2);assert.equal(x.timeouts.size,0);
});

test('permanent failures and long retry intervals stop automatic attempts while retaining a useful cause',async()=>{
 for(const [status,data] of [[429,{error:'quota',retryable:false}],[502,{error:'ai_access',retryable:false}],[401,{error:'telegram_auth_expired'}],[413,{error:'too_big'}],[429,{error:'rate',retryable:true,retryAfter:120}]]){
  const x=setup();let calls=0;const error=x.client.failure({status},data);
  await assert.rejects(x.client.run(async()=>{calls++;throw error},value=>value));assert.equal(calls,1);assert.equal(x.delays.length,0);assert.equal(x.timeouts.size,0);assert.ok(x.client.message(error).length>20);
 }
});

test('daily Gemini quotas are distinguished from temporary rate limits without exposing upstream details',async()=>{
 const quota=await aiFailure(Response.json({error:{message:'private detail',details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}},{status:429}));
 assert.deepEqual(quota,{status:429,data:{error:'quota',retryable:false}});
 const rate=await aiFailure(Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'8s'}]}},{status:429,headers:{'Retry-After':'12'}}));
 assert.deepEqual(rate,{status:429,data:{error:'rate',retryable:true,retryAfter:12}});
 for(const status of [400,401,402,403,404,500,503,504]){
  const result=await aiFailure(Response.json({error:{message:'private detail'}},{status}));assert.equal(result.data.retryable,status>=500);assert.doesNotMatch(JSON.stringify(result),/private detail/);
 }
});

test('empty, truncated and blocked replies receive different retry decisions and thinking text is excluded',()=>{
 const reply=(text,finishReason='STOP')=>({candidates:[{finishReason,content:{parts:[{text:'private thinking',thought:true},{text}]}}]});
 assert.equal(foodText(reply('{"actions":[],"reply":"Уточните название блюда."}')),'{"actions":[],"reply":"Уточните название блюда."}');
 for(const data of [reply('', 'STOP'),reply('{"actions":[','MAX_TOKENS'),{}])assert.throws(()=>foodText(data),error=>error.message==='invalid_response'&&error.retryable===true);
 assert.throws(()=>foodText(reply('', 'SAFETY')),error=>error.message==='ai_blocked'&&error.retryable===false);
 assert.equal(foodRequest({mode:'dish',text:'рис',outputTokens:3200}).generationConfig.maxOutputTokens,3200);
 assert.equal(foodRequest({mode:'dish',text:'рис',outputTokens:6400}).generationConfig.maxOutputTokens,6400);
 assert.equal(foodRequest({mode:'dish',text:'рис',outputTokens:999999}).generationConfig.maxOutputTokens,1600);
});

test('a slow failed calculation cannot restart a new full waiting period after 45 seconds',async()=>{
 const x=setup();let calls=0;
 await assert.rejects(x.client.run(async()=>{
  calls++;x.advance(44000);
  throw x.client.failure({status:503},{error:'unavailable',retryable:true});
 },value=>value));
 assert.equal(calls,1);assert.equal(x.delays.length,0);assert.equal(x.timeouts.size,0);
});

test('food replies require usable nutrition while retaining legacy totals, edits and useful questions',()=>{
 const reply=value=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
 for(const value of [
  {reply:'Записал.',actions:[{op:'add'}]},
  {actions:[{op:'add',name:'Печенье',grams:40,kcal100:380}]},
  {actions:[{op:'edit',id:'entry-1'}]},
  {actions:[],reply:'Не удалось подсчитать, попробуйте позже.'},
  {actions:[{op:'add',name:'Печенье',grams:-40,kcal100:380,protein100:5,fat100:11,carbs100:65}]}
 ])assert.throws(()=>foodText(reply(value)),error=>error.message==='invalid_response'&&error.retryable===true);
 for(const value of [
  {items:[{name:'Печенье',grams:40,kcal:152,protein:2,fat:4.4,carbs:26}]},
  {actions:[{type:'add_food',name:'Печенье',grams:40,kcal:152,protein:2,fat:4.4,carbs:26}]},
  {actions:[{op:'edit',id:'entry-1',grams:80}]},
  {actions:[{op:'delete',id:'entry-1'}]},
  {actions:[],reply:'Какой соус был в блюде?'}
 ])assert.equal(typeof foodText(reply(value)),'string');
});
