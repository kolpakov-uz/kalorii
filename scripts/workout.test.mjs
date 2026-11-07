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
 const fields={'#wk-minutes':{value:'45',attributes:{},setAttribute(k,v){this.attributes[k]=v},focus(){this.focused=true}},'#wk-duration-error':{hidden:true},'#wk-save':{disabled:false}};
 const buttons=Object.fromEntries(Object.entries({m:[30,45,60,90],d:[0,1],t:['str','abs','cardio']}).map(([key,values])=>[key,values.map(value=>({dataset:{[key]:String(value)},classList:{toggle(_name,on){this.on=on}}}))]));
 let stored,markup='',saved=0,closed=0;
 const context=vm.createContext({Date:FixedDate,S:initial||{wk:[],wkGoal:3},today:()=> '2026-11-07',fd:d=>d,$:selector=>fields[selector],document:{querySelectorAll:selector=>buttons[selector.match(/data-(\w+)/)[1]]},sheet:value=>{markup=value;fields['#wk-minutes'].value='45'},save:()=>{stored=JSON.parse(JSON.stringify(context.S));saved++},closeSheet:()=>closed++,render(){},toast(){},anim(){},celebrate(){},setTimeout(){}});
 vm.runInContext(source,context);
 const run=code=>vm.runInContext(code,context);
 run('openWorkout()');
 const input=value=>{fields['#wk-minutes'].value=value;context.value=value;run('wkDuration(value)')};
 return {run,input,fields,buttons,context,get stored(){return stored},get markup(){return markup},get saved(){return saved},get closed(){return closed}};
}

test('custom minutes are saved exactly, survive reload and remain readable by diary backup',()=>{
 const x=setup();x.run("wkType('abs');wkDay(1)");x.input('75');x.run('saveWorkout()');
 assert.equal(x.saved,1);assert.equal(x.closed,1);assert.equal(x.stored.wk[0].m,75);assert.equal(x.stored.wk[0].d,'2026-11-06');assert.deepEqual(x.stored.wk[0].t,['str','abs']);
 const reloaded=setup(x.stored);assert.match(reloaded.run('workCard()'),/75 мин/);
 vm.runInContext(fs.readFileSync(new URL('../diary-backup.js',import.meta.url),'utf8'),x.context);
 assert.equal(x.run('DiaryBackup.parse(DiaryBackup.stringify(S)).wk[0].m'),75);
});
test('quick duration buttons and manual entry stay in sync without changing workout types or day',()=>{
 const x=setup();x.run("wkType('cardio');wkDay(1);wkMin(60)");assert.equal(Number(x.fields['#wk-minutes'].value),60);assert.equal(x.buttons.m.find(b=>b.dataset.m==='60').classList.on,true);
 x.input('50');assert.ok(x.buttons.m.every(b=>!b.classList.on));assert.equal(x.fields['#wk-save'].disabled,false);x.run('saveWorkout()');assert.deepEqual(x.stored.wk[0].t,['str','cardio']);assert.equal(x.stored.wk[0].d,'2026-11-06');assert.equal(x.stored.wk[0].m,50);
});
test('empty, fractional and invalid durations cannot save a stale duration or create a workout',()=>{
 for(const value of ['', ' ', '0', '-5', '2.5', '1441', 'Infinity', 'abc']){
  const x=setup();x.input(value);assert.equal(x.fields['#wk-save'].disabled,true,value);assert.equal(x.fields['#wk-duration-error'].hidden,false,value);assert.equal(x.fields['#wk-minutes'].attributes['aria-invalid'],'true',value);
  x.run('saveWorkout()');assert.equal(x.context.S.wk.length,0,value);assert.equal(x.saved,0,value);assert.equal(x.closed,0,value);
  x.run('wkMin(30)');assert.equal(x.fields['#wk-save'].disabled,false);assert.equal(x.fields['#wk-duration-error'].hidden,true);x.run('saveWorkout()');assert.equal(x.stored.wk[0].m,30);
 }
});
test('save validates the visible field again, including one-minute and full-day durations',()=>{
 for(const value of ['1','1440']){const x=setup();x.fields['#wk-minutes'].value=value;x.run('saveWorkout()');assert.equal(x.stored.wk[0].m,Number(value))}
 const x=setup();x.fields['#wk-minutes'].value='';x.run('saveWorkout()');assert.equal(x.saved,0);
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
 x.input('75');x.run("wkType('abs');saveWorkout()");const first=x.run('gStats().P');assert.ok(first>0);assert.equal(x.run('gStats().workouts.count'),1);
 x.run("openWorkout();wkType('cardio')");x.input('25');x.run('saveWorkout()');const second=x.run('gStats().P');assert.ok(second>first);assert.equal(x.run('gStats().workouts.count'),2);
 assert.equal(x.stored.wk.length,2);assert.notEqual(x.stored.wk[0].id,x.stored.wk[1].id);assert.deepEqual(x.stored.wk.map(w=>w.m),[75,25]);assert.match(x.run('workCard()'),/За весь срок цели: 2 из 6 тренировок/);assert.match(x.run('workCard()'),/Записать ещё тренировку/);
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
 x.input('40');x.run('saveWorkout();openWorkout()');x.input('20');x.run('saveWorkout()');const before=x.run('gStats().P');assert.equal(x.run('habitSum(today()).n'),0);
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
