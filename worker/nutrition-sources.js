import {unzipSync,strFromU8} from 'fflate';
import '../nutrition.js';
// Deliberately narrow mappings: no US cottage cheese -> local tvorog substitution.
export const mappings=[
 [2646170,'Куриная грудка сырая',['Куриное филе сырое','Куриная грудка сырой вес']],
 [331960,'Куриная грудка тушёная',[]],
 [1105314,'Банан',['Бананы','Банан сырой']],
 [2346396,'Овсяные хлопья сухие',['Овсяные хлопья сырой вес']],
 [2512378,'Гречка сухая',['Гречка сырой вес']],
 [2512381,'Рис белый длиннозерный сухой',['Рис белый длиннозерный сырой вес']],
 [2346401,'Картофель сырой без кожуры',[]],
 [321360,'Помидоры черри сырые',[]],
 [1750340,'Яблоко фуджи с кожурой сырое',[]],
 [2346398,'Ананас сырой',[]]
];
export function fromFoundation(foods,now=Date.now()){
 return mappings.flatMap(([id,n,aliases])=>{
  const item=foods.find(f=>f.fdcId===id);if(!item)return [];
  const nutrient=id=>item.foodNutrients?.find(f=>f.nutrient?.id===id)?.amount;
  const row={key:Nutrition.key(n),n,aliases:[n,...aliases],k:nutrient(2048)??nutrient(1008)??nutrient(2047),p:nutrient(1003),f:nutrient(1004),c:nutrient(1005),origin:'usda',source:`https://fdc.nal.usda.gov/food-details/${id}/nutrients`,ref:'usda:'+id,checkedAt:now,updatedAt:now};
  return Nutrition.valid(row)?[row]:[];
 });
}
async function limited(response,max){if(!response.ok)throw Error('source');const reader=response.body.getReader(),chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('source_size')}chunks.push(value)}const bytes=new Uint8Array(size);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length}return bytes}
export async function foundation(){
 const signal=AbortSignal.timeout(20000);
 const page=await fetch('https://fdc.nal.usda.gov/download-datasets/',{signal});
 const html=strFromU8(await limited(page,1e6));
 const path=html.match(/(?:https:\/\/fdc\.nal\.usda\.gov)?(\/fdc-datasets\/FoodData_Central_foundation_food_json_\d{4}-\d{2}-\d{2}\.zip)/)?.[1];
 if(!path)throw Error('source_link');
 const bytes=await limited(await fetch('https://fdc.nal.usda.gov'+path,{signal}),4e6);
 let found=false;const files=unzipSync(bytes,{filter:file=>{if(found||!file.name.endsWith('.json')||file.originalSize>20e6)return false;found=true;return true}});
 const data=JSON.parse(strFromU8(Object.values(files)[0]));
 const foods=data.FoundationFoods;if(!Array.isArray(foods))throw Error('source_data');
 const rows=fromFoundation(foods);if(rows.length<5)throw Error('source_incomplete');return rows;
}
