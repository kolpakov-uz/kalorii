import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const create=()=>{const context=vm.createContext({Date,Math});vm.runInContext(fs.readFileSync(new URL('../food-tasks.js',import.meta.url),'utf8'),context);return vm.runInContext('FoodTasks',context)};
const clone=value=>JSON.parse(JSON.stringify(value));
const gate=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};

test('new food descriptions and new photos start separate threads while explicit corrections retain their target',()=>{
 const api=create(),history=[{r:'me',t:'Вафли 50 г',img:'fixture-photo'},{r:'ai',t:'Готово',ids:['waffle']}];
 api.prepare(history);const original=history[0].thread;
 for(const text of ['Банан 100 г','Одна лепёшка 300 г и сюзьма 250 г','Запиши рис 200 г','Рис вместо макарон 200 г']){
  const selected=api.select(history,text,false);assert.notEqual(selected.thread,original);assert.equal(selected.thread,selected.task);
 }
 for(const text of ['50 г','попробуй ещё раз','пересчитай по фото','исправь вес на 100 г']){
  const selected=api.select(history,text,false);assert.equal(selected.thread,original);assert.notEqual(selected.task,history[0].task);
 }
 assert.notEqual(api.select(history,'50 г',true,original).thread,original);
 assert.equal(api.select(history,'На самом деле это вафли с начинкой',false,original).thread,original);
 assert.notEqual(api.select(history,'Банан',false,'missing-thread').thread,'missing-thread');
});

test('legacy history receives stable task links without losing photos or merging unrelated messages',()=>{
 const api=create(),history=[{r:'me',t:'Вафли',img:'fixture-photo'},{r:'ai',lbl:'request-abc-def',t:'Сбой'},{r:'me',t:'попробуй ещё раз'},{r:'ai',ids:['waffle']},{r:'me',t:'Рис 200 г'},{r:'ai',ids:['rice']}];
 api.prepare(history);const first=clone(history);api.prepare(history);
 assert.deepEqual(clone(history),first);assert.equal(history[0].img,'fixture-photo');
 assert.equal(history[0].task,'request-abc-def');assert.equal(history[1].task,history[0].task);
 assert.equal(history[2].thread,history[0].thread);assert.notEqual(history[4].thread,history[0].thread);
 assert.equal(history[3].task,history[2].task);assert.equal(history[5].task,history[4].task);
});

test('two independent jobs run together, queued corrections wait for their thread and failures release capacity',async()=>{
 const api=create(),queue=api.queue(2),a=gate(),b=gate(),started=[];
 const first=queue.run('a','thread-a',async()=>{started.push('a');await a.promise;return 'a'});
 const correction=queue.run('a-edit','thread-a',async()=>{started.push('a-edit');return 'edit'});
 const second=queue.run('b','thread-b',async()=>{started.push('b');await b.promise;throw Error('fixture failure')});
 const failed=assert.rejects(second,/fixture failure/);
 const third=queue.run('c','thread-c',async()=>{started.push('c');return 'c'});
 await flush();assert.deepEqual(started,['a','b']);
 b.resolve();await failed;await third;assert.deepEqual(started,['a','b','c']);
 a.resolve();assert.equal(await first,'a');assert.equal(await correction,'edit');assert.deepEqual(started,['a','b','c','a-edit']);
});

test('double activation shares a running task and a later deliberate retry starts a new attempt',async()=>{
 const queue=create().queue(),pending=gate();let count=0;
 const run=()=>queue.run('same','thread',async()=>{count++;await pending.promise;return count});
 const first=run(),duplicate=run();assert.equal(first,duplicate);await flush();assert.equal(count,1);
 pending.resolve();await first;assert.equal(await run(),2);
});
