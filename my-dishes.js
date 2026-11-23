const MyDishes=(()=>{
  let selected=null,editing=null,previous=null,hold=null,point=null,suppressClick=false;
  const field=id=>document.getElementById(id);

  function clearCache(dish){
    const names=new Set([dish.n,...(dish.aliases||[])].map(DishCatalog.normalize));
    for(const [key,cached] of Object.entries(S.dc||{})){
      if(cached.dishId===dish.id||names.has(DishCatalog.normalize(cached.n)))delete S.dc[key];
    }
  }
  function persist(change){
    const snapshot=JSON.parse(JSON.stringify({foods:S.foods,log:S.log,dc:S.dc}));
    try{
      change();
      if(save()!==false)return true;
    }catch{}
    for(const key of ['foods','log','dc'])S[key]=snapshot[key];
    toast('Не удалось сохранить изменения. Проверьте свободное место и доступ к хранилищу браузера, затем повторите действие.',{type:'error'});
    return false;
  }
  function refresh(){
    if(field('md-list'))drawList();
    if(field('fq'))drawFq();
  }
  function open(){
    DishCatalog.init(S);selected=null;
    sheet(`<div class="adh"><h2>Мои блюда</h2><button class="x" aria-label="Закрыть" onclick="closeSheet()">×</button></div><button class="pri" onclick="MyDishes.edit()">Добавить блюдо</button><input id="md-search" type="search" placeholder="Найти блюдо" aria-label="Найти блюдо" oninput="MyDishes.drawList()"><div id="md-list"></div>`);
    drawList();
  }
  function drawList(){
    const list=field('md-list');if(!list)return;
    const query=DishCatalog.normalize(field('md-search')?.value||'');
    const dishes=S.foods.filter(dish=>!dish.hidden&&(!query||[dish.n,...(dish.aliases||[])].some(name=>DishCatalog.normalize(name).includes(query))));
    list.innerHTML=dishes.length?dishes.map(dish=>`<button class="dish-list-item" onclick="MyDishes.edit('${dish.id}')"><span><b>${esc(dish.n)}</b><small>${dish.g} г · ${Math.round(dish.k*dish.g/100)} ккал${dish.pinned?' · Закреплено':''}</small><small>${dish.meals.length?MEALS.filter(([key])=>dish.meals.includes(key)).map(([,name])=>name).join(' · '):'Показ в приёмах пищи выключен'}</small></span><span aria-hidden="true">›</span></button>`).join(''):'<p class="em">'+(query?'Совпадений нет.':'Добавьте своё блюдо или сохраните его при записи еды.')+'</p>';
  }
  function actions(id){
    selected=id;suppressClick=true;refreshActions();
  }
  function refreshActions(confirm=false){
    const bar=field('dish-actions');if(!bar)return;
    const dish=selected&&DishCatalog.find(S,selected);
    if(!dish||dish.hidden){bar.hidden=true;selected=null;return}
    bar.hidden=false;
    bar.innerHTML=confirm
      ?`<b>Удалить «${esc(dish.n)}» из моих блюд?</b><div><button class="sm" onclick="MyDishes.remove('${dish.id}')">Удалить</button><button class="sm" onclick="MyDishes.refreshActions()">Отмена</button></div>`
      :`<div class="dish-action-title"><b>${esc(dish.n)}</b><button class="x" aria-label="Скрыть действия" onclick="MyDishes.dismiss()">×</button></div><div><button class="sm" onclick="MyDishes.edit('${dish.id}')">Редактировать</button><button class="sm" onclick="MyDishes.pin('${dish.id}')">${dish.pinned?'Открепить':'Закрепить'}</button><button class="sm" onclick="MyDishes.confirmRemove()">Удалить</button></div>`;
  }
  function dismiss(){selected=null;suppressClick=false;refreshActions()}
  function press(event,id){
    release();suppressClick=false;if(event.button!=null&&event.button!==0)return;
    point={x:event.clientX,y:event.clientY};
    hold=setTimeout(()=>{hold=null;actions(id)},480);
  }
  function move(event){if(point&&Math.hypot(event.clientX-point.x,event.clientY-point.y)>10)release()}
  function release(){clearTimeout(hold);hold=null;point=null}
  function consumeClick(event){
    if(!suppressClick)return false;
    suppressClick=false;
    event?.preventDefault();return true;
  }
  function pin(id){
    const dish=DishCatalog.find(S,id);if(!dish)return;
    if(!persist(()=>{dish.pinned=!dish.pinned}))return;
    refresh();
  }
  function edit(id){
    DishCatalog.init(S);
    const existing=id&&DishCatalog.find(S,id);
    if(id&&!existing)return;
    editing=existing?.id||null;
    const dish=existing||{n:'',g:100,k:'',p:'',f:'',c:'',aliases:[],meals:MEALS.map(([key])=>key),pinned:true};
    kbClose();if(typeof voiceCancel==='function')voiceCancel();
    const host=field('sheet');previous=document.createDocumentFragment();
    while(host.firstChild)previous.appendChild(host.firstChild);
    const input=(key,label,value)=>`<label>${label}<input id="md-${key}" type="number" inputmode="decimal" min="0" step="any" value="${value}" oninput="MyDishes.preview()"></label>`;
    const others=S.foods.filter(item=>!item.hidden&&item.id!==editing);
    sheet(`<div class="adh"><h2>${existing?'Редактировать блюдо':'Новое блюдо'}</h2><button class="x" aria-label="Вернуться" onclick="closeSheet()">×</button></div><form class="dish-editor" onsubmit="event.preventDefault();MyDishes.saveDish()"><label>Название<input id="md-name" maxlength="60" value="${esc(dish.n)}" required></label>${input('g','Порция для быстрого добавления, г',dish.g)}<h3>КБЖУ на 100 г</h3><div class="g2">${input('k','Калории, ккал',dish.k)}${input('p','Белки, г',dish.p)}${input('f','Жиры, г',dish.f)}${input('c','Углеводы, г',dish.c)}</div><p class="em" id="md-preview"></p><fieldset><legend>Показывать в приёмах пищи</legend><div class="dish-meals">${MEALS.map(([key,name])=>`<label><input type="checkbox" data-md-meal="${key}" ${dish.meals.includes(key)?'checked':''}>${name}</label>`).join('')}</div></fieldset><label class="dish-check"><input id="md-pinned" type="checkbox" ${dish.pinned?'checked':''}>Показывать сразу, до 10 записей</label><label>Другие названия<textarea id="md-aliases" rows="2" maxlength="50049" placeholder="Один вариант на строку">${esc((dish.aliases||[]).filter(alias=>alias!==dish.n).join('\n'))}</textarea></label><p id="md-error" role="alert"></p><button class="pri" type="submit">Сохранить блюдо</button></form>${existing?`<div class="dish-editor-extra"><button class="ghost" onclick="MyDishes.confirmRemove('${existing.id}')">Удалить блюдо</button>${others.length?`<label>Объединить повторы с другим блюдом<select id="md-merge"><option value="">Выберите блюдо</option>${others.map(item=>`<option value="${item.id}">${esc(item.n)}</option>`).join('')}</select></label><button class="ghost" onclick="MyDishes.confirmMerge()">Объединить блюда</button>`:''}<div id="md-confirm"></div></div>`:''}`);
    preview();
  }
  function back(skip){
    release();
    if(skip){previous=null;editing=null;selected=null;return false}
    if(!previous)return false;
    kbClose();field('sheet').replaceChildren(previous);previous=null;editing=null;
    if(!document.querySelector('#sheet .ov'))unlockBody();
    fixVV();telegramBackState();
    if(field('md-list'))drawList();
    if(field('am')){loadHist();drawFq()}
    return true;
  }
  function preview(){
    const g=Number(field('md-g')?.value),k=Number(field('md-k')?.value);
    const output=field('md-preview');if(output)output.textContent=g>0&&k>=0?`В порции ${g} г — ${Math.round(g*k/100)} ккал`:'';
  }
  function saveDish(){
    const name=field('md-name').value.trim();
    const values=Object.fromEntries(['g','k','p','f','c'].map(key=>[key,Number(field('md-'+key).value.replace(',','.'))]));
    const empty=['g','k','p','f','c'].some(key=>!field('md-'+key).value.trim());
    if(!name||empty||Object.values(values).some(value=>!Number.isFinite(value)||value<0)||values.g<=0||values.g>5000||values.k>950||['p','f','c'].some(key=>values[key]>100)){
      field('md-error').textContent='Укажите название, вес порции и корректные КБЖУ на 100 г.';return;
    }
    let dish=editing&&DishCatalog.find(S,editing);
    const duplicate=DishCatalog.match(S,name);
    if(duplicate&&duplicate.id!==editing&&(editing||!duplicate.hidden)){field('md-error').textContent='Такое блюдо уже есть. Откройте его для редактирования.';return}
    const aliases=field('md-aliases').value.split('\n').map(value=>value.trim().slice(0,1000)).filter(Boolean).slice(0,50);
    if(!persist(()=>{
      if(!dish) dish=duplicate||DishCatalog.record(S,{n:name,g:values.g,k:values.k*values.g/100,p:values.p*values.g/100,f:values.f*values.g/100,c:values.c*values.g/100,m:'b'});
      clearCache(dish);
      Object.assign(dish,values,{n:name,aliases:[...new Set([dish.n,...aliases].map(value=>value.trim().slice(0,1000)))].slice(0,50),meals:MEALS.filter(([key])=>document.querySelector(`[data-md-meal="${key}"]`).checked).map(([key])=>key),pinned:field('md-pinned').checked,hidden:false,custom:true});
    }))return;
    if(typeof NutritionUI!=='undefined')NutritionUI.manual(dish);
    back();refresh();toast('Блюдо сохранено',{type:'success'});
  }
  function confirmRemove(id){
    if(!id){refreshActions(true);return}
    const dish=DishCatalog.find(S,id);if(!dish)return;
    field('md-confirm').innerHTML=`<p>Удалить «${esc(dish.n)}» из моих блюд?</p><button class="sm" onclick="MyDishes.remove('${id}')">Удалить</button><button class="sm" onclick="document.getElementById('md-confirm').innerHTML=''">Отмена</button>`;
  }
  function remove(id){
    if(!DishCatalog.find(S,id)||!persist(()=>DishCatalog.remove(S,id)))return;
    selected=null;
    if(previous)back();refresh();toast('Блюдо удалено');
  }
  function confirmMerge(){
    const target=field('md-merge')?.value;if(!target)return;
    const dish=DishCatalog.find(S,target);
    field('md-confirm').innerHTML=`<p>Объединить повторы с «${esc(dish.n)}»?</p><button class="sm" onclick="MyDishes.merge('${target}')">Объединить</button>`;
  }
  function merge(target){
    if(!editing||!target)return;
    const source=DishCatalog.find(S,editing),destination=DishCatalog.find(S,target);
    if(!source||!destination||source.id===destination.id||!persist(()=>DishCatalog.merge(S,editing,target)))return;
    selected=null;back();refresh();toast('Блюда объединены',{type:'success'});
  }
  return {open,drawList,actions,refreshActions,dismiss,press,move,release,consumeClick,pin,edit,back,preview,saveDish,confirmRemove,remove,confirmMerge,merge};
})();
