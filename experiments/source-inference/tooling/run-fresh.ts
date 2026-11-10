// Repeat the source-frozen public-project measurements. This never publishes or edits app source.
import assert from 'node:assert/strict';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {Ajv} from 'ajv';
import {ensureLocalApp} from '../src/local-app.js';
import type {Sample} from '../src/samples.js';
import {digest,treeDigest,evaluationDigest,evaluationInputs} from '../evaluation/metrics.js';

const root=process.cwd(),directory='artifacts/evaluation/fresh';
mkdirSync(directory,{recursive:true});
const json=(path:string)=>JSON.parse(readFileSync(path,'utf8'));
const catalog=json('evaluation/fresh/projects.json');
const snapshot=()=>({...evaluationInputs(),compiler:treeDigest('src'),evaluator:evaluationDigest(),catalog:digest(readFileSync('evaluation/fresh/projects.json'))});
execFileSync(process.execPath,['tooling/fetch-fresh.mjs','--verify'],{cwd:root,stdio:'inherit'});
const before=snapshot();
async function run(script:string,args:string[]=[],env:NodeJS.ProcessEnv={}){
  await new Promise<void>((done,reject)=>{
    const child=spawn(process.execPath,['--import','tsx',script,...args],{cwd:root,stdio:'inherit',env:{...process.env,FRESH_FINAL:'1',...env}});
    child.once('error',reject);child.once('exit',code=>code===0?done():reject(new Error(`${script} exited ${code}`)));
  });
}
const projects:any[]=[];
for(const id of ['modern-store','jira-clone']){
  const fixture=catalog.fixtures.find((entry:any)=>entry.id===id);assert(fixture);
  const labels=json(`evaluation/fresh/${id}/labels.json`);
  const staticPath=`${directory}/${id}-static.json`,runtimePath=`${directory}/${id}-runtime.json`;
  let server:ChildProcess|undefined;
  try{
    server=await ensureLocalApp({id:fixture.destination.split('/').at(-1),subdirectory:fixture.subdirectory,angularProject:fixture.angularProject,port:fixture.port} as Sample);
    await run('tooling/fresh-evaluate.ts',[id,staticPath]);
    await run(`evaluation/fresh/${id}/compiler-checks.ts`,[`http://127.0.0.1:${fixture.port}`,runtimePath]);
  }finally{server?.kill();}
  const stat=json(staticPath),runtime=json(runtimePath),audit=json(`evaluation/fresh/${id}/adjudications.json`);
  assert.equal(audit.frozenLabelsSha256,digest(readFileSync(`evaluation/fresh/${id}/labels.json`)),'Scope adjudication refers to different labels');
  for(const decision of audit.scopeDecisions)assert(labels.exclusions.some((exclusion:any)=>exclusion.id===decision.frozenExclusionId),'Scope exclusion has no frozen inventory basis');
  assert.equal(runtime.validForFinalGate,true);assert.equal(runtime.compilerDigest,before.compiler);
  assert.equal(stat.compilerDigest,before.compiler);
  assert.equal(runtime.labelsSha256,digest(readFileSync(`evaluation/fresh/${id}/labels.json`)));
  assert.equal(runtime.evaluationSource.harness,digest(readFileSync('evaluation/fresh/harness.ts')));
  assert.equal(runtime.evaluationSource.projectChecks,digest(readFileSync(`evaluation/fresh/${id}/compiler-checks.ts`)));
  const excluded=(candidate:any)=>audit.scopeDecisions.some((decision:any)=>decision.component===candidate.component&&decision.handler===candidate.handler&&decision.classification==='out-of-scope-transient-ui');
  const unresolved=stat.unknown.filter((candidate:any)=>!excluded(candidate));
  // Keep frozen scores intact. Audit explains only this exact known validator mismatch.
  const emailAudit=id==='modern-store'?json('evaluation/fresh/modern-store/email-audit.json'):undefined;
  const audited=stat.actions.filter((action:any)=>!action.businessSchema?.passed&&['session-sign-in','session-sign-up'].includes(action.id)&&action.businessSchema.fieldsCorrect&&action.businessSchema.requiredCorrect&&action.businessSchema.inputWellFormed&&action.businessSchema.outputWellFormed&&action.businessSchema.cases.filter((test:any)=>!test.passed).every((test:any)=>{
    const observed=emailAudit?.results.find((row:any)=>row.value===test.input.email);
    return test.name==='single-label email domain email'&&test.accepted===false&&test.actualAccepted===true&&observed?.nativeValid===true&&observed?.angularValid===true&&observed?.ajvFullFormatEmail===false;
  }));
  const tp=stat.totals.discovered,rawFp=stat.totals.unmatchedRunnable;
  projects.push({id,gold:labels.actions.length,discovery:{truePositives:tp,falseNegatives:labels.actions.length-tp,rawFalsePositives:rawFp,rawPrecision:tp/(tp+rawFp),precisionUnits:'Semantic gold operations vs unique component.handler unknown operations; UI state operations retained before explicit scope adjudication',rawEmissionCounts:{runnable:stat.totals.rawRunnableEmissions,matched:stat.totals.matchedRunnableEmissions,unmatched:stat.totals.unmatchedRunnableEmissions,precision:stat.totals.rawRunnableEmissions?stat.totals.matchedRunnableEmissions/stat.totals.rawRunnableEmissions:null},backendOnlyUnknownOperations:stat.totals.backendOnlyUnmatchedOperations,scopedFalsePositives:unresolved.length,scopedPrecision:tp/(tp+unresolved.length),recall:tp/labels.actions.length,explicitScopeExclusions:stat.unknown.filter(excluded).map((candidate:any)=>{const decision=audit.scopeDecisions.find((entry:any)=>entry.component===candidate.component&&entry.handler===candidate.handler);return {...candidate,frozenExclusionId:decision.frozenExclusionId,reason:decision.reason,evidence:decision.evidence};}),unresolved},schema:{raw:stat.totals.correctSchemas,businessWithoutRouteContext:stat.totals.correctBusinessSchemas,total:labels.actions.length,auditedLabelApproximations:audited.map((a:any)=>a.id),sourceCompatibleFiniteChecks:stat.totals.correctBusinessSchemas+audited.length},execution:runtime.counts,evidence:{static:staticPath,runtime:runtimePath,staticSha256:digest(readFileSync(staticPath)),runtimeSha256:digest(readFileSync(runtimePath)),frozenLabelsSha256:stat.labelsDigest,sourceCommit:runtime.sourceCommit,adjudications:`evaluation/fresh/${id}/adjudications.json`,adjudicationsSha256:digest(readFileSync(`evaluation/fresh/${id}/adjudications.json`))}});
}
const modernDirectory='evaluation/fresh/todomvc-angular21',modernFixture=catalog.fixtures.find((entry:any)=>entry.id==='todomvc-angular21');assert(modernFixture);
await run(`${modernDirectory}/mcp-runtime.mts`,[],{HOLDOUT_SOURCE_DIR:resolve(root,modernFixture.destination,modernFixture.subdirectory),HOLDOUT_REPO_DIR:resolve(root,modernFixture.destination),HOLDOUT_ARTIFACT_DIR:resolve(root,modernDirectory),HOLDOUT_SERVER_MODE:'managed'});
const modern=json(`${modernDirectory}/replay-runtime-results.json`),provenance=json(`${modernDirectory}/replay-provenance.json`),mappingArtifact=json(`${modernDirectory}/replay-input-mappings.json`),modernLabels=json(`${modernDirectory}/labels.json`);
assert.equal(mappingArtifact.frozenLabelsModified,false);
for(const operation of modernLabels.operations){const exact=modern.baseline.find((row:any)=>row.id===operation.id),native=modern.compilerNative.find((row:any)=>row.id===operation.id);assert.deepEqual(exact?.args,operation.validInput,'Modern exact frozen payload was rewritten');const mapping=mappingArtifact.mappings[operation.id];if(mapping)assert.deepEqual(mapping.source,operation.validInput,'Recorded mapping source differs from frozen input');assert.deepEqual(native?.args,mapping?.compilerNative??operation.validInput,'Compiler-native payload differs from recorded mapping');}
for(const entry of provenance.evaluatorFiles)assert.equal(digest(readFileSync(`${modernDirectory}/${entry.path}`)),entry.sha256,'Modern replay evaluator changed');
assert.equal(modern.validForFinalGate,true);assert.equal(modern.compilerTreeDigestBefore,before.compiler);assert.equal(modern.compilerTreeDigestAfter,before.compiler);
const ajv=new Ajv({strict:false,allErrors:true});
const outputConformance=modern.compilerNative.map((row:any)=>({id:row.id,passed:row.tools?.length===1&&ajv.validateSchema(row.tools[0].inputSchema)&&ajv.validateSchema(row.tools[0].outputSchema)&&ajv.compile(row.tools[0].outputSchema)(row.result?.structuredContent)}));
const exactSchemas=modern.baseline.map((row:any)=>({id:row.id,accepted:row.tools?.length===1&&ajv.compile(row.tools[0].inputSchema)(row.args)}));
projects.push({id:'todomvc-angular21',gold:7,execution:{exactFrozen:modern.totals.exactBaselineEffects,compilerNative:modern.totals.compilerNativeEffects,boundaries:modern.totals.boundariesPassed},schema:{exactRepresentativeInputs:exactSchemas.filter((row:any)=>row.accepted).length,total:7,scope:'Representative acceptance only; source-name/semantic mappings remain separate. No full equivalence claim.'},outputConformance,evidence:{runtime:`${modernDirectory}/replay-runtime-results.json`,provenance:`${modernDirectory}/replay-provenance.json`,runtimeSha256:digest(readFileSync(`${modernDirectory}/replay-runtime-results.json`)),provenanceSha256:digest(readFileSync(`${modernDirectory}/replay-provenance.json`)),frozenLabelsSha256:digest(readFileSync(`${modernDirectory}/labels.json`)),evaluatorFiles:provenance.evaluatorFiles,mappings:`${modernDirectory}/replay-input-mappings.json`,mappingsSha256:digest(readFileSync(`${modernDirectory}/replay-input-mappings.json`))},argumentMappings:mappingArtifact.mappings,sourcePreconditions:mappingArtifact.sourcePreconditions});
assert.deepEqual(snapshot(),before,'Source or evaluator inputs changed during measurement');
const usableWithinTestedScope=projects.slice(0,2).every(p=>p.discovery.recall===1&&p.discovery.scopedFalsePositives===0&&p.schema.sourceCompatibleFiniteChecks===p.gold&&p.execution.success===p.gold)&&modern.totals.compilerNativeEffects===7&&modern.totals.boundariesPassed===4&&outputConformance.every((row:any)=>row.passed);
const report={formatVersion:1,measuredAt:new Date().toISOString(),sourceSnapshot:before,scope:'Reviewed local development-build workflows on three source-frozen public modern projects; after remediation these are development samples. This is not a new held-out accuracy estimate or production/backend guarantee.',usableWithinTestedScope,projects,unsupportedLegacy:{project:'sitepoint-todo',gold:4,referenceEffects:4,firstPassCompilerEffects:0,evidence:'evaluation/fresh/sitepoint-todo/UNSUPPORTED-SCOPE.md'},limits:['Original first-pass failures and frozen labels remain unchanged.','Runtime context is declared separately and fixture setup uses original UI.','Raw precision retains unlabelled transient UI predictions; scoped precision cites frozen inventory exclusions.','The two audited email mismatches remain failures in raw schema scores.','TodoMVC requires three documented mappings to use the generated tool schemas.','HTTP-free/local fixture effects do not establish production API correctness.']};
writeFileSync(`${directory}/latest.json`,JSON.stringify(report,null,2)+'\n');
const rows=projects.map(p=>p.id==='todomvc-angular21'?`| ${p.id} | ${p.gold} | ${p.execution.exactFrozen}/${p.gold} | ${p.execution.compilerNative}/${p.gold} | ${Object.keys(p.argumentMappings).length} explicit argument mappings; ${p.execution.boundaries} negative/boundary checks |`:`| ${p.id} | ${p.gold} | ${p.execution.success}/${p.gold} | ${p.execution.success}/${p.gold} | Raw schemas ${p.schema.raw}/${p.gold}; business schemas ${p.schema.businessWithoutRouteContext}/${p.gold} |`).join('\n');
writeFileSync(`${directory}/REPORT.md`,`# Public-project remediation measurement\n\nMeasured ${report.measuredAt}. Compiler SHA-256: \`${before.compiler}\`.\n\n${report.scope}\n\n| Project | Gold operations | Exact frozen business inputs + declared context | Generated-contract execution | Notes |\n|---|---:|---:|---:|---|\n${rows}\n\nTested-scope usability gate: **${usableWithinTestedScope?'PASS':'FAIL'}**. No publication performed.\n\n${projects.slice(0,2).map(p=>`- ${p.id}: raw semantic precision ${(p.discovery.rawPrecision*100).toFixed(1)}%, raw emission precision ${(p.discovery.rawEmissionCounts.precision*100).toFixed(1)}% (${p.discovery.rawEmissionCounts.matched}/${p.discovery.rawEmissionCounts.runnable}), scoped precision ${(p.discovery.scopedPrecision*100).toFixed(1)}%, recall ${(p.discovery.recall*100).toFixed(1)}%. Schema scores retain frozen-label mismatches; ${p.schema.auditedLabelApproximations.length} independently audited email approximations are explained separately.`).join('\n')}\n- The Angular4 legacy test remains recorded: original UI 4/4, generated effects 0/4. It is unsupported.\n\n${report.limits.map(value=>'- '+value).join('\n')}\n\nFull schemas, payloads, mappings, exact contexts, effects, source/evaluator hashes and failure history: [latest.json](latest.json). Original frozen first-pass evidence is in [fresh-baselines](../fresh-baselines) and [evaluation/fresh](../../../evaluation/fresh).\n`);
console.log(JSON.stringify({usableWithinTestedScope,projects:projects.map(p=>({id:p.id,execution:p.execution,schema:p.schema}))},null,2));
