import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const decode=value=>String(value).replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
const clone=value=>JSON.parse(JSON.stringify(value));
const dish=(id='oats',name='Овсяная каша')=>({id,n:name,d:'',g:200,k:110,p:4,f:3,c:16,aliases:[name],meals:['b'],pinned:true,hidden:false,custom:true});

function setup(initial={}){
  let now=100000,timerId=0,api,redraws=0;
  const timers=new Map(),snapshots=[],notices=[];
  class Element {
    constructor(id='',fragment=false){this.id=id;this.fragment=fragment;this.children=[];this.parentNode=null;this.value='';this.checked=false;this.hidden=false;this.textContent='';this.markup='';this.attrs={}}
    get firstChild(){return this.children[0]||null}
    appendChild(child){
      if(child.fragment){while(child.firstChild)this.appendChild(child.firstChild);return child}
      if(child.parentNode)child.parentNode.children.splice(child.parentNode.children.indexOf(child),1);
      this.children.push(child);child.parentNode=this;return child;
    }
    replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];for(const child of children)this.appendChild(child)}
    get innerHTML(){return this.markup}
    set innerHTML(value){
      this.markup=String(value);this.replaceChildren();
      for(const match of this.markup.matchAll(/<(input|textarea|select|div|p)\b([^>]*)>/g)){
        const attributes=Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(([,key,text])=>[key,decode(text)]));
        if(!attributes.id&&!attributes['data-md-meal'])continue;
        const child=new Element(attributes.id);child.attrs=attributes;child.value=attributes.value||'';child.checked=/\bchecked\b/.test(match[2]);child.hidden=/\bhidden\b/.test(match[2]);
        if(match[1]==='textarea')child.value=decode(this.markup.slice(match.index+match[0].length).split('</textarea>')[0]);
        this.appendChild(child);
      }
    }
  }
  const host=new Element('sheet');
  const descendants=node=>[node,...node.children.flatMap(descendants)];
  const document={
    getElementById:id=>descendants(host).find(node=>node.id===id)||null,
    createDocumentFragment:()=>new Element('',true),
    querySelector:selector=>{const key=selector.match(/data-md-meal="([blds])"/);return key?descendants(host).find(node=>node.attrs['data-md-meal']===key[1])||null:null}
  };
  const state={foods:[],log:{},dc:{},...clone(initial)};
  const context=vm.createContext({
    S:state,document,Date:{now:()=>now},MEALS:[['b','Завтрак'],['l','Обед'],['d','Ужин'],['s','Перекус']],
    esc:value=>String(value).replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char])),
    save:()=>snapshots.push(clone(state)),toast:(...args)=>notices.push(args),kbClose(){},fixVV(){},telegramBackState(){},loadHist(){},lockBody(){},unlockBody(){},
    drawFq(){redraws++;api?.refreshActions()},
    sheet(markup){const root=new Element();root.innerHTML=markup;host.replaceChildren(root)},
    setTimeout(callback,delay){const id=++timerId;timers.set(id,{callback,at:now+delay});return id},clearTimeout:id=>timers.delete(id)
  });
  vm.runInContext(fs.readFileSync(new URL('../dish-catalog.js',import.meta.url),'utf8'),context);
  vm.runInContext(fs.readFileSync(new URL('../my-dishes.js',import.meta.url),'utf8'),context);
  api=vm.runInContext('MyDishes',context);
  const catalog=vm.runInContext('DishCatalog',context);
  catalog.init(state);
  const field=id=>document.getElementById(id);
  function scene(markup){context.sheet(markup)}
  function tick(milliseconds){now+=milliseconds;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback()}}
  function form(values={}){
    const defaults={name:'Моя каша',g:'250',k:'120',p:'5',f:'4',c:'16',aliases:'Каша утром',...values};
    for(const [key,value] of Object.entries(defaults))field('md-'+key).value=value;
  }
  function meals(...keys){for(const key of ['b','l','d','s'])document.querySelector(`[data-md-meal="${key}"]`).checked=keys.includes(key)}
  return {api,catalog,state,field,scene,tick,form,meals,context,snapshots,notices,host,get redraws(){return redraws}};
}

