import {Ajv} from 'ajv';
import {createRequire} from 'node:module';
import type {FormatsPlugin} from 'ajv-formats';
const addFormats=createRequire(import.meta.url)('ajv-formats') as FormatsPlugin;
export const SCORING_VERSION=2;
function schemaValidator(){const ajv=new Ajv({allErrors:true,strict:false});addFormats(ajv);return ajv;}
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import type {Capability,Manifest,Schema} from '../src/model.js';
export type Json = Record<string,any>;
export interface GoldAction {id:string;project:string;component:string;handler:string;routes:string[];evidence:{file:string;line:number;anchor:string;sha256:string}[];inputSchema:Json;validInput:Json;effect:string;context?:Json;runtimeOnly?:string[];}
export interface GroundTruth {version:number;actions:GoldAction[];[key:string]:unknown;}
export const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export function treeDigest(directory:string):string {
  const files:string[]=[];
  function walk(path:string){for(const item of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,item.name);if(item.isDirectory())walk(file);else if(item.isFile())files.push(file);}}
  walk(directory);return digest(files.map(file=>`${file}\0${digest(readFileSync(file))}`).join('\n'));
}
/** Measurement inputs only: writing a report must not invalidate the evaluator that produced it. */
export function evaluationDigest(directory='evaluation'):string{
  const records:string[]=[];
  const inputs=new Set(['ground-truth.json','projects.json','labels.json','inventory.json','inventory.md','prerequisites.json','prerequisites.md','adjudications.json','schema-source-audit.json','FREEZE.sha256','source-manifest.json','source-manifest.sha256.json']);
  function walk(path:string){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=join(path,entry.name);if(entry.isDirectory())walk(file);else if(entry.isFile()&&(/\.(?:ts|mts|js|mjs)$/.test(entry.name)||inputs.has(entry.name)))records.push(`${file.slice(directory.length+1)}\0${digest(readFileSync(file))}`);}}
  walk(directory);return digest(records.join('\n'));
}
export function evaluationInputs(){
 const locks=['package.json','package-lock.json','samples/toolchains/course-crud/package-lock.json','samples/locks/realworld-package-lock.json','test-apps/user-crud/package-lock.json','test-apps/signup/package-lock.json','test-apps/forms-course/package-lock.json','test-apps/course-crud/crud-angular/package-lock.json'];
 return {fixtures:digest(readFileSync('samples/isolation.ts')),tooling:treeDigest('tooling'),dependencyFiles:Object.fromEntries(locks.filter(file=>existsSync(file)).map(file=>[file,digest(readFileSync(file))]))};
}
export function match(action:GoldAction,c:Capability){return action.component===c.component&&action.handler===c.handler&&action.routes.includes(c.route);}
export function representatives(caps:Capability[]) {
  // Deterministic before scoring: runnable before blocked; full workflow/form before standalone button.
  return [...caps].sort((a,b)=>Number(b.status==='candidate')-Number(a.status==='candidate') || Number(b.action.kind!=='button')-Number(a.action.kind!=='button') || ((a.inputSchema as Json).required?.length??0)-((b.inputSchema as Json).required?.length??0) || a.id.localeCompare(b.id));
}
export function discovery(actions:GoldAction[],manifest:Manifest,readyOnly=false){
  const caps=manifest.capabilities.filter(c=>!readyOnly||c.status==='candidate');
  const matched=actions.filter(a=>caps.some(c=>match(a,c)));
  // UI-state-only actions (no service/store/HTTP effect) are reported but are not scored as false positives against backend-operation labels.
  const unknown=[...new Set(caps.filter(c=>c.effectKind!=='ui-state'&&!actions.some(a=>match(a,c))).map(c=>[c.component,c.handler,c.route].join('|')))];
  const tp=matched.length,fp=unknown.length,fn=actions.length-tp;
  return {truePositives:tp,falsePositives:fp,falseNegatives:fn,precision:tp+fp?tp/(tp+fp):null,recall:actions.length?tp/actions.length:null,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null,rawEmissions:caps.length,duplicateEmissions:caps.length-tp-fp,unmatchedPredictions:unknown,missing:actions.filter(a=>!matched.includes(a)).map(a=>a.id)};
}
const clone=<T>(v:T):T=>structuredClone(v);
function valueFor(s:Json):any {
  if('const' in s)return s.const;if(s.enum)return s.enum[0];if(s.anyOf)return valueFor(s.anyOf[s.anyOf.length-1]);
  if(s.type==='object')return Object.fromEntries(Object.entries(s.properties??{}).map(([k,v])=>[k,valueFor(v as Json)]));
  if(s.type==='array')return Array.from({length:s.minItems??1},()=>valueFor(s.items));
  if(s.type==='boolean')return true;if(s.type==='integer'||s.type==='number')return s.minimum??1;
  if(s.format==='email'||s.pattern?.includes('@'))return 'probe@example.test';return 'x'.repeat(Math.max(1,s.minLength??1));
}
export function probes(action:GoldAction){
  const cases:{name:string;input:Json;accepted:boolean}[]=[];
  const add=(name:string,input:Json,accepted:boolean)=>cases.push({name,input,accepted});
  const baseline=clone(action.validInput);add('valid representative input',baseline,true);
  add('unknown property',{...baseline,__unexpected:true},false);
  for(const name of action.inputSchema.required??[]){const input=clone(baseline);delete input[name];add(`missing required ${name}`,input,false);}
  function visit(schema:Json,path:(string|number)[]){
    if(schema.type==='object'){
      if(path.length){
        const without=(key:string)=>{const input=clone(baseline);let obj:any=input;for(const part of path)obj=obj[part];delete obj[key];return input;};
        for(const key of schema.required??[])add(`missing required ${[...path,key].join('.')}`,without(key),false);
      }
      for(const [key,field]of Object.entries(schema.properties??{}))visit(field as Json,[...path,key]);return;
    }
    const set=(value:any)=>{const input=clone(baseline);let obj:any=input;for(let i=0;i<path.length-1;i++){const k=path[i];if(obj[k]===undefined)obj[k]=typeof path[i+1]==='number'?[]:{};obj=obj[k];}obj[path.at(-1)!]=value;return input;};
    const label=path.join('.');const correct=valueFor(schema);
    // Fill an optional field as a positive example; omitting it remains valid.
    if(path.length===1&&!Object.hasOwn(baseline,path[0]))add(`optional ${label} accepted`,set(correct),true);
    add(`wrong type ${label}`,set(schema.type==='boolean'?'true':schema.type==='array'?{}:schema.type==='integer'||schema.type==='number'?'1':42),false);
    if(schema.enum){const invalid=schema.type==='number'||schema.type==='integer'?Math.max(...schema.enum.filter((v:unknown)=>typeof v==='number'))+1:'__invalid__';add(`invalid enum ${label}`,set(invalid),false);for(const v of schema.enum)add(`enum ${label}=${v}`,set(v),true);}
    if('const' in schema)add(`violates const ${label}`,set(typeof schema.const==='boolean'?!schema.const:'__wrong__'),false);
    if(schema.minLength){add(`below minLength ${label}`,set('x'.repeat(schema.minLength-1)),false);if(!schema.pattern)add(`at minLength ${label}`,set('x'.repeat(schema.minLength)),true);}
    if(schema.maxLength){add(`above maxLength ${label}`,set('x'.repeat(schema.maxLength+1)),false);add(`at maxLength ${label}`,set('x'.repeat(schema.maxLength)),true);}
    if(schema.format==='email'||typeof schema.pattern==='string'&&schema.pattern.includes('@')){
      add(`malformed email ${label}`,set('not-an-email'),false);
      add(`single-label email domain ${label}`,set('a@b'),true);
      add(`plus email address ${label}`,set('a+b@example.test'),true);
      add(`consecutive email dots ${label}`,set('a..b@example.test'),false);
    }else if(schema.pattern){
      let witness:any=baseline;for(const part of path)witness=witness?.[part];
      for(const [i,value]of ['', '__invalid__', typeof witness==='string'?witness+'!':'!', typeof witness==='string'?witness.slice(1):'x'].entries())add(`pattern example ${label} ${i}`,set(value),false);
    }
    if(schema.minimum!==undefined){add(`below minimum ${label}`,set(schema.minimum-1),false);add(`minimum ${label}`,set(schema.minimum),true);}
    if(schema.type==='integer')add(`fractional ${label}`,set(1.5),false);
    if(schema.type==='array'){
      if(schema.minItems)add(`below minItems ${label}`,set([]),false);
      // Upstream has no 20-row limit. An executor bound is a supported-subset restriction.
      if(!schema.maxItems&&schema.items?.type==='object')add(`21 valid items ${label}`,set(Array.from({length:21},()=>valueFor(schema.items))),true);
      if(schema.items?.type==='object')visit(schema.items,[...path,0]);
    }
    if(schema.anyOf){add(`optional empty ${label}`,set(''),true);const length=schema.anyOf.find((s:Json)=>s.minLength)?.minLength;if(length>1)add(`short nonempty optional ${label}`,set('x'.repeat(length-1)),false);}
  }
  visit(action.inputSchema,[]);
  // Constraint interactions matter: a length boundary can still fail its pattern/format. The authored full gold schema
  // is the oracle for candidate payloads, rather than a hardcoded email or string assumption.
  const reference=schemaValidator().compile(action.inputSchema);
  if(!reference(action.validInput))throw new Error(`Invalid gold representative input: ${action.id}`);
  return cases.map(c=>{const accepted=Boolean(reference(c.input));return {...c,accepted,...(accepted!==c.accepted?{expectationAdjusted:true}:{})};});
}
export function schemaScore(action:GoldAction,capability:Capability){
  const ajv=schemaValidator();
  const reference=ajv.compile(action.inputSchema);const generated=capability.inputSchema as Json;
  const inputWellFormed=Boolean(ajv.validateSchema(generated));const outputWellFormed=Boolean(ajv.validateSchema(capability.outputSchema as Schema));
  const validate=ajv.compile(generated);
  const cases=probes(action).map(test=>{
    if(Boolean(reference(test.input))!==test.accepted)throw new Error(`Invalid gold probe: ${action.id}: ${test.name} ${ajv.errorsText(reference.errors)}`);
    const accepted=Boolean(validate(test.input));return {...test,actualAccepted:accepted,passed:accepted===test.accepted};
  });
  const expectedFields=Object.keys(action.inputSchema.properties??{}).sort();const actualFields=Object.keys(generated.properties??{}).sort();
  const expectedRequired=[...action.inputSchema.required??[]].sort();const actualRequired=[...generated.required??[]].sort();
  const fieldsCorrect=JSON.stringify(expectedFields)===JSON.stringify(actualFields);
  const requiredCorrect=JSON.stringify(expectedRequired)===JSON.stringify(actualRequired);
  return {capability:capability.id,inputWellFormed,outputWellFormed,fieldsCorrect,requiredCorrect,expectedFields,actualFields,expectedRequired,actualRequired,passed:inputWellFormed&&outputWellFormed&&fieldsCorrect&&requiredCorrect&&cases.every(c=>c.passed),cases};
}
