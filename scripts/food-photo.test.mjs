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

function setup(initial={}) {
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
