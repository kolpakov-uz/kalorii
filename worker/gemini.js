import {aiFailure,coachText,foodText} from './ai-errors.js';
import {transcriptionText} from './voice.js';
import {responseSchema} from './ai-schema.js';

const quotaDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
const recentCooldowns = new WeakMap();
const KV_TIMEOUT = 250;

function modelRequest(body, model, mode) {
  const config = {...body.generationConfig,responseJsonSchema:responseSchema(mode)};
  if (!['gemini-4-hydrogen','gemini-3.8-flash'].includes(model)) return {...body,generationConfig:config};
  delete config.temperature;
  delete config.topP;
  delete config.topK;
  config.maxOutputTokens = Math.max(8192,config.maxOutputTokens || 0);
  const hasImage = body.contents.some(turn=>turn.parts.some(part=>part.inlineData?.mimeType?.startsWith('image/')));
  config.thinkingConfig = {thinkingLevel:mode === 'chat' || hasImage ? 'MEDIUM' : 'LOW'};
  return {...body,generationConfig:config};
}

async function boundedStorage(operation){
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),KV_TIMEOUT)})
    ]);
  }catch{return null}
  finally{clearTimeout(timer)}
}

function activeCooldown(state, shared){
  if(!state||typeof state!=='object')return false;
  if(!Number.isInteger(state.status)||state.status<400||state.status>599)return false;
  // Older v1 keys also held request failures. They must not block other modes.
  if(shared&&![403,404,429].includes(state.status)&&state.scope!=='model')return false;
  if(state.status===429&&state.day===quotaDate.format(Date.now()))return true;
  return Number.isFinite(state.until)&&state.until>Date.now();
}

async function cooldownState(storage, key, shared) {
  if (!storage) return null;
  try {
    // KV writes propagate asynchronously. Remember our own failures immediately.
    const recent=recentCooldowns.get(storage),local=recent?.get(key);
    if(activeCooldown(local,shared))return local;
    if(local)recent.delete(key);
    const state=JSON.parse(await boundedStorage(()=>storage.get(key)));
    if(activeCooldown(state,shared))return state;
  } catch {
    // A storage outage must not prevent a direct attempt with Gemini.
  }
  return null;
}

function failureResponse(response,failure,until){
  const retryAfter=Number.isFinite(until)?Math.max(1,Math.ceil((until-Date.now())/1000)):failure.data.retryAfter;
  const code=failure.data.error==='quota'?'quota_exceeded':failure.data.error;
  // Never pass upstream messages, request contents or credentials back to callers.
  return Response.json({error:{code}},{status:response.status,headers:retryAfter?{'Retry-After':String(retryAfter)}:{}});
}

function stateResponse(state){
  const error=state.day?'quota':({429:'rate',403:'ai_access',404:'ai_model',408:'timeout'}[state.status])||(['invalid_response','timeout','unavailable'].includes(state.error)?state.error:'unavailable');
  const response=Response.json({error:{code:error==='quota'?'quota_exceeded':error}},{status:state.status});
  return failureResponse(response,{data:{error}},state.until);
}

async function saveCooldown(storage, sharedKey, modeKey, response, failure, startedAt, modelWide) {
  const now = Date.now();
  let state, seconds,key;
  if (failure.data.error === 'quota') {
    // Compare calendar days so midnight recovery also handles daylight saving.
    state = {status:429,day:quotaDate.format(startedAt)};
    seconds = 26*60*60;
    key=sharedKey;
  } else if (response.status === 429 || response.status === 403 || response.status === 404) {
    seconds = response.status === 429 ? failure.data.retryAfter : 5*60;
    state = {status:response.status,until:now+seconds*1000};
    key=sharedKey;
  } else if (failure.data.retryable) {
    seconds = Math.max(30,failure.data.retryAfter||0);
    state = {status:response.status,until:now+seconds*1000,error:failure.data.error};
    // A real upstream overload affects the model, while malformed replies,
    // local aborts and transport failures are specific to this request mode.
    if(modelWide)state.scope='model';
    key=modelWide?sharedKey:modeKey;
  } else return;
  if(storage){
    let recent=recentCooldowns.get(storage);
    if(!recent){recent=new Map();recentCooldowns.set(storage,recent)}
    recent.set(key,state);
    // A slow or unavailable KV binding must leave time for the fallback models.
    await boundedStorage(()=>storage.put(key, JSON.stringify(state), {expirationTtl:Math.max(60,Math.ceil(seconds))}));
  }
  return state;
}

