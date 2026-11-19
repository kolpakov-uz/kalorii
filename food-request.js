const FoodRequest=(()=>{
  function invalid(){return Object.assign(new Error('invalid_response'),{kind:'invalid_response',retryable:true})}
  function failure(response,data={}){
    const kind=data.error||'server';
    const permanent=['quota','ai_access','ai_model','ai_billing','ai_request','ai_blocked','bad_image','too_big','private_not_configured'].includes(kind)||response.status===401||response.status===403;
    const retryable=!permanent&&(data.retryable===true||response.status===408||response.status>=500||response.status===429);
    return Object.assign(new Error(kind),{kind,code:response.status===429?'rl':'err',status:response.status,retryable,retryAfter:Number(data.retryAfter)||0});
  }
  async function run(request,parse,onProgress=()=>{},labels={}){
    let previousError=null;
    const deadline=Date.now()+45000;
    for(let attempt=0;attempt<3;attempt++){
      const controller=new AbortController();
      const remaining=deadline-Date.now();
      if(remaining<=0)throw previousError||new DOMException('timeout','AbortError');
      const timeout=setTimeout(()=>controller.abort(),remaining);
      let delay;
      try{
        onProgress(attempt?(labels.retry||'Продолжаю считать…'):(labels.start||'Считаю КБЖУ…'));
        const raw=await request(controller.signal,attempt,previousError);
        return parse(raw);
      }catch(error){
        previousError=error;
        const transient=error.retryable===true||['TypeError','AbortError','SyntaxError'].includes(error.name);
        if(!transient||error.retryable===false||attempt===2)throw error;
        delay=Math.max(attempt?6000:2000,(Number(error.retryAfter)||0)*1000)+Math.floor(Math.random()*350);
        if(delay>60000||Date.now()+delay>=deadline)throw error;
        // Only the transport and parsing are repeated. The caller applies the result once.
        onProgress(error.name==='TypeError'?'Восстанавливаю соединение…':labels.retry||'Продолжаю считать…');
      }finally{clearTimeout(timeout)}
      await new Promise(resolve=>setTimeout(resolve,delay));
    }
  }
  function message(error,retryHint='Запрос можно продолжить кнопкой ниже.'){
    const messages={
      quota:'Лимит ИИ на сегодня исчерпан. Исходное сообщение сохранено в переписке.',
      rate:'Сервис просит немного подождать. Исходное сообщение сохранено в переписке.',
      ai_access:'Сервис ИИ требует проверки доступа. Исходное сообщение сохранено в переписке.',
      ai_model:'Выбранная модель ИИ сейчас недоступна. Исходное сообщение сохранено в переписке.',
      ai_billing:'Доступ к ИИ приостановлен на стороне провайдера. Исходное сообщение сохранено в переписке.',
      ai_request:'Сервис ИИ отклонил запрос. Исходное сообщение сохранено в переписке.',
      ai_blocked:'ИИ просит изменить описание или фотографию. Исходное сообщение сохранено в переписке.',
      bad_image:'Фотографию не удалось прочитать. Попробуйте выбрать другой снимок.',
      too_big:'Фото слишком большое для отправки. Выберите снимок меньшего размера.',
      invalid_response:'ИИ пока вернул неполный ответ. '+retryHint,
      save_failed:'Расчёт получен, но запись не сохранилась. '+retryHint
    };
    if(error.status===401||error.status===403)return 'Для продолжения откройте приложение заново через Telegram. Исходное сообщение сохранено в переписке.';
    if(error.name==='TypeError')return 'Соединение пока не восстановилось. '+retryHint;
    return messages[error.kind||error.message]||'Сервис пока занят. '+retryHint;
  }
  return {run,failure,invalid,message};
})();
