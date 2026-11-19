import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {coachText} from '../worker/ai-errors.js';
import {responseSchema} from '../worker/ai-schema.js';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('let UNDO=null;'),html.indexOf('/* ---- прогресс ---- */'));
const text='В среду я провел силовую тренировку. Силовая тренировка была 1,5 часа и кардио 10 минут. Запиши это в мои тренировки.';
const result={reply:'Записал силовую на 90 минут и кардио на 10 минут за среду.',actions:[
  {type:'add_workout',kinds:['strength'],minutes:90,date:'2026-11-18'},
  {type:'add_workout',kinds:['cardio'],minutes:10,date:'2026-11-18'}
]};
const candidate=value=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
class FixedDate extends Date {
  constructor(...args){super(...(args.length?args:['2026-11-20T00:52:00+05:00']))}
  static now(){return Date.parse('2026-11-20T00:52:00+05:00')}
}

function setup(){
  const progress=[],requests=[],snapshots=[];
  function element(){
    let markup='';
    return {textContent:'',children:[],get innerHTML(){return markup},set innerHTML(value){markup=value;progress.push(value)},append(...children){this.children.push(...children)},after(){},focus(){},remove(){}};
  }
  const input=element(),chat=element();
  const state={profile:null,chat:[],log:{},wk:[],wkGoal:3,wkPlanMinutes:45,water:{},weights:[],meas:[],foods:[],hist:{},dc:{},custom:null,goal:null,coachMode:'strict',rem:{on:{},t:{},fired:{}}};
  let respond=()=>JSON.stringify(result);
  const context=vm.createContext({
    S:state,VOICE:null,Date:FixedDate,AbortController,DOMException,
    $:selector=>selector==='#ci'?input:chat,
    document:{createElement:element,querySelectorAll:()=>[]},
    today:()=> '2026-11-20',cur:()=> '2026-11-20',R:Math.round,
    items:day=>state.log[day]||[],WK:{str:['Силовая'],abs:['Пресс'],cardio:['Кардио']},
    ctx:()=> 'Сегодня 2026-11-20 (пятница). На экране открыт день 2026-11-20.',
    hasAPI:()=>true,kbFlush(){},kbSync(){},sbtn(){},toBot(){},toast(){},
    val:field=>field.textContent,esc:value=>value,bub:(_role,value)=>Object.assign(element(),{textContent:value}),
    save(){snapshots.push(JSON.parse(JSON.stringify(state)))},
    setTimeout(callback,delay){if(delay!==45000)queueMicrotask(callback);return 1},clearTimeout(){},
    callAPI:async(payload,options)=>{requests.push(JSON.parse(JSON.stringify(payload)));return respond(payload,options,requests.length)}
  });
  vm.runInContext(fs.readFileSync(new URL('../food-request.js',import.meta.url),'utf8'),context);
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  return {state,requests,snapshots,progress,context,run,respond:value=>respond=value,send:()=>run(`ask(${JSON.stringify(text)})`),get stored(){return snapshots.at(-1)}};
}

test('coach schemas declare separate action shapes and require complete workout parameters',()=>{
  const schema=responseSchema('chat');
  assert.equal(schema.properties.actions.maxItems,undefined);
  const actions=schema.properties.actions.items.anyOf;
  assert.equal(actions.length,15);
  const workout=actions.find(action=>action.properties.type.enum[0]==='add_workout');
  assert.deepEqual(workout.required,['type','kinds','minutes','date']);
  assert.deepEqual(Object.keys(workout.properties),['type','kinds','minutes','date']);
});

test('coach validates both workouts and rejects incomplete or impossible actions as an entire batch',()=>{
  assert.deepEqual(JSON.parse(coachText(candidate(result))),result);
  for(const action of [
    {type:'add_workout'},
    {...result.actions[0],minutes:0},
    {...result.actions[0],minutes:NaN},
    {...result.actions[0],kinds:[]},
    {...result.actions[0],kinds:['unknown']},
    {...result.actions[0],date:'2026-11-31'},
    {...result.actions[0],date:undefined},
    {...result.actions[0],name:'irrelevant field'}
  ])assert.throws(()=>coachText(candidate({...result,actions:[result.actions[0],action]})),error=>error.message==='invalid_response'&&error.retryable===true);
});

