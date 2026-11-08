import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../worker/index.js';
import {telegramEnvFixture,telegramPayload} from './telegram-fixture.mjs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const day='2026-11-08',shift=n=>{const date=new Date(day+'T12:00:00');date.setDate(date.getDate()+n);return date.toLocaleDateString('sv')};
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[day+'T12:00:00']))}}
function state(){
 const s={profile:{sex:'m',a:30,h:180,w:80,goal:'keep'},goal:{type:'abs',m:'waist',start:90,target:80,startDate:shift(-30)},log:{},water:{},weights:[],meas:[{d:shift(-7),waist:85},{d:day,waist:87}],wk:[30,45,45,60].map((m,i)=>({id:String(i),d:shift(-i),m})),wkGoal:3,wkPlanMinutes:45,coachMode:'strict',rem:{on:{},t:{}}};
 for(let i=1;i<=12;i++){s.log[shift(-i)]=[{id:'food'+i,n:'Обед',m:'l',g:500,k:i<=10?2000:3000,p:i<=10?100:50,f:i<=10?60:120,c:200}];s.water[shift(-i)]=1500}
 return s;
}
function setup(s=state()){
 const context=vm.createContext({S:s,Date:FixedDate,today:()=>day,norm:()=>({k:2000,p:100,f:60,c:265}),fastLoss:()=>!!s.fastFlag,dd:(a,b)=>Math.round((new Date(b)-new Date(a))/864e5),f1:value=>String(Math.round(value*10)/10).replace('.',','),fd:value=>value,GT:{abs:{t:'Талия',u:'см'}},MN:{waist:'Талия'}});
 for(const file of ['goal-progress.js','goal-ui.js'])vm.runInContext(read(file),context);
 const run=code=>vm.runInContext(code,context);
 return {context,run,s,stats:()=>run('gStats()'),step:()=>run('coachStep(gStats())'),card:()=>run('coachCard(gStats())')};
}

test('the hypothetical workout matches an actual entry and never changes measurements or stores a workout',()=>{
 for(const minutes of [0,180,260])for(const session of [15,45,180]){
  const s=state();s.wk=[{id:'existing',d:day,m:minutes}];s.wkPlanMinutes=session;
  const x=setup(s),before=x.stats(),saved=JSON.stringify(s),next=x.run('GoalProgress.nextWorkout(gStats().plan)');
  assert.equal(JSON.stringify(s),saved);
  if(!next){assert.ok(before.plan.training.minutes>=before.plan.training.targetMinutes);continue}
  s.wk.push({id:'completed',d:day,m:next.minutes});
  assert.equal(x.stats().plan.percent,next.after);assert.equal(x.stats().P,before.P);assert.equal(next.before,before.plan.percent);
 }
 const x=setup();assert.equal(x.step().before,75);assert.equal(x.step().after,83.3);assert.equal(x.step().minutes,45);
});

test('workout comparison stops at the training target and cannot cover days outside the food plan',()=>{
 const x=setup();x.s.wk=[{id:'one',d:day,m:260}];const step=x.step();assert.equal(step.after,91.7);
 x.s.wk[0].m=270;assert.equal(x.run('GoalProgress.nextWorkout(gStats().plan)'),null);assert.equal(x.step().kind,'nutrition');assert.doesNotMatch(x.card(),/coach-comparison/);
 x.s.log={};assert.equal(x.run('GoalProgress.nextWorkout(gStats().plan)'),null);assert.equal(x.step().kind,'diary');assert.match(x.card(),/openAdd\(\)/);assert.doesNotMatch(x.card(),/coach-comparison/);
});

test('missing, stale and rapidly changing measurements take priority over a workout invitation',()=>{
 for(const readings of [[],[{d:shift(-22),waist:87}]]){
  const s=state();s.meas=readings;const x=setup(s);assert.equal(x.step().kind,'measure');assert.match(x.card(),/openMeas\(\)/);assert.doesNotMatch(x.card(),/openWorkout\(\)|coach-comparison/);
 }
 const s=state();s.fastFlag=true;const x=setup(s);assert.equal(x.step().kind,'rest');assert.doesNotMatch(x.card(),/openWorkout\(\)|coach-comparison|История Шэрон/);
});

test('actual achievement and a completed recorded plan do not trigger a new workout challenge',()=>{
 const x=setup();x.s.meas.at(-1).waist=80;assert.equal(x.step().kind,'keep');assert.doesNotMatch(x.card(),/coach-comparison|openWorkout\(\)/);assert.match(x.run('coachLine(gStats())'),/достигнута/);
 x.s.meas.at(-1).waist=87;x.s.wk=[{id:'all',d:day,m:270}];for(const entries of Object.values(x.s.log)){entries[0].k=2000;entries[0].p=100;entries[0].f=60}
 assert.equal(x.stats().plan.percent,100);assert.equal(x.step().kind,'keep');assert.equal(x.stats().P,30);assert.match(x.card(),/По заполненным дням/);
});

