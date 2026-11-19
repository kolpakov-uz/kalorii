const number = {type:'number',minimum:0};
const string = {type:'string'};
const foodFields = {
  name:string,
  grams:{type:'number',exclusiveMinimum:0},
  kcal100:number,
  protein100:number,
  fat100:number,
  carbs100:number
};

const foodAction = {
  anyOf:[
    {
      type:'object',
      properties:{op:{type:'string',enum:['add']},...foodFields},
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

const coachAction = {
  type:'object',
  properties:{
    type:{type:'string',enum:['add_food','edit_food','delete_food','move_food','move_day','set_macros','reset_macros','set_goal','set_reminder','set_water_reminder','add_water','add_weight','add_measure','update_goal','add_workout']},
    id:string,name:string,date:string,from:string,to:string,time:string,key:string,
    meal:{type:'string',enum:['b','l','d','s']},
    goal:{type:'string',enum:['lose','gain','abs','keep']},
    on:{type:'boolean'},
    kinds:{type:'array',items:{type:'string',enum:['strength','abs','cardio']}},
    grams:number,kcal:number,protein:number,fat:number,carbs:number,
    ml:number,kg:number,waist:number,neck:number,hip:number,arm:number,
    weight:number,start:number,target:number,minutes:number,every_hours:number
  },
  required:['type'],
  additionalProperties:false
};

export function responseSchema(mode) {
  if (mode === 'transcribe') {
    return {type:'object',properties:{transcript:string},required:['transcript'],additionalProperties:false};
  }
  return {
    type:'object',
    properties:{
      reply:string,
      actions:{type:'array',maxItems:8,items:mode === 'chat' ? coachAction : foodAction}
    },
    required:['reply','actions'],
    additionalProperties:false
  };
}
