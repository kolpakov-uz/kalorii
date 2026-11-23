// Shared identity and per-100-g cache. No network or AI is needed on a cache hit.
globalThis.Nutrition = (() => {
 const week=7*864e5, fields=['k','p','f','c'];
 const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/(\d),(?=\d)/g,'$1.').replace(/[^\p{L}\p{N}%.]+/gu,' ').replace(/\.(?=\D|$)/g,' ').replace(/\s+/g,' ').trim();
 const prep=s=>/сыр|сух(?:ой|ая|ие|ом)/.test(s)?'raw':/варен|отвар|варен|варё|варк/.test(s)?'boiled':/жарен|жарен|жарё|сковород/.test(s)?'fried':/запеч|духов|грил/.test(s)?'baked':/тушен|тушён/.test(s)?'braised':'';
 function family(s){s=norm(s);return /курин|куриц/.test(s)&&/груд|филе/.test(s)?'chicken':/^(?:рис|рис\s)/.test(s)?'rice':/греч/.test(s)?'buckwheat':/овсян|овсяные хлоп/.test(s)?'oats':''}
 function identity(s){
  s=norm(s);const fat=s.match(/\d+(?:\.\d+)?\s*%/g)?.map(x=>x.replace(/\s/g,'')).join('|')||'';
  let brand=(s.match(/(?:бренд|марка|компании|производитель)\s+(.+)$/)?.[1]||'').trim();
  if(!brand&&/творог/.test(s))brand=s.replace(/творог[а-я]*|\d+(?:\.\d+)?\s*%|обезжиренн[а-я]*|жирност[а-я]*|(?:^|\s)(?:от|компании|бренд|марка)(?=\s|$)/g,' ').replace(/\s+/g,' ').trim();
  return {fat,prep:prep(s),family:family(s),brand};
 }
 function key(s){return norm(s).replace(/сыр(?:ой|ая|ое|ые|ую|ом)(?:\s+вес)?/g,'raw').replace(/сух(?:ой|ая|ое|ие|ую|ом)/g,'raw').replace(/варен[а-я]*/g,'boiled').replace(/жарен[а-я]*/g,'fried').replace(/запечен[а-я]*/g,'baked').replace(/тушен[а-я]*/g,'braised').replace(/курин[а-я]*/g,'курин').replace(/грудк[а-я]*/g,'грудка').split(' ').sort().join(' ')}
 function compatible(a,b){const x=identity(a),y=identity(b);return x.fat===y.fat&&x.prep===y.prep&&(!x.brand&&!y.brand||key(x.brand)===key(y.brand))}
 function valid(row){return row&&typeof row.n==='string'&&row.n.length>0&&row.n.length<=160&&fields.every(k=>typeof row[k]==='number'&&Number.isFinite(row[k])&&row[k]>=0&&row[k]<=(k==='k'?950:100))}
 function store(state){const db=state.nutrition;if(!db||db.version!==1||!Array.isArray(db.rows))state.nutrition={version:1,rows:[],defaults:{}};state.nutrition.defaults=state.nutrition.defaults||{};return state.nutrition}
 function cleanName(text){return norm(text).replace(/(?:^|\s)(?:я|съел|съела|ела|ел|добавь|запиши|сегодня|примерно|около)(?=\s|$)/g,' ').replace(/\d+(?:\.\d+)?\s*(?:кг|грамм[а-я]*|гр|г|g)(?=\s|$)/g,' ').replace(/\s+/g,' ').trim()}
 function parse(text){
  if(typeof text!=='string'||text.length>1000)return null;
  // Only a whole, single product with an explicit gram weight is safe locally.
  const matches=[...norm(text).matchAll(/(\d+(?:\.\d+)?)\s*(кг|грамм[а-я]*|гр|г|g)(?=\s|$)/g)];
  if(matches.length!==1||/(?:\sи\s|\sс\s|\sсо\s|\sплюс\s|\+|;|исправ|измени|удал|убери|пересчитай|половин|треть|четверть|порци|\b\d+\s*шт)/i.test(text))return null;
  const g=+matches[0][1]*(matches[0][2]==='кг'?1000:1),n=cleanName(text);
  if(!(g>0&&g<=3000)||!n||/\d/.test(n.replace(/\d+(?:\.\d+)?\s*%/g,'')))return null;
  return {n,g,key:key(n),...identity(n)};
 }
 function prepare(state,text){const q=parse(text);if(!q||!q.family||q.prep)return {text};const method=store(state).defaults[q.family];return method?{text:text+' '+labels[method],query:q}:{text,choice:q}}
 const labels={raw:'сырой вес',boiled:'варёное',fried:'жареное',baked:'запечённое',braised:'тушёное'};
 function choose(state,text,method){const q=parse(text);if(!q||!labels[method])return text;store(state).defaults[q.family]=method;return text+' '+labels[method]}
 function lookup(state,text,now=Date.now()){
  const q=parse(text);if(!q)return null;
  const manual=(state.foods||[]).filter(d=>d.custom&&!d.hidden&&compatible(q.n,d.n)&&[d.n,...d.aliases||[]].some(n=>key(n)===q.key));
  if(manual.length===1)return {...manual[0],g:q.g,origin:'manual'};
  const matches=store(state).rows.filter(row=>valid(row)&&compatible(q.n,row.n)&&[row.n,...row.aliases||[]].some(n=>key(n)===q.key));
  const row=matches.find(r=>r.origin==='manual')||matches.sort((a,b)=>b.updatedAt-a.updatedAt)[0];
  // Estimates expire instead of becoming an indefinite AI answer cache.
  if(!row||row.origin==='estimate'&&now-row.checkedAt>week)return null;
  return {...row,g:q.g};
 }
 function remember(state,value,alias='',origin='estimate',now=Date.now()){
  if(!valid(value))return null;const db=store(state),id=key(value.n),existing=db.rows.find(r=>r.key===id);
  if(existing?.origin==='manual'&&origin!=='manual')return existing;
  if(existing&&['usda','off'].includes(existing.origin)&&origin==='estimate')return existing;
  const names=[value.n,...(existing?.aliases||[])];const q=parse(alias);
  if(q&&compatible(q.n,value.n))names.push(q.n);
  const row={key:id,n:value.n,...Object.fromEntries(fields.map(k=>[k,value[k]])),aliases:[...new Set(names)].slice(0,30),origin,checkedAt:now,updatedAt:now};
  if(value.source&&typeof value.source==='string')row.source=value.source.slice(0,300);
  if(value.ref&&typeof value.ref==='string')row.ref=value.ref.slice(0,100);
  if(existing)Object.assign(existing,row);else db.rows.unshift(row);
  if(db.rows.length>1000)db.rows.length=1000;return row;
 }
 function merge(state,rows){const db=store(state);for(const row of rows||[]){if(!valid(row)||!['usda','off','estimate','manual'].includes(row.origin)||!Number.isFinite(row.checkedAt)||!Number.isFinite(row.updatedAt))continue;const old=db.rows.find(r=>r.key===key(row.n));if(old?.origin==='manual'&&row.origin!=='manual'||old&&old.updatedAt>row.updatedAt)continue;const saved=remember(state,row,'',row.origin,row.updatedAt);if(saved){saved.checkedAt=row.checkedAt;saved.aliases=[...new Set([row.n,...(row.aliases||[]).filter(a=>typeof a==='string'&&a.length<=160&&compatible(a,row.n))])].slice(0,30)}}}
 return {norm,key,identity,compatible,family,valid,store,parse,prepare,choose,lookup,remember,merge,labels,week};
})();
