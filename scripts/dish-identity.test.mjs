import test from 'node:test';
import assert from 'node:assert/strict';
import {foodRequest} from '../worker/food.js';
import {foodText} from '../worker/ai-errors.js';
import {responseSchema} from '../worker/ai-schema.js';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';

const knownDishes=[
  {id:'dish-oats-milk',n:'Овсянка на молоке',aliases:['Каша овсяная с молоком','Овсяная молочная каша']},
  {id:'dish-oats-water',n:'Овсянка на воде',aliases:[]},
  {id:'dish-curd-1',n:'Творог 1%',aliases:['Творог однопроцентный']},
  {id:'dish-curd-5',n:'Творог 5%',aliases:[]}
];
const input={mode:'dish',text:'Съел молочную овсяную кашу, 200 г',knownDishes};
const estimate={reply:'Записал кашу',actions:[{op:'add',foodId:'dish-oats-milk',name:'Овсянка на молоке',grams:200,kcal100:100,protein100:3,fat100:4,carbs100:14}]};
const candidate=value=>({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(value)}]}}]});
const currentText=body=>body.contents.at(-1).parts.at(-1).text;
function catalogFrom(body){
  const text=currentText(body);
  const marker='МОИ БЛЮДА (id, название и варианты формулировок):\n';
  return JSON.parse(text.slice(text.indexOf(marker)+marker.length,text.indexOf('\n\nТЕКУЩЕЕ СООБЩЕНИЕ:')));
}

test('food identity context carries saved IDs and aliases while preserving the new description and portion',()=>{
  const request=foodRequest(input);
  assert.deepEqual(catalogFrom(request),knownDishes);
  assert.ok(currentText(request).endsWith('ТЕКУЩЕЕ СООБЩЕНИЕ: '+input.text));
  const instructions=request.systemInstruction.parts[0].text;
  assert.match(instructions,/словоформы.*опечатки/);
  assert.match(instructions,/foodId.*id из списка/);
  assert.match(instructions,/творог 1% и 5%/);
  assert.match(instructions,/способ приготовления, марку и жирность/);
  assert.match(instructions,/при сомнении пропусти foodId/);
});

test('long diary context cannot truncate the separate saved-dish identities',()=>{
  const request=foodRequest({...input,context:'x'.repeat(5000)});
  assert.equal(currentText(request).match(/x+/)[0].length,3500);
  assert.deepEqual(catalogFrom(request),knownDishes);
});

test('legacy clients and malformed catalog values keep normal food calculation available',()=>{
  for(const value of [undefined,null,42,'not a list',{},[]]){
    const request=foodRequest({...input,knownDishes:value});
    assert.doesNotMatch(currentText(request),/МОИ БЛЮДА/);
    assert.match(currentText(request),/200 г/);
  }
  const request=foodRequest({...input,knownDishes:[null,{}, {id:'bad/id',n:'Каша'}, {id:'x'.repeat(101),n:'Каша'}, {id:'empty',n:' '}, {id:7,n:'Каша'}, ...knownDishes, {id:'dish-oats-milk',n:'Duplicate'}]});
  assert.deepEqual(catalogFrom(request),knownDishes);
});

test('catalog metadata has bounded item, name and alias sizes and remains quoted data',()=>{
  const dishes=Array.from({length:120},(_,index)=>({id:'dish-'+index,n:'К'.repeat(100),aliases:[null,42,'А'.repeat(120),'Б'.repeat(120),'В'.repeat(120),'Г'.repeat(120)]}));
  const catalog=catalogFrom(foodRequest({...input,knownDishes:dishes}));
  assert.equal(catalog.length,100);
  assert.ok(catalog.every(dish=>dish.n.length===60&&dish.aliases.length===3&&dish.aliases.every(alias=>alias.length===80)));
  const unusual={id:'quoted',n:'Каша "утренняя"',aliases:['Каша\nс молоком']};
  assert.deepEqual(catalogFrom(foodRequest({...input,knownDishes:[unusual]})),[unusual]);
});

test('optional identity does not relax the required nutrition fields or alter edit/delete schemas',()=>{
  const schemas=responseSchema('dish').properties.actions.items.anyOf;
  const add=schemas.find(schema=>schema.properties.op.enum[0]==='add');
  assert.equal(add.properties.foodId.type,'string');
  assert.equal(add.required.includes('foodId'),false);
  assert.deepEqual(add.required,['op','name','grams','kcal100','protein100','fat100','carbs100']);
  assert.ok(schemas.filter(schema=>schema!==add).every(schema=>!schema.properties.foodId));
});

test('food identity accepts known-shaped strings and legacy omission while rejecting malformed output IDs',()=>{
  for(const value of ['dish-oats-milk','',undefined,'another-valid-id']){
    const action={...estimate.actions[0]};
    if(value===undefined)delete action.foodId;else action.foodId=value;
    assert.deepEqual(JSON.parse(foodText(candidate({...estimate,actions:[action]}))).actions[0],action);
  }
  for(const value of [null,42,false,{},'bad/id','bad id','x'.repeat(101)]){
    assert.throws(()=>foodText(candidate({...estimate,actions:[{...estimate.actions[0],foodId:value}]})),error=>error.message==='invalid_response'&&error.retryable===true);
  }
});

test('saved dish identity accompanies a photo without replacing or duplicating the image',()=>{
  const image=Buffer.from('photo-fixture').toString('base64');
  const request=foodRequest({...input,mode:'photo',image,text:'200 г овсянки'});
  const pictures=request.contents.flatMap(message=>message.parts.filter(part=>part.inlineData));
  assert.equal(pictures.length,1);
  assert.equal(pictures[0].inlineData.data,image);
  assert.deepEqual(catalogFrom(request),knownDishes);
});

test('the authenticated diary API forwards identities and returns foodId with a complete estimate',async t=>{
  let sent;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    sent=JSON.parse(options.body);
    return Response.json(candidate(estimate));
  });
  const request=new Request('https://fixture.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload(input))});
  const response=await worker.fetch(request,{...telegramEnvFixture,MODEL:'gemini-3.5-flash-lite',GEMINI_KEY:'fixture-only'});
  assert.equal(response.status,200);
  assert.deepEqual(catalogFrom(sent),knownDishes);
  assert.deepEqual(JSON.parse((await response.json()).text),estimate);
});
