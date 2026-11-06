// The screen is a convenience; the Worker independently validates every request.
const PrivateAccess={
 state:'checking',error:'',
 get allowed(){return this.state==='allowed'},
 async request(body,options={}){
  const response=await fetch(API,{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(KaloriiTelegram.requestData(body))});
  if((response.status===401||response.status===403)&&this.allowed){const data=await response.clone().json().catch(()=>({}));this.state='closed';this.error=data.error||'telegram_auth_required';render()}
  return response;
 },
 async check(){
  this.state='checking';render();
  try{
   const response=await this.request({mode:'access'}),data=await response.json();
   if(response.ok&&data.allowed===true){this.state='allowed';this.error='';render();anim();schedSync();return}
   this.state='closed';this.error=data.error||'unavailable';
  }catch{this.state='closed';this.error='unavailable'}
  render();
 },
 markup(hasDiary){
  const pending=this.state==='checking',id=KaloriiTelegram.userId();
  const descriptions={telegram_not_allowed:'Этому Telegram-аккаунту доступ пока не предоставлен.',telegram_auth_required:'Откройте приложение кнопкой в боте @caloriies_ai_bot.',telegram_auth_invalid:'Не удалось проверить вход. Закройте мини-приложение и откройте его снова через бота.',telegram_auth_expired:'Срок входа истёк. Закройте мини-приложение и заново откройте его через бота.',private_not_configured:'Настройка личного доступа ещё не завершена.'};
  return `<h1>Калории</h1><p class="sub">Личный дневник питания</p><section class="card"><h2>${pending?'Проверяем вход…':'Личное приложение'}</h2><p class="em">${pending?'Подождите немного.':descriptions[this.error]||'Не удалось связаться с сервером. Проверьте интернет и повторите вход.'}</p>${!pending?`<a class="ghost access-link" href="${KaloriiTelegram.botUrl}">Открыть Telegram-бота</a><button class="ghost" onclick="PrivateAccess.check()">Проверить снова</button>${id?`<p class="em">ID этого аккаунта: ${id}</p>`:''}`:''}</section>${hasDiary?'<section class="card"><h3>Ваш дневник на устройстве</h3><p class="em">Записи сохранены. Можно выгрузить копию для переноса.</p><button class="ghost" onclick="exportDiary()">Сохранить дневник в файл</button></section>':''}`;
 }
};
