#!/usr/bin/env node
import assert from 'node:assert/strict';
import {existsSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {digest,treeDigest} from '../../digest.mjs';
import {assertFrozen} from './fixture.mjs';

const artifactRoot=dirname(fileURLToPath(import.meta.url));
const projectRoot=resolve(process.env.COMPILER_PROJECT_ROOT??process.cwd());
const {values}=parseArgs({options:{report:{type:'string'},provenance:{type:'string'}}});
for(const [name,value] of Object.entries(values))assert(value&&basename(value)===value&&value.endsWith('.json'),'Use an artifact filename for --'+name);
assert(values.report&&values.provenance,'Provide --report and a new --provenance filename');
const read=name=>readFileSync(join(artifactRoot,name));
const json=name=>JSON.parse(read(name).toString('utf8'));
assert(!existsSync(join(artifactRoot,values.provenance)),'Provenance is immutable; choose a new filename');
assertFrozen();
const previous=json('current-integrity.pre-archive.json'),report=json(values.report),native=json(previous.nativeReference);
const sourceFiles={};
function walk(path,prefix){for(const entry of readdirSync(path,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const relative=prefix+'/'+entry.name,file=join(path,entry.name);if(entry.isDirectory())walk(file,relative);else if(entry.isFile())sourceFiles[relative]=digest(readFileSync(file));else assert.fail('Unexpected source symlink or special file: '+relative);}}
walk(join(projectRoot,'src'),'src');
const compilerTreeDigest=treeDigest('src');
assert.equal(digest(Object.entries(sourceFiles).map(([file,sha])=>file+'\0'+sha).join('\n')),compilerTreeDigest);
assert.equal(report.compilerTreeDigestBefore,compilerTreeDigest,'A fresh replay is required; report used different source');
assert.equal(report.compilerTreeDigestAfter,compilerTreeDigest,'Compiler changed during replay');
assert.equal(report.evaluatorSha256,digest(read('mcp-runtime.mts')),'A fresh replay is required; evaluator changed');
for(const field of ['sourceUnchangedBefore','sourceUnchangedAfter','compilerSourceUnchanged','validForFinalGate'])assert.equal(report[field],true,field);
assert.equal(report.build,'passed');assert.equal(report.error,undefined);assert.equal(report.failureStage,undefined);
assert.equal(report.total,12);assert.equal(report.executed,12);assert.equal(report.passed,9);
assert.equal(report.labelFreeze,previous.labelFreeze);
assert.deepEqual(report.additionalIntegrationFailures,[]);
assert.deepEqual(report.cases.map(test=>test.id).sort(),native.cases.map(test=>test.id).sort());
for(const test of report.cases){const reference=native.cases.find(item=>item.id===test.id);assert.equal(test.pass,reference.pass,test.id);assert.deepEqual(test.before,reference.before,test.id);assert.deepEqual(test.after,reference.after,test.id);}
const evaluatorNames=['fixture.mjs','reference.mjs','mcp-runtime.mts','mcp-runtime.first-pass.mts','mcp-runtime.second-pass.mts','mcp-runtime.pre-archive.mts'];
const provenance={formatVersion:1,kind:'post-archive-current-source-provenance',compilerTreeDigest,sourceFiles,exactNativeSnapshotParity:12,total:12,frozenChecksPassed:9,additionalIntegrationFailures:[],evaluatorFiles:Object.fromEntries(evaluatorNames.map(name=>[name,digest(read(name))])),reason:'Fresh replay after archiving the source-inference prototype. Historical report digests and frozen app inputs remain unchanged.'};
const preservedPasses=[...previous.preservedPasses,{report:previous.currentReport,evaluator:previous.currentEvaluator}].map(entry=>{
 const expected=json(entry.report).evaluatorSha256;
 const evaluator=[entry.evaluator,'mcp-runtime.pre-archive.mts','mcp-runtime.second-pass.mts','mcp-runtime.first-pass.mts'].find(file=>existsSync(join(artifactRoot,file))&&digest(read(file))===expected);
 assert(evaluator,'Missing exact historical evaluator bytes for '+entry.report);
 return {report:entry.report,evaluator};
});
const files={};
for(const [name,expected] of Object.entries(previous.files)){
 const actual=digest(read(name));
 if(!['mcp-runtime.mts','check.mjs'].includes(name))assert.equal(actual,expected,'Historical evidence changed: '+name);
 files[name]=actual;
}
for(const name of ['mcp-runtime.pre-archive.mts','check.pre-archive.mjs','current-integrity.pre-archive.json','capture-current.mjs',values.report])files[name]=digest(read(name));
writeFileSync(join(artifactRoot,values.provenance),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
files[values.provenance]=digest(read(values.provenance));
const integrity={...previous,capturedAt:new Date().toISOString(),compilerTreeDigest,currentReport:values.report,currentProvenance:values.provenance,currentEvaluator:'mcp-runtime.mts',reportKind:report.kind,preservedPasses,files,projectFiles:Object.fromEntries(['evaluation/digest.mjs','package-lock.json'].map(file=>[file,digest(readFileSync(join(projectRoot,file)))])),migration:'Historical source-inference files moved outside the active package. Current source/evaluator claims come from a new execution, not rewritten historical report hashes.'};
writeFileSync(join(artifactRoot,'current-integrity.json'),JSON.stringify(integrity,null,2)+'\n');
console.log(JSON.stringify({captured:true,report:values.report,provenance:values.provenance,compilerTreeDigest,preservedHistoricalReports:preservedPasses.length},null,2));
