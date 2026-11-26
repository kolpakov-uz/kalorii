import {coachActions} from './ai-schema.js';
import '../nutrition.js';

function retryDelay(response){
  const header=response.headers.get('Retry-After');
  if(!header)return null;
  const seconds=Number.isFinite(Number(header))?Number(header):(Date.parse(header)-Date.now())/1000;
  return Number.isFinite(seconds)?Math.max(1,Math.ceil(seconds)):null;
}

export async function aiFailure(response) {
  const status=response.status;
  const retryAfter=retryDelay(response);
  if(status===502){
    const payload=await response.clone().json().catch(()=>({}));
    if(payload?.error?.code==='invalid_response')return {status:502,data:{error:'invalid_response',retryable:true,...(retryAfter?{retryAfter}:{})}};
  }
  if(status===429){
    const payload=await response.json().catch(()=>({}));
    const details=Array.isArray(payload?.error?.details)?payload.error.details:[];
    const violations=details.flatMap(detail=>Array.isArray(detail.violations)?detail.violations:[]);
    const dailyQuota=payload?.error?.code==='quota_exceeded'||violations.some(violation=>/perday|per_day|daily/i.test(String(violation.quotaId||'')+' '+String(violation.quotaMetric||'')));
    if(dailyQuota)return {status:429,data:{error:'quota',retryable:false}};
    const retryInfo=details.find(detail=>String(detail['@type']||'').endsWith('/google.rpc.RetryInfo'));
    const delay=Number.parseFloat(retryInfo?.retryDelay);
    return {status:429,data:{error:'rate',retryable:true,retryAfter:retryAfter||Math.max(1,Math.ceil(Number.isFinite(delay)?delay:10))}};
  }
  if(status===401||status===403)return {status:502,data:{error:'ai_access',retryable:false}};
  if(status===404)return {status:502,data:{error:'ai_model',retryable:false}};
  if(status===402)return {status:502,data:{error:'ai_billing',retryable:false}};
  if(status===408||status>=500){
    const data={error:status===408?'timeout':'unavailable',retryable:true};
    if(retryAfter)data.retryAfter=retryAfter;
    return {status:503,data};
  }
  return {status:502,data:{error:'ai_request',retryable:false}};
}

