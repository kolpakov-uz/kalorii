import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../telegram.js',import.meta.url),'utf8');
function setup(app){const properties={},events={},calls=[],root={classList:{add:x=>calls.push(x)},dataset:{},style:{setProperty:(k,v)=>properties[k]=v}};const c=vm.createContext({window:{Telegram:app?{WebApp:app}:undefined},document:{documentElement:root},toast:(...args)=>calls.push(args)});vm.runInContext(source,c);return {tg:vm.runInContext('KaloriiTelegram',c),root,properties,events,calls}}
test('ordinary browser and unlaunched SDK keep the existing diary key',()=>{for(const sdk of [undefined,{initData:''}]){const x=setup(sdk);assert.equal(x.tg.active,false);assert.equal(x.tg.storageKey('kalorii-v1'),'kalorii-v1');x.tg.init(()=>{});x.tg.back(true)}});
test('Telegram namespaces local storage by account without trusting it as server authentication',()=>{for(const id of [123,456]){const x=setup({initData:'fixture',initDataUnsafe:{user:{id}}});assert.equal(x.tg.storageKey('kalorii-v1'),'kalorii-v1-telegram-'+id)}const x=setup({initData:'fixture',initDataUnsafe:{user:{id:'invalid'}}});assert.equal(x.tg.storageKey('kalorii-v1'),'kalorii-v1-telegram-local')});
test('Telegram updates theme and safe areas, expands and wires native back control',()=>{
 const events={},calls=[];const app={initData:'fixture',colorScheme:'dark',safeAreaInset:{top:44,bottom:34},contentSafeAreaInset:{top:52,bottom:0},isVersionAtLeast:()=>true,setHeaderColor:v=>calls.push(v),setBackgroundColor(){},setBottomBarColor(){},ready:()=>calls.push('ready'),expand:()=>calls.push('expand'),onEvent:(k,fn)=>events[k]=fn,BackButton:{show:()=>calls.push('show'),hide:()=>calls.push('hide'),onClick:fn=>events.back=fn}};
 const x=setup(app);let back=0;x.tg.init(()=>back++);assert.equal(x.root.dataset.theme,'dark');assert.equal(x.properties['--tg-app-top'],'96px');assert.equal(x.properties['--tg-app-bottom'],'34px');assert.ok(calls.includes('ready'));assert.ok(calls.includes('expand'));
 app.colorScheme='light';app.safeAreaInset.bottom=0;events.themeChanged();assert.equal(x.root.dataset.theme,'light');assert.equal(x.properties['--tg-app-bottom'],'0px');x.tg.back(true);x.tg.back(false);events.back();assert.equal(back,1);assert.ok(calls.includes('show'));assert.ok(calls.includes('hide'));
});
test('unsupported shortcut shows a message instead of attempting installation',()=>{let installed=0;const x=setup({initData:'fixture',isVersionAtLeast:()=>true,checkHomeScreenStatus:fn=>fn('unsupported'),addToHomeScreen:()=>installed++});x.tg.addHome();assert.equal(installed,0);assert.equal(x.calls.length,1)});
