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
  let response=estimate;
  const context=vm.createContext({
    S:state,R:Math.round,VOICE:null,cur:()=>date,today:()=>date,
    items:day=>state.log[day]||[],$:selector=>fields[selector],
    MEALS:[['b','Завтрак'],['l','Обед'],['d','Ужин'],['s','Перекус']],
    save(){},render(){},saveFood(){},kbFlush(){},kbSync(){},toast(){},esc:value=>value,
    hasAPI:()=>true,allFoods:()=>[],setTimeout:callback=>{callback();return 1},
    callAPI:async request=>{requests.push(JSON.parse(JSON.stringify(request)));return JSON.stringify(response)}
  });
  vm.runInContext(source,context);
  const run=code=>vm.runInContext(code,context);
  run(`thumb=async()=>${JSON.stringify('data:image/jpeg;base64,'+thumbnail)};shrink=async()=>${JSON.stringify(fullImage)};am=()=>({innerHTML:'',textContent:''});think=()=>()=>{}`);
  return {
    state,requests,run,context,
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