export async function generateContent(env, body, mode, requestId='',signal) {
  const models = [...new Set([env.MODEL || 'gemini-3.5-flash-lite', ...String(env.MODEL_FALLBACKS || '').split(',')].map(model=>model.trim()).filter(Boolean))];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.GEMINI_KEY || ''));
  const scope = [...new Uint8Array(digest)].slice(0,12).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const failures = [];
  const group=mode==='dish'||mode==='photo'?'food':mode==='transcribe'?'transcribe':'chat';
  const task=typeof requestId==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(requestId)?requestId:'';
  const modelTimeout=mode==='transcribe'?12000:8000;
  const deadline = Date.now()+(mode==='transcribe'?36000:24000);

  for (const [index,model] of models.entries()) {
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const sharedKey = 'gemini:cooldown:v1:'+scope+':'+model;
    const modeKey = task?'gemini:cooldown:v3:'+scope+':'+model+':'+group+':'+task:'gemini:cooldown:v2:'+scope+':'+model+':'+group;
    const [shared,local]=await Promise.all([cooldownState(env.SUBS,sharedKey,true),cooldownState(env.SUBS,modeKey,false)]);
    // If both gates are active, the model is usable only after the longer one.
    const cached=shared?.day?shared:shared&&local?(shared.until>=local.until?shared:local):shared||local;
    let response = cached?stateResponse(cached):null;
    if (!response) {
      const startedAt = Date.now();
      let upstreamFailure=false;
      const controller = new AbortController();
      const cancel=()=>controller.abort();signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted)cancel();
      // Leave time for every fallback inside the client's 45-second timeout.
      const timeout = Math.max(1,Math.min(modelTimeout,Math.floor((deadline-Date.now())/(models.length-index))));
      const timer = setTimeout(()=>controller.abort(),timeout);
      try {
        const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method:'POST',
          headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_KEY},
          body:JSON.stringify(modelRequest(body,model,mode)),
          signal:controller.signal
        });
        response = new Response(await upstream.text(), {status:upstream.status,headers:upstream.headers});
        upstreamFailure=upstream.status>=500;
      } catch {
        response = controller.signal.aborted
          ?Response.json({error:{code:'timeout'}},{status:408})
          :Response.json({error:{code:'unavailable'}},{status:503});
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort',cancel);
      }
      // A reserve winner is not a Google outage and must not open a cooldown.
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      if (response.ok) {
        try {
          const data=await response.clone().json();
          if(mode === 'dish' || mode === 'photo')foodText(data);
          else if(mode === 'transcribe')transcriptionText(data);
          else coachText(data);
          return response;
        } catch(error) {
          if(error.retryable===false)return response;
          response=Response.json({error:{code:'invalid_response'}},{status:502});
        }
      }
      const failure = await aiFailure(response.clone());
      // Invalid input, credentials and billing require their own correction.
      if (![403,404,408,429].includes(response.status) && response.status < 500) return failureResponse(response,failure);
      const state=await saveCooldown(env.SUBS,sharedKey,modeKey,response,failure,startedAt,upstreamFailure&&failure.data.error!=='invalid_response');
      failures.push({response,failure,state});
    } else {
      failures.push({response,failure:await aiFailure(response.clone()),state:cached});
    }
  }

  // A short-lived failure should remain retryable even if another model has
  // exhausted its daily quota. Otherwise the client would pause until tomorrow.
  const temporary = failures.filter(result=>result.failure.data.retryable);
  const retryAt=result=>result.state?.until||Date.now()+(result.failure.data.retryAfter||30)*1000;
  temporary.sort((a,b)=>retryAt(a)-retryAt(b));
  const result = temporary[0] || failures.find(result=>result.failure.data.error === 'quota') || failures[0];
  return failureResponse(result.response,result.failure,result.state?.until);
}