test('rounding away a tiny training gap does not claim the training plan was fully completed',()=>{
 const x=setup();x.s.wkGoal=7;x.s.wkPlanMinutes=180;x.s.wk=[{id:'almost',d:day,m:2519}];
 for(const entries of Object.values(x.s.log)){entries[0].k=2000;entries[0].p=100;entries[0].f=60}
 assert.equal(x.stats().plan.percent,100);assert.equal(x.step().kind,'training');assert.doesNotMatch(x.card(),/По заполненным дням план выполнен|План тренировок выполнен/);
});

test('all three tones preserve measured rollback facts and the same conditional calculation',()=>{
 const x=setup(),lines=[];
 for(const mode of ['soft','strict','hard']){
  x.s.coachMode=mode;const text=x.run('coachLine(gStats())');lines.push(text);
  assert.match(text,/30%/);assert.match(text,/−20 п\.п\./);assert.match(x.card(),/83,3%/);assert.match(x.card(),/Расчёт выполнения плана на сегодня при тех же записях питания/);assert.match(x.card(),/Запишите занятие после его выполнения/);
  assert.equal(x.stats().P,30);assert.equal(x.stats().plan.percent,75);
 }
 assert.equal(new Set(lines).size,3);
 x.s.meas.at(-1).waist=84;assert.match(x.run('coachLine(gStats())'),/\+10 п\.п\./);
 x.s.meas.at(-1).waist=85;assert.match(x.run('coachLine(gStats())'),/без изменений/);
});

test('the short real story links to its source without copying a photo or claiming equivalent results',()=>{
 const x=setup(),markup=x.card();assert.match(markup,/https:\/\/www\.england\.nhs\.uk\/diabetes\/case-studies\/sharons-story\//);assert.match(markup,/Личный опыт, у каждого свой темп/);assert.doesNotMatch(markup,/<img/);
});

function longContext(){
 const x=setup();x.s.log[day]=Array.from({length:150},(_,i)=>({id:'long'+i,n:'Очень длинное название блюда '.repeat(3),m:'b',g:100,k:0,p:0,f:0,c:0}));
 Object.assign(x.context,{cur:()=>day,tot:()=>({k:0,p:0,f:0,c:0}),R:Math.round,GOALS:[['keep','Поддержание']],REM:[]});
 x.run('function goalCtx(){return goalCtx0()}');const html=read('index.html');x.run(html.slice(html.indexOf('function ctx(){'),html.indexOf('const CH=')));
 return x.run('ctx()');
}
test('goal facts and the exact scenario survive the Worker context limit with a long food diary',()=>{
 const context=longContext();assert.ok(context.length>6000);const sent=context.slice(0,6000);
 assert.match(sent,/Достижение цели 30%/);assert.match(sent,/выполнение плана с 75% до 83,3%/);assert.match(sent,/Режим тренера: строгий/);assert.ok(sent.indexOf('Достижение цели')<sent.indexOf('Записи по дням'));
});

test('authenticated chat receives the factual motivation rules and current scenario, using the configured model',async()=>{
 const original=globalThis.fetch;let sent,url;
 globalThis.fetch=async(target,options)=>{url=target;sent=JSON.parse(options.body);return Response.json({candidates:[{content:{parts:[{text:'{"reply":"Следуйте своему плану.","actions":[]}'}]}}]})};
 try{
  const req=new Request('https://preview.test',{method:'POST',headers:{Origin:'https://kolpakov-uz.github.io'},body:JSON.stringify(telegramPayload({mode:'chat',context:longContext(),messages:[{role:'user',content:'Мотивируй меня'}]}))});
  const response=await worker.fetch(req,{...telegramEnvFixture,GEMINI_KEY:'fixture-only',MODEL:'gemini-3.5-flash-lite'});assert.equal(response.status,200);
  assert.match(url,/models\/gemini-3\.5-flash-lite:generateContent$/);const instruction=sent.systemInstruction.parts[0].text;
  assert.match(instruction,/Не выдумывай процент изменений тела/);assert.match(instruction,/Отсутствие записей не доказывает нарушение/);assert.match(instruction,/Не выдумывай реальные истории успеха/);assert.match(instruction,/выполнение плана с 75% до 83,3%/);
  assert.deepEqual(JSON.parse((await response.json()).text).actions,[]);
 }finally{globalThis.fetch=original}
});