test('settings can add a pinned dish with per-100g nutrition and explicitly selected meals',()=>{
  const x=setup();x.api.open();assert.match(x.field('md-list').innerHTML,/Добавьте своё блюдо/);
  x.api.edit();x.form({name:'Овсянка с яблоком',g:'150',k:'130',p:'4',f:'3',c:'20'});x.meals('b','l');x.field('md-pinned').checked=true;
  x.api.preview();assert.match(x.field('md-preview').textContent,/150 г — 195 ккал/);
  x.api.saveDish();
  assert.equal(x.state.foods.length,1);const food=x.state.foods[0];
  assert.equal(food.n,'Овсянка с яблоком');assert.equal(food.g,150);assert.equal(food.k,130);assert.equal(food.custom,true);assert.equal(food.pinned,true);
  assert.deepEqual(clone(food.meals),['b','l']);assert.equal(Object.keys(x.state.log).length,0);
  assert.equal(x.catalog.frequent(x.state,'b').length,1);assert.equal(x.catalog.frequent(x.state,'d').length,0);
  assert.match(x.field('md-list').innerHTML,/Овсянка с яблоком/);
  assert.equal(x.snapshots.length,1);
});

test('editing a dish from the add-food dialog preserves its typed draft and attached preview nodes',()=>{
  const food=dish();const x=setup({foods:[food],dc:{oats:{n:food.n,g:200,k:110,p:4,f:3,c:16,dishId:food.id},other:{n:'Рис',g:100,k:130,p:3,f:0,c:28}}});
  x.scene('<div id="am"></div><div id="fq"></div><div id="pv"></div><div id="ai"></div><div id="dish-actions" hidden></div>');
  const input=x.field('ai'),preview=x.field('pv');input.textContent='Уже набранное описание еды';preview.innerHTML='<img src="fixture-photo">';
  x.context.AF={name:'fixture-photo.jpg'};const photo=x.context.AF;
  x.api.edit(food.id);assert.equal(x.field('ai'),null);x.form({name:'Моя утренняя овсянка',g:'300',k:'125',p:'5',f:'4',c:'18'});x.meals('b');x.api.saveDish();
  assert.equal(x.field('ai'),input);assert.equal(input.textContent,'Уже набранное описание еды');assert.equal(x.field('pv'),preview);assert.match(preview.innerHTML,/fixture-photo/);assert.equal(x.context.AF,photo);
  const saved=x.state.foods[0];assert.equal(saved.id,food.id);assert.equal(saved.g,300);assert.equal(saved.k,125);assert.deepEqual(clone(saved.meals),['b']);assert.equal(saved.custom,true);
  assert.equal(x.catalog.match(x.state,'Овсяная каша').id,food.id);assert.equal(x.state.dc.oats,undefined);assert.ok(x.state.dc.other);
  assert.equal(x.snapshots.length,1);
});

test('cancel returns to the original dialog without applying unfinished editor changes',()=>{
  const x=setup({foods:[dish()]});x.scene('<div id="am"></div><div id="fq"></div><div id="ai"></div>');
  const input=x.field('ai');input.textContent='Черновик';const before=clone(x.state.foods);
  x.api.edit('oats');x.form({name:'Несохранённое имя'});assert.equal(x.api.back(),true);
  assert.equal(x.field('ai'),input);assert.equal(input.textContent,'Черновик');assert.deepEqual(clone(x.state.foods),before);
});

test('empty, invalid and duplicate form values do not create or overwrite saved dishes',()=>{
  const x=setup({foods:[dish()]});x.api.open();x.api.edit();const before=clone(x.state.foods);
  for(const values of [{name:''},{k:''},{g:'0'},{p:'101'},{g:'Infinity'},{name:'Овсяная каша'}]){
    x.form(values);x.api.saveDish();assert.deepEqual(clone(x.state.foods),before);assert.ok(x.field('md-error').textContent);
  }
});

