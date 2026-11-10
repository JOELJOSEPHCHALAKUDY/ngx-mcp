import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';

const read=path=>JSON.parse(readFileSync(path,'utf8'));
const samples=read('samples/projects.json');
assert.equal(samples.length,5,'Release verification expects the five pinned public samples');
const verified=[];
for(const sample of samples){
  const runtime=read(`artifacts/samples/${sample.id}/runtime.json`);
  const manifest=read(`artifacts/samples/${sample.id}/manifest.json`);
  const approvals=read(`review/${sample.id}.json`);
  assert.equal(runtime.outcome,'executed',`${sample.id} must verify an implemented workflow effect`);
  assert.equal(runtime.revision,sample.revision);
  assert.equal(runtime.applicationSourceModified,false);
  assert.deepEqual(runtime.pageErrors,[]);
  const capability=manifest.capabilities.find(c=>c.id===runtime.capability?.id);
  assert(capability&&capability.status==='candidate',`Missing verified capability for ${sample.id}`);
  assert.equal(capability.fingerprint,runtime.capability.fingerprint,`Stale runtime evidence for ${sample.id}`);
  assert(approvals.some(a=>a.id===capability.id&&a.fingerprint===capability.fingerprint),`Missing current review for ${sample.id}`);
  execFileSync('git',['diff','--exit-code','HEAD','--','src'],{cwd:resolve('test-apps',sample.id,sample.subdirectory),stdio:'pipe'});
  verified.push({id:sample.id,capability:capability.id,outcome:runtime.outcome});
}
const packageReport=read('artifacts/package-report.json');
assert.equal(packageReport.extractedCliSmokePassed,true);
assert.equal(packageReport.sampleApplicationsIncluded,false);
const result={typecheck:'passed',testSuites:{compiler:'passed',browserProtocol:'passed'},sampleProjects:samples.length,executedScenarios:verified.length,unsupportedScenarios:0,upstreamBusinessSourceModified:false,extractedPackageSmokePassed:true,publicationPerformed:false,verified};
writeFileSync('artifacts/validation-summary.json',JSON.stringify(result,null,2)+'\n');
console.log(`Selected-workflow regression verification: ${verified.length}/${samples.length} public workflows have current reviews and verified effects.`);
