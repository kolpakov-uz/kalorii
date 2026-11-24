import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {foodRequest} from '../worker/food.js';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';

const fullImage=Buffer.from('full-resolution-photo-fixture').toString('base64');
const thumbnail=Buffer.from('saved-thumbnail-fixture').toString('base64');
const estimate={actions:[{op:'add',name:'Вафли с начинкой',grams:50,kcal100:460,protein100:6,fat100:22,carbs100:60}],reply:'КБЖУ оценены по фото'};
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf("let meal='b';"),html.indexOf('function openAdd('));
const date='2026-11-11';

function setup(initial={},nutrition=false) {
  const state={log:{},hist:{},foods:[],dc:{},...initial};
  const fields={
    '#ai':{textContent:'',innerHTML:'',dataset:{},focus(){},closest(){return {querySelector(){return {disabled:false}}}}},
    '#pv':{innerHTML:''},'#am':{scrollTop:0},'#mn':{hidden:true}
  };
  const requests=[];
  const bubbles=[];
  const snapshots=[],progress=[];
  let response=estimate;
  const context=vm.createContext({
    S:state,R:Math.round,VOICE:null,cur:()=>date,today:()=>date,
    items:day=>state.log[day]||[],$:selector=>fields[selector],
    MEALS:[['b','Завтрак'],['l','Обед'],['d','Ужин'],['s','Перекус']],
    save(){snapshots.push(JSON.parse(JSON.stringify(state)))},render(){},saveFood(){},kbFlush(){},kbSync(){},toast(){},esc:value=>value,
    hasAPI:()=>true,allFoods:()=>[],AbortController,clearTimeout(){},setTimeout:(callback,delay)=>{if(delay!==45000)callback();return 1},
    document:{getElementById:id=>bubbles.find(bubble=>bubble.id===id)||null},
    callAPI:async(request,options)=>{requests.push(JSON.parse(JSON.stringify(request)));const next=typeof response==='function'?await response(request,options,requests.length):response;if(next instanceof Error)throw next;return typeof next==='string'?next:JSON.stringify(next)}
  });
  vm.runInContext(fs.readFileSync(new URL('../food-request.js',import.meta.url),'utf8'),context);
  vm.runInContext(fs.readFileSync(new URL('../food-tasks.js',import.meta.url),'utf8'),context);
  vm.runInContext(fs.readFileSync(new URL('../dish-catalog.js',import.meta.url),'utf8'),context);
  if(nutrition){vm.runInContext(fs.readFileSync(new URL('../nutrition.js',import.meta.url),'utf8'),context);context.NutritionUI={schedule(){},cancel(){},requestChoice(){return false}};}
  vm.runInContext(html.slice(html.indexOf('function saveFood('),html.indexOf('\nlet UNDO=',html.indexOf('function saveFood('))),context);
  context.testBubble=()=>{let markup='';const bubble={textContent:'',get innerHTML(){return markup},set innerHTML(value){markup=value;progress.push(value)}};bubbles.push(bubble);return bubble};
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run(`thumb=async()=>${JSON.stringify('data:image/jpeg;base64,'+thumbnail)};shrink=async()=>${JSON.stringify(fullImage)};am=testBubble;think=()=>()=>{}`);
  return {
    state,requests,run,context,snapshots,progress,
    reply(value){response=value},
    async send(text,photo=false){fields['#ai'].textContent=text;context.file=photo?{name:'waffle.jpg'}:null;run('AF=file');await run('sendFood()')},
    entries:()=>state.log[date]||[]
  };
}
const pictures=body=>body.contents.flatMap(turn=>turn.parts.filter(part=>part.inlineData).map(part=>part.inlineData));
test('an exact product uses the nutrition database without AI and keeps its original per-100 values',async()=>{
 const x=setup({},true);x.run("Nutrition.remember(S,{n:'Банан',k:97,p:.74,f:.29,c:23},'', 'estimate')");
 const checked=x.state.nutrition.rows[0].checkedAt;
 await x.send('Банан 33 г');await x.send('Банан 200 г');
 assert.equal(x.requests.length,0);assert.equal(x.entries()[0].k,32);assert.equal(x.entries()[1].k,194);
 assert.equal(x.entries()[0].per100.k,97);assert.equal(x.state.nutrition.rows[0].checkedAt,checked);
});
test('new AI results populate the private database immediately and future portions bypass AI',async()=>{
 const x=setup({},true);x.reply({actions:[{op:'add',name:'Сюзьма 5%',grams:200,kcal100:111,protein100:10.7,fat100:5,carbs100:5.8}],reply:'Примерная оценка'});
 await x.send('Сюзьма 5% 200 г');assert.equal(x.requests.length,1);
 assert.equal(x.state.nutrition.rows[0].p,10.7);
 await x.send('Сюзьма 5% 50 г');assert.equal(x.requests.length,1);assert.equal(x.entries()[1].k,56);
});
test('explicit per-100 correction updates future portions while changing only weight leaves the base unchanged',async()=>{
 const x=setup({},true);x.reply({actions:[{op:'add',name:'Сюзьма 5%',grams:200,kcal100:111,protein100:10.7,fat100:5,carbs100:5.8}],reply:'Оценка'});
 await x.send('Сюзьма 5% 200 г');const id=x.entries()[0].id;
 x.reply({actions:[{op:'edit',id,kcal100:123,protein100:12,fat100:5,carbs100:6}],reply:'Исправлено'});
 await x.send('Исправь: на 100 г 123 ккал, белки 12, жиры 5, углеводы 6');
 assert.equal(x.state.nutrition.rows.find(r=>r.n==='Сюзьма 5%').origin,'manual');
 await x.send('50 г');assert.equal(x.entries()[0].per100.k,123);
 await x.send('Сюзьма 5% 100 г');assert.equal(x.entries().at(-1).k,123);assert.equal(x.requests.length,2);
});
async function until(predicate){for(let i=0;i<40&&!predicate();i++)await Promise.resolve();assert.ok(predicate(),'expected asynchronous task state')}

