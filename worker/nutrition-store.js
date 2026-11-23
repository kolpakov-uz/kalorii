import '../nutrition.js';
import '../nutrition-seed.js';
import {foundation} from './nutrition-sources.js';
const prefix='nutrition:v1:user:';
const fingerprint=s=>[...new Set(Nutrition.key(s).split(' '))].sort().join(' ');
export async function searchProduct(row){
 const url=new URL('https://world.openfoodfacts.org/cgi/search.pl');
 for(const [k,v] of Object.entries({search_terms:row.n,search_simple:'1',action:'process',json:'1',page_size:'5',fields:'code,product_name,brands,nutriments'}))url.searchParams.set(k,v);
 const response=await fetch(url,{headers:{'User-Agent':'Kalorii/1.0 (https://kolpakov-uz.github.io/kalorii/)'},signal:AbortSignal.timeout(5000)});
 if(!response.ok)return null;const data=await response.json();
 const matches=(data.products||[]).filter(product=>{
  if(!/^\d{8,14}$/.test(product.code||'')||!product.product_name)return false;
  const names=product.brands?product.brands.split(',').map(brand=>product.product_name+' '+brand.trim()):[product.product_name];
  return names.some(name=>fingerprint(name)===fingerprint(row.n)&&Nutrition.compatible(name,row.n));
 });
 if(matches.length!==1)return null;const product=matches[0],n=product.nutriments||{};
 const next={...row,k:n['energy-kcal_100g'],p:n.proteins_100g,f:n.fat_100g,c:n.carbohydrates_100g,origin:'off',source:'https://world.openfoodfacts.org/product/'+product.code,ref:'off:'+product.code,checkedAt:Date.now(),updatedAt:Date.now()};
 return Nutrition.valid(next)?next:null;
}
async function read(env,key,fallback){try{const value=JSON.parse(await env.SUBS.get(key));return value||fallback}catch{return fallback}}
export async function nutritionSync(env,user,input,clear=false){
 if(!env.SUBS)throw Error('nutrition_storage');
 if(clear===true){await env.SUBS.delete(prefix+user);return await read(env,'nutrition:v1:reference',NutritionSeed)}
 if(input!==undefined&&(!Array.isArray(input)||input.length>1000||JSON.stringify(input).length>800000))throw Object.assign(Error('bad_nutrition'),{status:400});
 const db=await read(env,prefix+user,{version:1,rows:[]});const state={nutrition:db};
 const safe=(input||[]).filter(Nutrition.valid).map(row=>({...row,origin:row.origin==='manual'?'manual':'estimate',source:undefined,ref:undefined,checkedAt:Math.min(Date.now(),+row.checkedAt||0),updatedAt:Math.min(Date.now(),+row.updatedAt||0)}));
 Nutrition.merge(state,safe);
 if(safe.length)await env.SUBS.put(prefix+user,JSON.stringify(state.nutrition));
 const reference=await read(env,'nutrition:v1:reference',NutritionSeed);
 // Personal corrections take priority. Reference rows never overwrite them.
 Nutrition.merge(state,reference.filter(row=>!state.nutrition.rows.some(personal=>personal.origin==='manual'&&personal.key===row.key)));
 return state.nutrition.rows;
}
export async function refreshNutrition(env){
 if(!env.SUBS)return;
 const last=await read(env,'nutrition:v1:refresh',{});
 if(Date.now()-(last.attemptAt||0)<3600000)return;
 await env.SUBS.put('nutrition:v1:refresh',JSON.stringify({...last,attemptAt:Date.now()}));
 if(Date.now()-(last.checkedAt||0)>=Nutrition.week)try{const rows=await foundation();await env.SUBS.put('nutrition:v1:reference',JSON.stringify(rows));await env.SUBS.put('nutrition:v1:refresh',JSON.stringify({checkedAt:Date.now(),attemptAt:Date.now()}))}catch{/* Keep the previous verified data. Retry next hour. */}
 // At most five searches per hour across all users, below OFF's search limit.
 // A failed/missing match never becomes a verified nutrition value.
 const page=await env.SUBS.list({prefix,limit:100});let remaining=5;
 for(const {name} of page.keys){
  const db=await read(env,name,{version:1,rows:[]});const updates=[];
  for(const row of db.rows||[]){
   if(!remaining)break;
   if(!Nutrition.valid(row)||row.origin==='manual'||row.origin==='usda'||Date.now()-(row.sourceAttemptAt||0)<Nutrition.week)continue;
   row.sourceAttemptAt=Date.now();remaining--;updates.push(row);
   try{const verified=await searchProduct(row);if(verified)Object.assign(row,verified)}catch{}
  }
  if(updates.length){
   // Re-read after external fetches: a correction made while refreshing wins.
   const current=await read(env,name,{version:1,rows:[]}),state={nutrition:current};
   for(const update of updates){const saved=current.rows.find(r=>r.key===update.key);if(saved?.origin==='manual')continue;Nutrition.merge(state,[update]);const merged=current.rows.find(r=>r.key===update.key);if(merged)merged.sourceAttemptAt=update.sourceAttemptAt}
   await env.SUBS.put(name,JSON.stringify(current));
  }
  if(!remaining)break;
 }
}
