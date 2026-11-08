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
 const buttons=Object.fromEntries(Object.entries({m:Array.from({length:12},(_,i)=>(i+1)*15),d:[0,1],t:['str','abs','cardio']}).map(([key,values])=>[key,values.map(value=>({dataset:{[key]:String(value)},attributes:{},setAttribute(k,v){this.attributes[k]=v},classList:{toggle(_name,on){this.on=on}}}))]));
 let stored,markup='',saved=0,closed=0;
 const context=vm.createContext({Date:FixedDate,S:initial||{wk:[],wkGoal:3},today:()=> '2026-11-07',fd:d=>d,document:{querySelectorAll:selector=>buttons[selector.match(/data-(\w+)/)[1]]},sheet:value=>{markup=value},save:()=>{stored=JSON.parse(JSON.stringify(context.S));saved++},closeSheet:()=>closed++,render(){},toast(){},anim(){},celebrate(){},setTimeout(){}});
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run('openWorkout()');
 const select=value=>{context.value=value;run('wkMin(value)')};
 return {run,select,buttons,context,get stored(){return stored},get markup(){return markup},get saved(){return saved},get closed(){return closed}};
}

test('chosen minutes are saved exactly, survive reload and remain readable by diary backup',()=>{
 const x=setup();x.run("wkType('abs');wkDay(1)");x.select(75);x.run('saveWorkout()');
 assert.equal(x.saved,1);assert.equal(x.closed,1);assert.equal(x.stored.wk[0].m,75);assert.equal(x.stored.wk[0].d,'2026-11-06');assert.deepEqual(x.stored.wk[0].t,['str','abs']);
 const reloaded=setup(x.stored);assert.match(reloaded.run('workCard()'),/75 мин/);
 vm.runInContext(fs.readFileSync(new URL('../diary-backup.js',import.meta.url),'utf8'),x.context);
 assert.equal(x.run('DiaryBackup.parse(DiaryBackup.stringify(S)).wk[0].m'),75);
});
test('duration selection updates the highlight and accessible state without changing workout types or day',()=>{
 const x=setup();x.run("wkType('cardio');wkDay(1);wkMin(60)");assert.equal(x.buttons.m.find(b=>b.dataset.m==='60').classList.on,true);
 x.select(150);assert.equal(x.buttons.m.filter(b=>b.classList.on).length,1);assert.equal(x.buttons.m.find(b=>b.dataset.m==='150').attributes['aria-pressed'],'true');assert.equal(x.buttons.m.find(b=>b.dataset.m==='60').attributes['aria-pressed'],'false');x.run('saveWorkout()');assert.deepEqual(x.stored.wk[0].t,['str','cardio']);assert.equal(x.stored.wk[0].d,'2026-11-06');assert.equal(x.stored.wk[0].m,150);
});
test('the picker offers every 15-minute step through three hours and saves either end correctly',()=>{
 const x=setup(),choices=[...x.markup.matchAll(/data-m="(\d+)"/g)].map(m=>Number(m[1]));assert.deepEqual(choices,Array.from({length:12},(_,i)=>(i+1)*15));assert.doesNotMatch(x.markup,/<input/);assert.match(x.markup,/data-m="180"[^>]*>3 ч<\/button>/);
 for(const minutes of choices){const y=setup();y.select(minutes);y.run('saveWorkout()');assert.equal(y.stored.wk[0].m,minutes)}
});
test('out-of-range selections cannot replace a valid choice and an invalid state cannot be saved',()=>{
 for(const value of [0,14,16,181,200,NaN,Infinity,null,'60']){const x=setup();x.select(90);x.select(value);x.run('saveWorkout()');assert.equal(x.stored.wk[0].m,90)}
 const x=setup();x.run('WM=200;saveWorkout()');assert.equal(x.saved,0);assert.equal(x.closed,0);
});

