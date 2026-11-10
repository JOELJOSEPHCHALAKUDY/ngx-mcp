import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {samples,compileSample,sampleDirectory,sampleUrl} from '../src/samples.js';
import {ensureLocalApp} from '../src/local-app.js';
import {SCORING_VERSION,digest,treeDigest,evaluationDigest,evaluationInputs,discovery,match,representatives,schemaScore,type GroundTruth} from './metrics.js';
import {chromium,executeAction} from './execution.js';
import {redact,isolateSample} from '../samples/isolation.js';
import {refineManifest} from '../src/refine.js';
const staticOnly=process.argv.includes('--static-only');
const gold:GroundTruth=JSON.parse(readFileSync('evaluation/ground-truth.json','utf8'));
assert.equal(samples.length,5);assert.equal(new Set(gold.actions.map(a=>a.id)).size,gold.actions.length);
const sourceSnapshot=()=>({...evaluationInputs(),compiler:treeDigest('src'),evaluator:evaluationDigest(),registry:digest(readFileSync('samples/projects.json')),groundTruth:digest(readFileSync('evaluation/ground-truth.json')),apps:Object.fromEntries(samples.map(s=>[s.id,treeDigest(resolve(sampleDirectory(s),'src'))]))});
const before=sourceSnapshot();
for(const sample of samples){
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:sampleDirectory(sample),encoding:'utf8'}).trim(),sample.revision,'Sample revision changed');
 execFileSync('git',['diff','--exit-code','HEAD','--','src'],{cwd:sampleDirectory(sample),stdio:'pipe'});
 for(const action of gold.actions.filter(a=>a.project===sample.id))for(const ref of action.evidence){
   const bytes=readFileSync(resolve(sampleDirectory(sample),ref.file));assert.equal(digest(bytes),ref.sha256,`Stale source label ${action.id}`);
   assert(bytes.toString('utf8').split('\n')[ref.line-1].includes(ref.anchor),`Stale line ${action.id}`);
 }
}
const projects:any[]=[];let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
if(!staticOnly)browser=await chromium.launch();
try{
 for(const sample of samples){
  console.log(`Scoring ${sample.id}...`);
  const app=staticOnly?undefined:await ensureLocalApp(sample);
  let manifest=compileSample(sample);
  // Option lists that only exist at run time are read from the live (isolated) application before contracts are scored.
  if(!staticOnly){const rc=await browser!.newContext({serviceWorkers:'block'});try{await isolateSample(rc,sample);manifest=await refineManifest(await rc.newPage(),manifest,sampleUrl(sample));}finally{await rc.close();}}
  const actions=gold.actions.filter(a=>a.project===sample.id);
  const entries=actions.map(action=>{
   const caps=representatives(manifest.capabilities.filter(c=>match(action,c)));const primary=caps[0];
   return {id:action.id,classification:!primary?'missing':caps.some(c=>c.status==='candidate')?'runnable':'blocked',emissions:caps.map(c=>({id:c.id,route:c.route,kind:c.action.kind,status:c.status,issues:c.issues})),schema:primary?schemaScore(action,primary):null,execution:{status:!primary?'missing':primary.status!=='candidate'?'blocked':staticOnly?'not-run':'pending'} as any,primary};
  });
  const project={id:sample.id,repository:sample.repository,revision:sample.revision,goldOperations:actions.length,discovery:discovery(actions,manifest),runnableDiscovery:discovery(actions,manifest,true),actions:entries};
  projects.push(project);
  if(!staticOnly){
   try{for(const entry of entries.filter(e=>e.classification==='runnable')){
    console.log(`  Executing ${entry.id}`);
    entry.execution=await executeAction(browser!,sample,actions.find(a=>a.id===entry.id)!,manifest,entry.primary!);
    console.log(`  ${entry.execution.status}: ${entry.id}${entry.execution.reason?' — '+entry.execution.reason.slice(0,180):''}`);
   }}finally{app?.kill();}
  }
  for(const entry of entries)delete (entry as any).primary;
 }
}finally{await browser?.close();}
const after=sourceSnapshot();assert.deepEqual(after,before,'Source changed during measurement');
const rows=projects.flatMap(p=>p.actions),schemas=rows.filter(a=>a.schema).map(a=>a.schema),runnableSchemas=rows.filter(a=>a.classification==='runnable').map(a=>a.schema);
const ratio=(n:number,d:number)=>({passed:n,total:d,rate:d?n/d:null});
const sum=(key:string,field:string)=>projects.reduce((n,p)=>n+p[key][field],0);
const discoveryTotals=(key:string)=>{const tp=sum(key,'truePositives'),fp=sum(key,'falsePositives'),fn=sum(key,'falseNegatives');return {truePositives:tp,falsePositives:fp,falseNegatives:fn,precision:tp+fp?tp/(tp+fp):null,recall:tp/(tp+fn),f1:2*tp/(2*tp+fp+fn),rawEmissions:sum(key,'rawEmissions'),duplicateEmissions:sum(key,'duplicateEmissions')};};
const attempted=rows.filter(a=>['passed','failed'].includes(a.execution.status)),passed=attempted.filter(a=>a.execution.status==='passed').length;
const returns=rows.filter(a=>a.execution.outputConforms!==undefined);
const aggregate={goldOperations:rows.length,discovery:discoveryTotals('discovery'),runnableDiscovery:discoveryTotals('runnableDiscovery'),schema:{matchedActions:ratio(schemas.filter(s=>s.passed).length,schemas.length),runnableActions:ratio(runnableSchemas.filter(s=>s.passed).length,runnableSchemas.length),endToEndCoverage:ratio(schemas.filter(s=>s.passed).length,rows.length),probes:ratio(schemas.flatMap(s=>s.cases).filter(c=>c.passed).length,schemas.flatMap(s=>s.cases).length),inputMetaSchema:ratio(schemas.filter(s=>s.inputWellFormed).length,schemas.length),outputMetaSchema:ratio(schemas.filter(s=>s.outputWellFormed).length,schemas.length),returnedOutputConformance:ratio(returns.filter(a=>a.execution.outputConforms).length,returns.length),missingSchemas:rows.filter(a=>!a.schema).length},execution:{attempted:attempted.length,success:ratio(passed,attempted.length),endToEndCoverage:ratio(passed,rows.length),blocked:rows.filter(a=>a.execution.status==='blocked').length,missing:rows.filter(a=>a.execution.status==='missing').length,infrastructureErrors:rows.filter(a=>a.execution.status==='infrastructure-error').length,notRun:rows.filter(a=>a.execution.status==='not-run').length}};
const ready=!staticOnly&&aggregate.discovery.falseNegatives===0&&aggregate.discovery.falsePositives===0&&aggregate.runnableDiscovery.recall===1&&aggregate.schema.matchedActions.rate===1&&aggregate.execution.endToEndCoverage.rate===1;
const report={formatVersion:1,scoringVersion:SCORING_VERSION,measuredAt:new Date().toISOString(),staticOnly,environment:{node:process.version,platform:process.platform,arch:process.arch},sourceSnapshot:before,method:gold.labelMethod,limitations:['Same-agent source review on development samples; no independent adjudication or holdout estimate.','Semantic operation precision/recall merges duplicate bindings and reusable route variants. All blocked/missing operations remain in recall denominator.','Execution tests one positive scenario for every runnable operation; does not exhaust branches, route variants, auth roles, negative cases, or real backend integration.','HTTP backends are deterministic local fixtures; older examples use their original fake backend. No production API or account used.','Schema score is finite input contract and probe conformance, not proof of equivalence. Output measures schema validity and successful return conformance, not domain-result schemas.','Benchmark-only in-memory approvals allow every runnable match; these are not distribution approvals.'],aggregate,releaseReady:ready,projects};
mkdirSync('artifacts/evaluation',{recursive:true});
// Inputs contain only synthetic data; redact passwords/tokens in evidence and failing probes before saving.
writeFileSync('artifacts/evaluation/latest.json',JSON.stringify(redact(report),null,2)+'\n');
const pct=(value:number|null)=>value===null?'n/a':`${(value*100).toFixed(1)}%`;
const table=projects.map(p=>{const attempted=p.actions.filter((a:any)=>['passed','failed'].includes(a.execution.status));const pass=attempted.filter((a:any)=>a.execution.status==='passed').length;const schemas=p.actions.filter((a:any)=>a.schema);return `| ${p.id} | ${p.goldOperations} | ${p.discovery.truePositives}/${p.goldOperations} | ${p.runnableDiscovery.truePositives}/${p.goldOperations} | ${schemas.filter((a:any)=>a.schema.passed).length}/${schemas.length} | ${pass}/${attempted.length} | ${pass}/${p.goldOperations} |`;}).join('\n');
const markdown=`# Ground-truth evaluation\n\nMeasured ${report.measuredAt}. Ground truth SHA-256: \`${before.groundTruth}\`.\n\nProvisional source-reviewed development corpus; same agent authored labels and implemented the compiler. No independent adjudication or held-out accuracy claim.\n\n| Project | Gold operations | Discovered | Runnable | Correct input contracts / matched | Execution passed / attempted | Verified / all gold |\n|---|---:|---:|---:|---:|---:|---:|\n${table}\n\n- Discovery precision: **${pct(aggregate.discovery.precision)}** (${aggregate.discovery.truePositives} TP, ${aggregate.discovery.falsePositives} FP); recall: **${pct(aggregate.discovery.recall)}**. Blocked findings count as discovered only.\n- Runnable precision: **${pct(aggregate.runnableDiscovery.precision)}**; runnable recall: **${pct(aggregate.runnableDiscovery.recall)}**.\n- Input contract correctness: **${pct(aggregate.schema.matchedActions.rate)}** (${aggregate.schema.matchedActions.passed}/${aggregate.schema.matchedActions.total} matched actions); probe agreement **${pct(aggregate.schema.probes.rate)}** (${aggregate.schema.probes.passed}/${aggregate.schema.probes.total}).\n- Input/output schema documents are meta-schema valid: ${aggregate.schema.inputMetaSchema.passed}/${aggregate.schema.inputMetaSchema.total} and ${aggregate.schema.outputMetaSchema.passed}/${aggregate.schema.outputMetaSchema.total}. Successful tool-return schema conformance: ${aggregate.schema.returnedOutputConformance.passed}/${aggregate.schema.returnedOutputConformance.total}.\n- Execution success: **${pct(aggregate.execution.success.rate)}** (${passed}/${attempted.length} attempted); verified end-to-end coverage: **${pct(aggregate.execution.endToEndCoverage.rate)}** (${passed}/${rows.length} gold operations).\n- Blocked: ${aggregate.execution.blocked}; missing: ${aggregate.execution.missing}; infrastructure errors: ${aggregate.execution.infrastructureErrors}.\n- Raw emissions: ${aggregate.discovery.rawEmissions}, including ${aggregate.discovery.duplicateEmissions} duplicate route/template representations.\n- Comprehensive-support release gate: **${ready?'PASS':'FAIL'}**.\n\n## Failures and gaps\n\n${rows.filter(a=>a.classification!=='runnable'||!a.schema?.passed||a.execution.status!=='passed').map(a=>`- **${a.id}**: ${a.classification}; schema ${a.schema?(a.schema.passed?'passes':'fails'):'missing'}; execution ${a.execution.status}.${a.execution.reason?' '+a.execution.reason.replace(/\n/g,' ').slice(0,350):''}${a.schema&&!a.schema.passed?' Failed checks: '+[...(!a.schema.fieldsCorrect?['input property set']:[]),...(!a.schema.requiredCorrect?['required property set']:[]),...a.schema.cases.filter((c:any)=>!c.passed).map((c:any)=>c.name)].join(', '):''}`).join('\n')}\n\n## Limits\n\n${report.limitations.map(l=>'- '+l).join('\n')}\n\nFull per-action evidence, source snapshots, schemas checks, probes and execution failures: [latest.json](latest.json).\n`;
writeFileSync('artifacts/evaluation/REPORT.md',markdown);
console.log(JSON.stringify({aggregate,releaseReady:ready},null,2));

if(aggregate.execution.infrastructureErrors>0)process.exitCode=1;