test('independent meals calculate concurrently, retain separate context and save out-of-order answers to their own messages',async()=>{
 const x=setup(),pending=new Map();
 x.reply(request=>new Promise(resolve=>pending.set(request.text,resolve)));
 const first=x.send('Вафли 50 г',true);await until(()=>x.requests.length===1);
 const second=x.send('Банан 100 г');await until(()=>x.requests.length===2);
 const third=x.send('Рис 200 г');await until(()=>x.run('foodJobs.size')===3);
 assert.equal(x.requests.length,2);assert.ok(x.progress.some(markup=>markup.includes('В очереди')));
 assert.deepEqual(x.requests.map(request=>request.history),[[],[]]);assert.equal(x.requests[1].mode,'dish');
 assert.notEqual(x.requests[0].requestId,x.requests[1].requestId);
 const make=(name,grams)=>({reply:'Добавлено',actions:[{...estimate.actions[0],name,grams}]});
 pending.get('Банан 100 г')(make('Банан',100));await second;await until(()=>x.requests.length===3);
 pending.get('Рис 200 г')(make('Рис',200));await third;
 pending.get('Вафли 50 г')(make('Вафли',50));await first;
 assert.deepEqual(x.entries().map(entry=>entry.n),['Банан','Рис','Вафли']);
 for(const request of x.requests){
  const history=x.state.hist[date+'|b'],source=history.find(message=>message.task===request.requestId&&message.r==='me'),notice=history.find(message=>message.task===request.requestId&&message.r==='ai');
  assert.ok(source&&notice);assert.equal(source.thread,notice.thread);assert.equal(notice.ids.length,1);
 }
 assert.deepEqual(x.requests[2].history,[]);assert.doesNotMatch(x.requests[2].context,/Вафли, 50 г|Банан, 100 г/);
});

test('an unrelated new dish after a photo receives neither the photo nor the previous entry ID',async()=>{
 const x=setup();await x.send('Вафли 50 г',true);const old=x.entries()[0];
 x.reply({reply:'Добавлено',actions:[{...estimate.actions[0],name:'Рис',grams:200}]});await x.send('Рис 200 г');
 const next=x.requests[1];assert.deepEqual(next.history,[]);assert.equal(pictures(foodRequest(next)).length,0);assert.ok(!next.context.includes(old.id));assert.equal(x.entries().length,2);
});