function progressSetup(){
 const x=setup({profile:{sex:'m',a:30,h:180,w:80,act:1.2,goal:'keep'},goal:{type:'abs',m:'waist',start:90,target:89,startDate:'2026-11-07'},wk:[],wkGoal:3,log:{},water:{},weights:[],meas:[]});
 const begin=html.indexOf('const GT='),finish=html.indexOf('\nfunction lastReasons',begin);
 assert.ok(begin>=0&&finish>begin);
 x.context.norm=()=>({k:2000,p:100,f:60});
 x.context.items=d=>x.context.S.log[d]||[];
 x.context.tot=d=>x.context.items(d).reduce((s,v)=>({k:s.k+v.k,p:s.p+v.p,f:s.f+v.f}),{k:0,p:0,f:0});
 vm.runInContext(html.slice(begin,finish),x.context);
 return x;
}
test('two separately saved workouts on the same day each increase goal progress immediately',()=>{
 const x=progressSetup();assert.equal(x.run('gStats().P'),0);
 x.select(75);x.run("wkType('abs');saveWorkout()");const first=x.run('gStats().P');assert.ok(first>0);assert.equal(x.run('gStats().workouts.count'),1);
 x.run("openWorkout();wkType('cardio')");x.select(30);x.run('saveWorkout()');const second=x.run('gStats().P');assert.ok(second>first);assert.equal(x.run('gStats().workouts.count'),2);
 assert.equal(x.stored.wk.length,2);assert.notEqual(x.stored.wk[0].id,x.stored.wk[1].id);assert.deepEqual(x.stored.wk.map(w=>w.m),[75,30]);assert.match(x.run('workCard()'),/За весь срок цели: 2 из 6 тренировок/);assert.match(x.run('workCard()'),/Записать ещё тренировку/);
 x.run('delWk(S.wk[1].id)');assert.equal(x.run('gStats().P'),first);assert.equal(x.run('gStats().workouts.count'),1);
});
test('training credit excludes other dates, supports historical views and caps at the goal plan',()=>{
 const x=progressSetup();x.context.S.wk=[{id:'before',d:'2026-11-06',t:['str'],m:45},{id:'later',d:'2026-11-08',t:['str'],m:45}];assert.equal(x.run('gStats().P'),0);
 for(let i=0;i<8;i++)x.context.S.wk.push({id:'now'+i,d:'2026-11-07',t:['str'],m:45});
 assert.equal(x.run('gStats().workouts.count'),8);assert.equal(x.run('gStats().workouts.planned'),6);assert.equal(x.run('gStats().P'),5);assert.equal(x.run("pAt(S.goal,'2026-11-06')"),0);
 x.context.S.meas.push({d:'2026-11-07',waist:89});assert.equal(x.run('gStats().P'),100);
});
test('today food waits until 21:00 while both workouts count before and after that time',()=>{
 const x=progressSetup();x.context.S.log['2026-11-07']=[{k:2000,p:100,f:60}];x.context.S.water['2026-11-07']=1500;
 x.select(45);x.run('saveWorkout();openWorkout()');x.select(30);x.run('saveWorkout()');const before=x.run('gStats().P');assert.equal(x.run('habitSum(today()).n'),0);
 x.context.Date=class extends FixedDate{getHours(){return 21}};const after=x.run('gStats().P');assert.ok(after>before);assert.equal(x.run('gStats().workouts.count'),2);assert.equal(x.run('habitSum(today()).n'),1);
});
test('two workouts requested through the assistant remain separate and both count toward the goal',()=>{
 const x=progressSetup(),begin=html.indexOf('let UNDO=null;'),finish=html.indexOf('\nasync function ask',begin);assert.ok(begin>=0&&finish>begin);
 x.context.cur=()=> '2026-11-07';x.context.R=Math.round;
 vm.runInContext(html.slice(begin,finish),x.context);
 x.run("applyActions([{type:'add_workout',kinds:['strength','abs'],minutes:75},{type:'add_workout',kinds:['cardio'],minutes:300}])");
 assert.equal(x.context.S.wk.length,2);assert.deepEqual(x.stored.wk.map(w=>w.m),[75,300]);assert.equal(x.run('gStats().workouts.count'),2);assert.ok(x.run('gStats().P')>0);
});
test('food and training credit each have their own cap and do not change the measurement requirement',()=>{
 const x=progressSetup();x.context.S.goal.startDate='2026-10-01';
 for(let i=1;i<=31;i++){const date='2026-10-'+String(i).padStart(2,'0');x.context.S.log[date]=[{k:2000,p:100,f:60}];x.context.S.water[date]=1500}
 assert.equal(x.run('gStats().P'),15);
 for(let i=0;i<10;i++)x.context.S.wk.push({id:'session'+i,d:'2026-11-07',t:['str'],m:45});
 assert.equal(x.run('gStats().P'),20);assert.equal(x.run('gStats().B'),0);
});