test('all meal checkboxes can be disabled and remain disabled after reopening settings',()=>{
  const x=setup({foods:[dish()]});x.api.open();x.api.edit('oats');x.form();x.meals();x.api.saveDish();
  assert.deepEqual(clone(x.state.foods[0].meals),[]);assert.equal(x.catalog.frequent(x.state,'b').length,0);
  x.api.open();assert.match(x.field('md-list').innerHTML,/Показ в приёмах пищи выключен/);assert.deepEqual(clone(x.state.foods[0].meals),[]);
});

test('deletion requires its explicit action and preserves past diary entries',()=>{
  const entry={id:'entry-1',n:'Овсяная каша',g:200,m:'b',k:220,p:8,f:6,c:32,dishId:'oats'};
  const x=setup({foods:[dish()],log:{'2026-11-20':[entry]}});x.api.open();x.api.edit('oats');x.api.confirmRemove('oats');
  assert.equal(x.state.foods[0].hidden,false);assert.match(x.field('md-confirm').innerHTML,/Удалить/);
  x.api.remove('oats');assert.equal(x.state.foods[0].hidden,true);assert.equal(x.state.log['2026-11-20'].length,1);assert.equal(x.catalog.frequent(x.state,'b').length,0);
  assert.doesNotMatch(x.field('md-list').innerHTML,/dish-list-item/);
  assert.equal(x.snapshots.length,1);
});

test('merging through the editor combines identities and keeps target portion and meal preferences',()=>{
  const target=dish('target','Моя овсянка'),source=dish('source','Овсяная каша');target.g=350;target.meals=['l'];
  const entry={id:'source-entry',n:source.n,g:200,m:'b',k:220,p:8,f:6,c:32,dishId:source.id};
  const x=setup({foods:[target,source],log:{'2026-11-20':[entry]}});x.api.open();x.api.edit('source');x.field('md-merge').value='target';x.api.confirmMerge();
  assert.match(x.field('md-confirm').innerHTML,/Моя овсянка/);x.api.merge('target');
  assert.equal(x.state.foods.filter(food=>!food.hidden).length,1);assert.equal(x.state.foods[0].g,350);assert.deepEqual(clone(x.state.foods[0].meals),['l']);assert.equal(x.state.log['2026-11-20'][0].dishId,'target');assert.equal(x.state.log['2026-11-20'][0].g,200);
  assert.equal(x.snapshots.length,1);
});

test('editing flushes the keyboard into the original draft before detaching it and cancels voice capture',()=>{
  const x=setup({foods:[dish()]});x.scene('<div id="am"></div><div id="fq"></div><div id="ai"></div><div id="keyboard"></div>');
  const input=x.field('ai');let closed=0,cancelled=0;
  x.context.kbClose=()=>{closed++;if(x.field('ai')){assert.equal(x.field('ai'),input);input.textContent='Черновик из клавиатуры';const keyboard=x.field('keyboard');keyboard.parentNode.children.splice(keyboard.parentNode.children.indexOf(keyboard),1)}};
  x.context.voiceCancel=()=>{assert.equal(x.field('ai'),input);cancelled++};
  x.api.edit('oats');assert.equal(closed,1);assert.equal(cancelled,1);assert.equal(x.field('ai'),null);
  x.api.back();assert.equal(closed,2);assert.equal(x.field('ai'),input);assert.equal(input.textContent,'Черновик из клавиатуры');assert.equal(x.field('keyboard'),null);
});

