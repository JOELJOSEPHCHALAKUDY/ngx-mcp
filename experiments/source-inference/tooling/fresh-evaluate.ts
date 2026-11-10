// Source-only first-pass evaluation of independently frozen public projects. Never rewrites the labels.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {compile} from '../src/compiler.js';
import {digest,treeDigest,schemaScore,representatives,SCORING_VERSION} from '../evaluation/metrics.js';
import type {Capability} from '../src/model.js';
const id=process.argv[2],out=process.argv[3];
if(!id)throw new Error('Usage: fresh-evaluate.ts <project-id> [report.json]');
const directory=`evaluation/fresh/${id}`,bytes=readFileSync(`${directory}/labels.json`),labels=JSON.parse(bytes.toString());
const freeze=readFileSync(`${directory}/FREEZE.sha256`,'utf8');assert(freeze.includes(digest(bytes)),'Independent labels changed after freezing');
const app=labels.project.localSource;
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),labels.project.commit);
execFileSync('git',['diff','--exit-code','HEAD','--','src'],{cwd:app,stdio:'pipe'});
const compilerDigest=treeDigest('src');
const entry=id==='jira-clone'?'src/app/app.routes.ts#appRoutes':'src/app/app.routes.ts#routes';
const manifest=compile(resolve(app,'tsconfig.app.json'),entry);
// Annotation text is for source reviewers, not part of a route. Wildcards retain their explicitly frozen scope.
const routes=(paths:string[])=>paths.map(path=>path.replace(/\s+\(.*\)$/,'').trim());
const matches=(action:any,c:Capability)=>action.component===c.component&&action.handler===c.handler&&(!c.drive?.drag||c.drive.drag.mode===(Object.hasOwn(action.validInput,'targetStatus')?'transfer':'reorder'))&&routes(action.routes).some(path=>[c.route,...c.allowedRoutes??[]].some(route=>path==='*'||path===route||path.endsWith('*')&&route.startsWith(path.slice(0,-1))));
function businessContract(c:Capability,action:any):Capability{
  const schema=structuredClone(c.inputSchema) as any;
  // Route IDs are explicitly bound by the host fixture URL in execution, not business form fields.
  // Keep the raw schema/score as evidence and report this comparison separately.
  for(const name of c.routeParams??[])if(!Object.hasOwn(action.inputSchema.properties??{},name)){
    if(schema.properties)delete schema.properties[name];
    if(Array.isArray(schema.required))schema.required=schema.required.filter((key:string)=>key!==name);
  }
  return {...c,inputSchema:schema};
}
const actions=labels.actions.map((action:any)=>{
  const caps=representatives(manifest.capabilities.filter(c=>matches(action,c))),primary=caps[0];
  let schema:unknown=null,businessSchema:unknown=null,labelError:string|undefined;
  if(primary){try{const gold={...action,project:id,evidence:action.evidence??[]};schema=schemaScore(gold,primary);businessSchema=schemaScore(gold,businessContract(primary,action));}catch(e){labelError=String(e);}}
  return {id:action.id,classification:primary?primary.status==='candidate'?'runnable':'blocked':'missing',predictions:caps.map(c=>({id:c.id,status:c.status,issues:c.issues,inputSchema:c.inputSchema,contextSchema:c.contextSchema,routeParams:c.routeParams,action:c.action,plan:c.plan,target:c.target,reveal:c.reveal,drive:c.drive})),schema,businessSchema,labelError};
});
assert.equal(treeDigest('src'),compilerDigest,'Compiler changed while first-pass scoring; rerun after edits settle');
const runnable=manifest.capabilities.filter(c=>c.status==='candidate');
const unknownRawEmissions=runnable.filter(c=>!labels.actions.some((a:any)=>matches(a,c))).map(c=>({id:c.id,component:c.component,handler:c.handler,route:c.route,effectKind:c.effectKind??'backend',action:c.action}));
// Operation precision and literal emission precision have different units; retain both without silently dropping UI helpers.
const semantic=new Map<string,{key:string;component:string;handler:string;routes:string[];emissionIds:string[];effectKinds:string[]}>();
for(const candidate of unknownRawEmissions){const key=candidate.component+'.'+candidate.handler;const entry=semantic.get(key)??{key,component:candidate.component,handler:candidate.handler,routes:[],emissionIds:[],effectKinds:[]};if(!entry.routes.includes(candidate.route))entry.routes.push(candidate.route);entry.emissionIds.push(candidate.id);if(!entry.effectKinds.includes(candidate.effectKind))entry.effectKinds.push(candidate.effectKind);semantic.set(key,entry);}
const unknown=[...semantic.values()];
const result={measuredAt:new Date().toISOString(),scoringVersion:SCORING_VERSION,project:labels.project.repository,revision:labels.project.commit,labelsDigest:digest(bytes),compilerDigest,normalization:'Discovery removes explanatory route annotations, interprets frozen route wildcards and source-proven layout child routes. Raw schema scores are unchanged. A separate businessSchema score removes only source-declared route parameters absent from frozen business fields; execution binds those from the fixture URL. Parameter names and object shapes are unchanged.',scope:'Independent source labels frozen before compiler scoring; this is discovery/schema only, not execution success.',totals:{gold:actions.length,discovered:actions.filter((a:any)=>a.classification!=='missing').length,runnable:actions.filter((a:any)=>a.classification==='runnable').length,correctSchemas:actions.filter((a:any)=>(a.schema as any)?.passed).length,correctBusinessSchemas:actions.filter((a:any)=>(a.businessSchema as any)?.passed).length,labelErrors:actions.filter((a:any)=>a.labelError).length,unmatchedRunnable:unknown.length,unmatchedRunnableEmissions:unknownRawEmissions.length,rawRunnableEmissions:runnable.length,matchedRunnableEmissions:runnable.length-unknownRawEmissions.length,backendOnlyUnmatchedOperations:unknown.filter(c=>c.effectKinds.some(kind=>kind!=='ui-state')).length},actions,unknown,unknownRawEmissions,manifest};
if(out){mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
console.log(JSON.stringify({project:id,totals:result.totals,actions:actions.map((a:any)=>({id:a.id,status:a.classification,schema:a.schema?.passed,error:a.labelError,issues:a.predictions[0]?.issues}))},null,2));
