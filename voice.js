/* Audio and drafts stay in memory. A transcript is never submitted automatically. */
let VOICE=null;
const MIC_ICON='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>';
function voiceButton(id){return `<button type="button" class="mic" data-voice="${id}" aria-label="Ввести голосом" title="Ввести голосом" onpointerdown="event.preventDefault()" onclick="voiceToggle('${id}')">${MIC_ICON}</button>`}
function voicePaint(){
 document.querySelectorAll('[data-voice]').forEach(b=>{const active=VOICE&&b.dataset.voice==VOICE.id,recording=!!active&&VOICE.phase=='recording';b.disabled=!!VOICE&&!active;b.classList.toggle('recording',recording);if(!recording)b.style?.removeProperty('--voice-level');b.setAttribute('aria-label',active?(recording?'Остановить запись':'Отменить голосовой ввод'):'Ввести голосом');b.innerHTML=recording?'<span class="mic-stop"></span>':MIC_ICON});
 document.querySelectorAll('.ce').forEach(t=>sbtn(t));
}
function voiceStatus(session,text){if(VOICE!==session)return;let bar=document.getElementById('voice-status');if(!bar){bar=document.createElement('div');bar.id='voice-status';bar.className='voice-status';const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Отмена';cancel.onclick=voiceCancel;bar.append(status,cancel);session.target.closest('.cmp,.send').before(bar)}bar.firstChild.textContent=text;}
function voiceClock(seconds){seconds=Math.max(0,Math.floor(seconds));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
function voiceLevel(previous,rms){const target=Math.min(1,Math.max(0,(rms-.012)*8));const level=previous+(target-previous)*(target>previous?.4:.12);return level<.002?0:level}
function voiceMeter(s){
 if(!s.audioContext)return;
 try{
  s.source=s.audioContext.createMediaStreamSource(s.stream);s.analyser=s.audioContext.createAnalyser();s.analyser.fftSize=512;s.source.connect(s.analyser);
  const samples=new Uint8Array(s.analyser.fftSize);s.level=0;
  const frame=()=>{if(VOICE!==s||s.phase!='recording')return;s.analyser.getByteTimeDomainData(samples);let energy=0;for(const sample of samples)energy+=((sample-128)/128)**2;s.level=voiceLevel(s.level,Math.sqrt(energy/samples.length));s.button?.style.setProperty('--voice-level',s.level.toFixed(3));s.frame=requestAnimationFrame(frame)};
  s.frame=requestAnimationFrame(frame);
 }catch{/* Recording still works when a device cannot provide a meter. */}
}
function voiceRelease(s){
 clearInterval(s.timer);s.cancelWait?.();
 if(s.frame!=null)cancelAnimationFrame(s.frame);
 try{s.source?.disconnect();s.analyser?.disconnect()}catch{}
 try{if(s.audioContext&&s.audioContext.state!='closed')s.audioContext.close().catch(()=>{})}catch{}
 s.button?.style.setProperty('--voice-level','0');s.stream?.getTracks().forEach(t=>t.stop());
}
function voiceCancel(){const s=VOICE;if(!s)return;VOICE=null;s.cancelled=true;s.controller?.abort();voiceRelease(s);if(s.recorder?.state=='recording')s.recorder.stop();document.getElementById('voice-status')?.remove();voicePaint();}
async function voiceToggle(id){
 if(VOICE){if(VOICE.id==id&&VOICE.phase=='recording')VOICE.recorder.stop();else voiceCancel();return}
 const target=document.getElementById(id);if(!target)return;
 if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return toast('Откройте приложение в современном браузере по HTTPS.',{type:'warning',title:'Голосовой ввод недоступен'});
 kbClose();target.blur();const s={id,target,phase:'permission',chunks:[],cancelled:false};VOICE=s;voiceStatus(s,'Разрешите доступ к микрофону');voicePaint();
 try{
  // Created inside the tap gesture so Safari can run the input analyser.
  const C=window.AudioContext||window.webkitAudioContext;
  if(C){try{s.audioContext=new C();s.audioContext.resume().catch(()=>{})}catch{}}
  s.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
  if(VOICE!==s){voiceRelease(s);return}
  const mime=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus'].find(t=>MediaRecorder.isTypeSupported(t));
  s.recorder=new MediaRecorder(s.stream,{...(mime?{mimeType:mime}:{}),audioBitsPerSecond:32000});
  s.recorder.ondataavailable=e=>{if(e.data.size)s.chunks.push(e.data)};
  s.recorder.onerror=()=>{if(VOICE===s){voiceCancel();toast('Попробуйте записать сообщение ещё раз.',{type:'error',title:'Запись прервалась'})}};
  s.recorder.onstop=()=>voiceFinish(s);s.started=Date.now();s.recorder.start(250);s.phase='recording';
  s.button=document.querySelector(`[data-voice="${id}"]`);
  const tick=()=>voiceStatus(s,`Запись ${voiceClock((Date.now()-s.started)/1000)} · нажмите ■`);tick();s.timer=setInterval(tick,1000);voicePaint();voiceMeter(s);
 }catch(e){if(VOICE!==s)return;voiceCancel();toast(e.name=='NotAllowedError'?'Разрешите доступ к микрофону в настройках браузера.':e.name=='NotFoundError'?'Подключите микрофон и попробуйте снова.':'Попробуйте включить микрофон ещё раз.',{type:'warning',title:e.name=='NotAllowedError'?'Нужен доступ к микрофону':e.name=='NotFoundError'?'Микрофон не найден':'Микрофон недоступен'});}
}
function voiceWav(buffer){
 const count=buffer.length,out=new ArrayBuffer(44+count*2),v=new DataView(out);const str=(at,t)=>{for(let i=0;i<t.length;i++)v.setUint8(at+i,t.charCodeAt(i))};
 str(0,'RIFF');v.setUint32(4,36+count*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,count*2,true);
 const channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));for(let i=0;i<count;i++){let x=0;for(const c of channels)x+=c[i];x=Math.max(-1,Math.min(1,x/channels.length));v.setInt16(44+i*2,x<0?x*32768:x*32767,true)}return new Uint8Array(out);
}
function voiceSegments(buffer){
 const parts=[];let start=0;
 while(start<buffer.length){let end=Math.min(start+16000*28,buffer.length);
  // Prefer a quiet boundary; keep every sample exactly once, including the tail.
  if(end<buffer.length){const channel=buffer.getChannelData(0);let best=Infinity,boundary=end;for(let at=end-16000*4;at+320<=end;at+=320){let energy=0;for(let i=at;i<at+320;i++)energy+=channel[i]*channel[i];if(energy<best){best=energy;boundary=at+160}}if(best<.000225)end=boundary;}
  const from=start,to=end;parts.push({length:to-from,numberOfChannels:buffer.numberOfChannels,getChannelData:i=>buffer.getChannelData(i).subarray(from,to)});start=end;
 }return parts;
}
async function voiceEncode(blob){
 const C=window.OfflineAudioContext||window.webkitOfflineAudioContext;if(!C)throw Error('codec');const context=new C(1,1,16000),buffer=await context.decodeAudioData(await blob.arrayBuffer());
 return voiceSegments(buffer).map(part=>{const bytes=voiceWav(part);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary)});
}
function voiceDelay(s,ms){return new Promise(resolve=>{const timer=setTimeout(()=>{s.cancelWait=null;resolve()},ms);s.cancelWait=()=>{clearTimeout(timer);s.cancelWait=null;resolve()}})}
async function voiceFinish(s){
 voiceRelease(s);if(VOICE!==s||s.cancelled)return;s.phase='processing';voiceStatus(s,'Распознаю речь…');voicePaint();
 try{
  if(Date.now()-s.started<450)throw Error('short');const blob=new Blob(s.chunks,{type:s.recorder.mimeType});s.chunks=[];if(!blob.size)throw Error('empty');
  const encoded=await voiceEncode(blob),parts=Array.isArray(encoded)?encoded:[encoded],texts=[];let lastRequest=0;
  for(let i=0;i<parts.length;i++){
   if(VOICE!==s)return;
   if(i)await voiceDelay(s,Math.max(0,5200-(Date.now()-lastRequest)));
   if(VOICE!==s)return;voiceStatus(s,parts.length>1?`Распознаю речь… ${i+1} / ${parts.length}`:'Распознаю речь…');
   s.controller=new AbortController();s.timeout=setTimeout(()=>s.controller.abort(),45000);let response;
   try{lastRequest=Date.now();response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'transcribe',audio:parts[i]}),signal:s.controller.signal})}finally{clearTimeout(s.timeout)}
   const data=await response.json();if(!response.ok)throw Error(response.status==429?'rate':'server');if(VOICE!==s||!s.target.isConnected)return;
   if(typeof data.text=='string'&&data.text.trim())texts.push(data.text.trim());
  }
  const text=texts.join(' ');if(!text){voiceCancel();toast('Говорите чуть ближе к микрофону и попробуйте снова.',{type:'warning',title:'Не удалось расслышать'});return}
  kbFlush();const existing=s.target.textContent.trim();s.target.textContent=existing+(existing?' ':'')+text;if(typeof CK!='undefined'&&CK&&KT===s.target)kbSync(true);VOICE=null;document.getElementById('voice-status')?.remove();voicePaint();gr(s.target);toast('Проверьте и при необходимости отредактируйте перед отправкой.',{type:'success',title:'Текст готов'});
 }catch(e){if(VOICE!==s)return;voiceCancel();toast(e.message=='rate'?'Попробуйте позже. Текст в поле сохранён.':e.message=='short'?'Скажите несколько слов и повторите запись.':'Попробуйте ещё раз. Текст в поле сохранён.',{type:e.message=='short'?'warning':'error',title:e.message=='rate'?'Лимит запросов исчерпан':e.message=='short'?'Запись слишком короткая':'Не удалось распознать запись'});}
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)voiceCancel()});
window.addEventListener('pagehide',voiceCancel);
