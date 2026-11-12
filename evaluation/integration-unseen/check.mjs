#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {catalog,directory,labels,readJson,hash,checkFreeze} from './fixtures.mjs';
import {validateProjectReports} from './evidence.mjs';
const root=resolve(process.env.ANGULAR_MCP_ROOT??process.cwd()),args=process.argv.slice(2);
process.chdir(root);
const file=args.includes('--summary')?resolve(args[args.indexOf('--summary')+1]):undefined;
const pointer=file?undefined:readJson(resolve(directory,'latest-measurement.json')),summaryPath=file??resolve(directory,pointer.path);
if(pointer)assert.equal(hash(readFileSync(summaryPath)),pointer.sha256,'Measurement summary changed');
const summary=readJson(summaryPath),digests=await import(pathToFileURL(resolve(root,'evaluation/digest.mjs')).href);
assert(!summary.infrastructureError,summary.infrastructureError);
assert.equal(summary.compilerStable,true);assert.equal(summary.compilerDigestBefore,summary.compilerDigestAfter,'Compiler changed during measurement');
assert.equal(summary.compilerDigestAfter,digests.treeDigest('src'),'Integration measurement is stale');
assert.equal(summary.evaluatorStable,true);assert.deepEqual(summary.evaluatorFilesBefore,summary.evaluatorFilesAfter,'Evaluator changed during measurement');
const requiredEvaluators=['../digest.mjs','fixtures.mjs','cases.mjs','oracles.mjs','run.mjs','mcp-driver.mjs','catalog.mjs','evidence.mjs','measure.mjs','check.mjs','fetch.mjs','serve.mjs'];
for(const name of requiredEvaluators)assert.equal(summary.evaluatorFilesAfter[name],hash(readFileSync(resolve(directory,name))),'Missing or changed evaluator: '+name);
assert.equal(summary.projects.length,3);assert.equal(summary.goldPositiveScenarios,35);assert.equal(summary.goldNegativeOrBoundaryCases,21);
let positive=0,negative=0,notApplicable=0;const allGaps=[];
for(const project of catalog.projects){
 const entry=summary.projects.find(item=>item.id===project.id);assert(entry);assert.equal(entry.serversStopped,true);await checkFreeze(project.id,entry.source);
 const gold=labels(project.id),reports={};
 for(const phase of ['reference','raw','ui']){
  const evidence=entry.evidence[phase],path=resolve(directory,evidence.path);assert.equal(hash(readFileSync(path)),evidence.sha256,'Changed report '+path);
  const report=reports[phase]=readJson(path);assert.equal(report.harnessStable,true);assert.deepEqual(report.harnessSha256,report.harnessSha256After,'Report evaluator changed mid-run');
  for(const name of ['../digest.mjs','run.mjs','fixtures.mjs','cases.mjs','oracles.mjs','mcp-driver.mjs','catalog.mjs','evidence.mjs'])assert.equal(report.harnessSha256After[name],summary.evaluatorFilesAfter[name],'Report used a different evaluator: '+name);
  if(phase!=='reference'){assert.equal(report.compilerStable,true);assert.equal(report.compilerDigestBefore,report.compilerDigestAfter);assert.equal(report.compilerDigestAfter,summary.compilerDigestAfter);assert.equal(report.projects[0].stage.runtimeSha256,entry.runtimeModuleSha256);}
 }
 const quality=validateProjectReports(project,gold,reports,{requireParity:args.includes('--require-parity')});allGaps.push(...quality.gaps);positive+=quality.nativePositivePassed;negative+=quality.nativeNegativePassed;notApplicable+=quality.nativeProtocolNotApplicable;
 if(project.id==='shopping'){
  const adjudication=readJson(resolve(directory,'shopping/avatar-reference-adjudication.json')),manifest=readJson(resolve(directory,'shopping/source-manifest.json'));
  assert.equal(summary.evaluatorFilesAfter['shopping/avatar-reference-adjudication.json'],hash(readFileSync(resolve(directory,'shopping/avatar-reference-adjudication.json'))),'Source adjudication is not pinned by measurement');
  assert.equal(adjudication.case,'shopping/profile-avatar');assert.equal(adjudication.frozenInputUnchanged,true);assert.equal(adjudication.nativeReferenceStatus,'blocked-source-ui-for-frozen-fixture');
  assert.deepEqual(adjudication.evidence.naturalImageSize,[1,1]);assert.equal(adjudication.evidence.syntheticProfileMutationRequests,0);assert.match(adjudication.evidence.consoleError,/drawImage/i);
  const source=adjudication.evidence.source.replace(/:\d+$/,'');assert.equal(adjudication.evidence.sourceSha256,manifest[source]);
  const avatar=reports.reference.projects[0].cases.find(test=>test.id==='profile-avatar');assert(!avatar.network?.some(request=>request.path==='/api/profil'&&!['GET','HEAD'].includes(request.method)),'Source-blocked avatar unexpectedly mutated profile');
 }
}
assert.equal(positive,34,'Native positive quality is vacuous or regressed');assert.equal(negative,19,'Native negative quality regressed');assert.equal(notApplicable,2,'Exactly two native-only protocol exclusions are allowed');
assert.equal(summary.nativeParity,allGaps.length===0);
console.log(JSON.stringify({integrity:'passed',nativeParity:allGaps.length===0,goldPositiveScenarios:35,goldNegativeOrBoundaryCases:21,nativeQuality:{positivePassed:positive,negativePassed:negative,protocolNotApplicable:notApplicable,sourceBlocked:['shopping/profile-avatar']},mcpOnlyBoundaries:'both required in raw and UI phases',parityGaps:allGaps,scope:'Current development evidence with fixed source-native denominator; no production or exhaustive-schema claim.'},null,2));