test('an explicit clarification targets an older dish without including the newer dish or its photo',async()=>{
 const x=setup();await x.send('Вафли 50 г',true);const first=x.entries()[0],thread=x.state.hist[date+'|b'][0].thread;
 x.reply({reply:'Добавлено',actions:[{...estimate.actions[0],name:'Рис',grams:200}]});await x.send('Рис 200 г');const second=x.entries()[1];
 x.run(`replyFood('${thread}')`);
 x.reply({reply:'Исправлено',actions:[{op:'edit',id:first.id,grams:75}]});await x.send('исправь вес на 75 г');
 const request=x.requests.at(-1);assert.ok(request.context.includes(first.id));assert.ok(!request.context.includes(second.id));assert.equal(request.history.filter(message=>message.image).length,0);assert.ok(request.history.every(message=>!message.text.includes('Рис')));
 assert.equal(x.entries().length,2);assert.equal(first.g,75);assert.equal(second.g,200);
});

test('a clarification waits for its pending parent and sees the saved entry before it edits',async()=>{
 const x=setup();let complete;
 x.reply(()=>new Promise(resolve=>complete=resolve));const first=x.send('Вафли 50 г',true);await until(()=>x.requests.length===1);
 const next=x.send('исправь вес на 75 г');await until(()=>x.run('foodJobs.size')===2);assert.equal(x.requests.length,1);
 x.reply(()=>({reply:'Исправлено',actions:[{op:'edit',id:x.entries()[0].id,grams:75}]}));complete(estimate);
 await first;await next;assert.equal(x.requests.length,2);assert.equal(x.entries().length,1);assert.equal(x.entries()[0].g,75);assert.ok(x.requests[1].history.some(message=>message.role==='model'&&message.text.includes(x.entries()[0].id)));
});

test('a new task cannot edit an unrelated diary entry even if a malformed model reply tries to target it',async()=>{
 const x=setup();await x.send('Вафли 50 г',true);const original={...x.entries()[0]};
 x.reply({reply:'Исправлено',actions:[{op:'edit',id:original.id,grams:999}]});await x.send('Рис 200 г');
 assert.equal(x.entries().length,1);assert.deepEqual({...x.entries()[0]},original);assert.match(x.state.hist[date+'|b'].at(-1).lbl,/^request-/);
});

test('resuming after reload pairs each failed request with its own source instead of the nearest later user message',async()=>{
 const x=setup();x.reply(()=>{throw Object.assign(Error('unavailable'),{kind:'unavailable',retryable:true})});
 await x.send('Вафли 50 г',true);await x.send('Рис 200 г');
 vm.runInContext(fs.readFileSync(new URL('../diary-backup.js',import.meta.url),'utf8'),x.context);
 const state=x.run('DiaryBackup.parse(DiaryBackup.stringify(S))'),y=setup(JSON.parse(JSON.stringify(state)));y.run('loadHist()');
 const notices=y.state.hist[date+'|b'].filter(message=>message.r==='ai');
 y.reply(request=>({reply:'Добавлено',actions:[{...estimate.actions[0],name:request.text.startsWith('Рис')?'Рис':'Вафли',grams:request.text.startsWith('Рис')?200:50}]}));
 await y.run(`retryFood('${notices[1].lbl}')`);await y.run(`retryFood('${notices[0].lbl}')`);
 assert.deepEqual(y.requests.map(request=>request.text),['Рис 200 г','Вафли 50 г']);assert.equal(y.requests[1].image,thumbnail);assert.equal(y.requests[0].image,undefined);assert.equal(y.entries().length,2);
});

test('a successful clarification retires the failed parent retry so it cannot later add the meal twice',async()=>{
 const x=setup();x.reply(()=>{throw Object.assign(Error('unavailable'),{kind:'unavailable',retryable:true})});await x.send('Вафли 50 г',true);
 const parent=x.state.hist[date+'|b'][1],id=parent.lbl;x.reply(estimate);await x.send('попробуй ещё раз');
 assert.equal(x.entries().length,1);assert.equal(x.run(`foodJobs.has('${id}')`),false);assert.equal(parent.lbl,'Уточнено');
 const count=x.requests.length;await x.run(`retryFood('${id}')`);assert.equal(x.requests.length,count);assert.equal(x.entries().length,1);
});

