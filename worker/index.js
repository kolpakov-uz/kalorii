import {transcriptionBody,transcriptionText} from './voice.js';
import {verifyTelegramAccess,allowedTelegramIds} from './telegram-auth.js';
import {issueBrowserAccess,verifyBrowserAccess,revokeBrowsers} from './browser-auth.js';
// Прокси между приложением «Калории» и Gemini API. Ключ хранится в секрете GEMINI_KEY.
const SYS='Ты — ИИ-тренер и помощник в приложении для подсчёта калорий. Пользователь может просить тебя менять данные приложения. Всегда отвечай ТОЛЬКО JSON: {"reply":"короткий ответ по-русски, до 100 слов","actions":[...]}. actions — пустой массив, если менять ничего не нужно. Допустимые действия: {"type":"add_food","date":"YYYY-MM-DD (необязательно)","name":"","meal":"b|l|d|s","grams":0,"kcal":0,"protein":0,"fat":0,"carbs":0} (значения на всю порцию, посчитай сам; b завтрак, l обед, d ужин, s перекус); {"type":"edit_food","id":"id из списка на сегодня","name":"","grams":0,"kcal":0,"protein":0,"fat":0,"carbs":0} (только меняемые поля); {"type":"delete_food","id":""}; {"type":"move_food","id":"","date":"YYYY-MM-DD"}; {"type":"move_day","from":"YYYY-MM-DD","to":"YYYY-MM-DD","meal":"b|l|d|s (необязательно)"}; {"type":"set_macros","protein":0,"fat":0,"carbs":0} (граммы в день); {"type":"reset_macros"}; {"type":"set_goal","goal":"lose|gain|abs|keep"}; {"type":"set_reminder","key":"b|l|d|s|e","on":true,"time":"HH:MM"}; {"type":"set_water_reminder","on":true,"from":"HH:MM","to":"HH:MM","every_hours":2}; {"type":"add_water","ml":0}; {"type":"add_weight","kg":0}. Если пользователь называет день (вчера, позавчера, дату), укажи date, считая от сегодняшней даты из контекста; записи за последние дни есть в контексте вместе с их id. {"type":"add_measure","waist":0,"neck":0,"hip":0,"arm":0,"weight":0} (указывай только названные поля, в см и кг); {"type":"update_goal","start":0,"target":0} (изменить стартовое и/или целевое значение текущей цели-результата; указывай только нужные поля, в см или кг); {"type":"add_workout","kinds":["strength","abs","cardio"],"minutes":45,"date":"YYYY-MM-DD"} (когда пользователь сообщает о тренировке; kinds: один или несколько типов, если тренировка комбинированная, например силовая и пресс; для двух отдельных тренировок за день сделай два действия; date необязательна). Меняй данные только по явной просьбе пользователя. В reply кратко скажи, что сделал. Не ставь диагнозов, не советуй рацион ниже 1200 ккал, при проблемах со здоровьем советуй врача. Режим тренера задан в контексте: мягкий — поддерживающий тон, строгий — прямая оценка без лести и конкретные задания, жёсткий — требовательный и краткий тон. В любом режиме: не стыдить за тело и вес, не называть еду плохой, не советовать голодать, пропускать приёмы пищи или обезвоживаться, не выходить за безопасный темп снижения веса; при признаках недоедания или расстройства питания смягчиться и посоветовать врача; людям до 18 лет не давать советов по снижению веса. Не обещай, что упражнения на пресс убирают жир с живота: жир уходит за счёт питания и общего расхода, а силовые сохраняют мышцы. Не добавляй калории за тренировки к норме.';
const PHOTO='Ты нутрициолог. На фото еда. Если пользователь добавил текст, учитывай его (жирность, вес, состав). Определи блюда и продукты, оцени вес порции в граммах и КБЖУ всей порции. Названия по-русски. Верни ТОЛЬКО JSON: {"items":[{"name":"...","grams":0,"kcal":0,"protein":0,"fat":0,"carbs":0}]}. Если еды на фото нет или пользователь задал вопрос, верни {"items":[],"reply":"краткий ответ по-русски"}.';
const DISH=PHOTO.replace('На фото еда.','Пользователь описал еду текстом. Учитывай указанную жирность и вес; если вес не указан, возьми типичную порцию. Если сообщение не описывает еду, а является вопросом или просьбой, верни {"items":[],"reply":"краткий полезный ответ по-русски, до 80 слов"}; если еды нет и вопроса тоже нет, верни {"items":[],"reply":"Не нашёл в сообщении еду. Напишите, что вы съели."}.');
const MSG={b:['Завтрак','Пора записать завтрак'],l:['Обед','Не забудьте внести обед'],d:['Ужин','Время ужина — добавьте его в дневник'],s:['Перекус','Время перекуса — внесите его в дневник'],e:['Вечерний итог','Посмотрите итоги дня и совет тренера']},DEF={b:'08:30',l:'13:00',d:'19:00',s:'16:30',e:'21:00'};
const b64=u=>Uint8Array.from(atob(u.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)),enc=a=>btoa(String.fromCharCode(...new Uint8Array(a))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hid=async s=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].slice(0,12).map(x=>x.toString(16).padStart(2,'0')).join('');
async function hkdf(salt,ikm,info,len){const k=await crypto.subtle.importKey('raw',ikm,'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt,info},k,len*8))}
async function push(env,s,msg){try{const te=new TextEncoder(),ua=b64(s.keys.p256dh),auth=b64(s.keys.auth),salt=crypto.getRandomValues(new Uint8Array(16)),
 eph=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),asPub=new Uint8Array(await crypto.subtle.exportKey('raw',eph.publicKey)),
 uaKey=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]),
 ecdh=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:uaKey},eph.privateKey,256)),
 info=new Uint8Array([...te.encode('WebPush: info\0'),...ua,...asPub]),ikm=await hkdf(auth,ecdh,info,32),
 cek=await hkdf(salt,ikm,te.encode('Content-Encoding: aes128gcm\0'),16),nonce=await hkdf(salt,ikm,te.encode('Content-Encoding: nonce\0'),12),
 key=await crypto.subtle.importKey('raw',cek,'AES-GCM',false,['encrypt']),
 ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,new Uint8Array([...te.encode(JSON.stringify(msg)),2]))),
 body=new Uint8Array([...salt,0,0,16,0,65,...asPub,...ct]),
 u=new URL(s.endpoint),jwk=JSON.parse(env.VAPID_KEY),sk=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']),
 h=enc(te.encode('{"typ":"JWT","alg":"ES256"}')),p=enc(te.encode(JSON.stringify({aud:u.origin,exp:Math.floor(Date.now()/1000)+43200,sub:(env.CONTACT||'https://kolpakov-uz.github.io/kalorii/')}))),
 sig=enc(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},sk,te.encode(h+'.'+p))),pub=enc(new Uint8Array([4,...b64(jwk.x),...b64(jwk.y)]));
 const r=await fetch(s.endpoint,{method:'POST',headers:{'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'3600',Urgency:'high',Authorization:`vapid t=${h}.${p}.${sig}, k=${pub}`},body});globalThis.__pr=(await r.text().catch(()=>'')).slice(0,160);return r.status}catch(e){globalThis.__pr=String(e&&e.message||e).slice(0,160);return 0}}
async function tick(env){const raw=await env.SUBS.get('subs');if(!raw)return;const subs=JSON.parse(raw);let dirty=false;
 let allowed;try{allowed=allowedTelegramIds(env)}catch{return}
 const mn=x=>+x.slice(0,2)*60+ +x.slice(3,5),ok=x=>/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(x||'');
 for(const [id,u] of Object.entries(subs)){if(!allowed.includes(u.ownerId))continue;const hm=new Date(Date.now()+u.tz*60000).toISOString().slice(11,16),out=[],c=u.cfg||{},on=c.on||{},t=c.t||{};
  for(const k in MSG)if(on[k]&&(ok(t[k])?t[k]:DEF[k])==hm)out.push({tag:k,title:MSG[k][0],body:MSG[k][1]});
  const W=c.wc||{},f=ok(W.from)?W.from:'09:00',to=ok(W.to)?W.to:'21:00',ev=Math.min(3,Math.max(1,+W.ev||2));
  if(on.w&&hm>=f&&hm<=to&&(mn(hm)-mn(f))%(ev*60)==0)out.push({tag:'w',title:'Вода',body:'Выпейте стакан воды'});
  for(const m of out){const r=await push(env,u.s,m);if(r==404||r==410){delete subs[id];dirty=true;break}}}
 if(dirty)await env.SUBS.put('subs',JSON.stringify(subs))}
const FOOD=`Ты помощник в дневнике питания. Пользователь пишет сообщения про еду. Верни ТОЛЬКО JSON: {"actions":[...],"reply":"..."}.
Типы сообщений:
1) Новая еда: {"op":"add","name":"название","grams":вес всей съеденной порции в граммах,"kcal100":0,"protein100":0,"fat100":0,"carbs100":0}. Значения даются НА 100 г. Если пользователь назвал вес, используй его, иначе типичную порцию. Если пользователь сказал, что съел долю блюда (60%, половину, треть), grams = полный вес порции × доля.
2) Исправление уже записанного (слова «исправь», «на самом деле», «это был», «только», «я съел 60% этого», «убери соус», поправка веса или состава без нового блюда): {"op":"edit","id":"id из списка записей","grams":новый вес,"name":"если меняется"}. Меняй только то, что просит пользователь. Значения на 100 г указывай только если изменился состав. НЕ создавай новое блюдо.
3) Удалить запись: {"op":"delete","id":"..."}.
4) Вопрос или просьба без еды: "actions":[] и "reply" с коротким полезным ответом по-русски (до 80 слов).
Правила: значения на 100 г должны быть правдоподобными и всегда одинаковыми для одного и того же блюда. Если блюдо есть в списке «Известные блюда пользователя», используй его значения на 100 г без изменений и то же название. Названия короткие, по-русски. Если сообщение непонятно, верни actions:[] и reply с вопросом.`;
const hits=new Map();
export default{async fetch(req,env){
 const allow=env.ORIGIN||'https://kolpakov-uz.github.io';
 const cors={'Access-Control-Allow-Origin':allow,'Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'};
 const j=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(req.method=='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!='POST'||req.headers.get('Origin')!=allow)return j({error:'forbidden'},403);
 if(+req.headers.get('Content-Length')>2e6)return j({error:'too_big'},413);
 let b;try{b=await req.json()}catch{return j({error:'bad'},400)}
 if(!b||typeof b!='object'||Array.isArray(b))return j({error:'bad'},400);
 // Only a verified native Telegram launch can grant or revoke browser access.
 const management=b.mode=='browser_link'||b.mode=='browser_revoke';
 const access=management||b.telegramInitData||!b.browserToken?await verifyTelegramAccess(b.telegramInitData,env):await verifyBrowserAccess(b.browserToken,env);
 if(!access.ok)return j({error:access.error},access.status);
 if(b.mode=='access')return j({allowed:true});
 if(b.mode=='browser_logout'){
  if(!access.browserKey)return j({error:'bad'},400);
  try{await env.SUBS.delete(access.browserKey);return j({ok:true})}catch{return j({error:'browser_unavailable'},503)}
 }
 const now=Date.now(),key=access.userId+'|'+(management?'browser':b.mode=='transcribe'?'voice':'main'),a=(hits.get(key)||[]).filter(t=>now-t<60000);
 if(a.length>=(b.mode=='transcribe'?12:6))return j({error:'rate'},429);a.push(now);hits.set(key,a);
 if(hits.size>5000)hits.clear();
 if(management){
  try{if(b.mode=='browser_link')return j(await issueBrowserAccess(access.userId,env));await revokeBrowsers(access.userId,env);return j({ok:true})}
  catch{return j({error:'browser_unavailable'},503)}
 }

 if(b.mode=='test'){const s=b.sub;if(!s||typeof s.endpoint!='string'||!s.keys||!/^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|push\.apple\.com|mozilla\.com|mozaws\.net|windows\.com)\//.test(s.endpoint))return j({error:'bad'},400);const st=await push(env,s,{tag:'test',title:'Тест пушей',body:'Если вы это видите, серверные пуши работают.'});return j({text:JSON.stringify({status:st,detail:globalThis.__pr||'',kv:!!env.SUBS,key:!!env.VAPID_KEY})})}
 if(b.mode=='sync'||b.mode=='unsync'){
  if(!env.SUBS)return j({error:'no_kv'},500);
  const subs=JSON.parse(await env.SUBS.get('subs')||'{}');
  if(b.mode=='unsync'){const id=await hid(String(b.endpoint||''));if(subs[id]&&subs[id].ownerId!==access.userId)return j({error:'forbidden'},403);delete subs[id]}
  else{const s=b.sub;if(!s||typeof s.endpoint!='string'||!/^https:\/\/([a-z0-9-]+\.)*(googleapis\.com|push\.apple\.com|mozilla\.com|mozaws\.net|windows\.com)\//.test(s.endpoint)||!s.keys||!s.keys.p256dh||!s.keys.auth||JSON.stringify(b.cfg||{}).length>2000)return j({error:'bad'},400);
   if(Object.keys(subs).length>500)return j({error:'full'},507);
   const id=await hid(s.endpoint);if(subs[id]&&subs[id].ownerId!==access.userId)return j({error:'forbidden'},403);
   subs[id]={ownerId:access.userId,s:{endpoint:s.endpoint,keys:{p256dh:String(s.keys.p256dh),auth:String(s.keys.auth)}},tz:Math.max(-720,Math.min(840,Math.round(+b.tz||0))),cfg:b.cfg||{}}}
  await env.SUBS.put('subs',JSON.stringify(subs));return j({text:'ok'})}
 let body;
 const cx=String(b.context||'').slice(0,3500),ut=String(b.text||'').slice(0,300),pt=b.portion?'\nДоля порции из сообщения: '+(+b.portion):'',msg=(cx?'КОНТЕКСТ:\n'+cx+'\n\n':'')+'СООБЩЕНИЕ: ';
 if(b.mode=='transcribe'){
  try{body=transcriptionBody(b.audio)}catch{return j({error:'bad_audio'},400)}
 }else if(b.mode=='photo'){
  if(typeof b.image!='string'||b.image.length>1.6e6)return j({error:'too_big'},413);
  body={systemInstruction:{parts:[{text:FOOD}]},contents:[{role:'user',parts:[{inlineData:{mimeType:'image/jpeg',data:b.image}},{text:msg+(ut||'Что на фото?')+pt}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:1000,temperature:0}};
 }else if(b.mode=='dish'&&typeof b.text=='string'){
  body={systemInstruction:{parts:[{text:FOOD}]},contents:[{role:'user',parts:[{text:msg+ut+pt}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:1000,temperature:0}};
 }else if(b.mode=='chat'&&Array.isArray(b.messages)){
  const m=b.messages.slice(-10).map(x=>({role:x.role=='user'?'user':'model',parts:[{text:String(x.content||'').slice(0,2000)}]}));
  if(!m.length||m.at(-1).role!='user')return j({error:'bad'},400);
  body={systemInstruction:{parts:[{text:SYS+'\n\n'+String(b.context||'').slice(0,6000)}]},contents:m,generationConfig:{responseMimeType:'application/json',maxOutputTokens:900,temperature:.5}};
 }else return j({error:'bad'},400);
 let r;
 try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.MODEL||'gemini-2.5-flash-lite'}:generateContent`,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_KEY},body:JSON.stringify(body)})}
 catch(e){if(b.mode=='transcribe')return j({error:'unavailable'},503);throw e}
 if(r.status==429)return j({error:'rate'},429);
 if(!r.ok){
  if(b.mode=='transcribe'){
   // Expose only status categories, never upstream messages, audio or secrets.
   return j({error:r.status==400?'audio_rejected':r.status==401||r.status==403?'ai_access':'ai',upstreamStatus:r.status},502);
  }
  return j({error:'ai'},502);
 }
 let d;try{d=await r.json()}catch(e){if(b.mode=='transcribe')return j({error:'transcript'},502);throw e}
 if(b.mode=='transcribe'){try{return j({text:transcriptionText(d)})}catch{return j({error:'transcript'},502)}}
 return j({text:(d.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('')});
},async scheduled(e,env,ctx){ctx.waitUntil(tick(env))}}