test('failed edit persistence restores the catalog and caches while retaining the form and food draft for retry',()=>{
  const food=dish(),entry={id:'entry',n:food.n,g:200,m:'b',k:220,p:8,f:6,c:32,dishId:food.id};
  const x=setup({foods:[food],log:{'2026-11-20':[entry]},dc:{oats:{n:food.n,dishId:food.id,k:110}}});
  x.scene('<div id="am"></div><div id="fq"></div><div id="ai"></div><div id="pv"></div>');
  const input=x.field('ai'),preview=x.field('pv');input.textContent='Сохранённый черновик еды';preview.innerHTML='<img src="draft-photo">';
  const before=clone(x.state);x.api.edit('oats');x.form({name:'Новая утренняя каша',g:'300'});const form=x.field('md-name');
  x.context.save=()=>false;x.api.saveDish();
  assert.deepEqual(clone(x.state),before);assert.equal(x.field('md-name'),form);assert.equal(form.value,'Новая утренняя каша');assert.equal(x.field('ai'),null);
  assert.equal(x.notices.length,1);assert.equal(x.notices[0][1].type,'error');assert.match(x.notices[0][0],/хранилищу браузера/);assert.equal(x.snapshots.length,0);
  x.context.save=()=>{x.snapshots.push(clone(x.state));return true};x.api.saveDish();
  assert.equal(x.field('ai'),input);assert.equal(input.textContent,'Сохранённый черновик еды');assert.equal(x.field('pv'),preview);assert.match(preview.innerHTML,/draft-photo/);
  assert.equal(x.state.foods.length,1);assert.equal(x.state.foods[0].n,'Новая утренняя каша');assert.equal(x.state.dc.oats,undefined);assert.equal(x.snapshots.length,1);assert.equal(x.notices.at(-1)[1].type,'success');
});

test('failed new-dish persistence removes the phantom item and leaves its form ready for retry',()=>{
  const x=setup();x.api.open();x.api.edit();x.form();const before=clone(x.state),form=x.field('md-name');
  x.context.save=()=>false;x.api.saveDish();assert.deepEqual(clone(x.state),before);assert.equal(x.field('md-name'),form);assert.equal(form.value,'Моя каша');assert.equal(x.notices[0][1].type,'error');
  x.context.save=()=>{x.snapshots.push(clone(x.state));return true};x.api.saveDish();assert.equal(x.state.foods.length,1);assert.equal(x.snapshots.length,1);assert.ok(x.field('md-list'));
});

test('failed pin persistence rolls back the pin and retains the quick-dish action bar',()=>{
  const x=setup({foods:[dish()]});x.scene('<div id="dish-actions" hidden></div><div id="fq"></div>');x.api.actions('oats');const before=clone(x.state);
  x.context.save=()=>false;x.api.pin('oats');assert.deepEqual(clone(x.state),before);assert.equal(x.field('dish-actions').hidden,false);assert.match(x.field('dish-actions').innerHTML,/Открепить/);assert.equal(x.notices[0][1].type,'error');
  x.context.save=()=>{x.snapshots.push(clone(x.state));return true};x.api.pin('oats');assert.equal(x.state.foods[0].pinned,false);assert.match(x.field('dish-actions').innerHTML,/Закрепить/);assert.equal(x.snapshots.length,1);
});

test('failed deletion preserves the dish, diary and caches and leaves confirmation in the editor',()=>{
  const food=dish(),entry={id:'entry',n:food.n,g:200,m:'b',k:220,p:8,f:6,c:32,dishId:food.id};
  const x=setup({foods:[food],log:{'2026-11-20':[entry]},dc:{oats:{n:food.n,dishId:food.id}}});x.api.open();x.api.edit('oats');x.api.confirmRemove('oats');
  const before=clone(x.state),confirmation=x.field('md-confirm');x.context.save=()=>false;x.api.remove('oats');
  assert.deepEqual(clone(x.state),before);assert.equal(x.field('md-confirm'),confirmation);assert.match(confirmation.innerHTML,/Удалить/);assert.ok(x.field('md-name'));assert.equal(x.notices.length,1);assert.equal(x.notices[0][1].type,'error');
});

test('a thrown persistence error also rolls back merging aliases and historical identities without closing the editor',()=>{
  const source=dish('source','Овсяная каша'),target=dish('target','Моя каша');
  const entry={id:'entry',n:source.n,g:200,m:'b',k:220,p:8,f:6,c:32,dishId:source.id};
  const x=setup({foods:[source,target],log:{'2026-11-20':[entry]},dc:{source:{n:source.n},target:{n:target.n}}});x.api.open();x.api.edit('source');x.field('md-merge').value='target';x.api.confirmMerge();
  const before=clone(x.state),confirmation=x.field('md-confirm');x.context.save=()=>{throw new Error('QuotaExceededError')};x.api.merge('target');
  assert.deepEqual(clone(x.state),before);assert.equal(x.field('md-confirm'),confirmation);assert.match(confirmation.innerHTML,/Объединить/);assert.ok(x.field('md-name'));assert.equal(x.notices.length,1);assert.equal(x.notices[0][1].type,'error');
});