test('rolling back one failed batch preserves an independent meal that finished while it was waiting',async()=>{
 const x=setup();let finish;
 x.reply(request=>request.text==='Две порции'?new Promise(resolve=>finish=resolve):{reply:'Добавлено',actions:[{...estimate.actions[0],name:'Банан',grams:100}]});
 const pending=x.send('Две порции');await until(()=>x.requests.length===1);await x.send('Банан 100 г');
 const saved={...x.entries()[0]},saveFood=x.context.saveFood;
 x.context.saveFood=(...args)=>{if(args[0]==='Ошибка порции')throw Error('fixture');return saveFood(...args)};
 finish({reply:'Добавлено',actions:[{...estimate.actions[0],name:'Первая порция'},{...estimate.actions[0],name:'Ошибка порции'}]});await pending;
 assert.equal(x.entries().length,1);assert.deepEqual({...x.entries()[0]},saved);
 const notices=x.state.hist[date+'|b'].filter(message=>message.r==='ai');assert.match(notices[0].t,/запись не сохранилась/);assert.deepEqual([...notices[1].ids],[saved.id]);
});

test('a completed background calculation does not interrupt a new voice recording',async()=>{
 const x=setup();let finish;
 x.reply(()=>new Promise(resolve=>finish=resolve));const pending=x.send('Вафли 50 г');await until(()=>x.requests.length===1);
 x.run('VOICE={phase:"recording"}');x.context.render=()=>{throw Error('render would cancel the microphone')};
 finish(estimate);await pending;assert.equal(x.entries().length,1);assert.equal(x.run('VOICE.phase'),'recording');
});

test('a background food response does not replace an open coach conversation or its draft',async()=>{
 const x=setup();x.context.V='coach';x.context.render=()=>{throw Error('coach DOM must remain intact')};
 await x.send('Вафли 50 г');assert.equal(x.entries().length,1);
 assert.equal(x.state.hist[date+'|b'].at(-1).ids.length,1);
});

test('AI identities count ten differently worded diary entries as one frequent dish across meals',async()=>{
 const x=setup(),names=['Овсянка на молоке','Молочная овсяная каша','Овсяная каша, молочная'];
 for(let i=0;i<10;i++){
  x.run(`meal='${i<5?'b':'l'}'`);
  x.reply(()=>({reply:'КБЖУ оценены',actions:[{op:'add',name:names[i%3],grams:200,kcal100:110,protein100:4,fat100:3,carbs100:16,...(x.state.foods[0]?{foodId:x.state.foods[0].id}:{})}]}));
  await x.send(names[i%3]+' 200 г');
 }
 assert.equal(x.state.foods.filter(dish=>!dish.hidden).length,1);
 assert.equal(new Set(x.entries().map(entry=>entry.dishId)).size,1);
 assert.equal(x.run('DishCatalog.frequent(S,"b")[0].count'),10);
 assert.equal(x.run('DishCatalog.frequent(S,"l")[0].count'),10);
 assert.ok(x.requests.slice(1).some(request=>request.knownDishes.some(dish=>dish.id===x.state.foods[0].id)));
});

test('exact saved recipe names honor manual nutrition and an unknown model ID cannot target another dish',async()=>{
 const x=setup({foods:[{id:'manual',n:'Моя каша',d:'',g:200,k:123,p:5,f:3,c:19,aliases:[],meals:['b'],custom:true,pinned:true}]});
 x.reply({reply:'Добавлено',actions:[{op:'add',name:'Моя каша',grams:200,kcal100:300,protein100:20,fat100:10,carbs100:35,foodId:'unknown'}]});
 await x.send('Моя каша 200 г');
 assert.equal(x.entries()[0].k,246);assert.equal(x.entries()[0].dishId,'manual');
 assert.equal(x.state.foods[0].k,123);
});

