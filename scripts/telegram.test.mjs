import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../telegram.js',import.meta.url),'utf8');
function setup(app){const properties={},events={},calls=[],root={classList:{add:x=>calls.push(x)},dataset:{},style:{setProperty:(k,v)=>properties[k]=v}};const c=vm.createContext({window:{Telegram:app?{WebApp:app}:undefined},document:{documentElement:root},toast:(...args)=>calls.push(args)});vm.runInContext(source,c);return {tg:vm.runInContext('KaloriiTelegram',c),root,properties,events,calls}}
test('ordinary browser and unlaunched SDK keep the existing diary key',()=>{for(const sdk of [undefined,{initData:''}]){const x=setup(sdk);assert.equal(x.tg.active,false);assert.equal(x.tg.storageKey('kalorii-v1'),'kalorii-v1');x.tg.init(()=>{});x.tg.back(true)}});
test('Telegram namespaces local storage by account without trusting it as server authentication',()=>{for(const id of [123,456]){const x=setup({initData:'fixture',initDataUnsafe:{user:{id}}});assert.equal(x.tg.storageKey('kalorii-v1'),'kalorii-v1-telegram-'+id)}const x=setup({initData:'fixture',initDataUnsafe:{user:{id:'invalid'}}});assert.equal(x.tg.storageKey('kalorii-v1'),'kalorii-v1-telegram-local')});
test('Telegram updates theme and safe areas, expands and wires native back control',()=>{
 const events={},calls=[];const app={initData:'fixture',colorScheme:'dark',safeAreaInset:{top:44,bottom:34},contentSafeAreaInset:{top:52,bottom:0},isVersionAtLeast:()=>true,setHeaderColor:v=>calls.push(v),setBackgroundColor(){},setBottomBarColor(){},ready:()=>calls.push('ready'),expand:()=>calls.push('expand'),requestFullscreen:()=>calls.push('fullscreen'),onEvent:(k,fn)=>events[k]=fn,BackButton:{show:()=>calls.push('show'),hide:()=>calls.push('hide'),onClick:fn=>events.back=fn}};
 const x=setup(app);let back=0;x.tg.init(()=>back++);assert.equal(x.root.dataset.theme,'dark');assert.equal(x.properties['--tg-app-top'],'96px');assert.equal(x.properties['--tg-app-bottom'],'34px');assert.ok(calls.includes('ready'));assert.ok(calls.includes('expand'));
 app.colorScheme='light';app.safeAreaInset.bottom=0;events.themeChanged();assert.equal(x.root.dataset.theme,'light');assert.equal(x.properties['--tg-app-bottom'],'0px');x.tg.back(true);x.tg.back(false);events.back();assert.equal(back,1);assert.ok(calls.includes('show'));assert.ok(calls.includes('hide'));
});
test('unsupported shortcut shows a message instead of attempting installation',()=>{let installed=0;const x=setup({initData:'fixture',isVersionAtLeast:()=>true,checkHomeScreenStatus:fn=>fn('unsupported'),addToHomeScreen:()=>installed++});x.tg.addHome();assert.equal(installed,0);assert.equal(x.calls.length,1)});

test('API payload includes native proof, never a client-selected substitute',()=>{const x=setup({initData:'signed-launch',initDataUnsafe:{user:{id:111}}});const data=x.tg.requestData({mode:'dish',telegramInitData:'forged'});assert.equal(data.telegramInitData,'signed-launch');assert.equal(x.tg.userId(),111);assert.equal(setup().tg.userId(),null)});