test('aliases are bounded to 50 entries and 1000 characters each including the former name',()=>{
  const x=setup({foods:[dish()]});x.api.open();x.api.edit('oats');assert.equal(x.field('md-aliases').attrs.maxlength,'50049');
  x.form({name:'Утренняя каша',aliases:Array.from({length:80},(_,i)=>`${i}-`+'а'.repeat(1500)).join('\n')});x.api.saveDish();
  const aliases=x.state.foods[0].aliases;assert.equal(aliases.length,50);assert.equal(aliases[0],'Овсяная каша');assert.ok(aliases.every(alias=>alias.length<=1000));assert.equal(x.snapshots.length,1);
});

test('editing cannot take a deleted dish name or alias while adding it again restores its original identity',()=>{
  const deleted=dish('deleted','Гречневая каша');deleted.hidden=true;deleted.pinned=false;deleted.aliases.push('Гречка утром');
  const x=setup({foods:[dish(),deleted]});x.api.open();x.api.edit('oats');const before=clone(x.state);
  for(const name of ['Гречневая каша','Гречка утром']){x.form({name});x.api.saveDish();assert.deepEqual(clone(x.state),before);assert.match(x.field('md-error').textContent,/уже есть/)}
  x.api.back();x.api.edit();x.form({name:'Гречка утром'});x.api.saveDish();
  assert.equal(x.state.foods.length,2);const restored=x.catalog.find(x.state,'deleted');assert.equal(restored.hidden,false);assert.equal(restored.n,'Гречка утром');assert.equal(restored.g,250);assert.equal(x.snapshots.length,1);
});

test('a long hold opens actions and suppresses the release click even when the finger is held for seconds',()=>{
  const x=setup({foods:[dish()]});x.scene('<div id="dish-actions" hidden></div><div id="fq"></div>');
  const down={button:0,clientX:10,clientY:20};x.api.press(down,'oats');x.tick(479);assert.equal(x.field('dish-actions').hidden,true);
  x.tick(1);assert.equal(x.field('dish-actions').hidden,false);assert.match(x.field('dish-actions').innerHTML,/Редактировать/);assert.match(x.field('dish-actions').innerHTML,/Удалить/);
  x.tick(2500);x.api.release();let prevented=false;
  assert.equal(x.api.consumeClick({preventDefault(){prevented=true}}),true);assert.equal(prevented,true);assert.equal(Object.keys(x.state.log).length,0);
  x.api.press(down,'oats');x.api.release();assert.equal(x.api.consumeClick({preventDefault(){}}),false);
});

test('scroll movement and cancellation do not turn into long-press actions',()=>{
  const x=setup({foods:[dish()]});x.scene('<div id="dish-actions" hidden></div>');
  x.api.press({button:0,clientX:0,clientY:0},'oats');x.api.move({clientX:20,clientY:0});x.tick(600);assert.equal(x.field('dish-actions').hidden,true);
  x.api.press({button:0,clientX:0,clientY:0},'oats');x.api.release();x.tick(600);assert.equal(x.field('dish-actions').hidden,true);
  assert.equal(x.api.consumeClick({preventDefault(){}}),false);
});

test('user dish names remain escaped in the settings list and action bar',()=>{
  const name='<img src=x onerror="fixture">';const x=setup({foods:[dish('quoted',name)]});x.api.open();
  assert.match(x.field('md-list').innerHTML,/&lt;img/);assert.doesNotMatch(x.field('md-list').innerHTML,/<img/);
  x.scene('<div id="dish-actions" hidden></div>');x.api.actions('quoted');assert.match(x.field('dish-actions').innerHTML,/&lt;img/);assert.doesNotMatch(x.field('dish-actions').innerHTML,/<img/);
});
