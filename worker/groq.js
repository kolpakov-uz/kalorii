import {foodText,coachText} from './ai-errors.js';
import {fastPhotoInstruction} from './food.js';
// Optional free-plan reserve. The API key exists only in Worker secrets.
const cooling=new Map();
const hasImage=body=>(body.contents||[]).some(t=>(t.parts||[]).some(p=>p.inlineData?.mimeType?.startsWith('image/')));
export function groqMessages(body,mode){
 const photo=(mode==='dish'||mode==='photo')&&hasImage(body);
 const system=photo?fastPhotoInstruction:body.systemInstruction?.parts?.map(p=>p.text||'').join('\n')||'';
 const messages=[{role:'system',content:system+'\nВерни только корректный JSON без Markdown.'}];
 for(const turn of body.contents||[]){
  const content=(turn.parts||[]).flatMap(part=>part.text?[{type:'text',text:part.text}]:part.inlineData?.mimeType?.startsWith('image/')?[{type:'image_url',image_url:{url:`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`}}]:[]);
  messages.push({role:turn.role==='model'?'assistant':'user',content:content.every(p=>p.type==='text')?content.map(p=>p.text).join('\n'):content});
 }
 return messages;
}
export async function groqContent(env,body,mode,signal){
 const image=hasImage(body);
 // Current image models on Groq are preview; enable only after an explicit
 // account/model check. Text reserve uses a production model by default.
 const model=image?env.GROQ_VISION_MODEL:'openai/gpt-oss-20b';
 if(!env.GROQ_API_KEY||!model||mode==='transcribe'||(cooling.get(model)||0)>Date.now())return null;
 try{
  const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+env.GROQ_API_KEY},signal,body:JSON.stringify({model,messages:groqMessages(body,mode),response_format:{type:'json_object'},max_completion_tokens:2200,reasoning_effort:image?'none':'low',temperature:0})});
  if(!response.ok){if([401,403,404,429].includes(response.status)||response.status>=500){const retry=Number(response.headers.get('Retry-After'));cooling.set(model,Date.now()+Math.min(3600,Math.max(response.status===429?60:300,retry||0))*1000)}return null}
  const result=await response.json(),choice=result.choices?.[0],text=choice?.message?.content;
  if(choice?.finish_reason&&choice.finish_reason!=='stop')return null;
  const data={candidates:[{content:{parts:[{text}]},finishReason:'STOP'}]};
  if(mode==='dish'||mode==='photo')foodText(data);else coachText(data);
  return Response.json(data);
 }catch{return null}
}
// Gemini starts first. A slow or failing request gets an independent reserve;
// only a fully validated answer can win. No diary writes happen in either call.
export async function withReserve(env,body,mode,primary){
 if(!env.GROQ_API_KEY||mode==='transcribe')return primary();
 const abort=new AbortController(),mainAbort=new AbortController();let start,timer,deadline,settled=false,mainDone=false,reserveDone=false,mainResult;
 return new Promise(resolve=>{
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(deadline);abort.abort();mainAbort.abort();resolve(value)};
  const reserve=()=>{if(start||settled)return;start=true;deadline=setTimeout(()=>{abort.abort();reserveDone=true;if(mainDone)finish(mainResult)},10000);groqContent(env,body,mode,abort.signal).then(value=>{reserveDone=true;if(value?.ok)finish(value);else if(mainDone)finish(mainResult)})};
  // A photo has no local text lookup: start its independent vision reserve
  // immediately. Gemini remains available and either validated answer can win.
  timer=setTimeout(reserve,env.GROQ_VISION_MODEL&&hasImage(body)?0:700);
  Promise.resolve().then(()=>primary(mainAbort.signal)).catch(()=>Response.json({error:{code:'unavailable'}},{status:503})).then(value=>{mainDone=true;mainResult=value;if(value.ok)finish(value);else{reserve();if(reserveDone)finish(value)}});
 });
}
