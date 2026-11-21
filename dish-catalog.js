const DishCatalog=(()=>{
  const mealKeys=['b','l','d','s'];
  const initialized=new WeakSet();
  const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(value);
  const finite=value=>Number.isFinite(Number(value))&&Number(value)>=0;
  const entries=state=>Object.entries(state.log||{}).sort(([a],[b])=>a.localeCompare(b)).flatMap(([,rows])=>Array.isArray(rows)?rows:[]);

  function normalize(value){
    return String(value||'').normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е')
      .replace(/(\d),(?=\d)/g,'$1.').replace(/(\p{L})(\d)/gu,'$1 $2')
      .replace(/[^\p{L}\p{N}%.]+/gu,' ').replace(/(^|[^\d])\./g,'$1 ').replace(/\.(?=\D|$)/g,' ')
      .replace(/\s*%\s*/g,'% ').replace(/\s+/g,' ').trim();
  }

  function aliases(values){
    const result=[],seen=new Set();
    for(const value of values){
      if(typeof value!=='string')continue;
      const text=value.trim().slice(0,1000),key=normalize(text);
      if(key&&!seen.has(key)){result.push(text);seen.add(key)}
    }
    return result;
  }

  function newId(name,used){
    let first=2166136261,second=5381;
    for(const character of normalize(name)){
      first=Math.imul(first^character.codePointAt(0),16777619);
      second=Math.imul(second,33)^character.codePointAt(0);
    }
    const base='dish-'+(first>>>0).toString(16)+'-'+(second>>>0).toString(16);
    let id=base,index=1;
    while(used.has(id))id=base+'-'+(++index);
    return id;
  }

  function indexName(index,food,value){
    const key=normalize(value);
    if(!key)return;
    if(!index.names.has(key))index.names.set(key,new Set());
    index.names.get(key).add(food);
  }

  function indexFood(index,food){
    index.ids.set(food.id,food);
    const target=resolve(index.ids,food.id);
    if(target)for(const value of [food.n,...food.aliases])indexName(index,target,value);
  }

  function indexFor(foods){
    const index={ids:new Map(foods.map(food=>[food.id,food])),names:new Map()};
    for(const food of foods)indexFood(index,food);
    return index;
  }

  function resolve(ids,id){
    let food=ids.get(id);
    const seen=new Set();
    while(food?.mergedInto){
      if(seen.has(food.id))return null;
      seen.add(food.id);food=ids.get(food.mergedInto);
    }
    return food||null;
  }

  function rememberName(index,food,value){
    const text=value.trim().slice(0,1000),key=normalize(text);
    if(key&&!index.names.get(key)?.has(food)){
      food.aliases.push(text);
      indexName(index,food,text);
    }
  }

  function exact(index,name){
    const candidates=index.names.get(normalize(name));
    return candidates?.size===1?[...candidates][0]:null;
  }

  function macroValues(entry){
    return {
      k:Math.round(Number(entry.k)/Number(entry.g)*100),
      p:Math.round(Number(entry.p)/Number(entry.g)*1000)/10,
      f:Math.round(Number(entry.f)/Number(entry.g)*1000)/10,
      c:Math.round(Number(entry.c)/Number(entry.g)*1000)/10
    };
  }

  function usableEntry(entry){
    return entry&&typeof entry.n==='string'&&normalize(entry.n)&&Number(entry.g)>0&&['g','k','p','f','c'].every(field=>finite(entry[field]));
  }

  function create(entry,used,id){
    return {
      id:validId(id)&&!used.has(id)?id:newId(entry.n,used),
      n:entry.n.trim(),d:'',g:Number(entry.g),...macroValues(entry),
      aliases:[entry.n.trim()],meals:mealKeys.includes(entry.m)?[entry.m]:[],
      pinned:false,hidden:false,custom:false
    };
  }

  function init(state){
    if(!Array.isArray(state.foods))state.foods=[];
    if(!state.log||typeof state.log!=='object'||Array.isArray(state.log))state.log={};
    const foods=[],used=new Set(),names=new Map(),inferPortion=new Set();
    for(const item of state.foods){
      if(!item||typeof item.n!=='string'||!normalize(item.n))continue;
      const name=normalize(item.n),legacy=!validId(item.id);
      const duplicate=legacy&&!item.custom?names.get(name):null;
      if(duplicate&&!duplicate.custom){
        duplicate.aliases=aliases([...duplicate.aliases,item.n,...(Array.isArray(item.aliases)?item.aliases:[])]);
        continue;
      }
      const food=item;
      food.n=food.n.trim();
      food.id=validId(food.id)&&!used.has(food.id)?food.id:newId(food.n,used);
      used.add(food.id);
      if(!(Number(food.g)>0&&Number.isFinite(Number(food.g))))inferPortion.add(food.id);
      food.g=Number(food.g)>0&&Number.isFinite(Number(food.g))?Number(food.g):100;
      food.d=typeof food.d==='string'?food.d:'';
      for(const field of ['k','p','f','c'])food[field]=finite(food[field])?Number(food[field]):0;
      food.aliases=aliases([food.n,...(Array.isArray(food.aliases)?food.aliases:[])]);
      food.meals=Array.isArray(food.meals)?mealKeys.filter(meal=>food.meals.includes(meal)):[];
      food.pinned=food.pinned===true;food.hidden=food.hidden===true;food.custom=food.custom===true;
      if(!validId(food.mergedInto))delete food.mergedInto;
      foods.push(food);if(!names.has(name))names.set(name,food);
    }
    state.foods=foods;
    const ids=new Map(foods.map(food=>[food.id,food]));
    for(const food of foods){
      if(food.mergedInto&&!resolve(ids,food.id))delete food.mergedInto;
      if(food.mergedInto){food.hidden=true;food.pinned=false}
    }
    const index=indexFor(foods);
    const materialized=new Set();
    for(const entry of entries(state)){
      if(!usableEntry(entry))continue;
      let food=resolve(index.ids,entry.dishId)||exact(index,entry.n);
      if(!food&&!index.names.has(normalize(entry.n))){
        food=create(entry,used,entry.dishId);used.add(food.id);foods.push(food);materialized.add(food.id);
        indexFood(index,food);
      }
      if(!food)continue;
      entry.dishId=food.id;
      if(!food.custom)rememberName(index,food,entry.n);
      if(!food.custom&&mealKeys.includes(entry.m)&&!food.meals.includes(entry.m))food.meals.push(entry.m);
      if(inferPortion.has(food.id))food.g=Number(entry.g);
      if(materialized.has(food.id))Object.assign(food,macroValues(entry),{g:Number(entry.g)});
    }
    for(const food of foods){
      // Legacy saved dishes without diary records remain available in settings.
      if(!food.meals.length&&!food.custom)food.meals=[...mealKeys];
    }
    initialized.add(state);
    return state;
  }

  function ensure(state){if(!initialized.has(state))init(state)}
  function find(state,id){ensure(state);return resolve(new Map(state.foods.map(food=>[food.id,food])),id)}
  function match(state,name){ensure(state);return exact(indexFor(state.foods),name)}

  function record(state,entry,options={}){
    if(validId(options.foodId)&&Array.isArray(state.foods)&&state.foods.some(food=>food.id===options.foodId))entry.dishId=options.foodId;
    ensure(state);
    if(!usableEntry(entry))return null;
    let food=find(state,options.foodId)||find(state,entry.dishId)||match(state,entry.n);
    if(!food){
      food=create(entry,new Set(state.foods.map(item=>item.id)));
      state.foods.unshift(food);
    }
    entry.dishId=food.id;
    food.aliases=aliases([...food.aliases,entry.n,options.alias]);
    if(!food.custom){
      Object.assign(food,macroValues(entry),{g:Number(entry.g)});
      if(mealKeys.includes(entry.m)&&!food.meals.includes(entry.m))food.meals.push(entry.m);
    }
    return food;
  }

  function frequent(state,meal){
    ensure(state);
    const index=indexFor(state.foods),counts=new Map(),seen=new Set();
    for(const entry of entries(state)){
      if(!usableEntry(entry))continue;
      const food=resolve(index.ids,entry.dishId)||exact(index,entry.n);
      if(!food)continue;
      if(entry.id&&seen.has(entry.id))continue;
      if(entry.id)seen.add(entry.id);
      counts.set(food.id,(counts.get(food.id)||0)+1);
    }
    return state.foods.map(food=>({...food,count:counts.get(food.id)||0}))
      .filter(food=>!food.hidden&&food.meals.includes(meal)&&(food.pinned||food.count>=10))
      .sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.count-a.count||a.n.localeCompare(b.n,'ru'));
  }

  function clearCache(state,food){
    const keys=new Set([food.n,...food.aliases].map(normalize));
    for(const [key,value] of Object.entries(state.dc||{})){
      if(keys.has(normalize(key))||keys.has(normalize(value?.n)))delete state.dc[key];
    }
  }

  function remove(state,id){
    const food=find(state,id);
    if(!food)return false;
    clearCache(state,food);food.hidden=true;food.pinned=false;
    return true;
  }

  function merge(state,sourceId,targetId){
    const source=find(state,sourceId),target=find(state,targetId);
    if(!source||!target||source===target)return null;
    const index=indexFor(state.foods);
    for(const entry of entries(state)){
      if(resolve(index.ids,entry.dishId)===source||!entry.dishId&&exact(index,entry.n)===source)entry.dishId=target.id;
    }
    target.aliases=aliases([...target.aliases,source.n,...source.aliases]);
    clearCache(state,source);clearCache(state,target);
    source.hidden=true;source.pinned=false;source.mergedInto=target.id;
    return target;
  }

  return {normalize,init,find,match,record,frequent,remove,merge};
})();