test('photo plus 50 grams sends the original image and saves calories and macros for exactly that portion',async()=>{
  const x=setup();
  // An upstream default portion must not override the explicit single-food weight.
  x.reply({...estimate,actions:[{...estimate.actions[0],grams:100}]});
  await x.send('50 гр вафли',true);
  assert.equal(x.requests.length,1);assert.equal(x.requests[0].mode,'photo');assert.equal(x.requests[0].image,fullImage);
  assert.equal(x.entries().length,1);
  const {g,k,p,f,c,m}=x.entries()[0];assert.deepEqual({g,k,p,f,c,m},{g:50,k:230,p:3,f:11,c:30,m:'b'});
  const body=foodRequest(x.requests[0]);assert.equal(pictures(body)[0].data,fullImage);assert.match(body.systemInstruction.parts[0].text,/Никогда не проси пользователя сообщить калории/);assert.match(body.systemInstruction.parts[0].text,/КБЖУ оценены по фото/);
});

test('temporary failure keeps the same photo and meal, shows continued processing and writes exactly once',async()=>{
 const x=setup();x.reply((_request,_options,attempt)=>{
  assert.equal(x.entries().length,0);
  if(attempt<3)throw Object.assign(new Error('unavailable'),{kind:'unavailable',retryable:true});
  return estimate;
 });
 await x.send('50 гр вафли',true);
 assert.equal(x.requests.length,3);assert.deepEqual(x.requests[0],x.requests[1]);assert.deepEqual(x.requests[1],x.requests[2]);
 assert.equal(x.entries().length,1);assert.equal(x.entries()[0].k,230);assert.ok(x.progress.some(markup=>markup.includes('Продолжаю считать…')));
 assert.equal(x.state.hist[date+'|b'].filter(message=>message.r==='me').length,1);
 for(const snapshot of x.snapshots){if(snapshot.log[date]?.length)assert.ok(snapshot.hist[date+'|b'].some(message=>message.ids?.includes(snapshot.log[date][0].id)))}
});

test('two biscuits survive an incomplete primary-model response and reach the diary through one client request',async()=>{
 const x=setup(),original=globalThis.fetch;
 const complete={reply:'КБЖУ оценены',actions:[{op:'add',name:'Печенье с джемом',grams:40,kcal100:380,protein100:5,fat100:11,carbs100:65}]};
 let upstreamCalls=0;
 globalThis.fetch=async()=>{
  const result=++upstreamCalls===1?{reply:'Записал два печенья.',actions:[{op:'add'}]}:complete;
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(result)}]}}]});
 };
 x.reply(async request=>{
  const response=await worker.fetch(new Request('https://fixture.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload(request))}),{...telegramEnvFixture,MODEL:'gemini-4-hydrogen',MODEL_FALLBACKS:'gemini-3.8-flash,gemini-3.5-flash-lite'});
  assert.equal(response.status,200);
  return JSON.parse((await response.json()).text);
 });
 try{
  await x.send('Две печеньки с вишнёвым джемом');
  assert.equal(upstreamCalls,2);
  assert.equal(x.requests.length,1);
  assert.equal(x.entries().length,1);
  assert.equal(x.entries()[0].g,40);
  assert.equal(x.entries()[0].k,152);
  assert.equal(x.state.hist[date+'|b'].filter(message=>message.r==='me').length,1);
 }finally{globalThis.fetch=original}
});

test('an invalid or partial batch is retried before any item is written and allows a larger complete reply',async()=>{
 const x=setup();x.reply((_request,_options,attempt)=>{
  assert.equal(x.entries().length,0);
  if(attempt===1)return '{"actions":[';
  if(attempt===2)return {actions:[estimate.actions[0],{op:'add',name:'Неполный продукт',grams:50}]};
  return estimate;
 });
 await x.send('50 г вафли',true);
 assert.equal(x.requests.length,3);assert.equal(x.requests[1].outputTokens,3200);assert.equal(x.requests[2].outputTokens,6400);assert.equal(x.entries().length,1);
});

