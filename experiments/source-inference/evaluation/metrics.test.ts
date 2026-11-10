import test from 'node:test';
import assert from 'node:assert/strict';
import {discovery,schemaScore,probes,evaluationDigest,type GoldAction} from './metrics.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {Manifest,Capability} from '../src/model.js';
const gold:GoldAction={id:'sample.save',project:'sample',component:'Form',handler:'save',routes:['/new','/edit'],evidence:[],inputSchema:{type:'object',properties:{name:{type:'string',minLength:2}},required:['name'],additionalProperties:false},validInput:{name:'Ada'},effect:'Save name'};
const capability=(id:string,changes:Partial<Capability>={}):Capability=>({id,component:'Form',handler:'save',route:'/new',status:'candidate',action:{kind:'form'},inputSchema:gold.inputSchema,outputSchema:{type:'object'},...changes} as Capability);
const manifest=(caps:Capability[])=>({capabilities:caps} as Manifest);
test('logical scoring merges route variants without inflating true positives',()=>{
 const result=discovery([gold],manifest([capability('a'),capability('b',{route:'/edit'})]));assert.equal(result.truePositives,1);assert.equal(result.duplicateEmissions,1);assert.equal(result.precision,1);assert.equal(result.recall,1);
});
test('blocked, missing and false positives have different denominators',()=>{
 const other={...gold,id:'sample.delete',handler:'delete'};
 const m=manifest([capability('a',{status:'blocked'}),capability('unknown',{handler:'unknown'})]);
 const discoveryResult=discovery([gold,other],m);assert.equal(discoveryResult.precision,0.5);assert.equal(discoveryResult.recall,0.5);
 const runnable=discovery([gold,other],m,true);assert.equal(runnable.truePositives,0);assert.equal(runnable.falsePositives,1);assert.equal(runnable.falseNegatives,2);assert.equal(runnable.recall,0);
});
test('matching requires declared component, handler and route',()=>{
 assert.equal(discovery([gold],manifest([capability('wrong-route',{route:'/else'})])).falsePositives,1);
 assert.equal(discovery([gold],manifest([])).precision,null);
});
test('schema scoring detects permissive schemas and missing fields',()=>{
 assert(schemaScore(gold,capability('correct')).passed);
 const result=schemaScore(gold,capability('permissive',{inputSchema:{type:'object',properties:{name:{type:'string'}},additionalProperties:false}}));
 assert(!result.passed);assert(!result.requiredCorrect);assert(result.cases.some(c=>c.name==='below minLength name'&&!c.passed));
 assert(!schemaScore(gold,capability('empty',{inputSchema:{type:'object',properties:{},additionalProperties:false}})).fieldsCorrect);
});
test('probe suite includes independently expected accepted and rejected boundaries',()=>{
 const cases=probes(gold);assert(cases.some(c=>c.accepted&&c.name==='at minLength name'));assert(cases.some(c=>!c.accepted&&c.name==='missing required name'));
});
test('non-email patterns and interacting bounds can score an identical correct schema',()=>{
 const schema={type:'object',properties:{name:{type:'string',pattern:'^[A-Z]{3}-[0-9]{3}$',minLength:7,maxLength:7}},required:['name'],additionalProperties:false};
 const action={...gold,inputSchema:schema,validInput:{name:'ABC-123'}};
 assert(schemaScore(action,capability('pattern',{inputSchema:schema})).passed);
 assert(probes(action).some(p=>p.name.startsWith('pattern example')&&!p.accepted));
});
test('standard email formats are validated instead of silently ignored',()=>{
 const schema={type:'object',properties:{name:{type:'string',format:'email'}},required:['name'],additionalProperties:false};
 const action={...gold,inputSchema:schema,validInput:{name:'ada@example.test'}};
 assert(schemaScore(action,capability('email',{inputSchema:schema})).passed);
 assert(!schemaScore(action,capability('loose',{inputSchema:{...schema,properties:{name:{type:'string'}}}})).passed);
});
test('numeric enums are tested with an invalid numeric value',()=>{
 const schema={type:'object',properties:{name:{type:'integer',enum:[5,10,15]}},required:['name'],additionalProperties:false};
 const action={...gold,inputSchema:schema,validInput:{name:5}};
 assert(schemaScore(action,capability('enum',{inputSchema:schema})).passed);
 assert(!schemaScore(action,capability('no-enum',{inputSchema:{...schema,properties:{name:{type:'integer'}}}})).passed);
});
test('an invalid representative label remains an explicit scoring error',()=>{
 assert.throws(()=>schemaScore({...gold,validInput:{name:'x'}},capability('correct')),/Invalid gold representative input/);
});
test('evaluator freshness includes code and frozen labels without hashing its own reports',()=>{
 const path=mkdtempSync(join(tmpdir(),'angular-evaluator-inputs-'));
 try{
  writeFileSync(join(path,'runner.ts'),'export const scoring=1;');writeFileSync(join(path,'labels.json'),'{}');
  const initial=evaluationDigest(path);writeFileSync(join(path,'compiler-results.json'),'{"result":1}');assert.equal(evaluationDigest(path),initial);
  writeFileSync(join(path,'labels.json'),'{"operations":[]}');const labels=evaluationDigest(path);assert.notEqual(labels,initial);
  writeFileSync(join(path,'runner.ts'),'export const scoring=2;');assert.notEqual(evaluationDigest(path),labels);
 }finally{rmSync(path,{recursive:true,force:true});}
});
