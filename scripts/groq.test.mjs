import test from 'node:test';
import assert from 'node:assert/strict';
import {groqContent,groqMessages,withReserve} from '../worker/groq.js';
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
