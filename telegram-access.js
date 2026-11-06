// The screen is a convenience; the Worker independently validates every request.
const PrivateAccess={
 state:'checking',error:'',busy:false,storageKey:'kalorii-browser-access-v1',
 get allowed(){return this.state==='allowed'},
 browserToken(){if(KaloriiTelegram.active)return '';try{return localStorage.getItem(this.storageKey)||''}catch{return ''}},
 async request(body,options={}){
  const payload=KaloriiTelegram.requestData(body),token=this.browserToken();delete payload.browserToken;if(token)payload.browserToken=token;
  const response=await fetch(API,{...options,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if((response.status===401||response.status===403)&&this.allowed){const data=await response.clone().json().catch(()=>({}));this.state='closed';this.error=data.error||'telegram_auth_required';render()}
  return response;
 },
 async check(){
  if(this.busy)return;
  this.state='checking';render();
  try{
   const response=await this.request({mode:'access'}),data=await response.json();
   if(response.ok&&data.allowed===true){this.state='allowed';this.error='';render();anim();schedSync();return}
   this.state='closed';this.error=data.error||'unavailable';
  }catch{this.state='closed';this.error='unavailable'}
  render();
 },
 async connect(code){
  if(this.busy)return;
  code=String(code||'').trim();
  if(!/^b1\.[1-9]\d{0,15}\.[a-f0-9]{64}$/.test(code))return toast('Скопируйте код целиком из Telegram → «Веб-версия».',{title:'Проверьте код',type:'warning'});
  this.busy=true;const button=document.getElementById('browser-connect');if(button){button.disabled=true;button.textContent='Подключаем…'}
  try{
   const response=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:'access',browserToken:code})}),data=await response.json();
   if(!response.ok||data.allowed!==true){toast(data.error==='telegram_not_allowed'?'Этому аккаунту доступ не предоставлен.':'Код не принят. Если он только что создан, подождите минуту и повторите подключение.',{title:'Не удалось подключить браузер',type:'warning'});return}
   try{localStorage.setItem(this.storageKey,code)}catch{toast('Разрешите сохранение данных сайта в браузере и повторите подключение.',{type:'error'});return}
   this.state='allowed';this.error='';render();anim();schedSync();toast('Можно пользоваться приложением напрямую, без запуска Telegram.',{title:'Браузер подключён'});
  }catch{toast('Не удалось связаться с сервером. Код сохранён в поле — попробуйте ещё раз.',{type:'error'})}
  finally{this.busy=false;if(button){button.disabled=false;button.textContent='Подключить браузер'}}
 },
 async showLink(){
  if(!KaloriiTelegram.active||this.busy)return;
  this.busy=true;
  try{
   const response=await this.request({mode:'browser_link'}),data=await response.json();
   if(!response.ok||!/^b1\.[1-9]\d{0,15}\.[a-f0-9]{64}$/.test(data.browserToken||'')){toast(response.status===429?'Подождите минуту перед созданием нового кода.':'Не удалось создать код. Попробуйте снова.',{type:'error'});return}
   sheet('<h2>Подключить браузер</h2><p class="sub">Скопируйте код. Откройте прежнее веб-приложение в Safari, другом браузере или с иконки на экране телефона и вставьте код в поле «Код подключения».</p><label>Код подключения<input id="browser-link-code" class="access-code" type="text" readonly spellcheck="false" autocomplete="off" onclick="this.select()"></label><button class="pri" onclick="PrivateAccess.copyLink()">Скопировать код</button><p class="em">Код открывает доступ к вашему ИИ. Храните его у себя. Браузер запомнит подключение на год. Существующий дневник останется на месте.</p>');
   document.getElementById('browser-link-code').value=data.browserToken;
  }catch{toast('Не удалось связаться с сервером.',{type:'error'})}
  finally{this.busy=false}
 },
 async copyLink(){
  const field=document.getElementById('browser-link-code');if(!field)return;
  try{await navigator.clipboard.writeText(field.value);toast('Вставьте его в прежнее веб-приложение.',{title:'Код скопирован'})}
  catch{field.focus();field.select();toast('Нажмите и удерживайте выделенный код, затем выберите «Скопировать».',{type:'info'})}
 },
 async disconnect(){
  if(!confirm('Отключить доступ этого браузера? Дневник останется на устройстве.'))return;
  try{const response=await this.request({mode:'browser_logout'});if(!response.ok&&response.status!==401&&response.status!==403)throw Error('server');localStorage.removeItem(this.storageKey);this.state='closed';this.error='';render()}
  catch{toast('Не удалось отключить браузер. Попробуйте снова.',{type:'error'})}
 },
 async revokeBrowsers(){
  if(!confirm('Отключить все ранее подключённые браузеры? Дневники на устройствах сохранятся.'))return;
  try{const response=await this.request({mode:'browser_revoke'});if(!response.ok)throw Error('server');toast('В течение минуты доступ будет отключён. Для подключения понадобится новый код.',{title:'Браузеры отключены'})}
  catch{toast('Не удалось отключить браузеры. Попробуйте снова.',{type:'error'})}
 },
 markup(hasDiary){
  const pending=this.state==='checking',id=KaloriiTelegram.userId();
  const descriptions={telegram_not_allowed:'Этому Telegram-аккаунту доступ пока не предоставлен.',telegram_auth_required:'Откройте приложение кнопкой в боте @caloriies_ai_bot.',telegram_auth_invalid:'Не удалось проверить вход. Закройте мини-приложение и откройте его снова через бота.',telegram_auth_expired:'Срок входа истёк. Закройте мини-приложение и заново откройте его через бота.',private_not_configured:'Настройка личного доступа ещё не завершена.'};
  const browser=!KaloriiTelegram.active;
  const browserForm='<p class="em">Один раз откройте Telegram-приложение и нажмите «Веб-версия» вверху экрана. Вставьте полученный код сюда. После подключения пользуйтесь этой версией напрямую, как раньше.</p><form class="access-form" onsubmit="event.preventDefault();PrivateAccess.connect(document.getElementById(\'browser-code\').value)"><label>Код подключения<input id="browser-code" class="access-code" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="Вставьте код из Telegram"></label><button id="browser-connect" class="pri" type="submit">Подключить браузер</button></form>';
  const message=browser?({browser_auth_invalid:'Подключение не найдено или было отключено. Получите новый код в Telegram.',browser_auth_expired:'Срок подключения закончился. Получите новый код в Telegram.',browser_unavailable:'Сервер временно недоступен. Попробуйте ещё раз.'}[this.error]||((this.error==='telegram_auth_required'||!this.error)?'':descriptions[this.error]||'Не удалось связаться с сервером. Проверьте интернет.')):descriptions[this.error]||'Не удалось связаться с сервером. Проверьте интернет и повторите вход.';
  return `<h1 class="sr-only">КалорИИ</h1><p class="sub">Личный дневник питания</p><section class="card"><h2>${pending?'Проверяем вход…':browser?'Вход в веб-приложение':'Личное приложение'}</h2>${message||pending?`<p class="em">${pending?'Подождите немного.':message}</p>`:''}${!pending?`${browser?browserForm:''}<a class="ghost access-link" href="${KaloriiTelegram.botUrl}">Открыть Telegram-бота</a><button class="ghost" onclick="PrivateAccess.check()">Проверить снова</button>${id?`<p class="em">ID этого аккаунта: ${id}</p>`:''}`:''}</section>${hasDiary?'<section class="card"><h3>Ваш дневник на устройстве</h3><p class="em">Записи сохранены. После подключения браузера дневник откроется как раньше.</p><button class="ghost" onclick="exportDiary()">Сохранить дневник в файл</button></section>':''}`;
 }
};
