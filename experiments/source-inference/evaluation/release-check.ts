import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {digest,treeDigest,evaluationDigest,evaluationInputs} from './metrics.js';
import {samples,sampleDirectory} from '../src/samples.js';
try{
 const report=JSON.parse(readFileSync('artifacts/evaluation/latest.json','utf8'));
 const current={...evaluationInputs(),compiler:treeDigest('src'),evaluator:evaluationDigest(),registry:digest(readFileSync('samples/projects.json')),groundTruth:digest(readFileSync('evaluation/ground-truth.json')),apps:Object.fromEntries(samples.map(s=>[s.id,treeDigest(resolve(sampleDirectory(s),'src'))]))};
 assert.deepEqual(report.sourceSnapshot,current,'Evaluation is stale; rerun npm run benchmark');
 assert.equal(report.staticOnly,false,'A static-only evaluation is not a release measurement');
 const a=report.aggregate;
 const gaps=[a.discovery.falsePositives&&`${a.discovery.falsePositives} false positives`,a.discovery.falseNegatives&&`${a.discovery.falseNegatives} missing operations`,a.execution.blocked&&`${a.execution.blocked} blocked operations`,a.schema.matchedActions.passed!==a.schema.matchedActions.total&&`${a.schema.matchedActions.total-a.schema.matchedActions.passed} incorrect input contracts`,a.execution.success.passed!==a.goldOperations&&`${a.goldOperations-a.execution.success.passed} operations without verified successful execution`,a.execution.infrastructureErrors&&`${a.execution.infrastructureErrors} infrastructure errors`].filter(Boolean);
 assert.equal(gaps.length,0,`Release blocked: ${gaps.join('; ')}. See artifacts/evaluation/REPORT.md`);
 assert.equal(report.releaseReady,true);
 console.log('Ground-truth comprehensive-support release gate passed. No publication performed.');
}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
