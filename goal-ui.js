function planStats(asOf=today()){return GoalProgress.plan(S,{asOf,today:today(),hour:new Date().getHours(),norm:norm(S.profile)})}
function gStats(){
 const g=S.goal;if(!g)return null;
 const measure=GoalProgress.measure(S,g,today());if(!measure)return null;
 return{...measure,P:measure.percent,cur:measure.value,n:measure.series.length,ser:measure.series,wk:measure.change,plan:planStats(),fast:fastLoss(),day:dd(g.startDate,today())+1,nx:[25,50,75,100].find(value=>value>measure.percent)};
}
function goalStamp(st){
 if(!st.latestDate)return 'Стартовое значение · добавьте замер';
 const when=st.age===0?'сегодня':st.age===1?'вчера':fd(st.latestDate)+(st.latestDate.slice(0,4)!==today().slice(0,4)?' '+st.latestDate.slice(0,4):'')+' · '+st.age+' дн. назад';
 return 'Последний замер · '+when;
}
function goalDelta(st){
 const text=st.stale?'Нужен свежий замер':st.wk===null?'Недостаточно данных для сравнения':st.wk===0?'Без изменений '+goalChangePeriod(st):(st.wk>0?'+':'−')+f1(Math.abs(st.wk))+' п.п. '+goalChangePeriod(st);
 return `<span class="goal-delta ${st.wk!==null&&!st.stale?(st.wk<0?'down':'up'):'neutral'}">${text}</span>`;
}
function goalChangePeriod(st){return st.changeDays===7?'за неделю':'с '+fd(st.changeFrom)+(st.changeFrom.slice(0,4)!==today().slice(0,4)?' '+st.changeFrom.slice(0,4):'')}
function goalPlanCard(plan){
 const food=plan.nutrition,training=plan.training;
 return `<section class="card" aria-label="Выполнение плана за последние 14 дней">
 <div class="goal-plan-head"><div><h3>Выполнение плана</h3><p class="em">Последние 14 дней</p></div><b class="goal-plan-number">${plan.percent===null?'—':f1(plan.percent)+'%'}</b></div>
 <div class="goal-plan-row"><div><span>Питание</span><b>${food.filled?food.good+' из '+food.filled+' дней':'Нет записей'}</b></div><div class="trk sm" role="progressbar" aria-label="Питание по заполненным дням" aria-valuemin="0" aria-valuemax="100" ${food.percent===null?'':'aria-valuenow="'+food.percent+'"'} style="--w:${food.percent||0}%"><div class="fb"></div></div></div>
 <div class="goal-plan-row"><div><span>Тренировки</span><b>${f1(training.minutes)} из ${training.targetMinutes} мин</b></div><div class="trk sm" role="progressbar" aria-label="Выполнение плана тренировок" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${training.percent}" style="--w:${training.percent}%"><div class="fb"></div></div><p class="em">Отдельных записей: ${training.count}</p></div>
 <p class="em goal-coverage">Дневник заполнен на ${food.filled} из ${food.eligible} завершённых дней${plan.todayPending?'. Сегодняшнее питание — после 21:00.':'.'}</p>
 <details class="how"><summary>Как считается выполнение</summary><p>Питание: доля заполненных дней в пределах текущего плана — калории ±10%, белок от 90%, жиры не выше 110%, вода от 1,5 л. Пустой дневник означает отсутствие данных. Тренировки: суммарные минуты за 14 дней относительно плана ${training.weeklyCount} × ${training.sessionMinutes} мин в неделю, максимум 100%. У обеих частей одинаковый вес. Пока записей питания нет, общая оценка не выставляется. Тренировки учитываются сразу, каждая запись сохраняется отдельно. Показатель обновляется за последние 14 дней и не добавляет проценты к замерам.</p></details></section>`;
}
function goalPrev(type){const start=parseFloat($('#g_s').value),target=parseFloat($('#g_t').value),out=$('#gp');if(!out)return;out.textContent=start>0&&target>0&&start!==target?'Изменение цели: '+f1(Math.abs(target-start))+' '+GT[type].u:''}
function goalCtx0(){
 const g=S.goal;if(!g)return ` Режим тренера: ${S.coachMode}.`;
 const st=gStats(),plan=st.plan,food=plan.nutrition,training=plan.training,step=coachStep(st);
 const scenario=step.kind==='workout'?` Мотивационный расчёт на сегодня: одна плановая тренировка ${step.minutes} мин изменила бы выполнение плана с ${f1(step.before)}% до ${f1(step.after)}%, если остальные записи не изменятся. Это не прогноз изменений тела; запись допустима только после выполненного занятия.`:'';
 return ` Цель-результат: ${GT[g.type].t}, старт ${g.start}, цель ${g.target}, по замерам ${f1(st.cur)} ${GT[g.type].u}. Достижение цели ${f1(st.P)}%, считается только по замерам и может уменьшаться. ${goalStamp(st)}.${st.stale?' Данные замеров устарели.':''}${st.fast?' Отмечен быстрый темп снижения веса: не предлагай ускорять его.':''} Изменение по замерам: ${st.wk===null?'нет сравнения':f1(st.wk)+' п.п. '+goalChangePeriod(st)}. Выполнение плана за ${plan.start}–${plan.end}: ${plan.percent===null?'недостаточно данных питания':f1(plan.percent)+'%'}. Питание: ${food.good} из ${food.filled} заполненных дней в пределах плана; завершённых дней ${food.eligible}. Тренировки: ${training.count} отдельных записей, ${training.minutes} из ${training.targetMinutes} минут.${scenario} Не трактуй отсутствие записей как подтверждённое нарушение; не добавляй баллы привычек к прогрессу замеров и не обещай точную дату достижения цели. Не выдумывай, какой процент цели по телу был бы достигнут при идеальном соблюдении плана, и не приписывай изменение замеров конкретному нарушению без данных. Мотивируй конкретным посильным следующим шагом без наказания едой или тренировками. Режим тренера: ${{soft:'мягкий',strict:'строгий',hard:'жёсткий'}[S.coachMode]}.`;
}
function coachLine(st){
 const tone=(soft,strict,hard)=>S.coachMode==='soft'?soft:S.coachMode==='hard'?hard:strict;
 if(st.fast)return 'Темп снижения веса отмечен как быстрый. Не пытайтесь ускорять его ограничением еды или дополнительными тренировками. Проверьте замеры; при плохом самочувствии обратитесь к врачу.';
 if(st.stale)return tone('Начнём со свежего замера. Он поможет увидеть, где вы сейчас, и выбрать следующий шаг.','Обновите замер: пока результат показан по последним данным. Отсутствие замера не означает откат.','Первый шаг — свежий замер. Без него нельзя оценить текущий результат.');
 if(st.P>=100)return tone('Вы достигли цели по замерам! Теперь ценен устойчивый результат: продолжайте наблюдать за ним.','Цель по замерам достигнута. Сохраняйте регулярность и наблюдайте за результатом.','Цель достигнута. Следующая задача — сохранить результат, а не наращивать нагрузку ради процентов.');
 const fact='По замерам сейчас '+f1(st.P)+'% пути к цели. ';
 if(st.wk!==null&&st.wk<0)return fact+'Изменение '+goalChangePeriod(st)+': −'+f1(Math.abs(st.wk))+' п.п. '+tone('Один откат не отменяет ваших усилий. Проверьте замер в тех же условиях и вернитесь к посильному шагу.','Проверьте замер в тех же условиях. Один замер не объясняет причину изменения — оцените записи и вернитесь к регулярности.','Откат есть. Проверьте замер и действуйте по плану: следующий последовательный шаг полезнее попытки догнать всё за день.');
 if(st.wk!==null&&st.wk>0)return fact+'Изменение '+goalChangePeriod(st)+': +'+f1(st.wk)+' п.п. '+tone('Это движение к цели. Поддержите его следующим небольшим шагом.','Движение к цели есть. Сохраняйте регулярность питания и тренировок.','Результат есть. Продолжайте выполнять план последовательно, без случайных рывков.');
 return fact+(st.wk===0?'Замеры пока без изменений. ':'')+tone('Не обязательно менять всё сразу. Выберите один посильный шаг на сегодня.','Сосредоточьтесь на следующем действии по плану. Результат проверим по новым замерам.','Действуйте последовательно. Один выполненный шаг полезнее обещания начать идеально завтра.');
}
function coachStep(st){
 if(st.fast)return {kind:'rest'};
 if(st.stale)return {kind:'measure'};
 if(st.P>=100)return {kind:'keep'};
 if(!st.plan.nutrition.filled)return {kind:'diary'};
 const scenario=GoalProgress.nextWorkout(st.plan);
 if(scenario)return {kind:'workout',...scenario};
 if(st.plan.training.minutes<st.plan.training.targetMinutes)return {kind:'training'};
 return {kind:st.plan.nutrition.good===st.plan.nutrition.filled?'keep':'nutrition'};
}
function coachCard(st){
 const step=coachStep(st),scenario=step.kind==='workout';
 const actions={measure:['Записать замер','openMeas()'],diary:['Записать питание','openAdd()'],nutrition:['Записать питание','openAdd()'],workout:['Записать тренировку','openWorkout()'],training:['Записать тренировку','openWorkout()']},action=actions[step.kind];
 const hint={diary:'Начните с записи еды за сегодня. Пока нет заполненных завершённых дней, оценка плана остаётся неполной.',nutrition:'План тренировок выполнен. Следующий шаг — заполнить питание за сегодня и сверить дневной итог со своим планом.',training:'Продолжайте занятия в рамках своего плана и записывайте их после выполнения.',keep:st.P>=100?'Поддерживайте привычный режим и продолжайте записывать замеры.':'По заполненным дням план выполнен. Сохраняйте этот ритм; новые замеры покажут результат.'}[step.kind];
 return `<section class="card goal-coach" aria-label="Поддержка тренера"><h3>Тренер</h3><div class="pills" style="margin-top:10px">${[['soft','Мягкий'],['strict','Строгий'],['hard','Жёсткий']].map(([key,name])=>`<button class="${S.coachMode===key?'on':''}" aria-pressed="${S.coachMode===key}" onclick="setMode('${key}')">${name}</button>`).join('')}</div><p class="cl">${coachLine(st)}</p>
 ${scenario?`<div class="coach-scenario"><p class="em">Одна плановая тренировка · ${step.minutes} мин</p><div class="coach-comparison" aria-label="Выполнение плана: сейчас ${f1(step.before)}%, с тренировкой ${f1(step.after)}%"><div><small>Сейчас</small><b>${f1(step.before)}%</b></div><span aria-hidden="true">→</span><div><small>С тренировкой</small><b>${f1(step.after)}%</b></div></div><p class="em">Расчёт выполнения плана на сегодня при тех же записях питания. Изменения тела покажут новые замеры.</p></div>`:hint?`<p class="em coach-hint">${hint}</p>`:''}
 ${action?`<button class="pri coach-action" onclick="${action[1]}">${action[0]}</button>${scenario?'<p class="em coach-note">Запишите занятие после его выполнения.</p>':''}`:''}
 ${step.kind!=='rest'?'<aside class="coach-story" aria-label="Реальная история"><b>Маленькие шаги работают</b><p>Шэрон Хейтер начала программу Couch to 5K. По её рассказу NHS, со временем она смогла бегать 30 минут, хотя раньше не выдерживала и минуты.</p><a href="https://www.england.nhs.uk/diabetes/case-studies/sharons-story/" target="_blank" rel="noopener noreferrer">История Шэрон · NHS ↗</a><small>Личный опыт, у каждого свой темп.</small></aside>':''}</section>`;
}
function chartSvg(st,g){
 const x0=18,x1=332,span=Math.max(1,dd(g.startDate,today())),X=day=>x0+(x1-x0)*dd(g.startDate,day)/span;
 const values=[g.start,g.target,...st.ser.map(row=>row.v)],lo=Math.min(...values),hi=Math.max(...values),pad=(hi-lo||1)*.15,Y=value=>(12+110*(1-(value-lo+pad)/(hi-lo+2*pad))).toFixed(1);
 const points=[{d:g.startDate,v:g.start},...st.ser],last=points.at(-1);
 return `<svg viewBox="0 0 350 150" width="100%" height="150" role="img" aria-label="История фактических замеров"><line x1="${x0}" y1="${Y(g.target)}" x2="${x1}" y2="${Y(g.target)}" stroke="var(--mut)" stroke-dasharray="4 5"/><text x="${x1}" y="${Math.max(12,+Y(g.target)-6)}" text-anchor="end" font-size="11" fill="var(--mut)">цель ${f1(g.target)}</text><polyline class="pl" pathLength="1" points="${points.map(row=>X(row.d).toFixed(1)+','+Y(row.v)).join(' ')}" fill="none" stroke="var(--acc)" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${X(last.d).toFixed(1)}" cy="${Y(last.v)}" r="4" fill="var(--acc)"/><text x="${x0}" y="145" font-size="11" fill="var(--mut)">${fd(g.startDate)}</text><text x="${x1}" y="145" text-anchor="end" font-size="11" fill="var(--mut)">${fd(today())}</text></svg>`;
}
function goalMini(){
 const g=S.goal;if(!g)return `<section class="card gm" role="button" tabindex="0" onclick="go('goal')"><div class="mh"><h3>Поставьте цель</h3><span>›</span></div><p class="em">Вес, талия или обхват руки: отслеживайте изменение замеров.</p></section>`;
 const st=gStats();return `<section class="card gm" role="button" tabindex="0" onclick="go('goal')"><div class="mh"><h3>${GT[g.type].t}</h3><span><b>${f1(st.P)}%</b></span></div><div class="trk sm" style="--w:${st.P}%"><div class="fb"></div></div><small>${st.stale?goalStamp(st):st.P>=100?'Цель по замерам достигнута':'Осталось '+f1(100-st.P)+'% по замерам'}</small></section>`;
}
function vGoal(){
 const g=S.goal;
 if(!g)return `<h1>Цель</h1><p class="sub">Выберите результат, чтобы отслеживать изменение замеров.</p>${Object.entries(GT).map(([key,type])=>`<button class="gcard" onclick="openGoal('${key}')"><b>${type.t}</b><small>${type.d}</small></button>`).join('')}${workCard()}`;
 const st=gStats(),type=GT[g.type],unit=type.u;
 return `<h1>Цель</h1><p class="sub">${MN[g.m]} · ${f1(g.start)} → ${f1(g.target)} ${unit}</p>
 <section class="card goal-result" aria-label="Достижение цели"><div class="goal-top"><h3>Достижение цели</h3>${goalDelta(st)}</div>
 <div class="gp goal-value"><div><b class="pc">${f1(st.P)}</b><span class="pcs">%</span></div><div class="goal-remaining"><small>осталось</small><b>${f1(100-st.P)}%</b></div></div>
 <div class="trk" role="progressbar" aria-label="Достижение цели по замерам" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${st.P}" style="--w:${st.P}%"><div class="fb"></div></div>
 <div class="g3 goal-measures"><div><small>Старт</small><b>${f1(g.start)} ${unit}</b></div><div><small>Сейчас</small><b>${f1(st.cur)} ${unit}</b></div><div><small>Цель</small><b>${f1(g.target)} ${unit}</b></div></div>
 <p class="em goal-stamp">${goalStamp(st)}${g.m==='weight'&&st.samples>1?'. Среднее по '+st.samples+' замерам за 7 дней.':''}</p><button class="pri" onclick="openMeas()">Записать замер</button>
 <details class="how"><summary>Как считается достижение</summary><p>Процент показывает изменение выбранного замера от старта к цели: при движении назад он уменьшается. Для веса используется среднее доступных замеров за 7 дней, для остальных показателей — последний замер. Питание и тренировки показаны отдельно в выполнении плана. Старые замеры не считаются свежими, а отсутствие записи не означает подтверждённый откат.</p></details></section>
 ${goalPlanCard(st.plan)}
 ${coachCard(st)}
 ${st.fast?'<section class="card wr"><b>Темп снижения веса слишком высокий</b><p class="em">Не урезайте калории дальше. Если чувствуете слабость или головокружение, обратитесь к врачу.</p></section>':''}
 <section class="card"><h3>${MN[g.m]}: история замеров</h3>${chartSvg(st,g)}<p class="em">Линия — записанные замеры. Пунктир — целевое значение.</p></section>
 ${workCard()}
 <button class="ghost" onclick="openGoalEdit()">Изменить старт и цель</button><button class="ghost" onclick="resetGoal()">Выбрать другую цель</button><p class="em">Процент относится к выбранному замеру и зависит от точности измерений.</p>`;
}
