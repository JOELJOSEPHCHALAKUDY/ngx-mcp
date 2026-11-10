import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const artifactRoot=dirname(fileURLToPath(import.meta.url));
const projectRoot=resolve(process.env.COMPILER_PROJECT_ROOT??process.cwd());
const sourceRoot=resolve(process.env.HOLDOUT_SOURCE_DIR??join(projectRoot,'test-apps/fresh-notes-manager'));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const safePath=(root,file)=>{
 assert.equal(typeof file,'string','Evidence paths must be strings');
 const absolute=resolve(root,file),part=relative(root,absolute);
 assert(part!==''&&!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep),'Evidence path escaped its root: '+file);
 return absolute;
};
const read=file=>readFileSync(safePath(artifactRoot,file));
const json=file=>JSON.parse(read(file).toString('utf8'));
const integrity=json('current-integrity.json');
assert.equal(integrity.formatVersion,1);assert.equal(integrity.kind,'integration-holdout-current-integrity');
assert.equal(integrity.projectId,'notes-manager-holdout');
assert(integrity.files&&typeof integrity.files==='object','Missing pinned evidence hashes');
for(const [file,expected]of Object.entries(integrity.files)){
 assert.match(expected,/^[a-f0-9]{64}$/,'Malformed evidence SHA: '+file);
 assert.equal(digest(read(file)),expected,'Changed evidence or evaluator: '+file);
}
for(const [file,expected]of Object.entries(integrity.projectFiles??{}))assert.equal(digest(readFileSync(safePath(projectRoot,file))),expected,'Changed shared evaluator or dependency lock: '+file);
for(const file of ['check.mjs','FREEZE.sha256','labels.json','inventory.json','source-manifest.json',integrity.currentReport,integrity.currentProvenance,integrity.nativeReference,integrity.currentEvaluator]){
 assert(Object.hasOwn(integrity.files,file),'Integrity sidecar must pin '+file);
}
for(const line of read('FREEZE.sha256').toString('utf8').trim().split('\n')){
 const match=/^([a-f0-9]{64})\s+(.+)$/.exec(line);assert(match,'Malformed freeze line');
 assert.equal(digest(read(match[2])),match[1],'Frozen artifact changed: '+match[2]);
}
const labels=json('labels.json'),inventory=json('inventory.json'),manifest=json('source-manifest.json');
assert.equal(digest(read('labels.json')),integrity.labelFreeze);
assert.equal(labels.commit,integrity.commit);assert.equal(inventory.commit,integrity.commit);assert.equal(manifest.commit,integrity.commit);
assert.equal(labels.repository,integrity.repository);assert.equal(inventory.repository,integrity.repository);assert.equal(manifest.repository,integrity.repository);
assert.equal(labels.methodology.sourceOnly,true);assert.equal(labels.methodology.projectCompilerOrIntegrationRunBeforeFreeze,false);
assert.equal(labels.methodology.projectGeneratedBridgeInspectedBeforeFreeze,false);assert.equal(labels.methodology.upstreamDependenciesPatched,false);
const manifestPaths=[];for(const file of manifest.files){
 assert.equal(digest(readFileSync(safePath(sourceRoot,file.file))),file.sha256,'Pinned app source changed: '+file.file);manifestPaths.push(file.file);
}
function walk(root,prefix){const files=[];for(const entry of readdirSync(safePath(root,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const file=prefix+'/'+entry.name;if(entry.isDirectory())files.push(...walk(root,file));else if(entry.isFile())files.push(file);else assert.fail('Unexpected source symlink or special file: '+file);}return files;}
assert.deepEqual(walk(sourceRoot,'src').sort(),manifestPaths.filter(file=>file.startsWith('src/')).sort(),'Original app has added or missing source files');
const current=json(integrity.currentReport),provenance=json(integrity.currentProvenance),native=json(integrity.nativeReference);
const sourceFiles=Object.fromEntries(walk(projectRoot,'src').map(file=>[file,digest(readFileSync(safePath(projectRoot,file)))]));
assert.deepEqual(sourceFiles,provenance.sourceFiles,'Current compiler source set or content differs from the executed run');
// This is metrics.treeDigest('src'): ordered relative file path, NUL, byte SHA, joined by newline.
const compilerTreeDigest=digest(Object.entries(sourceFiles).map(([file,hash])=>file+'\0'+hash).join('\n'));
assert.equal(compilerTreeDigest,integrity.compilerTreeDigest,'Stale current-source sidecar');
assert.equal(compilerTreeDigest,provenance.compilerTreeDigest,'Stale current-source provenance');
assert.equal(compilerTreeDigest,current.compilerTreeDigestBefore,'Report ran against different compiler source');
assert.equal(compilerTreeDigest,current.compilerTreeDigestAfter,'Source changed during the report run');
for(const [file,expected]of Object.entries(provenance.evaluatorFiles)){
 assert(Object.hasOwn(integrity.files,file),'Evaluator is not pinned by integrity sidecar: '+file);
 assert.equal(digest(read(file)),expected,'Evaluator changed after run: '+file);
}
assert.equal(digest(read(integrity.currentEvaluator)),current.evaluatorSha256,'Current report evaluator mismatch');
for(const previous of integrity.preservedPasses??[]){
 assert(Object.hasOwn(integrity.files,previous.report));assert(Object.hasOwn(integrity.files,previous.evaluator));
 assert.equal(json(previous.report).evaluatorSha256,digest(read(previous.evaluator)),'Preserved report evaluator changed: '+previous.report);
}
assert.equal(current.kind,integrity.reportKind);assert.equal(current.build,'passed');
assert.equal(current.instrumentation.angularVersion,inventory.versionsFromUpstreamLock['@angular/core']);
for(const field of ['sourceUnchangedBefore','sourceUnchangedAfter','compilerSourceUnchanged','validForFinalGate'])assert.equal(current[field],true,'Run integrity flag failed: '+field);
assert.equal(current.error,undefined);assert.equal(current.failureStage,undefined);
assert.equal(current.labelFreeze,integrity.labelFreeze);assert.equal(native.labelFreeze,integrity.labelFreeze);
const expectedCases=[...labels.positiveCases,...labels.boundaryCases].map(test=>test.id);
assert.equal(expectedCases.length,12);assert.equal(new Set(expectedCases).size,12);
const index=(cases,name)=>{assert(Array.isArray(cases),name+' cases missing');const map=new Map(cases.map(test=>[test.id,test]));assert.equal(map.size,cases.length,name+' duplicated case');assert.deepEqual([...map.keys()].sort(),expectedCases.slice().sort(),name+' missing or extra cases');return map;};
const nativeCases=index(native.cases,'Native reference'),mcpCases=index(current.cases,'MCP');
const addedFailures=[],upstreamFailures=[];let snapshotParity=0,passed=0,externalConfirmations=0;
for(const id of expectedCases){
 const original=nativeCases.get(id),result=mcpCases.get(id);
 assert.equal(typeof original.pass,'boolean');assert.equal(result.pass,original.pass,'MCP/native outcome differs: '+id);
 assert.equal(result.nativeReferencePass,original.pass,'Stale native outcome annotation: '+id);
 assert.equal(result.upstreamReferenceFailure,!original.pass,'Incorrect upstream failure annotation: '+id);
 if(result.pass)passed++;if(!original.pass)upstreamFailures.push(id);if(original.pass&&!result.pass)addedFailures.push(id);
 assert.deepEqual(result.before,original.before,'Fixture snapshot differs: '+id);
 assert.deepEqual(result.after,original.after,'Final DOM/localStorage differs: '+id);snapshotParity++;
 assert(result.calls.length>=2,'Missing actual MCP calls: '+id);
 for(const call of result.calls){assert.notEqual(call.response.isError,true,'MCP dispatch failed: '+id+'/'+call.name);if(!['angular_list_nodes','angular_describe_node'].includes(call.name)){assert.equal(call.response.structuredContent?.status,'ui-dispatched','Missing dispatch evidence: '+id+'/'+call.name);assert.equal(call.response.structuredContent?.businessStatus,'unknown','Dispatch is incorrectly claiming business success: '+id);}}
 if(id.startsWith('delete_')){
  assert.equal(result.dialogs?.length,1,'Missing native confirm decision: '+id);assert.equal(original.dialogs?.length,1);
  const dialog=result.dialogs[0];assert.equal(dialog.type,'confirm');assert.equal(dialog.message,original.dialogs[0].message);assert.equal(dialog.decision,id.endsWith('_cancel')?'dismiss':'accept');assert.equal(dialog.externalHumanStep,true,'Confirmation must remain external: '+id);externalConfirmations++;
 }
}
assert.deepEqual(upstreamFailures.sort(),['edit_selected','empty_text_allowed','long_title_truncated_only'].sort());
assert.deepEqual(addedFailures,[]);assert.deepEqual(current.additionalIntegrationFailures,[]);assert.deepEqual(provenance.additionalIntegrationFailures,[]);
assert.equal(passed,9);assert.equal(current.passed,passed);assert.equal(native.passed,passed);assert.equal(current.nativeReferencePassed,passed);assert.equal(provenance.frozenChecksPassed,passed);
for(const value of [current.total,current.executed,native.total,provenance.total,provenance.exactNativeSnapshotParity,snapshotParity])assert.equal(value,12);
assert.equal(externalConfirmations,4);
console.log(JSON.stringify({status:'passed',project:'notes-manager-holdout',compilerTreeDigest,frozenChecks:{passed,total:12,upstreamFailures},nativeDomStorageSnapshotParity:{matched:snapshotParity,total:12},addedIntegrationFailures:addedFailures,confirmations:{count:externalConfirmations,policy:'external human/UI decisions; not unattended MCP successes'},evidence:'current-source replay after development exposure; preserved first pass remains an instrumentation failure'},null,2));