test('all existing coach action types retain their own supported fields',()=>{
  const actions=[
    {type:'add_food',name:'Яблоко',grams:100,kcal:52,protein:0.3,fat:0.2,carbs:14},
    {type:'edit_food',id:'food-1',grams:150},{type:'delete_food',id:'food-1'},
    {type:'move_food',id:'food-1',date:'2026-11-18'},{type:'move_day',from:'2026-11-17',to:'2026-11-18'},
    {type:'set_macros',protein:130,fat:60,carbs:220},{type:'reset_macros'},
    {type:'set_goal',goal:'keep'},{type:'set_reminder',key:'b',on:false},
    {type:'set_water_reminder',on:false,every_hours:2},{type:'add_water',ml:250},
    {type:'add_weight',kg:80},{type:'add_measure',waist:90},{type:'update_goal',target:75},result.actions[0]
  ];
  assert.deepEqual(JSON.parse(coachText(candidate({reply:'Готово',actions}))).actions,actions);
  assert.equal(JSON.parse(coachText(candidate({reply:'План тренировок зависит от вашей цели.',actions:[]}))).actions.length,0);
});

test('the normal chat entry point falls through quota and overload and saves 90 plus 10 minutes on Wednesday',async t=>{
  const x=setup(),models=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const model=new URL(url).pathname.match(/models\/(.*):generateContent$/)[1];models.push(model);
    if(model==='gemini-4-hydrogen')return Response.json({error:{code:'quota_exceeded'}},{status:429});
    if(model==='gemini-3.8-flash')return Response.json({},{status:503});
    return Response.json(candidate(result));
  });
  x.respond(async payload=>{
    const response=await worker.fetch(new Request('https://fixture.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload(payload))}),{...telegramEnvFixture,MODEL:'gemini-4-hydrogen',MODEL_FALLBACKS:'gemini-3.8-flash,gemini-3.5-flash-lite'});
    assert.equal(response.status,200);return (await response.json()).text;
  });
  await x.send();
  assert.deepEqual(models,['gemini-4-hydrogen','gemini-3.8-flash','gemini-3.5-flash-lite']);
  assert.equal(x.requests.length,1);
  assert.deepEqual(x.stored.wk.map(workout=>({d:workout.d,m:workout.m,t:workout.t})),[
    {d:'2026-11-18',m:90,t:['str']},{d:'2026-11-18',m:10,t:['cardio']}
  ]);
  assert.notEqual(x.stored.wk[0].id,x.stored.wk[1].id);
  assert.equal(x.stored.wk.reduce((sum,workout)=>sum+workout.m,0),100);
  vm.runInContext(fs.readFileSync(new URL('../diary-backup.js',import.meta.url),'utf8'),x.context);
  assert.equal(x.run('DiaryBackup.parse(DiaryBackup.stringify(S)).wk.length'),2);
  x.run('undo()');assert.equal(x.state.wk.length,0);
});

test('temporary coach failure retries the same message and applies the final actions once',async()=>{
  const x=setup();
  x.respond((_payload,_options,attempt)=>{
    assert.equal(x.state.wk.length,0);
    if(attempt===1)throw Object.assign(new Error('unavailable'),{retryable:true});
    return JSON.stringify(result);
  });
  await x.send();
  assert.equal(x.requests.length,2);assert.deepEqual(x.requests[0],x.requests[1]);
  assert.equal(x.state.wk.length,2);assert.equal(x.state.chat.filter(message=>message.role==='user').length,1);
  assert.ok(x.progress.some(value=>value.includes('Продолжаю обрабатывать')));
  assert.equal(x.run('ask.b'),0);
});

test('a partial workout batch never changes the diary before a complete reply is obtained',async()=>{
  const x=setup();
  x.respond((_payload,_options,attempt)=>{
    assert.equal(x.state.wk.length,0);
    return JSON.stringify(attempt===1?{...result,actions:[result.actions[0],{type:'add_workout',kinds:['cardio']}]}:result);
  });
  await x.send();assert.equal(x.requests.length,2);assert.equal(x.state.wk.length,2);
  x.context.raw=JSON.stringify({...result,actions:[{...result.actions[0],date:'2026-11-21'}]});
  assert.throws(()=>x.run('coachResponse(raw)'),error=>error.message==='invalid_response');
});

test('double send while a coach reply is pending cannot duplicate the workouts',async()=>{
  const x=setup();let complete;
  x.respond(()=>new Promise(resolve=>complete=resolve));
  const pending=x.send();await x.send();assert.equal(x.requests.length,1);
  complete(JSON.stringify(result));await pending;assert.equal(x.state.wk.length,2);
});

test('an exhausted quota keeps the user message and gives a useful cause without claiming a saved workout',async()=>{
  const x=setup();
  x.respond(()=>{throw Object.assign(new Error('quota'),{kind:'quota',retryable:false})});
  await x.send();
  assert.equal(x.requests.length,1);assert.equal(x.state.wk.length,0);
  assert.equal(x.stored.chat[0].content,text);
  assert.match(x.stored.chat.at(-1).content,/Лимит ИИ на сегодня исчерпан/);
  assert.doesNotMatch(x.stored.chat.at(-1).content,/тренировк.*записан|кнопкой ниже/);
});
