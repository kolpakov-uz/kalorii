import {aiFailure,coachText,foodText} from './ai-errors.js';
import {transcriptionText} from './voice.js';
import {responseSchema} from './ai-schema.js';

const quotaDate = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
const recentCooldowns = new WeakMap();

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

async function cooldownResponse(storage, key) {
  if (!storage) return null;
  try {
    // KV writes propagate asynchronously. Remember our own failures immediately.
    const state = recentCooldowns.get(storage)?.get(key) || JSON.parse(await storage.get(key));
    const now = Date.now();
    if (state?.day === quotaDate.format(now) && state.status === 429) {
      return Response.json({error:{code:'quota_exceeded'}}, {status:429});
    }
    if (state?.until > now && [403,404,408,429,502,503].includes(state.status)) {
      const payload=state.error === 'invalid_response' ? {error:{code:'invalid_response'}} : {};
      return Response.json(payload, {status:state.status,headers:{'Retry-After':String(Math.ceil((state.until-now)/1000))}});
    }
  } catch {
    // A storage outage must not prevent a direct attempt with Gemini.
  }
  return null;
}

async function saveCooldown(storage, key, response, failure, startedAt) {
  if (!storage) return;
  const now = Date.now();
  let state, seconds;
  if (failure.data.error === 'quota') {
    // Compare calendar days so midnight recovery also handles daylight saving.
    state = {status:429,day:quotaDate.format(startedAt)};
    seconds = 26*60*60;
  } else if (response.status === 429 || response.status === 403 || response.status === 404) {
    seconds = response.status === 429 ? failure.data.retryAfter : 5*60;
    state = {status:response.status,until:now+seconds*1000};
  } else if (failure.data.retryable) {
    seconds = 30;
    state = {status:failure.status,until:now+seconds*1000,error:failure.data.error};
  } else return;
  try {
    let recent=recentCooldowns.get(storage);
    if(!recent){recent=new Map();recentCooldowns.set(storage,recent)}
    recent.set(key,state);
    await storage.put(key, JSON.stringify(state), {expirationTtl:Math.max(60,Math.ceil(seconds))});
  } catch {
    // The next model can still answer when a cooldown cannot be saved.
  }
}

export async function generateContent(env, body, mode) {
  const models = [...new Set([env.MODEL || 'gemini-3.5-flash-lite', ...String(env.MODEL_FALLBACKS || '').split(',')].map(model=>model.trim()).filter(Boolean))];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.GEMINI_KEY || ''));
  const scope = [...new Uint8Array(digest)].slice(0,12).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const failures = [];
  const deadline = Date.now()+24000;

  for (const [index,model] of models.entries()) {
    const key = 'gemini:cooldown:v1:'+scope+':'+model;
    let response = await cooldownResponse(env.SUBS, key);
    let networkFailure = false;
    if (!response) {
      const startedAt = Date.now();
      const controller = new AbortController();
      // Leave time for every fallback inside the client's 45-second timeout.
      const timeout = Math.max(1,Math.min(8000,Math.floor((deadline-Date.now())/(models.length-index))));
      const timer = setTimeout(()=>controller.abort(),timeout);
      try {
        const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method:'POST',
          headers:{'Content-Type':'application/json','x-goog-api-key':env.GEMINI_KEY},
          body:JSON.stringify(modelRequest(body,model,mode)),
          signal:controller.signal
        });
        response = new Response(await upstream.text(), {status:upstream.status,headers:upstream.headers});
      } catch {
        networkFailure = true;
        response = Response.json({}, {status:503});
      } finally {
        clearTimeout(timer);
      }
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
      if (![403,404,408,429].includes(response.status) && response.status < 500) return response;
      await saveCooldown(env.SUBS,key,response,failure,startedAt);
      failures.push({response,failure,networkFailure});
    } else {
      failures.push({response,failure:await aiFailure(response.clone())});
    }
  }

  // A short-lived failure should remain retryable even if another model has
  // exhausted its daily quota. Otherwise the client would pause until tomorrow.
  const temporary = failures.filter(result=>result.failure.data.retryable);
  temporary.sort((a,b)=>(a.failure.data.retryAfter || 10)-(b.failure.data.retryAfter || 10));
  const result = temporary[0] || failures.find(result=>result.failure.data.error === 'quota') || failures[0];
  if (result.networkFailure) throw new Error('unavailable');
  return result.response;
}
