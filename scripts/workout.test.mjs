import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('const WK='),end=html.indexOf('\n(()=>{let y0=',start);
assert.ok(start>=0&&end>start,'workout section exists');
const source=html.slice(start,end);
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-07T12:00:00']))}}

function setup(initial){
 const fields={'#wk-date':{value:'2026-11-07'},'#wk-date-label':{textContent:''},'#wk-next':{disabled:true},'#wk-date-info':{innerHTML:''}};
 const buttons=Object.fromEntries(Object.entries({m:Array.from({length:12},(_,i)=>(i+1)*15),t:['str','abs','cardio']}).map(([key,values])=>[key,values.map(value=>({dataset:{[key]:String(value)},attributes:{},setAttribute(k,v){this.attributes[k]=v},classList:{toggle(_name,on){this.on=on}}}))]));
 let stored,markup='',saved=0,closed=0;
 const context=vm.createContext({Date:FixedDate,S:initial||{wk:[],wkGoal:3},today:()=> '2026-11-07',$:selector=>fields[selector],document:{querySelectorAll:selector=>buttons[selector.match(/data-(\w+)/)[1]]},sheet:value=>{markup=value;fields['#wk-date'].value=value.match(/id="wk-date"[^>]*value="([^"]+)"/)[1];fields['#wk-next'].disabled=true},save:()=>{stored=JSON.parse(JSON.stringify(context.S));saved++},closeSheet:()=>closed++,render(){},toast(){},anim(){},celebrate(){},setTimeout(){}});
 vm.runInContext(html.slice(html.indexOf('function fd(v)'),html.indexOf('function dnav()')),context);
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run('openWorkout()');
 const select=value=>{context.value=value;run('wkMin(value)')};
 return {run,select,buttons,fields,context,get stored(){return stored},get markup(){return markup},get saved(){return saved},get closed(){return closed}};
}

test('chosen minutes are saved exactly, survive reload and remain readable by diary backup',()=>{
 const x=setup();x.run("wkType('abs');wkDay(-1)");x.select(75);x.run('saveWorkout()');
 assert.equal(x.saved,1);assert.equal(x.closed,1);assert.equal(x.stored.wk[0].m,75);assert.equal(x.stored.wk[0].d,'2026-11-06');assert.deepEqual(x.stored.wk[0].t,['str','abs']);
 const reloaded=setup(x.stored);assert.match(reloaded.run('workCard()'),/75 мин/);
 vm.runInContext(fs.readFileSync(new URL('../diary-backup.js',import.meta.url),'utf8'),x.context);
 assert.equal(x.run('DiaryBackup.parse(DiaryBackup.stringify(S)).wk[0].m'),75);
});
test('duration selection updates the highlight and accessible state without changing workout types or day',()=>{
 const x=setup();x.run("wkType('cardio');wkDay(-1);wkMin(60)");assert.equal(x.buttons.m.find(b=>b.dataset.m==='60').classList.on,true);
 x.select(150);assert.equal(x.buttons.m.filter(b=>b.classList.on).length,1);assert.equal(x.buttons.m.find(b=>b.dataset.m==='150').attributes['aria-pressed'],'true');assert.equal(x.buttons.m.find(b=>b.dataset.m==='60').attributes['aria-pressed'],'false');x.run('saveWorkout()');assert.deepEqual(x.stored.wk[0].t,['str','cardio']);assert.equal(x.stored.wk[0].d,'2026-11-06');assert.equal(x.stored.wk[0].m,150);
});
test('the picker offers every 15-minute step through three hours and saves either end correctly',()=>{
 const x=setup(),choices=[...x.markup.matchAll(/data-m="(\d+)"/g)].map(m=>Number(m[1]));assert.deepEqual(choices,Array.from({length:12},(_,i)=>(i+1)*15));assert.doesNotMatch(x.markup,/type="number"/);assert.match(x.markup,/data-m="180"[^>]*>3 ч<\/button>/);
 for(const minutes of choices){const y=setup();y.select(minutes);y.run('saveWorkout()');assert.equal(y.stored.wk[0].m,minutes)}
});
test('out-of-range selections cannot replace a valid choice and an invalid state cannot be saved',()=>{
 for(const value of [0,14,16,181,200,NaN,Infinity,null,'60']){const x=setup();x.select(90);x.select(value);x.run('saveWorkout()');assert.equal(x.stored.wk[0].m,90)}
 const x=setup();x.run('WM=200;saveWorkout()');assert.equal(x.saved,0);assert.equal(x.closed,0);
});

test('date arrows start at today, preserve the workout choices and save the selected past day',()=>{
 const x=setup();assert.equal(x.run('WD'),'2026-11-07');assert.equal(x.fields['#wk-next'].disabled,true);
 x.select(150);x.run("wkType('cardio');wkDay(-1);wkDay(-1);wkDay(-1);wkDay(1)");assert.equal(x.run('WD'),'2026-11-05');assert.equal(x.fields['#wk-date'].value,'2026-11-05');assert.equal(x.fields['#wk-next'].disabled,false);x.run('saveWorkout()');
 assert.equal(x.stored.wk[0].d,'2026-11-05');assert.equal(x.stored.wk[0].m,150);assert.deepEqual(x.stored.wk[0].t,['str','cardio']);
 x.run('openWorkout()');assert.equal(x.run('WD'),'2026-11-07');
});
test('date navigation handles month/year boundaries and leap days without rolling invalid dates forward',()=>{
 const x=setup();
 for(const [from,previous] of [['2026-11-01','2026-10-31'],['2026-01-01','2025-12-31'],['2024-03-01','2024-02-29']]){
  x.context.from=from;x.run('wkSetDay(from);wkDay(-1)');assert.equal(x.run('WD'),previous);x.run('wkDay(1)');assert.equal(x.run('WD'),from);
 }
 x.run("wkSetDay('2025-12-31')");assert.match(x.fields['#wk-date-label'].textContent,/2025/);
 for(const value of ['2026-02-30','2023-02-29','','invalid','2026-13-01','0000-01-01']){x.context.value=value;x.run('wkSetDay(value)');assert.equal(x.run('WD'),'2025-12-31');assert.equal(x.fields['#wk-date'].value,'2025-12-31')}
});
test('future dates cannot be selected or saved, and the forward arrow disables at today',()=>{
 const x=setup();x.run('wkDay(-1);wkDay(1);wkDay(1)');assert.equal(x.run('WD'),'2026-11-07');assert.equal(x.fields['#wk-next'].disabled,true);
 x.run("wkSetDay('2026-11-08')");assert.equal(x.run('WD'),'2026-11-07');x.run("WD='2026-11-08';saveWorkout()");assert.equal(x.saved,0);assert.equal(x.closed,0);
});
test('selected-day counts refresh independently and a midnight change does not move the saved workout',()=>{
 const x=setup({wk:[{id:'first',d:'2026-11-05',t:['str'],m:45},{id:'second',d:'2026-11-05',t:['cardio'],m:30}],wkGoal:3});
 x.run("wkSetDay('2026-11-05')");assert.match(x.fields['#wk-date-info'].innerHTML,/день: 2/);x.run('wkDay(1)');assert.match(x.fields['#wk-date-info'].innerHTML,/день: 0/);
 x.context.today=()=> '2026-11-08';x.context.Date=class extends Date{constructor(...args){super(...(args.length?args:['2026-11-08T12:00:00']))}};
 x.run('saveWorkout()');assert.equal(x.stored.wk.at(-1).d,'2026-11-06');
});

function progressSetup(){
 const x=setup({profile:{sex:'m',a:30,h:180,w:80,act:1.2,goal:'keep'},goal:{type:'abs',m:'waist',start:90,target:89,startDate:'2026-11-07'},wk:[],wkGoal:3,log:{},water:{},weights:[],meas:[]});
 const begin=html.indexOf('const GT='),finish=html.indexOf('\nfunction goalErr',begin);
 assert.ok(begin>=0&&finish>begin);
 x.context.norm=()=>({k:2000,p:100,f:60});
 x.context.items=d=>x.context.S.log[d]||[];
 x.context.tot=d=>x.context.items(d).reduce((s,v)=>({k:s.k+v.k,p:s.p+v.p,f:s.f+v.f}),{k:0,p:0,f:0});
 vm.runInContext(html.slice(begin,finish),x.context);
 vm.runInContext(fs.readFileSync(new URL('../goal-progress.js',import.meta.url),'utf8'),x.context);
 vm.runInContext(fs.readFileSync(new URL('../goal-ui.js',import.meta.url),'utf8'),x.context);
 return x;
}
test('two workouts update recent plan minutes separately without changing measurement progress',()=>{
 const x=progressSetup();assert.equal(x.run('gStats().P'),0);
 x.select(75);x.run("wkType('abs');saveWorkout()");assert.equal(x.run('gStats().plan.training.count'),1);assert.equal(x.run('gStats().plan.training.minutes'),75);
 x.run("openWorkout();wkType('cardio')");x.select(30);x.run('saveWorkout()');assert.equal(x.run('gStats().P'),0);assert.equal(x.run('gStats().plan.training.count'),2);assert.equal(x.run('gStats().plan.training.minutes'),105);
 assert.equal(x.stored.wk.length,2);assert.notEqual(x.stored.wk[0].id,x.stored.wk[1].id);assert.deepEqual(x.stored.wk.map(w=>w.m),[75,30]);assert.match(x.run('workCard()'),/Записать ещё тренировку/);assert.doesNotMatch(x.run('workCard()'),/вклад/);
 x.run('delWk(S.wk[1].id)');assert.equal(x.run('gStats().P'),0);assert.equal(x.run('gStats().plan.training.count'),1);assert.equal(x.run('gStats().plan.training.minutes'),75);
});
test('recent training respects the rolling window and cannot award measurement progress',()=>{
 const x=progressSetup();x.context.S.wk=[{id:'before',d:'2026-10-24',t:['str'],m:45},{id:'later',d:'2026-11-08',t:['str'],m:45}];assert.equal(x.run('gStats().plan.training.count'),0);
 for(let i=0;i<8;i++)x.context.S.wk.push({id:'now'+i,d:'2026-11-07',t:['str'],m:45});
 assert.equal(x.run('gStats().plan.training.count'),8);assert.equal(x.run('gStats().plan.training.percent'),100);assert.equal(x.run('gStats().P'),0);
 x.context.S.meas.push({d:'2026-11-07',waist:89});assert.equal(x.run('gStats().P'),100);
});
test('today food waits until 21:00 while workouts immediately update the plan',()=>{
 const x=progressSetup();x.context.S.log['2026-11-07']=[{k:2000,p:100,f:60}];x.context.S.water['2026-11-07']=1500;
 x.select(45);x.run('saveWorkout();openWorkout()');x.select(30);x.run('saveWorkout()');assert.equal(x.run('gStats().plan.nutrition.filled'),0);assert.equal(x.run('gStats().P'),0);
 x.context.Date=class extends FixedDate{getHours(){return 21}};assert.equal(x.run('gStats().plan.nutrition.filled'),1);assert.equal(x.run('gStats().plan.training.count'),2);assert.equal(x.run('gStats().P'),0);
});
test('two workouts requested through the assistant remain separate and both count toward the goal',()=>{
 const x=progressSetup(),begin=html.indexOf('let UNDO=null;'),finish=html.indexOf('\nasync function ask',begin);assert.ok(begin>=0&&finish>begin);
 x.context.cur=()=> '2026-11-07';x.context.R=Math.round;
 vm.runInContext(html.slice(begin,finish),x.context);
 x.run("applyActions([{type:'add_workout',kinds:['strength','abs'],minutes:75},{type:'add_workout',kinds:['cardio'],minutes:300}])");
 assert.equal(x.context.S.wk.length,2);assert.deepEqual(x.stored.wk.map(w=>w.m),[75,300]);assert.equal(x.run('gStats().plan.training.count'),2);assert.equal(x.run('gStats().plan.training.minutes'),375);assert.equal(x.run('gStats().P'),0);
});
test('full plan adherence does not imply achieving a measurement goal',()=>{
 const x=progressSetup();x.context.S.goal.startDate='2026-10-01';
 for(let i=1;i<=31;i++){const date='2026-10-'+String(i).padStart(2,'0');x.context.S.log[date]=[{k:2000,p:100,f:60}];x.context.S.water[date]=1500}
 assert.equal(x.run('gStats().P'),0);assert.equal(x.run('gStats().plan.percent'),50);
 for(let i=0;i<10;i++)x.context.S.wk.push({id:'session'+i,d:'2026-11-07',t:['str'],m:45});
 assert.equal(x.run('gStats().P'),0);assert.equal(x.run('gStats().plan.percent'),100);
});
