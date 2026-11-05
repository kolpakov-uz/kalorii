// Telegram data selects local UI/storage only; it is not server authentication.
const KaloriiTelegram=(()=>{
 const app=window.Telegram?.WebApp,active=!!app?.initData;
 function storageKey(base){const id=app?.initDataUnsafe?.user?.id;return active?base+'-telegram-'+(Number.isSafeInteger(id)&&id>0?id:'local'):base}
 function refresh(){
  if(!active)return;
  const root=document.documentElement,dark=app.colorScheme==='dark';root.classList.add('tg');root.dataset.theme=dark?'dark':'light';
  for(const edge of ['top','bottom']){
   const inset=Math.max(0,Number(app.safeAreaInset?.[edge])||0)+Math.max(0,Number(app.contentSafeAreaInset?.[edge])||0);
   root.style.setProperty('--tg-app-'+edge,inset+'px');
  }
  if(app.isVersionAtLeast('6.1')){app.setHeaderColor(dark?'#0F1613':'#F2F5F1');app.setBackgroundColor(dark?'#0F1613':'#F2F5F1')}
  if(app.isVersionAtLeast('7.10'))app.setBottomBarColor(dark?'#18221D':'#ffffff');
 }
 function back(show){if(active&&app.isVersionAtLeast('6.1'))app.BackButton[show?'show':'hide']()}
 function init(onBack){
  if(!active)return;
  refresh();app.ready();app.expand();
  app.onEvent('themeChanged',refresh);
  if(app.isVersionAtLeast('8.0')){app.onEvent('safeAreaChanged',refresh);app.onEvent('contentSafeAreaChanged',refresh)}
  if(app.isVersionAtLeast('6.1'))app.BackButton.onClick(onBack);
 }
 function addHome(){if(active&&app.isVersionAtLeast('8.0'))app.checkHomeScreenStatus(status=>{if(status==='unsupported')toast('На этом устройстве Telegram не поддерживает добавление иконки.',{type:'info'});else app.addToHomeScreen()});else toast('Добавление иконки доступно в актуальной версии Telegram.',{type:'info'})}
 return {active,storageKey,init,back,addHome,botUrl:'https://t.me/caloriies_ai_bot'};
})();
