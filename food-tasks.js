const FoodTasks=(()=>{
  const valid=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(value);
  const id=()=> 'request-'+Date.now().toString(36)+'-'+(Math.random().toString(36).slice(2,10)||'0');

  function follows(text){
    const value=String(text||'').trim().toLowerCase().replace(/^я\s+/,'');
    return /^(?:исправ|измени|поменя|поправ|замени|вместо\s|на самом деле|ошиб|не так|не то|это не|убер|удал|пересчит|нет[,.!]|не\s+\d)/i.test(value)
      ||/^(?:попробуй(?:те)?(?:\s+ещ[её])?(?:\s+раз)?|посчитай(?:те)?\s+(?:сам|ещ[её]|примерно)|уточни(?:те)?)(?:\s|$)/i.test(value)
      ||/^(?:(?:вес|всего|только|около|примерно|это|было|съел[аи]?|ела)\s+)*(?:\d+(?:[.,]\d+)?\s*(?:кг|г|гр|грамм[а-я]*|g|мл|%)|(?:половин[ау]|треть|четверть))(?:\s*(?:порции|этого|блюда|от|всего))*[.!?\s]*$/i.test(value);
  }

  function prepare(history){
    let thread=null,task=null,source=null;
    for(const message of history){
      if(message.r==='me'){
        task=valid(message.task)?message.task:id();
        thread=valid(message.thread)?message.thread:thread&&!message.img&&follows(message.t)?thread:task;
        message.task=task;message.thread=thread;source=message;
      }else{
        if(!valid(message.thread))message.thread=thread||id();
        if(!valid(message.task))message.task=task||id();
        if(source&&/^request-[a-z0-9]+-[a-z0-9]{1,12}$/.test(message.lbl||'')){
          message.task=source.task=message.lbl;
        }
      }
    }
    return history;
  }

  function select(history,text,newPhoto,explicit){
    prepare(history);
    const task=id(),previous=history.findLast(message=>message.r==='me');
    const selected=valid(explicit)&&history.some(message=>message.thread===explicit)?explicit:null;
    return {task,thread:!newPhoto&&(selected||follows(text)&&previous?.thread)||task};
  }

  function queue(limit=2){
    const waiting=[],pending=new Map(),groups=new Set();let active=0;
    function pump(){
      while(active<limit){
        const index=waiting.findIndex(job=>!groups.has(job.group));if(index<0)return;
        const [job]=waiting.splice(index,1);active++;groups.add(job.group);
        const finish=(complete,value)=>{pending.delete(job.key);groups.delete(job.group);active--;complete(value);pump()};
        Promise.resolve().then(job.start).then(value=>finish(job.resolve,value),error=>finish(job.reject,error));
      }
    }
    function run(key,group,start){
      if(pending.has(key))return pending.get(key);
      const promise=new Promise((resolve,reject)=>waiting.push({key,group,start,resolve,reject}));
      pending.set(key,promise);pump();return promise;
    }
    return {run};
  }
  return {valid,id,follows,prepare,select,queue};
})();
