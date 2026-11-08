// Read a versioned backup into a fresh, validated state. Never merge arbitrary keys.
const DiaryBackup=(()=>{
 const fail=()=>{throw Error('backup')},obj=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:fail();
 const text=v=>typeof v==='string'&&v.length<=100000?v:fail();
 const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e7?v:fail();
 const bool=v=>typeof v==='boolean'?v:fail();
 const choice=(...values)=>v=>values.includes(v)?v:fail();
 const pattern=re=>v=>re.test(text(v))?v:fail();
 const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(text(v))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v?v:fail();
 const id=pattern(/^[a-zA-Z0-9_.-]{1,100}$/),time=pattern(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
 const array=read=>v=>Array.isArray(v)&&v.length<=50000?v.map(read):fail();
 const nullable=read=>v=>v===null?null:read(v);
 const shape=spec=>v=>{obj(v);const out={};for(const [key,read] of Object.entries(spec))if(v[key]!==undefined)out[key]=read(v[key]);return out};
 const required=(read,keys)=>v=>{const out=read(v);for(const k of keys)if(out[k]===undefined)fail();return out};
 const map=(read,keyRead=text)=>v=>Object.fromEntries(Object.entries(obj(v)).map(([key,value])=>[keyRead(key),read(value)]));
 const macros={k:num,p:num,f:num,c:num},food=required(shape({id,n:text,g:num,m:choice('b','l','d','s'),...macros}),['id','n','g','m','k','p','f','c']);
 const profile=required(shape({sex:choice('m','f'),a:num,h:num,w:num,act:num,goal:choice('lose','gain','abs','keep')}),['sex','a','h','w','act','goal']);
 const goal=required(shape({type:choice('abs','lose','arm','fat'),m:choice('waist','weight','arm','bf'),start:num,target:num,startDate:date}),['type','m','start','target','startDate']);
 const cache=required(shape({n:text,g:num,...macros}),['n','g','k','p','f','c']);
 const history=shape({r:choice('me','ai'),t:text,ids:array(id),lbl:text,img:pattern(/^(?:|data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+)$/)});
 function parse(raw){
  if(typeof raw!=='string'||raw.length>20*1024*1024)fail();
  const envelope=JSON.parse(raw,(key,value)=>['__proto__','constructor','prototype'].includes(key)?fail():value);
  if(envelope?.format!=='kalorii-backup'||envelope.version!==1)fail();
  const input=obj(envelope.data),out={profile:null,log:{},water:{},weights:[],custom:null,foods:[],goal:null,meas:[],coachMode:'strict',wk:[],wkGoal:3,wkPlanMinutes:45,dc:{},rem:{on:{},t:{},fired:{}},chat:[],hist:{}};
  const readers={profile:nullable(profile),log:map(array(food),date),water:map(num,date),weights:array(required(shape({d:date,w:num}),['d','w'])),custom:nullable(required(shape({p:num,f:num,c:num}),['p','f','c'])),foods:array(required(shape({n:text,d:text,...macros}),['n','k','p','f','c'])),goal:nullable(goal),meas:array(required(shape({d:date,waist:num,neck:num,hip:num,arm:num,weight:num,bf:num}),['d'])),coachMode:choice('soft','strict','hard'),wk:array(required(shape({id,d:date,t:array(choice('str','abs','cardio')),m:num}),['id','d','t','m'])),wkGoal:num,wkPlanMinutes:choice(15,30,45,60,75,90,105,120,135,150,165,180),dc:map(cache),chat:array(required(shape({role:choice('user','assistant'),content:text}),['role','content'])),hist:map(array(history),pattern(/^\d{4}-\d{2}-\d{2}\|[blds]$/)),ownKb:bool};
  for(const [key,read] of Object.entries(readers))if(input[key]!==undefined)out[key]=read(input[key]);
  if(input.rem){const rem=obj(input.rem);out.rem.on=map(bool,choice('b','l','d','s','e','w'))(rem.on||{});out.rem.t=map(time,choice('b','l','d','s','e'))(rem.t||{});if(rem.wc)out.rem.wc=required(shape({from:time,to:time,ev:choice(1,2,3)}),['from','to','ev'])(rem.wc)}
  if(out.profile&&(!(out.profile.a>=14&&out.profile.a<=100&&out.profile.h>=120&&out.profile.h<=230&&out.profile.w>=35&&out.profile.w<=250)||![1.2,1.375,1.55,1.725].includes(out.profile.act)))fail();
  if(out.goal&&(out.goal.m!=={abs:'waist',lose:'weight',arm:'arm',fat:'bf'}[out.goal.type]||out.goal.start===out.goal.target))fail();
  for(const entries of Object.values(out.hist))for(const entry of entries){if(!entry.r)fail();if(entry.r==='ai'&&!entry.ids)entry.ids=[]}
  if(out.wkGoal<1||out.wkGoal>7)fail();
  return out;
 }
 function stringify(state){return JSON.stringify({format:'kalorii-backup',version:1,exportedAt:new Date().toISOString(),data:state})}
 function store(storage,key,state,previousState){const encoded=JSON.stringify(state),previous=storage.getItem(key);if(previous!==null||previousState!==undefined)storage.setItem(key+'-before-import',previous??JSON.stringify(previousState));storage.setItem(key,encoded)}
 return {parse,stringify,store};
})();
