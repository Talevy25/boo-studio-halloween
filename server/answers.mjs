import {ApiError} from './base44.mjs';
const bad=()=>{throw new ApiError(400,'Complete the builder’s requested fields.');};
export function answerPayload(question,input){
 const payload={tool_call_id:question.id,message_id:question.message_id,action:input.action};
 if(input.action==='rejected'||question.waiting_on.kind==='approval')return payload;
 let args=question.arguments;try{args??=JSON.parse(question.arguments_string||'{}')}catch{args={}}
 const value=input.extra_user_input;
 if(question.waiting_on.kind==='choice'&&Array.isArray(args.questions)&&args.questions.length){
  if(!Array.isArray(value?.answers)||value.answers.length!==args.questions.length)bad();
  payload.extra_user_input={answers:args.questions.map((q,i)=>{
   const answer=value.answers.find(a=>a.question_index===i);
   const labels=(q.options||[]).map(o=>typeof o==='string'?o:o.label);
   if(!answer||!Array.isArray(answer.selected_labels)||!answer.selected_labels.length||(!q.multi_select&&answer.selected_labels.length!==1)||new Set(answer.selected_labels).size!==answer.selected_labels.length||answer.selected_labels.some(x=>typeof x!=='string'||!labels.includes(x)))bad();
   return {question_index:i,selected_labels:answer.selected_labels};
  })};
 }else if(question.waiting_on.kind==='input'&&Array.isArray(args.secrets_schema)&&args.secrets_schema.length){
  const secrets={};for(const field of args.secrets_schema){const name=field.secretName;if(typeof name!=='string'||['__proto__','constructor','prototype'].includes(name))bad();const v=value?.secrets?.[name];if(typeof v!=='string'||!v.trim()||v.length>8000)bad();secrets[name]=v;}
  payload.extra_user_input={secrets};
 }else{
  if(typeof value!=='string'||!value.trim()||value.length>8000)bad();payload.extra_user_input=value.trim();
 }
 return payload;
}
