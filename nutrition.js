// Shared identity and per-100-g cache. No network or AI is needed on a cache hit.
globalThis.Nutrition = (() => {
 const week=7*864e5, fields=['k','p','f','c'];
 const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/ё/g,'е').replace(/(\d),(?=\d)/g,'$1.').replace(/[^\p{L}\p{N}%.]+/gu,' ').replace(/\.(?=\D|$)/g,' ').replace(/(\d)\s*%/g,'$1%').replace(/\s+/g,' ').trim();
 const endings='(?:ый|ая|ое|ые|ого|ой|ую|ым|ых|ыми|ом|ою)';
 const methods={raw:new RegExp('^(?:сыр|сух)'+endings+'$'),boiled:new RegExp('^(?:варен|варенн|отварн|отваренн)'+endings+'$'),fried:new RegExp('^(?:жарен|жаренн|обжаренн)'+endings+'$'),baked:new RegExp('^(?:запеченн'+endings+'|запечен|гриль)$'),braised:new RegExp('^(?:тушен|тушенн)'+endings+'$')};
 const words=s=>norm(s).split(' ').filter(Boolean),has=(s,re)=>words(s).some(w=>re.test(w));
 // A portion percentage is not a product's fat percentage.
 function withoutPortion(s){return norm(s).replace(/(?:^|\s)(?:съел[аи]?|ела|ел|только)\s+(?:около\s+)?\d+(?:\.\d+)?%\s*(?:от\s+)?/g,' ').replace(/(?:^|\s)\d+(?:\.\d+)?%\s+от(?=\s|$)/g,' ').trim()}
 function preparation(s){
  const tokens=words(s),found=[],excluded=[];
  for(let i=0;i<tokens.length;i++)for(const [method,re] of Object.entries(methods)){
   const word=tokens[i],negative=re.test(word)&&tokens[i-1]==='не'||word.startsWith('не')&&re.test(word.slice(2));
   if(word==='сыром'&&['с','со'].includes(tokens[i-1]))continue;
   if(negative)excluded.push(method);else if(re.test(word))found.push(method);
  }
  const text=norm(s);
  if(/(?:^|\s)на пару(?=\s|$)/.test(text))found.push('steamed');
  if(/(?:^|\s)(?:на гриле|в духовке|из духовки)(?=\s|$)/.test(text))found.push('baked');
  if(/(?:^|\s)на сковороде(?=\s|$)/.test(text))found.push('fried');
  if(/(?:^|\s)до приготовления(?=\s|$)/.test(text))found.push('raw');
  if(!found.length&&(/(?:^|\s)после приготовления(?=\s|$)/.test(text)||has(text,/^готов(?:ый|ая|ое|ые|ого|ой|ую|ом)$/)))found.push('cooked');
  if(!found.length&&!excluded.length&&has(text,/^(?:каша|каши|каше|кашу|кашей|овсяноблин[а-я]*|суп[а-я]*)$/))found.push('cooked');
  return {method:found[0]||'',excluded:[...new Set(excluded)]};
 }
 const ready=s=>has(s,/^(?:йогурт[а-я]*|творог[а-я]*|сыр(?:а|у|ом|е|ы|ов)?|сырник[а-я]*|салат[а-я]*|хлеб[а-я]*|печень[а-я]*|пудинг[а-я]*|кисел[а-я]*|мед(?:а|ом|у|е)?|мук(?:а|и|е|у|ой)|овсяноблин[а-я]*|блин[а-я]*|суп[а-я]*|котлет[а-я]*|рулет[а-я]*|каша|каши|каше|кашу|кашей)$/);
 function family(s){
  if(ready(s))return '';
  if(has(s,/^(?:курин[а-я]+|куриц[а-я]*)$/)&&has(s,/^(?:грудк[а-я]*|филе)$/))return 'chicken';
  if(has(s,/^рис(?:а|у|ом|е)?$/))return 'rice';
  if(has(s,/^(?:гречк[а-я]*|гречих[а-я]*)$/)||has(s,/^гречнев[а-я]+$/)&&has(s,/^круп[а-я]*$/))return 'buckwheat';
  if(has(s,/^овсянк[а-я]*$/)||has(s,/^овсян[а-я]+$/)&&has(s,/^хлопь[а-я]+$/))return 'oats';
  return '';
 }
 function kind(s){
  const head=norm(s).split(/\s(?:с|со|на)\s/)[0];
  if(has(head,/^йогурт(?:а|у|ом|е|ы|ов|ам|ами|ах)?$/))return 'yogurt';if(has(head,/^творог(?:а|у|ом|е|и|ов)?$/))return 'tvorog';
  if(has(head,/^сыр(?:а|у|ом|е|ы|ов)?$/))return 'cheese';if(has(head,/^кефир(?:а|у|ом|е|ы|ов)?$/))return 'kefir';
  if(has(head,/^молок(?:о|а|у|ом|е)$/))return 'milk';if(has(head,/^сметан(?:а|ы|е|у|ой|ою)$/))return 'sourcream';
  if(has(s,/^варень(?:е|я|ю|ем|и)$/))return 'jam';if(has(s,/^вареник(?:и|а|у|ом|е|ов|ам|ами|ах)?$/))return 'dumplings';
  return family(s);
 }
 function brand(s){
  s=withoutPortion(s).replace(/\d+(?:\.\d+)?\s*(?:кг|грамм[а-я]*|гр|г|g)(?=\s|$)/g,' ');
  const explicit=s.match(/(?:^|\s)(?:бренд|марка|марки|компании|производитель)\s+(.+)$/)?.[1];
  if(explicit)return explicit.replace(/\d+(?:\.\d+)?%/g,'').trim();
  if(!['yogurt','tvorog','cheese','kefir','milk','sourcream'].includes(kind(s)))return '';
  // For dairy, retain the manufacturer while ignoring ordinary product/flavour
  // descriptors. Unknown qualifiers stay distinct rather than sharing a cache.
  return s.replace(/\d+(?:\.\d+)?%/g,' ').replace(/(?:^|\s)(?:с|со|на)\s+.*$/,' ')
   .split(' ').filter(w=>w&&!/^(?:йогурт[а-я]*|творог[а-я]*|сыр(?:а|у|ом|е|ы|ов)?|кефир[а-я]*|молок[а-я]*|сметан[а-я]*|греческ[а-я]*|натуральн[а-я]*|обезжиренн[а-я]*|питьев[а-я]*|густ[а-я]*|мягк[а-я]*|тверд[а-я]*|жирност[а-я]*|низкожирн[а-я]*|пастеризованн[а-я]*|ультрапастеризованн[а-я]*|клубничн[а-я]*|ванильн[а-я]*|персиков[а-я]*|вишнев[а-я]*|ягодн[а-я]*|фруктов[а-я]*|без|сахара|добавок|от|компании|бренд|марка)$/.test(w)&&!Object.values(methods).some(re=>re.test(w))).join(' ');
 }
 function identity(s){
  s=withoutPortion(s);const fat=s.match(/\d+(?:\.\d+)?%/g)?.join('|')||'',p=preparation(s);
  return {fat,prep:p.method,excludedPrep:p.excluded,family:family(s),kind:kind(s),brand:brand(s)};
 }
 function key(s){const result=[],tokens=words(s);for(const [i,word] of tokens.entries()){if(word==='вес'&&result.at(-1)==='raw')continue;result.push(word==='сыром'&&['с','со'].includes(tokens[i-1])?word:Object.entries(methods).find(([,re])=>re.test(word))?.[0]||(/^курин[а-я]+$/.test(word)?'курин':/^грудк[а-я]*$/.test(word)?'грудка':word))}return result.sort().join(' ')}
 function compatible(a,b){
  const x=identity(a),y=identity(b),cooked=p=>['boiled','fried','baked','braised','steamed','cooked'].includes(p);
  const preparationMatches=x.prep===y.prep||x.prep==='cooked'&&cooked(y.prep)||y.prep==='cooked'&&cooked(x.prep)||!x.prep&&x.excludedPrep.length&&!x.excludedPrep.includes(y.prep)||!y.prep&&y.excludedPrep.length&&!y.excludedPrep.includes(x.prep);
  return x.fat===y.fat&&preparationMatches&&!x.excludedPrep.includes(y.prep)&&!y.excludedPrep.includes(x.prep)&&(!x.kind||!y.kind||x.kind===y.kind)&&key(x.brand)===key(y.brand);
 }
 function valid(row){return row&&typeof row.n==='string'&&row.n.length>0&&row.n.length<=160&&fields.every(k=>typeof row[k]==='number'&&Number.isFinite(row[k])&&row[k]>=0&&row[k]<=(k==='k'?950:100))}
 // A loose check for gross unit/column errors, not a replacement for label kcal.
 // Alcohol has energy outside P/F/C; fibre and polyols may reduce energy.
 function plausible(row){
  if(!valid(row))return false;
  const expected=4*row.p+9*row.f+4*row.c;
  return row.p+row.f+row.c<=110&&(expected<40||row.k<=expected*2+40||/(?:алкогол|водк|вино|вина|вином|пиво|пива|коньяк|виски|ликер|ром\b|vodka|wine|beer|whisk|liqueur)/i.test(row.n));
 }
 function normalizeAction(action){
  if(action.label==null)return action;
  const source=action.label,label=source&&Object.hasOwn(action,'printedKcal')&&!Object.hasOwn(source,'printedKcal')?{...source,printedKcal:action.printedKcal}:source,amount=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(+v)&&+v>=0;
  if(!label||typeof label!=='object'||!['kcal','kJ'].includes(label.energyUnit)||!['basisGrams','energy'].every(k=>amount(label[k]))||['printedKcal','protein','fat','carbs'].some(k=>Object.hasOwn(label,k)&&!amount(label[k]))||+label.basisGrams<=0||+label.basisGrams>3000)throw Error('invalid_label');
  const factor=100/+label.basisGrams;
  const normalized={...action,label,kcal100:(Object.hasOwn(label,'printedKcal')?+label.printedKcal:+label.energy/(label.energyUnit==='kJ'?4.184:1))*factor};
  for(const [read,field] of [['protein','protein100'],['fat','fat100'],['carbs','carbs100']])if(Object.hasOwn(label,read))normalized[field]=+label[read]*factor;
  return normalized;
 }
 function saneAction(action,base={}){
  const row={n:action.name||action.n||base.n||'Продукт'},grams=+(action.grams||action.g||100);
  for(const [field,per100,total] of [['k','kcal100','kcal'],['p','protein100','protein'],['f','fat100','fat'],['c','carbs100','carbs']])row[field]=action[per100]!=null?+action[per100]:action.op==='add'&&action[total]!=null?+action[total]*100/grams:base[field];
  return !fields.every(k=>row[k]!=null)||plausible(row);
 }
 function store(state){const db=state.nutrition;if(!db||db.version!==1||!Array.isArray(db.rows))state.nutrition={version:1,rows:[],defaults:{}};state.nutrition.defaults=state.nutrition.defaults||{};return state.nutrition}
 function cleanName(text){return words(withoutPortion(text).replace(/\d+(?:\.\d+)?\s*(?:кг|грамм[а-я]*|гр|г|g)(?=\s|$)/g,' ')).filter(w=>!['я','съел','съела','ела','ел','добавь','запиши','сегодня','примерно','около'].includes(w)).join(' ')}
 function parse(text){
  if(typeof text!=='string'||text.length>1000)return null;
  // Only a whole, single product with an explicit gram weight is safe locally.
  const matches=[...norm(text).matchAll(/(\d+(?:\.\d+)?)\s*(кг|грамм[а-я]*|гр|г|g)(?=\s|$)/g)];
  if(matches.length!==1||/(?:\sи\s|\sс\s|\sсо\s|\sплюс\s|\+|;|исправ|измени|удал|убери|пересчитай|половин|треть|четверть|порци|\b\d+\s*шт)/i.test(text))return null;
  const g=+matches[0][1]*(matches[0][2]==='кг'?1000:1),n=cleanName(text);
  if(!(g>0&&g<=3000)||!n||/\d/.test(n.replace(/\d+(?:\.\d+)?\s*%/g,'')))return null;
  return {n,g,key:key(n),...identity(n)};
 }
 function prepare(state,text){const q=parse(text);if(!q||!q.family||q.prep||q.excludedPrep.length)return {text};const method=store(state).defaults[q.family];return labels[method]?{text:text+' '+labels[method],query:q}:{text,choice:q}}
 const labels={raw:'сырой вес',boiled:'варёное',fried:'жареное',baked:'запечённое',braised:'тушёное'};
 function choose(state,text,method){const q=parse(text);if(!q?.family||q.prep||q.excludedPrep.length||!labels[method])return text;store(state).defaults[q.family]=method;return text+' '+labels[method]}
 function lookup(state,text,now=Date.now()){
  const q=parse(text);if(!q||q.excludedPrep.length)return null;
  const manual=(state.foods||[]).filter(d=>d.custom&&!d.hidden&&compatible(q.n,d.n)&&[d.n,...d.aliases||[]].some(n=>key(n)===q.key));
  if(manual.length===1)return {...manual[0],g:q.g,origin:'manual'};
  const matches=store(state).rows.filter(row=>valid(row)&&(row.origin==='manual'||plausible(row))&&compatible(q.n,row.n)&&[row.n,...row.aliases||[]].some(n=>key(n)===q.key));
  const row=matches.find(r=>r.origin==='manual')||matches.sort((a,b)=>b.updatedAt-a.updatedAt)[0];
  // Estimates expire instead of becoming an indefinite AI answer cache.
  if(!row||row.origin==='estimate'&&now-row.checkedAt>week)return null;
  return {...row,g:q.g};
 }
 function remember(state,value,alias='',origin='estimate',now=Date.now()){
  if(!valid(value)||origin!=='manual'&&!plausible(value))return null;const db=store(state),id=key(value.n),existing=db.rows.find(r=>key(r.n)===id);
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
 function merge(state,rows){const db=store(state);for(const row of rows||[]){if(!valid(row)||!['usda','off','estimate','manual'].includes(row.origin)||!Number.isFinite(row.checkedAt)||!Number.isFinite(row.updatedAt))continue;const old=db.rows.find(r=>key(r.n)===key(row.n));if(old?.origin==='manual'&&row.origin!=='manual'||old&&old.updatedAt>row.updatedAt)continue;const saved=remember(state,row,'',row.origin,row.updatedAt);if(saved){saved.checkedAt=row.checkedAt;saved.aliases=[...new Set([row.n,...(row.aliases||[]).filter(a=>typeof a==='string'&&a.length<=160&&compatible(a,row.n))])].slice(0,30)}}}
 return {norm,key,identity,compatible,family,valid,plausible,normalizeAction,saneAction,store,parse,prepare,choose,lookup,remember,merge,labels,week};
})();
