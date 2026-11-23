import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transcriptionBody,transcriptionText} from '../worker/voice.js';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';
const code=fs.readFileSync(new URL('../voice.js',import.meta.url),'utf8');
function setup(extra={}){const target={textContent:'Уже набрано',isConnected:true,blur(){},closest(){return{before(){}}}};let stops=0;const context=vm.createContext({console,Blob,DataView,Uint8Array,ArrayBuffer,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,btoa,API:'https://example.test',kbClose(){},kbFlush(){},gr(){},sbtn(){},toast(){},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stops++}}]})}},document:{hidden:false,addEventListener(){},querySelectorAll:()=>[],getElementById:id=>id==='ai'?target:{firstChild:{},remove(){} }},window:{MediaRecorder:class{},addEventListener(){}},...extra});vm.runInContext(code,context);return{c:context,target,run:s=>vm.runInContext(s,context),stops:()=>stops}}
const buffer={length:8000,numberOfChannels:1,getChannelData:()=>new Float32Array(8000).fill(.2)};
test('WAV is valid 16k mono PCM and validates on server',()=>{const x=setup();x.c.buf=buffer;const bytes=x.run('voiceWav(buf)');const audio=Buffer.from(bytes).toString('base64'),body=transcriptionBody(audio);assert.equal(body.contents[0].parts[0].inlineData.mimeType,'audio/wav');assert.equal(body.contents[0].parts[0].inlineData.data,audio);assert.equal(body.tools,undefined)});
test('invalid audio, oversized audio and tampered headers are rejected',()=>{for(const audio of['','!!!!','a'.repeat(1280101),Buffer.from('not an audio file'.repeat(8)).toString('base64')])assert.throws(()=>transcriptionBody(audio));const x=setup();x.c.buf=buffer;const bytes=Buffer.from(x.run('voiceWav(buf)'));bytes.writeUInt32LE(48000,24);assert.throws(()=>transcriptionBody(bytes.toString('base64')))});
test('transcription accepts silence but rejects hallucinated action objects and incomplete output',()=>{const reply=(text,finishReason='STOP')=>({candidates:[{finishReason,content:{parts:[{text:JSON.stringify(text)}]}}]});assert.equal(transcriptionText(reply({transcript:''})), '');assert.equal(transcriptionText(reply({transcript:'  Рис, 200 г.  '})), 'Рис, 200 г.');assert.throws(()=>transcriptionText(reply({actions:[{type:'add_food'}]})));assert.throws(()=>transcriptionText(reply({transcript:'обрыв'},'MAX_TOKENS')))});
test('cancelled microphone permission request releases stream when it eventually resolves',async()=>{let grant;const stream={getTracks:()=>[{stop(){released++}}]};let released=0;const x=setup({navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>grant=r)}}});const pending=x.run("voiceToggle('ai')");x.run('voiceCancel()');grant(stream);await pending;assert.equal(released,1);assert.equal(x.run('VOICE'),null);assert.equal(x.target.textContent,'Уже набрано')});
test('transcript appends to current editable draft and never submits it',async()=>{let requests=0;const x=setup({fetch:async(_url,opts)=>{requests++;const data=JSON.parse(opts.body);assert.equal(data.mode,'transcribe');return{ok:true,json:async()=>({text:'Съел плов.'})}}});x.c.stream={getTracks:()=>[{stop(){}}]};x.run("voiceEncode=async()=> 'wav'; VOICE={id:'ai',target:document.getElementById('ai'),started:Date.now()-1000,chunks:[new Blob(['audio'])],recorder:{mimeType:'audio/webm'},stream}");await x.run('voiceFinish(VOICE)');assert.equal(x.target.textContent,'Уже набрано Съел плов.');assert.equal(requests,1);assert.equal(x.run('VOICE'),null)});
test('cancelling in-flight transcription never inserts late text',async()=>{let resolve;const x=setup({fetch:()=>new Promise(r=>resolve=r)});x.c.stream={getTracks:()=>[{stop(){}}]};x.run("voiceEncode=async()=> 'wav'; VOICE={id:'ai',target:document.getElementById('ai'),started:Date.now()-1000,chunks:[new Blob(['audio'])],recorder:{mimeType:'audio/webm'},stream}");const finish=x.run('voiceFinish(VOICE)');await new Promise(r=>setTimeout(r,0));x.run('voiceCancel()');resolve({ok:true,json:async()=>({text:'Запоздалый ответ'})});await finish;assert.equal(x.target.textContent,'Уже набрано')});
test('denied microphone leaves original draft and resets controls',async()=>{const x=setup({navigator:{mediaDevices:{getUserMedia:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'})}}}});await x.run("voiceToggle('ai')");assert.equal(x.run('VOICE'),null);assert.equal(x.target.textContent,'Уже набрано')});
test('worker rejects invalid voice without calling Gemini and preserves CORS',async()=>{const response=await worker.fetch(new Request('https://example.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload({mode:'transcribe',audio:'invalid'}))}),telegramEnvFixture);assert.equal(response.status,400);assert.equal((await response.json()).error,'bad_audio');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://kolpakov-uz.github.io')});

test('long audio is segmented without truncation, overlap or loss of samples',()=>{
 const x=setup(),samples=Float32Array.from({length:16000*73},(_,i)=>((i%100)-50)/100);
 x.c.long={length:samples.length,numberOfChannels:1,getChannelData:()=>samples};
 const parts=x.run('voiceSegments(long)');let offset=0;
 assert.ok(parts.length>1);for(const part of parts){assert.ok(part.length<=16000*28);assert.equal(part.getChannelData(0)[0],samples[offset]);x.c.part=part;transcriptionBody(Buffer.from(x.run('voiceWav(part)')).toString('base64'));offset+=part.length;assert.equal(part.getChannelData(0).at(-1),samples[offset-1]);}
 assert.equal(offset,samples.length);assert.equal(x.run('voiceWav(long).length'),44+samples.length*2);
});
test('recording has an elapsed clock and no automatic duration stop',async()=>{
 let durationTimers=0;const x=setup({setTimeout:()=>{durationTimers++;return 1},setInterval:()=>1,clearInterval(){}});
 class Recorder{static isTypeSupported(){return true}constructor(){this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive'}}
 x.c.MediaRecorder=Recorder;x.c.window.MediaRecorder=Recorder;x.c.document.querySelector=()=>null;
 await x.run("voiceToggle('ai')");assert.equal(x.run('VOICE.phase'),'recording');assert.equal(durationTimers,0);assert.equal(x.run('voiceClock(135)'),'2:15');x.run('voiceCancel()');assert.equal(x.stops(),1);
});
test('microphone waves respond to speech and settle to zero in silence; resources close',()=>{
 let frame,signal=128,level=0,closed=0,cancelled=0,disconnected=0;const x=setup({requestAnimationFrame:fn=>{frame=fn;return 1},cancelAnimationFrame:()=>cancelled++});
 const analyser={fftSize:512,getByteTimeDomainData:a=>a.fill(signal),disconnect:()=>disconnected++};
 x.c.audioContext={state:'running',createMediaStreamSource:()=>({connect(){},disconnect:()=>disconnected++}),createAnalyser:()=>analyser,close:()=>{closed++;return Promise.resolve()}};
 x.c.button={style:{setProperty:(_key,value)=>level=+value}};
 x.run("VOICE={phase:'recording',audioContext,button,stream:{getTracks:()=>[]}};voiceMeter(VOICE)");frame();assert.equal(level,0);signal=160;for(let i=0;i<8;i++)frame();assert.ok(level>.5);signal=128;for(let i=0;i<65;i++)frame();assert.equal(level,0);x.run('voiceRelease(VOICE)');assert.equal(closed,1);assert.equal(cancelled,1);assert.equal(disconnected,2);
});
test('multi-part dictation is ordered and remains one editable draft',async()=>{
 let calls=0;const x=setup({fetch:async()=>({ok:true,json:async()=>({text:++calls===1?'Первая часть.':'Вторая часть.'})})});x.c.stream={getTracks:()=>[]};
 x.run("voiceEncode=async()=>['one','two'];voiceDelay=async()=>{};VOICE={id:'ai',target:document.getElementById('ai'),started:Date.now()-1000,chunks:[new Blob(['audio'])],recorder:{mimeType:'audio/webm'},stream}");
 await x.run('voiceFinish(VOICE)');assert.equal(calls,2);assert.equal(x.target.textContent,'Уже набрано Первая часть. Вторая часть.');
});

function recording(x,parts=['one']){
 x.c.encodedParts=parts;
 x.run("voiceEncode=async()=>encodedParts;voiceDelay=async()=>{};VOICE={id:'ai',target:document.getElementById('ai'),started:Date.now()-1000,chunks:[new Blob(['audio'])],recorder:{mimeType:'audio/mp4'},stream:{getTracks:()=>[]}}");
}

test('temporary upstream failure automatically retries the same audio and inserts once',async()=>{
 let calls=0;const sent=[],notices=[];
 const x=setup({toast:(...args)=>notices.push(args),fetch:async(_url,opts)=>{sent.push(JSON.parse(opts.body).audio);return ++calls===1?{ok:false,status:502,json:async()=>({error:'ai',upstreamStatus:503})}:{ok:true,json:async()=>({text:'Два яйца.'})}}});
 recording(x);await x.run('voiceFinish(VOICE)');
 assert.deepEqual(sent,['one','one']);assert.equal(x.target.textContent,'Уже набрано Два яйца.');
 assert.equal(x.run('VOICE_RETRY'),null);assert.equal(notices.at(-1)[1].type,'success');
});

test('failed speech with an empty field retains audio for retry without claiming a saved transcript',async()=>{
 const notices=[];let calls=0;
 const x=setup({toast:(...args)=>notices.push(args),fetch:async()=>{calls++;return{ok:false,status:503,json:async()=>({error:'unavailable'})}}});
 x.target.textContent='';recording(x);await x.run('voiceFinish(VOICE)');
 assert.equal(calls,2);assert.equal(x.target.textContent,'');assert.equal(x.run('VOICE'),null);
 assert.ok(x.run('VOICE_RETRY.blob.size')>0);assert.equal(x.run('VOICE_RETRY.parts[0]'),'one');
 assert.doesNotMatch(notices.at(-1)[0],/текст.*(сохран|остал)/i);
 x.c.fetch=async()=>({ok:true,json:async()=>({text:'Творог 200 граммов.'})});
 await x.run('voiceRetry()');assert.equal(x.target.textContent,'Творог 200 граммов.');assert.equal(x.run('VOICE_RETRY'),null);
});

test('quota does not retry automatically and preserves only the actual existing draft',async()=>{
 let calls=0;const notices=[];
 const x=setup({toast:(...args)=>notices.push(args),fetch:async()=>{calls++;return{ok:false,status:429,json:async()=>({error:'rate'})}}});
 recording(x);await x.run('voiceFinish(VOICE)');assert.equal(calls,1);
 assert.equal(x.target.textContent,'Уже набрано');assert.match(notices.at(-1)[0],/Набранный текст остался в поле/);
 x.run('voiceCancel()');assert.equal(x.run('VOICE_RETRY'),null);
});

test('retry of a failed later fragment keeps the recognized prefix and does not duplicate it',async()=>{
 let fail=true;const sent=[];
 const x=setup({fetch:async(_url,opts)=>{const audio=JSON.parse(opts.body).audio;sent.push(audio);if(audio==='two'&&fail)return{ok:false,status:502,json:async()=>({error:'ai'})};return{ok:true,json:async()=>({text:audio==='one'?'Первая часть.':'Вторая часть.'})}}});
 recording(x,['one','two']);await x.run('voiceFinish(VOICE)');
 assert.equal(x.target.textContent,'Уже набрано Первая часть.');assert.equal(x.run('VOICE_RETRY.nextPart'),1);
 fail=false;await x.run('voiceRetry()');assert.deepEqual(sent,['one','two','two','two']);
 assert.equal(x.target.textContent,'Уже набрано Первая часть. Вторая часть.');
});

test('network failure and timeout get useful messages without inventing text',async()=>{
 for(const name of ['TypeError','AbortError']){
  const notices=[];const x=setup({toast:(...args)=>notices.push(args),fetch:async()=>{throw Object.assign(Error('failed'),{name})}});
  x.target.textContent='';recording(x);await x.run('voiceFinish(VOICE)');
  assert.equal(notices.at(-1)[1].title,name==='TypeError'?'Нет связи с сервисом':'Сервис не успел ответить');
  assert.equal(x.target.textContent,'');assert.ok(x.run('VOICE_RETRY.blob.size')>0);
 }
});

test('decoder failure reports an audio problem and does not claim the empty field was saved',async()=>{
 const notices=[];const x=setup({toast:(...args)=>notices.push(args)});x.target.textContent='';recording(x);
 x.run("voiceEncode=async()=>{throw Error('EncodingError')}");await x.run('voiceFinish(VOICE)');
 assert.equal(notices.at(-1)[1].title,'Не удалось прочитать аудио');assert.doesNotMatch(notices.at(-1)[0],/текст.*(сохран|остал)/i);assert.equal(x.run('VOICE_RETRY'),null);
});

test('cancelling an automatic retry never inserts late text or retains audio',async()=>{
 let continueRetry;const x=setup({fetch:async()=>({ok:false,status:502,json:async()=>({error:'ai'})})});recording(x);
 x.c.wait=new Promise(resolve=>continueRetry=resolve);x.run('voiceDelay=()=>wait');
 const pending=x.run('voiceFinish(VOICE)');await new Promise(resolve=>setTimeout(resolve,0));
 x.run('voiceCancel()');continueRetry();await pending;
 assert.equal(x.target.textContent,'Уже набрано');assert.equal(x.run('VOICE_RETRY'),null);assert.equal(x.run('VOICE'),null);
});

const reply=(status,data,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function controlledRecording(respond,parts=['one']){
 let now=100000,nextTimer=0;const timers=new Map(),requests=[],statuses=[],notices=[];
 class Clock extends Date{static now(){return now}}
 const x=setup({Date:Clock,setTimeout:(callback,delay)=>{const id=++nextTimer;timers.set(id,{callback,at:now+delay});return id},clearTimeout:id=>timers.delete(id),toast:(...args)=>notices.push(args),fetch:async(_url,options)=>{const request={at:now,audio:JSON.parse(options.body).audio};requests.push(request);return respond(request,requests.length)}});
 const firstChild={set textContent(text){statuses.push(text)},get textContent(){return statuses.at(-1)}};
 x.c.document.getElementById=id=>id==='ai'?x.target:{firstChild,remove(){}};
 x.c.actualDelay=x.run('voiceDelay');recording(x,parts);x.run('voiceDelay=actualDelay');
 async function advance(milliseconds){
  const end=now+milliseconds;
  while(true){const next=[...timers].filter(([,timer])=>timer.at<=end).sort(([,a],[,b])=>a.at-b.at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].callback();await flush()}
  now=end;await flush();
 }
 return {x,requests,statuses,notices,timers,advance};
}

test('retry waits from the failed response, honors server pause, counts down and inserts one transcript',async()=>{
 let fail;const z=controlledRecording((_request,number)=>number===1?new Promise(resolve=>fail=()=>resolve(reply(503,{error:'unavailable',retryable:true,retryAfter:30},{'Retry-After':'20'}))):reply(200,{text:'Рис, 200 граммов.'}));
 const pending=z.x.run('voiceFinish(VOICE)');await flush();assert.equal(z.requests[0].at,100000);
 await z.advance(10000);fail();await flush();assert.match(z.statuses.at(-1),/через 30 с/);
 await z.advance(29999);assert.equal(z.requests.length,1);assert.ok(z.statuses.some(text=>/через 29 с/.test(text)));
 await z.advance(1);await pending;
 assert.deepEqual(z.requests,[{at:100000,audio:'one'},{at:140000,audio:'one'}]);
 assert.equal(z.x.target.textContent,'Уже набрано Рис, 200 граммов.');assert.equal(z.x.run('VOICE_RETRY'),null);assert.equal(z.timers.size,0);
});

test('Retry-After HTTP date takes precedence over a shorter JSON pause',async()=>{
 const z=controlledRecording((_request,number)=>number===1?reply(503,{error:'unavailable',retryable:true,retryAfter:10},{'Retry-After':new Date(120000).toUTCString()}):reply(200,{text:'Два яйца.'}));
 const pending=z.x.run('voiceFinish(VOICE)');await flush();assert.match(z.statuses.at(-1),/через 20 с/);
 await z.advance(19999);assert.equal(z.requests.length,1);await z.advance(1);await pending;assert.equal(z.requests[1].at,120000);
});

test('a temporary rate limit retries after its delay and identifies the rate limit in the countdown',async()=>{
 const z=controlledRecording((_request,number)=>number===1?reply(429,{error:'rate',retryable:true,retryAfter:8}):reply(200,{text:'Творог.'}));
 const pending=z.x.run('voiceFinish(VOICE)');await flush();assert.match(z.statuses.at(-1),/частые запросы/);assert.doesNotMatch(z.statuses.at(-1),/занят/);
 await z.advance(7999);assert.equal(z.requests.length,1);await z.advance(1);await pending;assert.equal(z.requests.length,2);
});

test('daily quota, permanent failures and explicit retryable false keep audio without automatic attempts',async()=>{
 for(const [status,error,retryable] of [[429,'quota',false],[502,'ai_access',false],[502,'ai_model',true],[502,'ai_billing',false],[502,'ai_request',false],[503,'unavailable',false]]){
  const z=controlledRecording(()=>reply(status,{error,retryable,retryAfter:30}));await z.x.run('voiceFinish(VOICE)');
  assert.equal(z.requests.length,1,error);assert.ok(z.x.run('VOICE_RETRY.blob.size')>0,error);assert.equal(z.x.target.textContent,'Уже набрано');
  assert.notEqual(z.notices.at(-1)[1].type,'success');if(error==='quota')assert.match(z.notices.at(-1)[1].title,/квота/);
  z.x.run('voiceCancel()');assert.equal(z.timers.size,0);
 }
});

test('manual repeat cannot bypass a long server pause and the waiting request remains cancellable',async()=>{
 const z=controlledRecording((_request,number)=>number===1?reply(503,{error:'unavailable',retryable:true,retryAfter:60}):reply(200,{text:'Повтор завершён.'}));
 await z.x.run('voiceFinish(VOICE)');assert.equal(z.requests.length,1);assert.equal(z.x.run('VOICE'),null);
 const pending=z.x.run('voiceRetry()');await flush();assert.match(z.statuses.at(-1),/через 60 с/);
 await z.advance(59999);assert.equal(z.requests.length,1);await z.advance(1);await pending;
 assert.equal(z.requests[1].at,160000);assert.equal(z.x.target.textContent,'Уже набрано Повтор завершён.');
});

test('cancelling the real countdown stops future requests, clears timers and preserves only the typed draft',async()=>{
 const z=controlledRecording(()=>reply(503,{error:'unavailable',retryable:true,retryAfter:30}));
 const pending=z.x.run('voiceFinish(VOICE)');await flush();await z.advance(5000);z.x.run('voiceCancel()');await pending;
 await z.advance(60000);assert.equal(z.requests.length,1);assert.equal(z.timers.size,0);assert.equal(z.x.target.textContent,'Уже набрано');assert.equal(z.x.run('VOICE'),null);assert.equal(z.x.run('VOICE_RETRY'),null);
});

test('exhausting two delayed attempts retains only the failed fragment and manual retry keeps its new pause',async()=>{
 let recovered=false;
 const z=controlledRecording((request)=>request.audio==='one'?reply(200,{text:'Первая часть.'}):recovered?reply(200,{text:'Вторая часть.'}):reply(503,{error:'unavailable',retryable:true,retryAfter:10}),['one','two']);
 const pending=z.x.run('voiceFinish(VOICE)');await flush();await z.advance(5200);assert.equal(z.requests.length,2);await z.advance(10000);await pending;
 assert.equal(z.requests.length,3);assert.equal(z.x.target.textContent,'Уже набрано Первая часть.');assert.equal(z.x.run('VOICE_RETRY.nextPart'),1);
 recovered=true;const repeated=z.x.run('voiceRetry()');await flush();await z.advance(9999);assert.equal(z.requests.length,3);await z.advance(1);await repeated;
 assert.deepEqual(z.requests.map(request=>request.audio),['one','two','two','two']);assert.equal(z.x.target.textContent,'Уже набрано Первая часть. Вторая часть.');
});

test('worker reports upstream voice failures with CORS and without leaking error messages',async()=>{
 const original=globalThis.fetch,x=setup();x.c.buf=buffer;
 const audio=Buffer.from(x.run('voiceWav(buf)')).toString('base64');
 const request=()=>new Request('https://example.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io','CF-Connecting-IP':'voice-regression-test'},body:JSON.stringify(telegramPayload({mode:'transcribe',audio}))});
 try{
  for(const [status,error,retryable,resultStatus] of [[400,'audio_rejected',false,502],[403,'ai_access',false,502],[404,'ai_model',false,502],[402,'ai_billing',false,502],[503,'unavailable',true,503]]){
   globalThis.fetch=async()=>new Response(JSON.stringify({error:{message:'private upstream detail'}}),{status});
   const response=await worker.fetch(request(),telegramEnvFixture),data=await response.json();
   assert.equal(response.status,resultStatus);assert.equal(data.error,error);assert.equal(data.retryable,retryable);assert.equal(data.upstreamStatus,status);assert.doesNotMatch(JSON.stringify(data),/private upstream detail/);
   if(retryable){assert.ok(data.retryAfter>0);assert.equal(response.headers.get('Retry-After'),String(data.retryAfter))}
   assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://kolpakov-uz.github.io');
  }
  globalThis.fetch=async()=>{throw TypeError('unreachable')};
  const offline=await worker.fetch(request(),telegramEnvFixture),offlineData=await offline.json();assert.equal(offline.status,503);assert.equal(offlineData.error,'unavailable');assert.equal(offlineData.retryable,true);assert.ok(offlineData.retryAfter>0);
  globalThis.fetch=async()=>new Response('invalid JSON');
  const malformed=await worker.fetch(request(),telegramEnvFixture),malformedData=await malformed.json();assert.equal(malformed.status,502);assert.equal(malformedData.error,'transcript');assert.equal(malformedData.retryable,true);assert.ok(malformedData.retryAfter>0);
 }finally{globalThis.fetch=original}
});
