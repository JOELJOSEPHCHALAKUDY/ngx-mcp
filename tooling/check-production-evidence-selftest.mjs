#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {parseArgs} from 'node:util';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),cohort=join(root,'evaluation/production-fresh');
const {values}=parseArgs({options:{report:{type:'string'}}});
const read=path=>JSON.parse(readFileSync(path,'utf8')),hash=value=>createHash('sha256').update(value).digest('hex');
const originalPointer=values.report?read(resolve(values.report)+'.sha256.json'):read(join(cohort,'latest-matrix.json'));
const originalReport=values.report?resolve(values.report):resolve(cohort,originalPointer.report);
const checker=join(root,'tooling/check-production-evidence.mjs');
function run(report){return spawnSync(process.execPath,[checker,'--report',report],{cwd:root,encoding:'utf8',timeout:30000});}
const good=run(originalReport);assert.equal(good.status,0,'Current production evidence must pass before tamper checks:\n'+good.stderr);
const folder=mkdtempSync(join(tmpdir(),'ngx-mcp-production-evidence-tamper-')),reportPath=join(folder,'report.json'),completionPath=join(folder,'run-completion.json');
const baseline=read(originalReport),sourceCompletion=read(resolve(dirname(originalReport),originalPointer.completion.file)),sourceArtifacts=read(resolve(dirname(originalReport),originalPointer.artifactManifest.file));
const passed=[];
function write(report){
 const bytes=JSON.stringify(report,null,2)+'\n';writeFileSync(reportPath,bytes);
 const completion={...sourceCompletion,report:reportPath,sha256:hash(bytes)};writeFileSync(completionPath,JSON.stringify(completion,null,2)+'\n');
 const artifactPath=join(folder,'evidence-manifest.json'),artifacts={...sourceArtifacts,report:reportPath,sha256:hash(bytes)};writeFileSync(artifactPath,JSON.stringify(artifacts,null,2)+'\n');
 const pointer={...originalPointer,report:reportPath,sha256:hash(bytes),completion:{file:'run-completion.json',sha256:hash(readFileSync(completionPath))},artifactManifest:{file:'evidence-manifest.json',sha256:hash(readFileSync(artifactPath))}};
 writeFileSync(reportPath+'.sha256.json',JSON.stringify(pointer,null,2)+'\n');
}
function rejects(name,mutate,{resign=true}={}){
 write(structuredClone(baseline));const report=read(reportPath);mutate(report);if(resign)write(report);else writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
 const result=run(reportPath);assert.notEqual(result.status,0,'Integrity gate accepted '+name);assert.equal(result.signal,null,'Gate crashed/timed out instead of rejecting '+name);passed.push(name);
}
try{
 cpSync(dirname(originalReport),folder,{recursive:true});
 const relocated=run(reportPath);assert.equal(relocated.status,0,'Relocated packet must pass with historical absolute self-references:\n'+relocated.stderr);
 write(structuredClone(baseline));const copied=run(reportPath);assert.equal(copied.status,0,'Copied evidence must pass before tamper checks:\n'+copied.stderr);
 rejects('raw report bytes changed',report=>{report.scope+=' altered';},{resign:false});
 rejects('stale compiler source',report=>{report.compilerDigestBefore=report.compilerDigestAfter='0'.repeat(64);});
 rejects('stale frozen harness',report=>{report.harnessFilesBefore['run.mjs']=report.harnessFilesAfter['run.mjs']='0'.repeat(64);});
 rejects('stale root package lock',report=>{report.runtimeInputsBefore['package-lock.json']=report.runtimeInputsAfter['package-lock.json']='0'.repeat(64);});
 rejects('stale installed runtime version metadata',report=>{report.runtimeVersionsBefore.packages.jose.version=report.runtimeVersionsAfter.packages.jose.version='0.0.0';});
 rejects('missing resource closure',report=>{report.resourcesClosed=false;});
 rejects('infrastructure error hidden by passed totals',report=>{report.infrastructureError='Synthetic failure';});
 rejects('failed case hidden by passed totals',report=>{report.projects[0].builds[0].cases[0].status='failed';});
 rejects('missing business case hidden by passed totals',report=>{report.projects[0].builds[0].cases.pop();});
 rejects('changed business payload with passing flags and renewed pointers',report=>{report.projects[0].builds[0].cases.find(item=>item.id==='create_task').after['todo-items'][0].title='Incorrect synthetic title';});
 rejects('changed reviewed policy digest',report=>{report.projects[0].builds[0].policySha256='0'.repeat(64);});
 rejects('changed runtime digest',report=>{report.projects[0].builds[0].runtimeSha256='0'.repeat(64);});
 rejects('changed production output digest',report=>{report.projects[0].builds[0].outputDigest='0'.repeat(64);});
 console.log(JSON.stringify({integritySelfTest:'passed',validEvidenceAccepted:true,relocatedPacketAccepted:true,tamperedEvidenceRejected:passed.length,cases:passed},null,2));
}finally{rmSync(folder,{recursive:true,force:true});}
