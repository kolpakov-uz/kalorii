// Measurement progress and recent plan adherence are independent indicators.
const GoalProgress=(()=>{
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 const clamp=v=>Math.max(0,Math.min(1,v));
 const round=v=>Math.round(v*10)/10;
 const shift=(day,n)=>{const d=new Date(day+'T12:00:00');d.setDate(d.getDate()+n);return d.toLocaleDateString('sv')};
 const days=(a,b)=>Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/864e5);
 function validDate(day){if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;const d=new Date(day+'T12:00:00');return Number.isFinite(d.getTime())&&d.toLocaleDateString('sv')===day}
 function records(state,goal,asOf){
  const rows=goal.m==='weight'?state.weights:state.meas,byDay=new Map();
  for(const row of rows||[]){const value=goal.m==='weight'?row.w:row[goal.m];if(validDate(row.d)&&row.d>=goal.startDate&&row.d<=asOf&&finite(value)&&value>0)byDay.set(row.d,{d:row.d,v:value})}
  return [...byDay.values()].sort((a,b)=>a.d.localeCompare(b.d));
 }
 function at(state,goal,asOf){
  const series=records(state,goal,asOf),latest=series.at(-1);
  if(!latest)return{value:goal.start,date:null,series,samples:0};
  const recent=goal.m==='weight'?series.filter(row=>days(row.d,latest.d)<7):[latest];
  return{value:recent.reduce((sum,row)=>sum+row.v,0)/recent.length,date:latest.d,series,samples:recent.length};
 }
 function percentage(goal,value){
  const ratio=clamp((value-goal.start)/(goal.target-goal.start));
  return ratio>=1?100:Math.min(99.9,round(ratio*100));
 }
 function measure(state,goal,asOf){
  if(!goal||!finite(goal.start)||!finite(goal.target)||goal.start===goal.target||!validDate(asOf))return null;
  const current=at(state,goal,asOf),age=current.date?days(current.date,asOf):null,stale=age===null||age>14,previousDay=shift(asOf,-7),previous=at(state,goal,previousDay);
  const percent=percentage(goal,current.value),change=!stale&&current.date>previousDay&&previous.date&&days(previous.date,previousDay)<=14?round(percent-percentage(goal,previous.value)):null;
  return{percent,value:current.value,latestDate:current.date,age,stale,hasMeasurement:!!current.date,change,changeFrom:change===null?null:previous.date,changeDays:change===null?null:days(previous.date,current.date),samples:current.samples,series:current.series};
 }
 function plan(state,{asOf,today,hour,norm}){
  const end=asOf<today?asOf:today,start=shift(end,-13),foodEnd=end===today&&hour<21?shift(end,-1):end;
  let eligible=0,filled=0,good=0;
  for(let day=start;day<=foodEnd;day=shift(day,1)){
   eligible++;
   const entries=(state.log?.[day]||[]).filter(row=>['k','p','f'].every(key=>finite(row[key])&&row[key]>=0));
   if(!entries.length)continue;
   filled++;
   const totals=entries.reduce((sum,row)=>({k:sum.k+row.k,p:sum.p+row.p,f:sum.f+row.f}),{k:0,p:0,f:0});
   if(totals.k>=norm.k*.9&&totals.k<=norm.k*1.1&&totals.p>=norm.p*.9&&totals.f<=norm.f*1.1&&(state.water?.[day]||0)>=1500)good++;
  }
  const weeklyCount=Number.isInteger(state.wkGoal)&&state.wkGoal>=1&&state.wkGoal<=7?state.wkGoal:3;
  const sessionMinutes=Number.isInteger(state.wkPlanMinutes)&&state.wkPlanMinutes>=15&&state.wkPlanMinutes<=180&&state.wkPlanMinutes%15===0?state.wkPlanMinutes:45;
  const seen=new Set(),workouts=[];
  for(const workout of state.wk||[]){
   if(!validDate(workout.d)||workout.d<start||workout.d>end||!finite(workout.m)||workout.m<=0)continue;
   if(workout.id&&seen.has(workout.id))continue;if(workout.id)seen.add(workout.id);
   workouts.push(workout);
  }
  const minutes=workouts.reduce((sum,workout)=>sum+workout.m,0),targetMinutes=weeklyCount*sessionMinutes*2,trainingRatio=clamp(minutes/targetMinutes),foodRatio=filled?good/filled:null;
  return{start,end,foodEnd,todayPending:end===today&&hour<21,percent:foodRatio===null?null:round((foodRatio+trainingRatio)*50),nutrition:{eligible,filled,good,percent:foodRatio===null?null:round(foodRatio*100)},training:{count:workouts.length,minutes,targetMinutes,weeklyCount,sessionMinutes,percent:round(trainingRatio*100)}};
 }
 function nextWorkout(plan){
  const food=plan.nutrition,training=plan.training;
  if(!food.filled||training.minutes>=training.targetMinutes)return null;
  const minutes=training.sessionMinutes,after=round((food.good/food.filled+clamp((training.minutes+minutes)/training.targetMinutes))*50);
  return after>plan.percent?{minutes,before:plan.percent,after}:null;
 }
 return{measure,plan,nextWorkout};
})();