function fullscreenFixture(overrides={}){
 const events={},calls=[];
 const app={initData:'fixture',colorScheme:'dark',isFullscreen:false,safeAreaInset:{top:0,bottom:0},contentSafeAreaInset:{top:0,bottom:0},isVersionAtLeast:()=>true,setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},ready:()=>calls.push('ready'),expand:()=>calls.push('expand'),requestFullscreen(){calls.push('fullscreen');assert.equal(typeof events.fullscreenChanged,'function');assert.equal(typeof events.fullscreenFailed,'function')},onEvent:(event,fn)=>events[event]=fn,BackButton:{onClick(){}},...overrides};
 const x=setup(app);return {...x,app,events,calls};
}
test('fullscreen is requested after ready and expand, with safe areas refreshed on native events',()=>{
 const x=fullscreenFixture();x.tg.init(()=>{});assert.deepEqual(x.calls,['ready','expand','fullscreen']);
 x.app.isFullscreen=true;x.app.safeAreaInset={top:47,bottom:34};x.app.contentSafeAreaInset={top:56,bottom:0};x.events.fullscreenChanged();
 assert.equal(x.properties['--tg-app-top'],'103px');assert.equal(x.properties['--tg-app-bottom'],'34px');
 x.app.safeAreaInset.top=0;x.app.contentSafeAreaInset.top=44;x.events.safeAreaChanged();assert.equal(x.properties['--tg-app-top'],'44px');
 x.app.contentSafeAreaInset.top=32;x.events.contentSafeAreaChanged();assert.equal(x.properties['--tg-app-top'],'32px');
});
test('an already fullscreen launch does not request fullscreen again',()=>{
 const x=fullscreenFixture({isFullscreen:true});x.tg.init(()=>{});assert.deepEqual(x.calls,['ready','expand']);
});
test('fullscreen exit and theme changes never force the user back into fullscreen',()=>{
 const x=fullscreenFixture();x.tg.init(()=>{});x.app.isFullscreen=false;x.events.fullscreenChanged();x.events.themeChanged();x.events.contentSafeAreaChanged();assert.deepEqual(x.calls,['ready','expand','fullscreen']);
});
test('older Telegram clients expand without calling unsupported fullscreen APIs',()=>{
 const x=fullscreenFixture({isVersionAtLeast:version=>version!=='8.0',requestFullscreen(){throw new Error('must not call')}});x.tg.init(()=>{});assert.deepEqual(x.calls,['ready','expand']);assert.equal(x.events.fullscreenChanged,undefined);assert.equal(x.events.fullscreenFailed,undefined);
});
test('native fullscreen refusal or a bridge exception leaves the expanded app working',()=>{
 const x=fullscreenFixture();x.tg.init(()=>{});x.events.fullscreenFailed({error:'UNSUPPORTED'});x.app.colorScheme='light';x.events.themeChanged();assert.equal(x.root.dataset.theme,'light');assert.deepEqual(x.calls,['ready','expand','fullscreen']);
 const y=fullscreenFixture({requestFullscreen(){throw new Error('unsupported bridge')}});assert.doesNotThrow(()=>y.tg.init(()=>{}));assert.deepEqual(y.calls,['ready','expand']);assert.equal(y.root.dataset.theme,'dark');
});

test('the food dialog colors Telegram background and header through theme changes and restores the page on close',()=>{
 const headers=[],backgrounds=[];
 const x=fullscreenFixture({setHeaderColor:color=>headers.push(color),setBackgroundColor:color=>backgrounds.push(color)});
 x.tg.init(()=>{});assert.equal(backgrounds.at(-1),'#0F1613');
 x.tg.setDialogOpen(true);assert.equal(backgrounds.at(-1),'#18221D');assert.equal(headers.at(-1),'#18221D');
 const calls=backgrounds.length;x.tg.setDialogOpen(true);assert.equal(backgrounds.length,calls);
 x.app.colorScheme='light';x.events.themeChanged();assert.equal(backgrounds.at(-1),'#ffffff');
 x.tg.setDialogOpen(false);assert.equal(backgrounds.at(-1),'#F2F5F1');assert.equal(headers.at(-1),'#F2F5F1');
 assert.doesNotThrow(()=>setup().tg.setDialogOpen(true));
});
