const number = {type:'number',minimum:0};
const string = {type:'string'};
const foodFields = {
  name:string,
  grams:{type:'number',exclusiveMinimum:0},
  kcal100:number,
  protein100:number,
  fat100:number,
  carbs100:number,
  label:{type:'object',properties:{basisGrams:{type:'number',exclusiveMinimum:0},energy:number,energyUnit:{type:'string',enum:['kcal','kJ']},protein:number,fat:number,carbs:number},required:['basisGrams','energy','energyUnit','protein','fat','carbs'],additionalProperties:false}
};

const foodAction = {
  anyOf:[
    {
      type:'object',
      properties:{op:{type:'string',enum:['add']},foodId:string,...foodFields},
      required:['op','name','grams','kcal100','protein100','fat100','carbs100'],
      additionalProperties:false
    },
    {
      type:'object',
      properties:{op:{type:'string',enum:['edit']},id:string,...foodFields},
      required:['op','id'],
      additionalProperties:false
    },
    {
      type:'object',
      properties:{op:{type:'string',enum:['delete']},id:string},
      required:['op','id'],
      additionalProperties:false
    }
  ]
};

function coachAction(type,properties,required=Object.keys(properties)) {
  return {
    type:'object',
    properties:{type:{type:'string',enum:[type]},...properties},
    required:['type',...required],
    additionalProperties:false
  };
}

// Keep unrelated optional fields out of each action. Their combinations can
// exceed Gemini's constrained-decoding limits before generation even starts.
const coachNumber = {type:'number'};
const meal = {type:'string',enum:['b','l','d','s']};
export const coachActions = [
  coachAction('add_food',{name:string,grams:coachNumber,kcal:coachNumber,protein:coachNumber,fat:coachNumber,carbs:coachNumber,meal,date:string},['name','grams','kcal','protein','fat','carbs']),
  coachAction('edit_food',{id:string,name:string,grams:coachNumber,kcal:coachNumber,protein:coachNumber,fat:coachNumber,carbs:coachNumber},['id']),
  coachAction('delete_food',{id:string}),
  coachAction('move_food',{id:string,date:string}),
  coachAction('move_day',{from:string,to:string,meal},['from','to']),
  coachAction('set_macros',{protein:coachNumber,fat:coachNumber,carbs:coachNumber}),
  coachAction('reset_macros',{}),
  coachAction('set_goal',{goal:{type:'string',enum:['lose','gain','abs','keep']}}),
  coachAction('set_reminder',{key:{type:'string',enum:['b','l','d','s','e']},on:{type:'boolean'},time:string},['key']),
  coachAction('set_water_reminder',{on:{type:'boolean'},from:string,to:string,every_hours:coachNumber},[]),
  coachAction('add_water',{ml:coachNumber}),
  coachAction('add_weight',{kg:coachNumber}),
  coachAction('add_measure',{waist:coachNumber,neck:coachNumber,hip:coachNumber,arm:coachNumber,weight:coachNumber,bf:coachNumber},[]),
  coachAction('update_goal',{start:coachNumber,target:coachNumber},[]),
  coachAction('add_workout',{kinds:{type:'array',items:{type:'string',enum:['strength','abs','cardio']}},minutes:coachNumber,date:string})
];

export function responseSchema(mode) {
  if (mode === 'transcribe') {
    return {type:'object',properties:{transcript:string},required:['transcript'],additionalProperties:false};
  }
  return {
    type:'object',
    properties:{
      reply:string,
      actions:mode === 'chat' ? {type:'array',items:{anyOf:coachActions}} : {type:'array',maxItems:8,items:foodAction}
    },
    required:['reply','actions'],
    additionalProperties:false
  };
}
