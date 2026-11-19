import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {generateContent} from '../worker/gemini.js';
import {aiFailure} from '../worker/ai-errors.js';
import {foodRequest} from '../worker/food.js';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';

const primary = 'gemini-4-hydrogen';
const secondary = 'gemini-3.8-flash';
const finalModel = 'gemini-3.5-flash-lite';
const body = foodRequest({mode:'photo',image:'ZmFrZS1pbWFnZQ==',text:'50 г вафли'});
const answer = text=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});
const success = ()=>answer('{"reply":"Готово","actions":[]}');
const quota = ()=>Response.json({error:{details:[{'@type':'type.googleapis.com/google.rpc.QuotaFailure',violations:[{quotaId:'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}]}]}},{status:429});

function fixture() {
  const records = new Map();
  const writes = [];
  const storage = {
    async get(key) {return records.get(key) || null},
    async put(key,value,options) {records.set(key,value);writes.push({key,value,options})}
  };
  return {records,writes,env:{MODEL:primary,MODEL_FALLBACKS:secondary+','+finalModel,GEMINI_KEY:'fixture-only-api-key',SUBS:storage}};
}

function backend(t, respond) {
  const calls = [];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    const model = new URL(url).pathname.match(/models\/(.*):generateContent$/)[1];
    const call = {model,body:JSON.parse(options.body),options};
    calls.push(call);
    return respond(call,calls.length);
  });
  return calls;
}

test('production configuration starts with Hydrogen and stops after the first successful model',async t=>{
  const config = JSON.parse(fs.readFileSync(new URL('../worker/wrangler.jsonc',import.meta.url),'utf8'));
  assert.equal(config.vars.MODEL,primary);
  assert.equal(config.vars.MODEL_FALLBACKS,secondary+','+finalModel);
  const x = fixture();
  const calls = backend(t,success);
  assert.equal((await generateContent(x.env,body,'photo')).status,200);
  assert.deepEqual(calls.map(call=>call.model),[primary]);
  assert.deepEqual(calls[0].body.contents,body.contents);
  assert.deepEqual(calls[0].body.systemInstruction,body.systemInstruction);
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel,'MEDIUM');
  assert.equal(calls[0].body.generationConfig.responseJsonSchema.properties.actions.items.required[0],'op');
  assert.equal('temperature' in calls[0].body.generationConfig,false);
  assert.equal('maxOutputTokens' in calls[0].body.generationConfig,false);
  assert.equal(body.generationConfig.temperature,0);
  assert.equal(body.generationConfig.maxOutputTokens,1600);
});

test('daily quotas move through all three models and are shared across subsequent request modes',async t=>{
  const x = fixture();
  let secondaryExhausted = false;
  const calls = backend(t,({model})=>model === primary || model === secondary && secondaryExhausted ? quota() : success());
  await generateContent(x.env,body,'photo');
  secondaryExhausted = true;
  await generateContent(x.env,body,'dish');
  await generateContent(x.env,body,'chat');
  assert.deepEqual(calls.map(call=>call.model),[primary,secondary,secondary,finalModel,finalModel]);
  assert.deepEqual(calls.at(-1).body,body);
  assert.equal(x.writes.length,2);
  assert.ok(x.writes.every(write=>write.options.expirationTtl >= 25*60*60));
  assert.doesNotMatch(JSON.stringify(x.writes),/fixture-only-api-key|вафли|ZmFrZS/);
});

test('exhausted daily quota stays skipped until Pacific midnight, including summer and daylight saving transitions',async t=>{
  for (const times of [
    ['2026-11-19T07:59:59Z','2026-11-19T08:00:00Z'],
    ['2026-07-20T06:59:59Z','2026-07-20T07:00:00Z'],
    ['2026-03-08T09:59:00Z','2026-03-09T06:59:59Z','2026-03-09T07:00:00Z'],
    ['2026-11-01T08:59:00Z','2026-11-02T07:59:59Z','2026-11-02T08:00:00Z']
  ]) {
    const x = fixture();
    let now = Date.parse(times[0]);
    t.mock.method(Date,'now',()=>now);
    let restored = false;
    const calls = backend(t,({model})=>model === primary && !restored ? quota() : success());
    await generateContent(x.env,body,'photo');
    for (const time of times.slice(0,-1)) {
      now = Date.parse(time);
      await generateContent(x.env,body,'photo');
    }
    assert.equal(calls.filter(call=>call.model === primary).length,1);
    now = Date.parse(times.at(-1));
    restored = true;
    await generateContent(x.env,body,'photo');
    assert.equal(calls.at(-1).model,primary);
    t.mock.restoreAll();
  }
});

test('a short rate limit uses the fallback immediately and returns to the primary after Retry-After',async t=>{
  const x = fixture();
  let now = Date.now();
  t.mock.method(Date,'now',()=>now);
  let limited = true;
  const calls = backend(t,({model})=>model === primary && limited ? Response.json({}, {status:429,headers:{'Retry-After':'8'}}) : success());
  await generateContent(x.env,body,'photo');
  now += 7000;
  await generateContent(x.env,body,'photo');
  limited = false;
  now += 1000;
  await generateContent(x.env,body,'photo');
  assert.deepEqual(calls.map(call=>call.model),[primary,secondary,secondary,primary]);
});

test('a quota response arriving across midnight does not disable the primary for the new day',async t=>{
  const x = fixture();
  let now = Date.parse('2026-11-19T07:59:59Z');
  t.mock.method(Date,'now',()=>now);
  let exhausted = true;
  const calls = backend(t,({model})=>{
    if (model === primary && exhausted) {
      now = Date.parse('2026-11-19T08:00:01Z');
      return quota();
    }
    return success();
  });
  await generateContent(x.env,body,'photo');
  exhausted = false;
  await generateContent(x.env,body,'photo');
  assert.equal(calls.at(-1).model,primary);
});

test('all daily quotas stop upstream calls while mixed daily and temporary limits remain retryable',async t=>{
  const x = fixture();
  const calls = backend(t,quota);
  for (let attempt=0;attempt<2;attempt++) {
    const response = await generateContent(x.env,body,'photo');
    assert.deepEqual(await aiFailure(response),{status:429,data:{error:'quota',retryable:false}});
  }
  assert.equal(calls.length,3);
  t.mock.restoreAll();

  const mixed = fixture();
  backend(t,({model})=>model === primary ? Response.json({}, {status:429,headers:{'Retry-After':'7'}}) : quota());
  for (let attempt=0;attempt<2;attempt++) {
    const failure = await aiFailure(await generateContent(mixed.env,body,'photo'));
    assert.equal(failure.data.error,'rate');
    assert.equal(failure.data.retryable,true);
    assert.ok(failure.data.retryAfter <= 7);
  }
});

test('unavailable models and network failures fall through with the original photo and recover after cooldown',async t=>{
  const x = fixture();
  let now = Date.now();
  t.mock.method(Date,'now',()=>now);
  let unavailable = true;
  const calls = backend(t,({model})=>{
    if (unavailable && model === primary) return Response.json({}, {status:404});
    if (unavailable && model === secondary) throw TypeError('private network detail');
    return success();
  });
  await generateContent(x.env,body,'photo');
  await generateContent(x.env,body,'photo');
  assert.deepEqual(calls.map(call=>call.model),[primary,secondary,finalModel,secondary,finalModel]);
  assert.ok(calls.every(call=>JSON.stringify(call.body.contents) === JSON.stringify(body.contents)));
  now += 300000;
  unavailable = false;
  await generateContent(x.env,body,'photo');
  assert.equal(calls.at(-1).model,primary);
});

test('model permission and server errors fall through, while invalid input, credentials and billing stop immediately',async t=>{
  for (const status of [403,503,400,401,402]) {
    const x = fixture();
    const calls = backend(t,({model})=>model === primary ? Response.json({error:{message:'private error'}},{status}) : success());
    const response = await generateContent(x.env,body,'photo');
    assert.equal(response.status,[403,503].includes(status) ? 200 : status);
    assert.equal(calls.length,[403,503].includes(status) ? 2 : 1);
    t.mock.restoreAll();
  }
});

test('a KV outage does not block fallback and rotating the API key does not inherit old cooldowns',async t=>{
  const x = fixture();
  const calls = backend(t,({model})=>model === primary ? quota() : success());
  await generateContent(x.env,body,'photo');
  await generateContent({...x.env,GEMINI_KEY:'rotated-fixture-key'},body,'photo');
  assert.equal(calls.filter(call=>call.model === primary).length,2);
  const broken = {get:async()=>{throw Error('KV read')},put:async()=>{throw Error('KV write')}};
  assert.equal((await generateContent({...x.env,SUBS:broken},body,'photo')).status,200);
});

test('an unresponsive model is aborted in time for the next model to answer',async t=>{
  const x = fixture();
  t.mock.timers.enable({apis:['setTimeout']});
  let started;
  const firstStarted = new Promise(resolve=>started=resolve);
  const calls = backend(t,({model,options})=>{
    if (model !== primary) return success();
    started();
    return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError'))));
  });
  const pending = generateContent(x.env,body,'photo');
  await firstStarted;
  t.mock.timers.tick(12000);
  assert.equal((await pending).status,200);
  assert.equal(calls[0].options.signal.aborted,true);
  assert.equal(calls[1].model,secondary);
});

test('the normal Worker entry point uses the chain for text, photos, coach chat and voice',async t=>{
  let userId = 700;
  for (const mode of ['dish','photo','chat','transcribe']) {
    const x = fixture();
    const env = {...telegramEnvFixture,...x.env,TELEGRAM_ALLOWED_IDS:JSON.stringify([++userId])};
    const wave = Buffer.alloc(46);
    wave.write('RIFF');wave.writeUInt32LE(38,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(16000,24);wave.writeUInt32LE(32000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(2,40);
    const input = {mode,text:'50 г вафли',image:'ZmFrZS1pbWFnZQ==',messages:[{role:'user',content:'Мой план'}],audio:wave.toString('base64')};
    const text = mode === 'transcribe' ? '{"transcript":"Вафли, 50 граммов."}' : '{"reply":"Готово","actions":[]}';
    const calls = backend(t,({model})=>model === primary ? quota() : answer(text));
    const request = new Request('https://fixture.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload(input,userId))});
    const response = await worker.fetch(request,env);
    assert.equal(response.status,200,mode);
    assert.deepEqual(await response.json(),{text:mode === 'transcribe' ? 'Вафли, 50 граммов.' : text});
    assert.deepEqual(calls.map(call=>call.model),[primary,secondary]);
    if (mode === 'transcribe') {
      assert.equal(calls[1].body.contents[0].parts[0].inlineData.data,input.audio);
      assert.equal(calls[1].body.generationConfig.thinkingConfig.thinkingLevel,'LOW');
      assert.deepEqual(calls[1].body.generationConfig.responseJsonSchema.required,['transcript']);
    }
    if (mode === 'chat') assert.deepEqual(calls[1].body.generationConfig.responseJsonSchema.properties.actions.items.required,['type']);
    t.mock.restoreAll();
  }
});