test('a persistent outage retains a resumable request and double-tapping continue cannot duplicate it',async()=>{
 const x=setup();x.reply(()=>{throw Object.assign(new Error('unavailable'),{kind:'unavailable',retryable:true})});await x.send('50 г вафли',true);
 const notice=x.state.hist[date+'|b'].at(-1);assert.match(notice.lbl,/^request-/);assert.equal(x.requests.length,3);assert.equal(x.entries().length,0);assert.ok(x.progress.at(-1).includes('Продолжить расчёт'));
 let complete;x.reply(()=>new Promise(resolve=>complete=resolve));
 const pending=x.run(`retryFood('${notice.lbl}')`);await x.run(`retryFood('${notice.lbl}')`);
 assert.equal(x.requests.length,4);complete(estimate);await pending;
 assert.equal(x.entries().length,1);assert.equal(x.requests[3].image,fullImage);assert.equal(x.state.hist[date+'|b'].filter(message=>message.r==='me').length,1);
});

test('saved request can resume after backup and reload with the same photo caption and original day',async()=>{
 const x=setup();x.reply(()=>{throw Object.assign(new Error('unavailable'),{kind:'unavailable',retryable:true})});await x.send('50 г вафли',true);
 vm.runInContext(fs.readFileSync(new URL('../diary-backup.js',import.meta.url),'utf8'),x.context);
 const restored=x.run('DiaryBackup.parse(DiaryBackup.stringify(S))');const y=setup(JSON.parse(JSON.stringify(restored)));
 y.run('loadHist()');const notice=y.state.hist[date+'|b'].at(-1);await y.run(`retryFood('${notice.lbl}')`);
 assert.equal(y.entries().length,1);assert.equal(y.requests[0].text,'50 г вафли');assert.equal(y.requests[0].image,thumbnail);assert.match(y.requests[0].context,/2026-11-11/);
});

test('daily quota pauses immediately with a clear message and keeps the request available',async()=>{
 const x=setup();x.reply(()=>{throw Object.assign(new Error('quota'),{kind:'quota',status:429,retryable:false})});await x.send('50 г вафли',true);
 assert.equal(x.requests.length,1);assert.equal(x.entries().length,0);assert.match(x.state.hist[date+'|b'].at(-1).t,/Лимит ИИ на сегодня исчерпан/);assert.ok(x.progress.at(-1).includes('Продолжить расчёт'));
});

test('an interrupted local batch rolls back completely before a manual retry',async()=>{
 const x=setup();let writes=0;x.context.saveFood=()=>{if(++writes===2)throw Error('fixture failure')};
 x.reply({actions:[estimate.actions[0],{...estimate.actions[0],name:'Другая порция'}]});await x.send('Две вафли',true);
 assert.equal(x.requests.length,1);assert.equal(x.entries().length,0);const notice=x.state.hist[date+'|b'].at(-1);assert.match(notice.t,/запись не сохранилась/);
 await x.run(`retryFood('${notice.lbl}')`);assert.equal(x.entries().length,2);assert.equal(x.requests.length,2);
});

test('an imported invalid retry label is never turned into executable markup',()=>{
 const x=setup({hist:{[date+'|b']:[{r:'me',t:'50 г вафли'},{r:'ai',lbl:'request-x-\'onclick=bad',t:'Запрос сохранён'}]}});
 x.run('loadHist()');assert.equal(x.run('foodJobs.size'),0);
});

test('a generic failure written by the model is retried while a useful clarification is shown',async()=>{
 const x=setup();x.reply((_request,_options,attempt)=>attempt===1?{actions:[],reply:'Не удалось посчитать. Попробуйте позже.'}:estimate);await x.send('50 г вафли',true);
 assert.equal(x.requests.length,2);assert.equal(x.entries().length,1);
 const y=setup();y.reply({actions:[],reply:'Какое блюдо на фото?'});await y.send('50 г',true);assert.equal(y.requests.length,1);assert.equal(y.entries().length,0);assert.equal(y.state.hist[date+'|b'].at(-1).t,'Какое блюдо на фото?');
});

test('retry after a failed recognition retains the full photo and original weight and produces the first entry',async()=>{
  const x=setup();x.reply({actions:[],reply:'Уточните КБЖУ вафли на 100 грамм'});
  await x.send('50 гр вафли',true);assert.equal(x.entries().length,0);
  x.reply(estimate);await x.send('попробуй ещё раз');
  const retry=x.requests[1];assert.equal(retry.mode,'dish');assert.equal(retry.history[0].image,fullImage);assert.equal(retry.history[0].text,'50 гр вафли');assert.equal(x.entries().length,1);
  const body=foodRequest(retry);assert.equal(pictures(body)[0].data,fullImage);assert.equal(body.contents.at(-1).parts.at(-1).text.split('ТЕКУЩЕЕ СООБЩЕНИЕ: ')[1],'попробуй ещё раз');
});

