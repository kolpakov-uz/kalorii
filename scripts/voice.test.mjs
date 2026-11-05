import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {transcriptionBody,transcriptionText} from '../worker/voice.js';
import worker from '../worker/index.js';
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
test('worker rejects invalid voice without calling Gemini and preserves CORS',async()=>{const response=await worker.fetch(new Request('https://example.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify({mode:'transcribe',audio:'invalid'})}),{});assert.equal(response.status,400);assert.equal((await response.json()).error,'bad_audio');assert.equal(response.headers.get('Access-Control-Allow-Origin'),'https://kolpakov-uz.github.io')});

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
