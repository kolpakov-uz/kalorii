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