test('a saved photo from the existing diary works after reload and a bare weight cannot edit an unrelated old entry',async()=>{
  const old={id:'other',m:'b',n:'Творог',g:200,k:200,p:30,f:5,c:5};
  const x=setup({log:{[date]:[old]},hist:{[date+'|b']:[{r:'me',t:'Вафля',img:'data:image/jpeg;base64,'+thumbnail},{r:'ai',t:'Не удалось посчитать'}]}});
  await x.send('50 г');assert.equal(x.requests.length,1);assert.equal(x.requests[0].history[0].image,thumbnail);assert.equal(old.g,200);assert.equal(x.entries().at(-1).g,50);
});

test('a re-estimate receives the stored entry ID and an edit changes that entry without adding a duplicate',async()=>{
  const x=setup();await x.send('50 г вафли',true);const id=x.entries()[0].id;
  x.reply({actions:[{op:'edit',id,grams:50,kcal100:440,protein100:6,fat100:20,carbs100:60}],reply:'Уточнил оценку по фото'});
  await x.send('пересчитай по фото');
  assert.match(x.requests[1].history.find(message=>message.role==='model').text,new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(x.entries().length,1);assert.equal(x.entries()[0].id,id);assert.equal(x.entries()[0].k,220);
});
test('changing only weight after a successful photo is local, preserves its image and never adds a second portion',async()=>{
 const x=setup();await x.send('Обед',true);const entry=x.entries()[0],id=entry.id;
 await x.send('425 г');assert.equal(x.requests.length,1);assert.equal(x.entries().length,1);assert.equal(x.entries()[0].id,id);assert.equal(x.entries()[0].g,425);assert.equal(x.state.hist[date+'|b'][0].img,'data:image/jpeg;base64,'+thumbnail);
});
test('a total weight for a multi-product photo never changes only the last component locally',async()=>{
 const x=setup();x.reply({actions:[{...estimate.actions[0],name:'Вафли',grams:30},{...estimate.actions[0],name:'Ягоды',grams:20}],reply:'Оценка по фото'});await x.send('Десерт',true);const [a,b]=x.entries();
 x.reply({actions:[{op:'edit',id:a.id,grams:60},{op:'edit',id:b.id,grams:40}],reply:'Общий вес 100 г'});await x.send('100 г');assert.equal(x.requests.length,2);assert.equal(x.requests[1].history.some(m=>m.image),false);assert.equal(x.entries().reduce((sum,e)=>sum+e.g,0),100);
});
test('a composition correction reuses saved records as text; explicit photo re-estimation sends the image again',async()=>{
 const x=setup();await x.send('Обед',true);const entry=x.entries()[0],thread=x.state.hist[date+'|b'][0].thread;
 x.reply({actions:[{op:'edit',id:entry.id,kcal100:430,protein100:6,fat100:19,carbs100:59}],reply:'Уточнён состав'});
 x.run(`replyFood('${thread}')`);await x.send('Убери сыр из состава');assert.equal(x.requests.length,2);assert.equal(x.requests[1].history.some(m=>m.image),false);assert.ok(x.requests[1].history.some(m=>m.text.includes(entry.id)));
 await x.send('Пересчитай по фото');assert.equal(x.requests.length,3);assert.equal(x.requests[2].history.filter(m=>m.image).length,1);assert.equal(x.entries().length,1);
});

test('multiple foods split the total weight and a fraction is not replaced with the full weight',async()=>{
  const x=setup();x.reply({actions:[{...estimate.actions[0],name:'Вафли',grams:30},{...estimate.actions[0],name:'Ягоды',grams:20}]});
  await x.send('50 г десерта',true);assert.equal(x.entries().reduce((sum,entry)=>sum+entry.g,0),50);
  const y=setup();y.reply({...estimate,actions:[{...estimate.actions[0],grams:25}]});await y.send('съел половину вафли 50 г',true);assert.equal(y.entries()[0].g,25);assert.equal(y.requests[0].portion,.5);
  const z=setup();z.reply({...estimate,actions:[{...estimate.actions[0],name:'Вафли с ягодами',grams:70}]});await z.send('50 г вафли и 20 г ягод',true);assert.equal(z.entries()[0].g,70);
  const perItem=setup();perItem.reply({...estimate,actions:[{...estimate.actions[0],grams:100}]});await perItem.send('Две вафли по 50 г',true);assert.equal(perItem.entries()[0].g,100);
  const volume=setup();volume.reply({...estimate,actions:[{...estimate.actions[0],name:'Масло',grams:45}]});await volume.send('50 мл масла',true);assert.equal(volume.entries()[0].g,45);
});

test('new photos replace the old image, history stays within its meal and normal cached text entries still work',async()=>{
  const x=setup({hist:{[date+'|d']:[{r:'me',t:'Другой приём пищи',img:'data:image/jpeg;base64,'+thumbnail}]},dc:{банан:{n:'Банан',g:100,k:89,p:1,f:0,c:23}}});
  await x.send('100 г банан');assert.equal(x.requests.length,0);assert.equal(x.entries()[0].k,89);
  await x.send('50 г вафли',true);await x.send('Новая вафля 100 г',true);
  const request=x.requests.at(-1);assert.ok(request.history.every(message=>!message.image));assert.equal(pictures(foodRequest(request)).length,1);
  x.run("meal='d'");assert.equal(x.run("foodHistory('2026-11-10','b',false).length"),0);
});

test('legacy total-portion items still scale correctly when the user supplies a photo weight',()=>{
  const x=setup();x.context.legacy={items:[{name:'Вафля',grams:100,kcal:460,protein:6,fat:22,carbs:60}]};
  x.run(`applyDish(legacy,'${date}','b','50 г','',50)`);assert.equal(x.entries()[0].k,230);assert.equal(x.entries()[0].g,50);
});

test('food requests retain just one recent image and no longer duplicate the current message in history',async()=>{
  const x=setup();await x.send('50 г вафли',true);assert.deepEqual(x.requests[0].history,[]);
  const body=foodRequest({mode:'dish',text:'посчитай сам',history:[{role:'user',text:'первое фото',image:thumbnail},{role:'model',text:'вопрос'},{role:'user',text:'последнее фото',image:fullImage}]});
  assert.equal(pictures(body).length,1);assert.equal(pictures(body)[0].data,fullImage);
  const png=foodRequest({mode:'dish',text:'50 г',history:[{role:'user',image:thumbnail,mimeType:'image/png'}]});assert.equal(pictures(png)[0].mimeType,'image/png');
  assert.equal(pictures(foodRequest({mode:'dish',text:'100 г риса'})).length,0);
});

test('invalid photo data is rejected before contacting Gemini',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected upstream')};
  try{
    for(const image of ['',42,'not base64 <img>','a'.repeat(1600001)]){
      const request=new Request('https://fixture.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload({mode:'photo',text:'50 г',image}))});
      const response=await worker.fetch(request,telegramEnvFixture);assert.ok([400,413].includes(response.status));
    }
    assert.equal(calls,0);
  }finally{globalThis.fetch=original}
});

test('an authenticated photo follow-up reaches the configured Gemini model with image, caption and estimation rules',async()=>{
  const original=globalThis.fetch;let sent,target;
  globalThis.fetch=async(url,options)=>{target=url;sent=JSON.parse(options.body);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(estimate)}]}}]})};
  try{
    const request=new Request('https://fixture.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload({mode:'dish',text:'попробуй ещё раз',history:[{role:'user',text:'50 гр вафли',image:fullImage}]}))});
    const response=await worker.fetch(request,{...telegramEnvFixture,MODEL:'gemini-3.5-flash-lite',GEMINI_KEY:'fixture-only'});
    assert.equal(response.status,200);assert.match(target,/gemini-3\.5-flash-lite:generateContent$/);assert.equal(pictures(sent)[0].data,fullImage);assert.equal(sent.contents[0].parts[1].text,'50 гр вафли');assert.deepEqual(JSON.parse((await response.json()).text),estimate);
  }finally{globalThis.fetch=original}
});
