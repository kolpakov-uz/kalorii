const NutritionUI=(()=>{
 let initialized=false,timer,busy=false,again=false,generation=0,flight,clearing=false;
 function start(){if(!PrivateAccess.allowed)return;if(!S.nutrition){Nutrition.merge(S,NutritionSeed);for(const dish of S.foods||[])if(!dish.hidden)Nutrition.remember(S,dish,'',dish.custom?'manual':'estimate')}if(initialized||clearing)return;initialized=true;schedule(0)}
 function schedule(delay=1500){clearTimeout(timer);timer=setTimeout(sync,delay)}
 async function sync(){
  if(!PrivateAccess.allowed||clearing)return;if(busy){again=true;return}busy=true;const version=generation;
  flight=(async()=>{try{const data=JSON.parse(await callAPI({mode:'nutrition',rows:Nutrition.store(S).rows.filter(r=>r.origin==='manual'||r.origin==='estimate')}));if(version===generation){Nutrition.merge(S,data.rows);save()}}catch{/* The local database remains usable offline; retry on the next edit/open. */}
  finally{busy=false;if(again&&!clearing){again=false;schedule(6000)}}})();return flight;
 }
 async function clear(){generation++;clearing=true;clearTimeout(timer);again=false;try{await flight;await callAPI({mode:'nutrition',clear:true})}catch{toast('Данные на устройстве удалены. Не удалось очистить пищевой кэш на сервере — повторите при подключении к интернету.',{type:'warning'})}finally{clearing=false;initialized=false}}
 function requestChoice(text,query){
  const host=document.getElementById('nutrition-choice');if(!host)return false;
  const grain=query.family!=='chicken';
  host.hidden=false;host.innerHTML=`<span>Вес до или после приготовления?</span><div>${(grain?[['raw','Сухой продукт'],['boiled','Готовая каша']]:[['raw','Сырое'],['boiled','Варёное'],['fried','Жареное'],['baked','Запечённое'],['braised','Тушёное']]).map(([id,label])=>`<button type="button" onclick="NutritionUI.choose('${id}')">${label}</button>`).join('')}<button type="button" onclick="NutritionUI.cancel()">Отмена</button></div><small>Запомню выбор для этого продукта. Явное уточнение в сообщении всегда важнее.</small>`;
  host.dataset.text=text;return true;
 }
 function cancel(){const host=document.getElementById('nutrition-choice');if(host){host.hidden=true;host.innerHTML=''}}
 function choose(method){const host=document.getElementById('nutrition-choice'),input=document.getElementById('ai');if(!host||!input)return;if(Nutrition.norm(input.textContent)!==Nutrition.norm(host.dataset.text)){cancel();sendFood();return}const text=Nutrition.choose(S,host.dataset.text,method);cancel();input.textContent=text;kbSync(1);save();sendFood()}
 function reset(){Nutrition.store(S).defaults={};save();toast('При следующем вводе мяса или крупы уточню, как указан вес.')}
 function manual(dish){Nutrition.remember(S,dish,'','manual');schedule()}
 return {start,schedule,requestChoice,choose,cancel,reset,manual,clear};
})();
