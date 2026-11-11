import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function classes(initial=''){
 const values=new Set(initial.split(/\s+/).filter(Boolean));
 return {contains:value=>values.has(value),add:value=>values.add(value),toggle(value,on){if(on)values.add(value);else values.delete(value)}};
}
function setup({viewport={height:844,offsetTop:0},innerHeight=844}={}){
 let overlay=null,markup='',locked=0,unlocked=0;
 const windowEvents={},documentEvents={},viewportEvents={},timers=[],frames=[],surfaces=[];
 const root={classList:classes()},messages={scrollHeight:1200,scrollTop:0};
 const host={get innerHTML(){return markup},set innerHTML(value){markup=value;overlay=value?{classList:classes('ov'+(value.includes('ov food-dialog')?' food-dialog':'')),style:{setProperty(key,value){this[key]=value}},contains:element=>!!element?.inDialog}:null}};
 const document={
  documentElement:root,activeElement:null,
  querySelector(selector){return selector==='#sheet .food-dialog'&&!overlay?.classList.contains('food-dialog')?null:overlay},
  getElementById:()=>messages,addEventListener:(event,callback)=>documentEvents[event]=callback
 };
 const window={visualViewport:viewport,addEventListener:(event,callback)=>windowEvents[event]=callback};
 if(viewport)viewport.addEventListener=(event,callback)=>viewportEvents[event]=callback;
 const context=vm.createContext({
  window,document,visualViewport:viewport,innerHeight,CK:false,S:{profile:{}},PrivateAccess:{allowed:true},V:'today',
  KaloriiTelegram:{setDialogOpen:open=>surfaces.push(open),back(){}},
  $:()=>host,lockBody:()=>locked++,unlockBody:()=>unlocked++,voiceCancel(){},kbClose(){},
  setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length},requestAnimationFrame:callback=>frames.push(callback),
  today:()=> '2026-11-12',cur:()=> '2026-11-12',dlab:()=> 'Сегодня, 12 ноября',MEALS:[['b','Завтрак'],['l','Обед'],['d','Ужин'],['s','Перекус']],
  OWNKB:()=>false,PLUS:'+',UP:'↑',voiceButton:()=>'',loadHist(){},drawFq(){},meal:'b',AF:null
 });
 const run=code=>vm.runInContext(code,context);
 run(html.slice(html.indexOf('function telegramBackState()'),html.indexOf('function go(')));
 run(html.slice(html.indexOf('let CS=0;'),html.indexOf('function render()')));
 run(html.slice(html.indexOf('function openAdd('),html.indexOf('function allFoods()')));
 const flushTimers=()=>{for(const timer of timers.splice(0))timer.callback()};
 return {
  run,context,window,document,root,windowEvents,documentEvents,viewportEvents,messages,surfaces,
  get overlay(){return overlay},get markup(){return markup},get locked(){return locked},get unlocked(){return unlocked},
  focus(){const input={inDialog:true,matches:()=>true,blur(){document.activeElement=null}};document.activeElement=input;documentEvents.focusin();return input},
  flushFrames(){for(const callback of frames.splice(0))callback()},
  flushTimers,
  close(){run('closeSheet()');flushTimers()}
 };
}

test('the normal add-food entry point opens full screen before measuring the viewport',()=>{
 const x=setup();x.run("openAdd('d')");
 assert.match(x.markup,/class="ov food-dialog"/);assert.match(x.markup,/class="sh chat" role="dialog" aria-modal="true"/);assert.doesNotMatch(x.markup,/class="grab"/);
 assert.equal(x.overlay.style.height,'844px');assert.equal(x.overlay.style.top,'0px');assert.equal(x.overlay.style.bottom,'auto');assert.equal(x.locked,1);assert.equal(x.root.classList.contains('food-dialog-open'),true);assert.equal(x.surfaces.at(-1),true);
});

test('the input follows visual viewport resizing and iOS panning with the native keyboard',()=>{
 const x=setup();x.run('openAdd()');x.focus();
 x.window.visualViewport.height=486;x.window.visualViewport.offsetTop=18;x.viewportEvents.resize();
 assert.equal(x.overlay.style.height,'486px');assert.equal(x.overlay.style.top,'18px');assert.equal(x.overlay.style['--food-offset-top'],'18px');assert.equal(x.overlay.classList.contains('kb'),true);assert.equal(x.overlay.classList.contains('typing'),true);assert.equal(x.messages.scrollTop,1200);
 x.window.visualViewport.offsetTop=26;x.viewportEvents.scroll();assert.equal(x.overlay.style.top,'26px');
});

test('a WebView that resizes both viewports still removes the keyboard safe-area spacer',()=>{
 const x=setup();x.run('openAdd()');x.focus();x.context.innerHeight=486;x.window.visualViewport.height=486;x.windowEvents.resize();
 assert.equal(x.overlay.style.height,'486px');assert.equal(x.overlay.classList.contains('kb'),false);assert.equal(x.overlay.classList.contains('typing'),true);
 x.document.activeElement=null;x.documentEvents.focusout();x.flushFrames();assert.equal(x.overlay.classList.contains('typing'),false);
 x.context.innerHeight=844;x.window.visualViewport.height=844;x.viewportEvents.resize();assert.equal(x.overlay.style.height,'844px');
});

test('rotation and clients without VisualViewport use the available window height',()=>{
 const x=setup({viewport:null});x.run('openAdd()');assert.equal(x.overlay.style.height,'844px');
 x.context.innerHeight=390;x.windowEvents.resize();assert.equal(x.overlay.style.height,'390px');assert.equal(x.overlay.style.top,'0px');
});

test('closing blurs the native editor and restores the previous page background',()=>{
 const x=setup();x.run('openAdd()');x.focus();x.close();
 assert.equal(x.document.activeElement,null);assert.equal(x.markup,'');assert.equal(x.root.classList.contains('food-dialog-open'),false);assert.equal(x.surfaces.at(-1),false);assert.equal(x.unlocked,1);
});

test('replacing a closing food dialog does not remove the replacement or leave its background selected',()=>{
 const x=setup();x.run('openAdd();closeSheet();sheet("other",true)');x.flushTimers();
 assert.equal(x.root.classList.contains('food-dialog-open'),false);assert.equal(x.overlay.classList.contains('food-dialog'),false);assert.equal(x.surfaces.at(-1),false);assert.match(x.markup,/other/);
 const y=setup();y.run('openAdd();closeSheet();openAdd("l")');y.flushTimers();
 assert.equal(y.overlay.classList.contains('food-dialog'),true);assert.equal(y.root.classList.contains('food-dialog-open'),true);assert.equal(y.overlay.style.height,'844px');
});

test('regular sheets and the existing custom keyboard keep their supported viewport behavior',()=>{
 const x=setup();x.run('sheet("settings",true)');assert.equal(x.overlay.classList.contains('food-dialog'),false);assert.equal(x.overlay.style.height,'');
 x.window.visualViewport.height=486;x.viewportEvents.resize();assert.equal(x.overlay.style.height,'486px');
 x.context.CK=true;x.run('fixVV()');assert.equal(x.overlay.style.height,'');assert.equal(x.overlay.classList.contains('kb'),true);
 x.run('openAdd()');assert.equal(x.overlay.style.height,'486px');assert.equal(x.overlay.classList.contains('typing'),false);
});
