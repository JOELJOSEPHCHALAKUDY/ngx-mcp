import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {digest,treeDigest,evaluationDigest,evaluationInputs} from './metrics.js';
try{
  // The measured app trees/commits/locks must still match the independent frozen source manifests.
  execFileSync(process.execPath,['tooling/fetch-fresh.mjs','--verify'],{stdio:'inherit'});
  const report=JSON.parse(readFileSync('artifacts/evaluation/fresh/latest.json','utf8'));
  assert.deepEqual(report.sourceSnapshot,{...evaluationInputs(),compiler:treeDigest('src'),evaluator:evaluationDigest(),catalog:digest(readFileSync('evaluation/fresh/projects.json'))},'Fresh-project evaluation is stale; rerun npm run benchmark:fresh');
  assert.equal(report.usableWithinTestedScope,true,'Fresh-project usability checks failed; inspect artifacts/evaluation/fresh/REPORT.md');
  assert.deepEqual(report.projects.map((project:any)=>project.id),['modern-store','jira-clone','todomvc-angular21']);
  for(const project of report.projects){
    const evidence=project.evidence;
    const directory=`evaluation/fresh/${project.id}`;for(const line of readFileSync(`${directory}/FREEZE.sha256`,'utf8').trim().split(/\r?\n/)){const [expected,name]=line.split(/  +/);assert.equal(digest(readFileSync(`${directory}/${name}`)),expected,'Frozen source provenance changed: '+name);}
    assert.equal(digest(readFileSync(`evaluation/fresh/${project.id}/labels.json`)),evidence.frozenLabelsSha256,'Frozen source labels changed');
    assert.equal(digest(readFileSync(evidence.runtime)),evidence.runtimeSha256,'Runtime evidence changed');
    if(evidence.adjudications)assert.equal(digest(readFileSync(evidence.adjudications)),evidence.adjudicationsSha256,'Scope adjudications changed');
    if(evidence.static)assert.equal(digest(readFileSync(evidence.static)),evidence.staticSha256,'Schema evidence changed');
    if(evidence.provenance)assert.equal(digest(readFileSync(evidence.provenance)),evidence.provenanceSha256,'Provenance changed');
    if(evidence.mappings){assert.equal(digest(readFileSync(evidence.mappings)),evidence.mappingsSha256,'Argument mappings changed');const mappings=JSON.parse(readFileSync(evidence.mappings,'utf8'));assert.deepEqual(project.argumentMappings,mappings.mappings,'Rollup mappings disagree with recorded source mappings');}
    for(const entry of evidence.evaluatorFiles??[])assert.equal(digest(readFileSync(`evaluation/fresh/${project.id}/${entry.path}`)),entry.sha256,'Replay evaluator changed');
  }
  console.log('Fresh-project tested-scope gate passed. Frozen strict mismatches, argument mappings and unsupported Angular4 remain disclosed. No publication performed.');
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
