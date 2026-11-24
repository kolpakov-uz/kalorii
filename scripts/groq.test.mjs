import test from 'node:test';
import assert from 'node:assert/strict';
import {groqContent,groqMessages,withReserve} from '../worker/groq.js';
import {foodRequest} from '../worker/food.js';
const body={systemInstruction:{parts:[{text:'JSON'}]},contents:[{role:'user',parts:[{text:'Банан 100 г'}]}]};
const food={actions:[{op:'add',name:'Банан',grams:100,kcal100:97,protein100:.74,fat100:.29,carbs100:23}],reply:'Добавлено'};
test('Groq preserves isolated roles and photo data without putting credentials into payload',()=>{
 const messages=groqMessages({...body,contents:[{role:'model',parts:[{text:'old'}]},{role:'user',parts:[{text:'50 г'},{inlineData:{mimeType:'image/jpeg',data:'aW1n'}}]}]});
 assert.equal(messages[1].role,'assistant');assert.equal(messages[2].content[1].image_url.url,'data:image/jpeg;base64,aW1n');
});
test('missing key and audio use only the existing provider',async()=>{
 let calls=0;const primary=async()=>{calls++;return Response.json({ok:true})};await withReserve({},body,'dish',primary);await withReserve({GROQ_API_KEY:'fixture'},body,'transcribe',primary);assert.equal(calls,2);
});
test('reserve starts immediately after a primary failure and accepts only complete food actions',async()=>{
 const original=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return Response.json({choices:[{message:{content:JSON.stringify(food)}}]})};
 try{const result=await withReserve({GROQ_API_KEY:'fixture'},body,'dish',async()=>new Response('',{status:503}));assert.equal(result.status,200);assert.equal(sent.model,'openai/gpt-oss-20b');assert.equal(sent.response_format.type,'json_object');const data=await result.json();assert.equal(JSON.parse(data.candidates[0].content.parts[0].text).actions.length,1);
  globalThis.fetch=async()=>Response.json({choices:[{message:{content:'{"actions":[{"op":"add","name":"x"}]}'}}]});assert.equal(await groqContent({GROQ_API_KEY:'fixture'},body,'dish'),null);
 }finally{globalThis.fetch=original}
});
test('a reserve winner aborts the slow primary and returns a single result',async()=>{
 const original=globalThis.fetch;let cancelled=false;
 globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify(food)}}]});
 try{const result=await withReserve({GROQ_API_KEY:'fixture'},body,'dish',signal=>new Promise(resolve=>signal.addEventListener('abort',()=>{cancelled=true;resolve(new Response('',{status:503}))})));assert.equal(result.status,200);assert.equal(cancelled,true)}finally{globalThis.fetch=original}
});
const vision={GROQ_API_KEY:'fixture',GROQ_VISION_MODEL:'qwen/qwen3.8-27b'};
const photo=()=>foodRequest({mode:'photo',image:'aW1n',text:'425 г на всей тарелке'});
test('photo reserve uses vision in non-thinking JSON mode and retains the full caption and image',async()=>{
 const original=globalThis.fetch;let sent;
 globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(food)}}]})};
 try{const input=photo(),before=JSON.stringify(input),result=await groqContent(vision,input,'photo');assert.equal(result.status,200);assert.equal(sent.model,vision.GROQ_VISION_MODEL);assert.equal(sent.reasoning_effort,'none');assert.equal(sent.response_format.type,'json_object');const user=sent.messages.at(-1);assert.ok(user.content.some(p=>p.image_url?.url==='data:image/jpeg;base64,aW1n'));assert.ok(user.content.some(p=>p.text?.includes('425 г на всей тарелке')));assert.equal(JSON.stringify(input),before);assert.ok(sent.messages[0].content.length<input.systemInstruction.parts[0].text.length)}finally{globalThis.fetch=original}
});
test('a text clarification carrying the previous image uses vision and preserves edit target IDs',async()=>{
 const original=globalThis.fetch;let sent;
 const edit={actions:[{op:'edit',id:'own-food',grams:425}],reply:'Уточнена порция'};
 globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(edit)}}]})};
 try{const input=foodRequest({mode:'dish',text:'На самом деле 425 г',history:[{role:'user',text:'Мой обед',image:'aW1n'},{role:'model',text:'Запись выполнена: [{"id":"own-food","n":"Паста"}]'}]});const result=await groqContent(vision,input,'dish');assert.equal(result.status,200);assert.equal(sent.model,vision.GROQ_VISION_MODEL);assert.equal(sent.messages.filter(m=>Array.isArray(m.content)&&m.content.some(p=>p.image_url)).length,1);assert.ok(sent.messages.some(m=>typeof m.content==='string'&&m.content.includes('own-food')));assert.match(sent.messages.at(-1).content,/425/);const output=await result.json();assert.equal(JSON.parse(output.candidates[0].content.parts[0].text).actions[0].op,'edit')}finally{globalThis.fetch=original}
});
test('the photo reserve starts with no 700ms text delay and cancels an unfinished primary',async()=>{
 const original=globalThis.fetch,timeout=globalThis.setTimeout,clear=globalThis.clearTimeout,delays=[];let cancelled=false;
 globalThis.fetch=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(food)}}]});
 globalThis.setTimeout=(fn,delay)=>{delays.push(delay);if(delay===0)queueMicrotask(fn);return 1};globalThis.clearTimeout=()=>{};
 try{const result=await withReserve(vision,photo(),'photo',signal=>new Promise(resolve=>signal.addEventListener('abort',()=>{cancelled=true;resolve(new Response('',{status:503}))})));assert.equal(result.status,200);assert.ok(delays.includes(0));assert.equal(delays.includes(700),false);assert.equal(cancelled,true)}finally{globalThis.fetch=original;globalThis.setTimeout=timeout;globalThis.clearTimeout=clear}
});
test('vision disabled never sends an image to the text-only reserve and truncated vision output cannot win',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return Response.json({choices:[{finish_reason:'length',message:{content:JSON.stringify(food)}}]})};
 try{assert.equal(await groqContent({GROQ_API_KEY:'fixture'},photo(),'photo'),null);assert.equal(calls,0);assert.equal(await groqContent(vision,photo(),'photo'),null);assert.equal(calls,1)}finally{globalThis.fetch=original}
});
test('a failed vision request leaves a valid primary answer available',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:503});
 try{const primary=Response.json({validPrimary:true});const result=await withReserve({...vision,GROQ_VISION_MODEL:'fixture-vision-outage'},photo(),'photo',async()=>{await new Promise(resolve=>setTimeout(resolve,5));return primary});assert.equal(result,primary)}finally{globalThis.fetch=original}
});
