// Telegram data selects local UI/storage only; it is not server authentication.
const KaloriiTelegram=(()=>{
 const app=window.Telegram?.WebApp,active=!!app?.initData;
 let dialogOpen=false;
 function requestData(body){return {...body,telegramInitData:active?app.initData:''}}
 function userId(){const id=app?.initDataUnsafe?.user?.id;return active&&Number.isSafeInteger(id)&&id>0?id:null}
 function storageKey(base){const id=app?.initDataUnsafe?.user?.id;return active?base+'-telegram-'+(Number.isSafeInteger(id)&&id>0?id:'local'):base}
 function refresh(){
  if(!active)return;
  const root=document.documentElement,dark=app.colorScheme==='dark';root.classList.add('tg');root.dataset.theme=dark?'dark':'light';
  for(const edge of ['top','bottom']){
   const inset=Math.max(0,Number(app.safeAreaInset?.[edge])||0)+Math.max(0,Number(app.contentSafeAreaInset?.[edge])||0);
   root.style.setProperty('--tg-app-'+edge,inset+'px');
  }
  const background=dialogOpen?(dark?'#18221D':'#ffffff'):(dark?'#0F1613':'#F2F5F1');
  if(app.isVersionAtLeast('6.1')){app.setHeaderColor(background);app.setBackgroundColor(background)}
  if(app.isVersionAtLeast('7.10'))app.setBottomBarColor(dark?'#18221D':'#ffffff');
 }
 function back(show){if(active&&app.isVersionAtLeast('6.1'))app.BackButton[show?'show':'hide']()}
 function setDialogOpen(open){if(dialogOpen===open)return;dialogOpen=open;refresh()}
 function init(onBack){
  if(!active)return;
  refresh();
  app.onEvent('themeChanged',refresh);
  if(app.isVersionAtLeast('8.0')){
   for(const event of ['safeAreaChanged','contentSafeAreaChanged','fullscreenChanged','fullscreenFailed'])app.onEvent(event,refresh);
  }
  if(app.isVersionAtLeast('6.1'))app.BackButton.onClick(onBack);
  app.ready();app.expand();
  // Request once per launch; leaving fullscreen must remain the user's choice.
  if(app.isVersionAtLeast('8.0')&&!app.isFullscreen){try{app.requestFullscreen()}catch{refresh()}}
 }
 function addHome(){if(active&&app.isVersionAtLeast('8.0'))app.checkHomeScreenStatus(status=>{if(status==='unsupported')toast('На этом устройстве Telegram не поддерживает добавление иконки.',{type:'info'});else app.addToHomeScreen()});else toast('Добавление иконки доступно в актуальной версии Telegram.',{type:'info'})}
 return {active,storageKey,init,back,setDialogOpen,addHome,requestData,userId,botUrl:'https://t.me/caloriies_ai_bot'};
})();
