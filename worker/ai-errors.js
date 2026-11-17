export async function aiFailure(response) {
  const status=response.status;
  if(status===429){
    const payload=await response.json().catch(()=>({}));
    const details=Array.isArray(payload?.error?.details)?payload.error.details:[];
    const violations=details.flatMap(detail=>Array.isArray(detail.violations)?detail.violations:[]);
    const dailyQuota=payload?.error?.code==='quota_exceeded'||violations.some(violation=>/perday|per_day|daily/i.test(String(violation.quotaId||'')+' '+String(violation.quotaMetric||'')));
    if(dailyQuota)return {status:429,data:{error:'quota',retryable:false}};
    const header=response.headers.get('Retry-After');
    const retryInfo=details.find(detail=>String(detail['@type']||'').endsWith('/google.rpc.RetryInfo'));
    const delay=Number.parseFloat(retryInfo?.retryDelay);
    const headerDelay=header&&Number.isFinite(Number(header))?Number(header):(Date.parse(header)-Date.now())/1000;
    const retryAfter=Math.max(1,Math.ceil(Number.isFinite(headerDelay)?headerDelay:Number.isFinite(delay)?delay:10));
    return {status:429,data:{error:'rate',retryable:true,retryAfter}};
  }
  if(status===401||status===403)return {status:502,data:{error:'ai_access',retryable:false}};
  if(status===404)return {status:502,data:{error:'ai_model',retryable:false}};
  if(status===402)return {status:502,data:{error:'ai_billing',retryable:false}};
  if(status===408||status>=500)return {status:503,data:{error:'unavailable',retryable:true}};
  return {status:502,data:{error:'ai_request',retryable:false}};
}

export function foodText(data) {
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