export function candidateText(data) {
  const candidate=data?.candidates?.[0];
  const blocked=data?.promptFeedback?.blockReason;
  const blockedOutput=['SAFETY','RECITATION','LANGUAGE','BLOCKLIST','PROHIBITED_CONTENT','SPII','IMAGE_SAFETY','IMAGE_PROHIBITED_CONTENT','IMAGE_RECITATION'].includes(candidate?.finishReason);
  if((blocked&&blocked!=='BLOCK_REASON_UNSPECIFIED')||blockedOutput){
    throw Object.assign(new Error('ai_blocked'),{retryable:false});
  }
  if(candidate?.finishReason&&!['STOP','FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason))throw Object.assign(new Error('invalid_response'),{retryable:true});
  const parts=Array.isArray(candidate?.content?.parts)?candidate.content.parts:[];
  const text=parts.filter(part=>part&&!part.thought).map(part=>typeof part.text==='string'?part.text:'').join('').trim();
  if(!text)throw Object.assign(new Error('invalid_response'),{retryable:true});
  return text;
}

export function foodText(data) {
  const text=candidateText(data);
  const invalid=()=>{throw Object.assign(new Error('invalid_response'),{retryable:true})};
  let response;
  try{response=JSON.parse(text.replace(/```json|```/g,'').trim())}catch{invalid()}
  if(!response||typeof response!=='object'||Array.isArray(response))invalid();
  const actions=Array.isArray(response.actions)?response.actions:Array.isArray(response.items)?response.items.map(item=>({...item,op:'add'})):null;
  if(!actions)invalid();
  const amount=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0;
  for(let i=0;i<actions.length;i++){
    let action=actions[i];
    if(!action||typeof action!=='object'||Array.isArray(action))invalid();
    try{action=Nutrition.normalizeAction(action);actions[i]=action}catch{invalid()}
    if(Object.hasOwn(action,'foodId')&&(typeof action.foodId!=='string'||action.foodId!==''&&!/^[a-zA-Z0-9_.-]{1,100}$/.test(action.foodId)))invalid();
    for(const field of ['grams','g','kcal','protein','fat','carbs','kcal100','protein100','fat100','carbs100']){
      if(action[field]!=null&&!amount(action[field]))invalid();
    }
    if(action.grams!=null&&Number(action.grams)<=0||action.g!=null&&Number(action.g)<=0)invalid();
    const op=action.op||{add_food:'add',edit_food:'edit',delete_food:'delete'}[action.type]||((action.name||action.n)&&action.type==null?'add':null);
    if(op==='add'){
      const name=action.name||action.n;
      if(typeof name!=='string'||!name.trim())invalid();
      for(const [per100,total] of [['kcal100','kcal'],['protein100','protein'],['fat100','fat'],['carbs100','carbs']]){
        if(!amount(action[per100])&&!amount(action[total]))invalid();
      }
    }else if(op==='edit'||op==='delete'){
      if(typeof action.id!=='string'||!action.id.trim())invalid();
      if(op==='edit'&&!['name','grams','kcal100','protein100','fat100','carbs100'].some(field=>action[field]!=null))invalid();
    }else invalid();
    if(op!=='delete'&&!Nutrition.saneAction({...action,op}))invalid();
  }
  if(!actions.length){
    const reply=typeof response.reply==='string'?response.reply.trim():'';
    const vagueFailure=/^(?:не удалось (?:посчитать|подсчитать|рассчитать|обработать запрос)(?:[.,!…\s]+попробуйте (?:ещ[её] раз|позже))?|попробуйте (?:ещ[её] раз|позже))[.!…\s]*$/i.test(reply);
    if(!reply||vagueFailure||/(записал|записан|добавил|добавлен|внес|внёс)/i.test(reply))invalid();
  }
  if(actions.some(action=>action.label)){
    if(actions.every(action=>action.label)){
      const missing=[['protein','белки'],['fat','жиры'],['carbs','углеводы']].filter(([field])=>actions.some(action=>!Object.hasOwn(action.label,field))).map(([,name],index)=>index?name:name[0].toUpperCase()+name.slice(1));
      response.reply=missing.length?'Калории рассчитаны по этикетке с учётом веса порции. '+missing.join(', ')+': приблизительная оценка, на этикетке не указаны.':'Калории рассчитаны по этикетке с учётом веса порции.';
    }
    return JSON.stringify({...response,actions});
  }
  return text;
}
function validCoachValue(value,schema) {
  if(schema.type==='array')return Array.isArray(value)&&value.every(item=>validCoachValue(item,schema.items));
  if(schema.type==='number')return (typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value));
  return typeof value===schema.type&&(!schema.enum||schema.enum.includes(value));
}

export function coachText(data) {
  const text=candidateText(data);
  const invalid=()=>{throw Object.assign(new Error('invalid_response'),{retryable:true})};
  let response;
  try{response=JSON.parse(text.replace(/```json|```/g,'').trim())}catch{invalid()}
  if(!response||typeof response.reply!=='string'||!response.reply.trim()||!Array.isArray(response.actions))invalid();
  for(const action of response.actions){
    if(!action||typeof action!=='object'||Array.isArray(action))invalid();
    const schema=coachActions.find(candidate=>candidate.properties.type.enum[0]===action.type);
    if(!schema||schema.required.some(field=>action[field]==null))invalid();
    for(const [field,value] of Object.entries(action)){
      if(!schema.properties[field]||!validCoachValue(value,schema.properties[field]))invalid();
      if(['id','name'].includes(field)&&!value.trim())invalid();
    }
    if(action.date!=null){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(action.date))invalid();
      const date=new Date(action.date+'T00:00:00Z');
      if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==action.date)invalid();
    }
    if(action.type==='add_workout'&&(!action.kinds.length||Number(action.minutes)<=0||Number(action.minutes)>1440))invalid();
    if(['edit_food','add_measure','update_goal','set_reminder','set_water_reminder'].includes(action.type)&&!Object.keys(action).some(field=>!['type','id','key'].includes(field)))invalid();
  }
  return text;
}
