import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('../goal-progress.js',import.meta.url),'utf8'),context);const progress=vm.runInContext('GoalProgress',context);
const goal={type:'abs',m:'waist',start:90,target:80,startDate:'2026-10-01'};
const state=()=>({goal:{...goal},log:{},water:{},weights:[],meas:[],wk:[],wkGoal:3,wkPlanMinutes:45});
const options={asOf:'2026-11-07',today:'2026-11-07',hour:12,norm:{k:2000,p:100,f:60}};
const shift=(day,n)=>{const date=new Date(day+'T12:00:00');date.setDate(date.getDate()+n);return date.toLocaleDateString('sv')};
function food(s,day,good=true){s.log[day]=[{k:good?2000:3000,p:good?100:50,f:good?60:120}];s.water[day]=1500}

test('measurement progress moves both ways and does not retain habit bonuses at the starting point',()=>{
 const s=state();for(const [waist,expected] of [[85,50],[87,30],[90,0],[92,0],[80.1,99],[80,100],[80.1,99]]){s.meas=[{d:options.today,waist}];assert.equal(progress.measure(s,s.goal,options.today).percent,expected)}
 for(let i=0;i<14;i++){food(s,shift(options.today,-i));s.wk.push({id:String(i),d:shift(options.today,-i),m:45})}s.meas=[{d:options.today,waist:90}];assert.equal(progress.plan(s,{...options,hour:21}).percent,100);assert.equal(progress.measure(s,s.goal,options.today).percent,0);
});
test('near-target progress never rounds up to achievement before the measurement reaches the goal',()=>{
 const s=state();s.meas=[{d:options.today,waist:80.001}];assert.equal(progress.measure(s,s.goal,options.today).percent,99.9);s.meas[0].waist=80;assert.equal(progress.measure(s,s.goal,options.today).percent,100);
});
test('growth goals and body-fat goals use the same reversible measurement calculation',()=>{
 const s=state();const arm={...goal,type:'arm',m:'arm',start:30,target:34};s.meas=[{d:options.today,arm:32}];assert.equal(progress.measure(s,arm,options.today).percent,50);s.meas[0].arm=31;assert.equal(progress.measure(s,arm,options.today).percent,25);
 const fat={...goal,type:'fat',m:'bf',start:24,target:20};s.meas=[{d:options.today,bf:21}];assert.equal(progress.measure(s,fat,options.today).percent,75);s.meas[0].bf=23;assert.equal(progress.measure(s,fat,options.today).percent,25);
});
test('weekly rollback compares actual measurement history, while stale or missing data is not invented',()=>{
 const s=state();s.meas=[{d:'2026-10-31',waist:85},{d:'2026-11-07',waist:87}];const current=progress.measure(s,s.goal,options.today);assert.equal(current.change,-20);assert.equal(current.age,0);assert.equal(current.changeDays,7);
 const historical=progress.measure(s,s.goal,'2026-10-31');assert.equal(historical.percent,50);assert.equal(historical.change,null);
 const stale=progress.measure(s,s.goal,'2026-11-29');assert.equal(stale.percent,30);assert.equal(stale.age,22);assert.equal(stale.stale,true);assert.equal(stale.change,null);
 s.meas=[{d:'2026-10-24',waist:85},{d:'2026-11-07',waist:87}];assert.equal(progress.measure(s,s.goal,options.today).changeDays,14);s.meas[0].d='2026-10-01';assert.equal(progress.measure(s,s.goal,options.today).change,null);
 s.meas=[];const missing=progress.measure(s,s.goal,options.today);assert.equal(missing.percent,0);assert.equal(missing.hasMeasurement,false);assert.equal(missing.latestDate,null);
});
test('weight uses available daily readings over seven days and excludes duplicates, old and future readings',()=>{
 const s=state(),weight={...goal,type:'lose',m:'weight',start:80,target:70};s.weights=[{d:'2026-10-24',w:60},{d:'2026-11-01',w:74},{d:'2026-11-02',w:99},{d:'2026-11-02',w:76},{d:'2026-11-08',w:70}];
 const result=progress.measure(s,weight,'2026-11-07');assert.equal(result.value,75);assert.equal(result.samples,2);assert.equal(result.latestDate,'2026-11-02');assert.equal(result.percent,50);
 s.weights.push({d:'2026-11-07',w:78});const rollback=progress.measure(s,weight,'2026-11-07');assert.equal(rollback.value,76);assert.equal(rollback.percent,40);
});
test('measurements before the goal, invalid dates and nonfinite values do not become current readings',()=>{
 const s=state();s.meas=[{d:'2026-09-30',waist:80},{d:'2026-02-30',waist:80},{d:'2026-11-08',waist:80},{d:'2026-11-07',waist:NaN}];assert.equal(progress.measure(s,s.goal,options.today).hasMeasurement,false);
});
test('the approved example has independent 30 percent measurement progress and 75 percent plan adherence',()=>{
 const s=state();s.meas=[{d:'2026-10-31',waist:85},{d:'2026-11-07',waist:87}];for(let i=0;i<12;i++)food(s,shift('2026-10-25',i),i<10);
 s.wk=[30,45,45,60].map((m,i)=>({id:String(i),d:shift('2026-11-01',i),m}));const plan=progress.plan(s,options);
 assert.equal(plan.nutrition.filled,12);assert.equal(plan.nutrition.good,10);assert.equal(plan.nutrition.eligible,13);assert.equal(plan.training.minutes,180);assert.equal(plan.training.targetMinutes,270);assert.equal(plan.percent,75);assert.equal(progress.measure(s,s.goal,options.today).percent,30);
});
test('bad recorded days lower recent adherence, while missing diary days remain explicitly unknown',()=>{
 const s=state();food(s,'2026-11-05');s.wk=[{id:'a',d:'2026-11-05',m:270}];assert.equal(progress.plan(s,options).percent,100);
 food(s,'2026-11-06',false);const plan=progress.plan(s,options);assert.equal(plan.percent,75);assert.equal(plan.nutrition.filled,2);assert.equal(plan.nutrition.eligible,13);
 s.log={};const missing=progress.plan(s,options);assert.equal(missing.percent,null);assert.equal(missing.nutrition.percent,null);assert.equal(missing.training.percent,100);
});
test('training credit expires after fourteen days and splitting the same minutes cannot inflate it',()=>{
 const one=state(),split=state();food(one,'2026-11-06');food(split,'2026-11-06');one.wk=[{id:'a',d:'2026-11-06',m:60}];split.wk=[15,15,15,15].map((m,i)=>({id:String(i),d:'2026-11-06',m}));
 assert.equal(progress.plan(one,options).training.percent,progress.plan(split,options).training.percent);assert.equal(progress.plan(split,options).training.count,4);
 const later={...options,today:'2026-11-21',asOf:'2026-11-21'};food(one,'2026-11-20');const expired=progress.plan(one,later);assert.equal(expired.training.minutes,0);assert.equal(expired.percent,50);
});
test('every separate workout adds its minutes; deletion, future records and duplicate IDs are handled',()=>{
 const s=state();s.wk=[{id:'a',d:'2026-11-07',m:15},{id:'b',d:'2026-11-07',m:180},{id:'a',d:'2026-11-07',m:15},{id:'future',d:'2026-11-08',m:180},{id:'old',d:'2026-10-24',m:180}];assert.equal(progress.plan(s,options).training.minutes,195);assert.equal(progress.plan(s,options).training.count,2);s.wk=s.wk.filter(row=>row.id!=='b');assert.equal(progress.plan(s,options).training.minutes,15);
});
test('today nutrition is evaluated after 21:00 and workouts count immediately',()=>{
 const s=state();food(s,options.today);s.wk=[{id:'a',d:options.today,m:45}];const before=progress.plan(s,options);assert.equal(before.nutrition.filled,0);assert.equal(before.training.minutes,45);assert.equal(before.todayPending,true);
 const after=progress.plan(s,{...options,hour:21});assert.equal(after.nutrition.filled,1);assert.equal(after.nutrition.eligible,14);assert.equal(after.todayPending,false);
});
test('plan duration changes only the plan target and never the measurement percentage',()=>{
 const s=state();s.meas=[{d:options.today,waist:85}];s.wk=[{id:'a',d:options.today,m:90}];const before=progress.plan(s,options);s.wkPlanMinutes=90;const after=progress.plan(s,options);assert.equal(before.training.targetMinutes,270);assert.equal(after.training.targetMinutes,540);assert.ok(after.training.percent<before.training.percent);assert.equal(progress.measure(s,s.goal,options.today).percent,50);
});
