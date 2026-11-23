import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';

const models=['gemini-4-hydrogen','gemini-3.8-flash','gemini-3.5-flash-lite'];
function fixture(id){
 const records=new Map();
 const env={...telegramEnvFixture,TELEGRAM_ALLOWED_IDS:JSON.stringify([id]),MODEL:models[0],MODEL_FALLBACKS:models.slice(1).join(','),GEMINI_KEY:'voice-integration-fixture',SUBS:{async get(key){return records.get(key)||null},async put(key,value){records.set(key,value)}}};
 const wav=Buffer.alloc(16044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
 const send=(body={mode:'transcribe',audio:wav.toString('base64')})=>worker.fetch(new Request('https://fixture.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload(body,id))}),env);
 return {send};
}
const success=()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"transcript":"Творог, 200 граммов."}'}]}}]});

test('all-model overload exposes the same usable retry delay on first and cached voice requests',async t=>{
 const x=fixture(3001);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{message:'private upstream message',status:'UNAVAILABLE'}},{status:503})});
 for(let attempt=0;attempt<2;attempt++){
  const response=await x.send(),data=await response.json();
  assert.equal(response.status,503);assert.equal(data.error,'unavailable');assert.equal(data.retryable,true);
  assert.ok(data.retryAfter>0&&data.retryAfter<=30);assert.equal(Number(response.headers.get('Retry-After')),data.retryAfter);
  assert.equal(response.headers.get('Access-Control-Expose-Headers'),'Retry-After');
  assert.doesNotMatch(JSON.stringify(data),/private|voice-integration-fixture|RIFF/);
 }
 assert.equal(calls,3,'the cached second request must not spend another API call');
});

test('daily voice quotas remain final and are not disguised as a short rate limit',async t=>{
 const x=fixture(3002);let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}},{status:429})});
 for(let attempt=0;attempt<2;attempt++){
  const response=await x.send(),data=await response.json();
  assert.equal(response.status,429);assert.equal(data.error,'quota');assert.equal(data.retryable,false);
  assert.equal(data.retryAfter,undefined);assert.equal(response.headers.get('Retry-After'),null);
 }
 assert.equal(calls,3);
});

test('short voice rate limits preserve their retry delay and recover after the advertised pause',async t=>{
 const x=fixture(3003);let now=Date.now(),limited=true,calls=0;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async()=>{calls++;return limited?Response.json({error:{}},{status:429,headers:{'Retry-After':'11'}}):success()});
 const response=await x.send(),data=await response.json();
 assert.equal(response.status,429);assert.equal(data.error,'rate');assert.equal(data.retryable,true);assert.equal(data.retryAfter,11);
 const cached=await x.send();assert.equal(cached.status,429);assert.equal(calls,3);
 limited=false;now+=11000;
 const recovered=await x.send();assert.equal(recovered.status,200);assert.equal((await recovered.json()).text,'Творог, 200 граммов.');assert.equal(calls,4);
});

test('a malformed food answer cannot prevent the next authenticated voice request from reaching Gemini',async t=>{
 const x=fixture(3004);let voice=false,calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return voice?success():Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"reply":"Добавил","actions":[{"op":"add","name":"Каша"}]}'}]}}]})});
 const food=await x.send({mode:'dish',text:'Каша 200 г'});assert.equal(food.status,502);assert.equal((await food.json()).error,'invalid_response');assert.equal(calls,3);
 voice=true;
 const response=await x.send();assert.equal(response.status,200);assert.equal((await response.json()).text,'Творог, 200 граммов.');assert.equal(calls,4);
});
