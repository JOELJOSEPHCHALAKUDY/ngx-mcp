#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,statSync,realpathSync} from 'node:fs';
import {dirname,basename,resolve,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const evidence=join(root,'evaluation/production-fresh');
const {values}=parseArgs({options:{pointer:{type:'string'},report:{type:'string'}}});
const hash=value=>createHash('sha256').update(value).digest('hex');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const digestFile=path=>hash(readFileSync(path));
const equalSet=(actual,expected,message)=>assert.deepEqual(actual.slice().sort(),expected.slice().sort(),message);
const inside=(folder,file)=>{const path=resolve(folder,file),rel=relative(folder,path);assert(rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel),'Evidence path escapes its directory: '+file);return path;};
const boundFile=(folder,file)=>{const path=inside(folder,file);inside(realpathSync(folder),realpathSync(path));return path;};
// Match run.mjs exactly: raw SHA256 file bytes, then SHA256 of the sorted
// relative-file -> SHA256 JSON manifest. This differs from evaluation/digest.mjs.
function treeHash(folder){const files={};const walk=path=>{for(const name of readdirSync(path).sort()){const file=join(path,name);if(statSync(file).isDirectory())walk(file);else files[relative(folder,file)]=digestFile(file);}};walk(folder);return hash(JSON.stringify(files));}
function noError(value,name){for(const key of ['error','infrastructureError','analysisError','cleanupError','stack'])assert.equal(value[key],undefined,name+' contains '+key);}
function sameSourceCheck(check,info,manifest,labelsHash){assert(check,'Missing source preservation check: '+info.id);assert.equal(check.commit,info.commit);assert.equal(check.sourceFiles,Object.keys(manifest).length);assert.equal(check.labelsSha256,labelsHash);assert.equal(check.lockSha256,info.lockSha256);}
function assertOriginalSource(info,manifest){
 const source=resolve(process.env['PRODUCTION_SOURCE_'+info.id.toUpperCase()]??info.sourceDefault);
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),info.commit,'Upstream commit changed: '+info.id);
 for(const[name,digest]of Object.entries(manifest))assert.equal(digestFile(boundFile(source,name)),digest,'Upstream file changed: '+info.id+'/'+name);
 assert.equal(execFileSync('git',['ls-files','--others','--exclude-standard','--','src'],{cwd:source,encoding:'utf8'}).trim(),'','Untracked upstream source: '+info.id);
}
assert(!(values.report&&values.pointer),'Use either --report or --pointer');
function assertPostconditions(project,item,label,clock){
 const before=item.before,after=item.after,input=label.input,expected=label.expected;
 assert(before&&after&&typeof item.url==='string','Missing independent business evidence: '+project+'/'+item.id);
 const fields=(actual,wanted)=>{for(const[key,value]of Object.entries(wanted))assert.deepEqual(actual[key],value,'Business field mismatch: '+project+'/'+item.id+'/'+key);};
 if(project==='todo'){
  if(['create_task','empty_title_native_quirk'].includes(item.id))assert.deepEqual(after['todo-items'],[expected.storageAdded]);
  else if(item.id==='toggle_second_task')assert.deepEqual(after['todo-items'],[before['todo-items'][0],expected.storageChanged]);
  else if(item.id==='delete_second_task')assert.deepEqual(after['todo-items'],[before['todo-items'][0]]);
  else assert.fail('Unknown todo postcondition');
 }else if(project==='sprint'){
  if(item.id==='register_user'){
   assert.equal(after.users.length,1);const created=after.users[0];equalSet(Object.keys(created),['id','username','email','password','createdAt']);fields(created,expected.userFields);assert.equal(typeof created.id,'string');assert(created.id.length>0);assert.equal(created.createdAt,clock);assert.equal(after.currentUser,null);assert.equal(item.url,'/login');assert.deepEqual(after.projects,before.projects);assert.deepEqual(after.tasks,before.tasks);
  }else if(item.id==='login_user'){
   assert.deepEqual(after.currentUser,expected.currentUser);assert.deepEqual(after.users,before.users);assert.deepEqual(after.projects,before.projects);assert.deepEqual(after.tasks,before.tasks);assert.equal(item.url,'/dashboard');
  }else if(item.id==='create_project'){
   assert.equal(after.projects.length,before.projects.length+1);const created=after.projects.at(-1);equalSet(Object.keys(created),['id','name','description','ownerId','createdAt','updatedAt']);fields(created,expected.projectFields);assert.equal(typeof created.id,'string');assert(created.id.length>0);assert.equal(created.createdAt,clock);assert.equal(created.updatedAt,clock);assert.deepEqual(after.projects.slice(0,-1),before.projects);assert.deepEqual(after.tasks,before.tasks);assert.deepEqual(after.currentUser,before.currentUser);
  }else if(item.id==='create_task'){
   assert.equal(after.tasks.length,1);const created=after.tasks[0];equalSet(Object.keys(created),['id','title','description','status','projectId','dueDate','createdAt','updatedAt']);fields(created,expected.taskFields);assert.equal(typeof created.id,'string');assert(created.id.length>0);assert.equal(created.createdAt,clock);assert.equal(created.updatedAt,clock);assert.deepEqual(after.projects,before.projects);assert.deepEqual(after.currentUser,before.currentUser);
  }else if(['cancel_project','empty_project_blocked'].includes(item.id))assert.deepEqual(after,before);
  else assert.fail('Unknown sprint postcondition');
  if(item.id!=='register_user')assert.deepEqual(after.users,before.users);
 }else if(project==='expense'){
  const db=after['expense-tracker.v1'],previous=before['expense-tracker.v1'];
  if(label.kind==='negative-native')assert.deepEqual(db,previous,'Native invalid input must leave business storage unchanged');
  else if(item.id==='create_category')assert.deepEqual(db,{categories:[{id:expected.generatedCategoryId,...expected.categoryFields}],expenses:previous.expenses});
  else if(item.id==='create_expense'){assert.deepEqual(db,{categories:previous.categories,expenses:[expected.expenseFields]});assert.equal(item.url,'/expenses');}
  else if(item.id==='change_one_budget'){const wanted=structuredClone(previous);const target=wanted.categories.find(category=>category.id===input.categoryId);assert(target);target.monthlyBudgetOre=input.monthlyBudgetOre;assert.deepEqual(db,wanted);}
  else assert.fail('Unknown expense postcondition');
 }else assert.fail('Unknown postcondition project');
}

const pointerPath=values.report?resolve(values.report)+'.sha256.json':resolve(root,values.pointer??'evaluation/production-fresh/latest-matrix.json'),pointer=read(pointerPath);
assert.equal(pointer.formatVersion,1,'Unsupported production pointer format');
const reportPath=values.report?resolve(values.report):boundFile(evidence,pointer.report);
assert.equal(basename(pointer.report),basename(reportPath),'Pointer names another report');if(!isAbsolute(pointer.report))assert.equal(resolve(evidence,pointer.report),reportPath,'Pointer does not identify the requested report');
// Absolute report locations are immutable historical metadata. Portable packet
// identity is its raw SHA256; copies need not retain the author's checkout path.
let historicalReport=isAbsolute(pointer.report)?resolve(pointer.report):undefined;
function reportIdentity(value){assert.equal(typeof value,'string');assert.equal(basename(value),basename(reportPath),'Sidecar names another report');const normalized=resolve(evidence,value);if(historicalReport===undefined)historicalReport=normalized;assert.equal(normalized,historicalReport,'Sidecars disagree on historical report identity');}
const report=read(reportPath),runDirectory=dirname(reportPath);
assert.equal(pointer.sha256,digestFile(reportPath),'Production report bytes changed');
assert.equal(report.kind,'production-fresh-all-modes');
assert.equal(report.resourcesClosed,true,'Matrix browser resources were not closed');assert.equal(report.browserClosed,true);assert.equal(report.buildMatrixComplete,true);assert.equal(report.firstAttemptsAreImmutable,true);assert.equal(report.releaseReady,false,'Selected workflow evidence must not declare a general release certification');
noError(report,'Report');
const started=Date.parse(report.startedAt),finished=Date.parse(report.finishedAt);assert(Number.isFinite(started)&&Number.isFinite(finished)&&finished>started,'Matrix did not complete');
assert.equal(report.compilerStable,true);assert.equal(report.compilerDigestBefore,report.compilerDigestAfter);assert.equal(report.compilerDigestAfter,treeHash(join(root,'src')),'Production evidence is stale for the current compiler');
const harness=['projects.json','fixtures.mjs','reference.mjs','fetch.mjs','driver.mjs','access-fixture.mjs','run.mjs','evidence.mjs'];
assert.equal(report.harnessStable,true);assert.deepEqual(report.harnessFilesBefore,report.harnessFilesAfter);equalSet(Object.keys(report.harnessFilesAfter),harness,'Harness coverage is incomplete');
for(const file of harness)assert.equal(report.harnessFilesAfter[file],digestFile(boundFile(evidence,file)),'Fresh harness changed: '+file);
assert.equal(typeof report.evidenceRole,'string');assert(report.evidenceRole.includes('Regression'),'A replay must not be presented as newly unseen evidence');assert.equal(report.firstIntegrationAttempt.sha256,digestFile(boundFile(evidence,report.firstIntegrationAttempt.file)),'Preserved first attempt changed');
const runtimeFiles=['package.json','package-lock.json'];assert.equal(report.runtimeInputsStable,true,'Runtime inputs changed during execution');assert.deepEqual(report.runtimeInputsBefore,report.runtimeInputsAfter);equalSet(Object.keys(report.runtimeInputsAfter??{}),runtimeFiles,'Root runtime input coverage is incomplete');for(const file of runtimeFiles)assert.equal(report.runtimeInputsAfter[file],digestFile(join(root,file)),'Runtime package/lock evidence is stale: '+file);
const require=createRequire(join(root,'package.json')),entryPoints={'@modelcontextprotocol/sdk':'@modelcontextprotocol/sdk/client/index.js',jose:'jose',playwright:'playwright'},runtimeVersions={node:process.version,packages:{}};
for(const[name,entry]of Object.entries(entryPoints)){let folder=dirname(require.resolve(entry));for(;;){const file=join(folder,'package.json');let metadata;try{metadata=read(file);}catch{}if(metadata?.name===name){runtimeVersions.packages[name]={version:metadata.version,packageJsonSha256:digestFile(file)};break;}const parent=dirname(folder);assert.notEqual(parent,folder,'Could not locate installed runtime package metadata: '+name);folder=parent;}}
assert.deepEqual(report.runtimeVersionsBefore,report.runtimeVersionsAfter,'Runtime version metadata changed during execution');assert.deepEqual(report.runtimeVersionsAfter,runtimeVersions,'Runtime Node/package metadata is stale');
const catalog=read(join(evidence,'projects.json')),ids=['todo','sprint','expense'],modes=['mcp','webmcp','both'];
equalSet(catalog.projects.map(item=>item.id),ids,'Fresh project selection changed');equalSet(report.configuration.projects,ids);equalSet(report.configuration.modes,modes);equalSet(report.projects.map(item=>item.id),ids,'Project coverage is incomplete or duplicated');assert.equal(report.sourceClock,catalog.clock);
const expectedEvidence=['native-original.json','original-builds.json',...ids.flatMap(id=>['freeze.json','source-manifest.json','labels.json','inventory.json','LICENSE'].map(file=>id+'/'+file))];
equalSet(Object.keys(pointer.evidenceFiles??{}),expectedEvidence,'Frozen evidence pointer coverage is incomplete');
for(const file of expectedEvidence)assert.equal(pointer.evidenceFiles[file],digestFile(boundFile(evidence,file)),'Frozen evidence bytes changed: '+file);
assert(pointer.completion&&typeof pointer.completion.file==='string','Missing observed process completion evidence');
const completionPath=boundFile(runDirectory,pointer.completion.file),completion=read(completionPath);assert.equal(pointer.completion.sha256,digestFile(completionPath));assert.equal(completion.formatVersion,1);reportIdentity(completion.report);assert.equal(completion.sha256,pointer.sha256);assert.equal(completion.exitCode,0,'Matrix subprocess did not succeed');assert.equal(completion.browserCloseAwaited,true,'Browser close was not awaited');assert.equal(typeof completion.basis,'string');assert(completion.basis.includes('browser.close'),'Browser lifecycle basis is missing');
// Resource scope is the frozen runner awaiting browser.close and each fixture's
// server close; this does not assert an OS-wide process or socket leak scan.
assert.equal(report.originalSourcesUnchanged,true);
const nativePath=boundFile(evidence,report.nativeReference.file);assert.equal(report.nativeReference.file,'native-original.json');assert.equal(report.nativeReference.sha256,digestFile(nativePath));const native=read(nativePath);assert.equal(native.kind,'production-fresh-native-reference');assert.equal(native.resourcesClosed,true);assert.deepEqual(native.totals,{passed:16,total:16});equalSet(native.projects.map(item=>item.id),ids);
for(const[file,digest]of Object.entries(native.harnessSha256))assert.equal(digestFile(boundFile(join(evidence,'harness-snapshots/native-first-pass'),file)),digest,'Original native oracle changed: '+file);
equalSet(Object.keys(native.harnessSha256),['reference.mjs','fixtures.mjs']);
const baselines=read(join(evidence,'original-builds.json'));assert.equal(baselines.kind,'unchanged-production-build-baselines');equalSet(baselines.projects.map(item=>item.id),ids);for(const item of baselines.projects){assert.equal(item.installPassed,true);assert.equal(item.productionBuildPassed,true);}
const boundaryIds=['missing_auth','ungranted_source','expired_auth','revoked_auth','denied_source','denied_model_read','denied_value_read','denied_approval','wrong_subject','cross_session_target','audit_redaction'];
let builds=0,business=0,framework=0,positive=0,nativeBoundary=0;const stagingRoots=new Set();
for(const info of catalog.projects){
 const record=report.projects.find(item=>item.id===info.id),labels=read(join(evidence,info.id,'labels.json')),freeze=read(join(evidence,info.id,'freeze.json')),manifest=read(join(evidence,info.id,'source-manifest.json')),nativeProject=native.projects.find(item=>item.id===info.id);noError(record,info.id);assert.equal(record.commit,info.commit);
 equalSet(Object.keys(freeze.files),['source-manifest.json','labels.json','inventory.json','LICENSE']);for(const[file,digest]of Object.entries(freeze.files))assert.equal(digestFile(boundFile(join(evidence,info.id),file)),digest,'Frozen selection changed: '+info.id+'/'+file);
 sameSourceCheck(record.sourceCheckBefore,info,manifest,freeze.files['labels.json']);sameSourceCheck(record.sourceCheckAfter,info,manifest,freeze.files['labels.json']);assert.deepEqual(record.sourceCheckBefore,record.sourceCheckAfter);assertOriginalSource(info,manifest);
 for(const item of labels.cases)for(const source of item.evidence??[])assert.equal(manifest[source.file],source.sha256,'Ground truth source anchor changed: '+info.id+'/'+item.id);
 noError(nativeProject,'Native baseline '+info.id);assert.equal(nativeProject.originalProductionBuild,true);assert.equal(nativeProject.sourcePreserved,true);sameSourceCheck(nativeProject.integrityBefore,info,manifest,freeze.files['labels.json']);sameSourceCheck(nativeProject.integrityAfter,info,manifest,freeze.files['labels.json']);equalSet(nativeProject.cases.map(item=>item.id),labels.cases.map(item=>item.id));for(const item of nativeProject.cases){assert.equal(item.passed,true);assert.equal(item.productionRuntime.bridge,'undefined');assert.equal(item.productionRuntime.instrumented,0);assert.equal(item.productionRuntime.debug,'undefined');assertPostconditions(info.id,item,labels.cases.find(label=>label.id===item.id),catalog.clock);}
 equalSet(record.builds.map(item=>item.mode),modes,'Mode coverage missing: '+info.id);assert(record.analysis&&record.analysis.nodes>0);assert(Array.isArray(record.analysis.diagnostics)&&record.analysis.diagnostics.every(item=>item.category==='warning'),'Compiler analysis contains an error or unknown diagnostic category');
 for(const build of record.builds){
  builds++;const label=info.id+'/'+build.mode,folder=boundFile(runDirectory,label);noError(build,label);assert.equal(build.productionBuild,'passed');assert.equal(build.serverStopped,true,'Fixture server not closed: '+label);assert.equal(build.buildId,record.analysis.buildId);
  const stage=resolve(build.stage),stageParent=dirname(dirname(stage));assert.equal(stage,join(stageParent,info.id,build.mode),'Build staging path does not match project/mode');assert.match(stageParent,/[/]ngx-mcp-fresh-production-[0-9T-]+Z$/,'Unexpected build staging root');assert(['/tmp','/private/tmp'].includes(dirname(stageParent)),'Unexpected historical matrix staging root');stagingRoots.add(stageParent);
  assert.deepEqual(build.artifacts,{manifest:label+'/artifacts/ngx-mcp.integration.json',runtime:label+'/artifacts/ngx-mcp.generated.ts',browser:label+'/artifacts/browser'},'Portable build packet coverage is missing');const integrationPath=boundFile(runDirectory,build.artifacts.manifest),integration=read(integrationPath);assert.equal(build.manifestSha256,digestFile(integrationPath),'Generated manifest changed: '+label);assert.equal(integration.mode,build.mode);assert.equal(integration.profile,'production');assert.equal(integration.buildId,build.buildId);assert.deepEqual(integration.diagnostics,record.analysis.diagnostics,'Compiler diagnostics changed between analysis and production builds');assert.equal(integration.buildTarget,info.target);assert.equal(integration.angularVersion,info.angular);assert.equal(integration.typescriptVersion,info.typescript);assert.equal(integration.features.mcp,build.mode!=='webmcp');assert.equal(integration.features.webmcp,build.mode!=='mcp');
  const runtime=boundFile(runDirectory,build.artifacts.runtime);assert.equal(build.runtimeSha256,digestFile(runtime),'Generated production runtime changed: '+label);
  const output=boundFile(runDirectory,build.artifacts.browser);assert.equal(build.outputDigest,treeHash(output),'Production output bytes changed: '+label);
  const policy=read(join(folder,'reviewed-policy.json')),review=read(join(folder,'source-id-review.json'));assert.equal(build.policySha256,hash(JSON.stringify(policy)),'Reviewed policy changed: '+label);assert.equal(policy.buildId,build.buildId);assert.deepEqual(policy.policy.allowedOrigins,[build.origin]);assert.equal(policy.policy.version,1);assert.equal(integration.access.policySha256,hash(JSON.stringify(policy.policy)));assert.equal(integration.access.bootstrapSha256,digestFile(boundFile(dirname(folder),'trusted-bootstrap.ts')));assert.equal(build.reviewedSourceCount,review.length);assert(review.length>0);
  equalSet(policy.policy.rules.map(item=>item.sourceId),review.map(item=>item.sourceId));for(const item of review){const node=integration.nodes.find(node=>node.id===item.sourceId);assert(node,'Policy source does not exist in compiler manifest');assert.deepEqual(item.source,node.source);assert.deepEqual(policy.policy.rules.find(rule=>rule.sourceId===item.sourceId).operations,item.operations);assert.equal(manifest[item.source.file],integration.sourceHashes[item.source.file]);}
  for(const[file,digest]of Object.entries(integration.sourceHashes))assert.equal(digest,manifest[file],'Generated manifest source does not match upstream: '+label+'/'+file);
  const audit=read(join(folder,'trusted-audit.json')),approvals=read(join(folder,'trusted-approvals.json'));assert.equal(build.auditSha256,hash(JSON.stringify(audit)));assert.equal(build.auditEvents,audit.length);assert.equal(build.approvals,approvals.length);assert(audit.length>0&&approvals.length>0,'Missing successful audit/approval evidence: '+label);
  const paths=build.mode==='both'?['mcp','native']:[build.mode==='mcp'?'mcp':'native'];equalSet(build.cases.map(item=>item.path+':'+item.id),paths.flatMap(path=>labels.cases.map(item=>path+':'+item.id)),'Business cases missing or duplicated: '+label);equalSet(build.boundaries.map(item=>item.path+':'+item.id),paths.flatMap(path=>boundaryIds.map(id=>path+':'+id)),'Authorization boundaries missing or duplicated: '+label);
  for(const item of build.cases){business++;noError(item,label+'/'+item.path+'/'+item.id);assert.equal(item.status,'passed');const expected=labels.cases.find(entry=>entry.id===item.id);assert.equal(item.kind,expected.kind);const original=nativeProject.cases.find(value=>value.id===item.id);assert.deepEqual(item.before,original.before,'Instrumented input fixture differs from native baseline');assert.equal(item.url,original.url,'Instrumented outcome route differs from native baseline');assertPostconditions(info.id,item,expected,catalog.clock);if(item.kind==='negative-native')nativeBoundary++;else positive++;const mode=item.modeEvidence;assert.equal(mode.bridge,build.mode);assert.equal(mode.profile,'production');assert.equal(mode.access.ready,true);assert.equal(mode.ngDebug,'undefined');assert.equal(mode.access.buildId,build.buildId);if(build.mode==='mcp')assert.equal(mode.nativeTools.length,0);else{assert.equal(mode.nativeApi,'function');assert.deepEqual(mode.nativeBaseTools,mode.nativeExpectedNames,'Native generic tools differ from the policy-filtered set');assert(mode.nativeBaseTools.length>0);const baseNames=['angular_list_nodes','angular_describe_node','angular_read_model','angular_fill','angular_activate','angular_submit'];assert(mode.nativeBaseTools.every(name=>baseNames.includes(name)));assert.deepEqual(mode.nativeBaseTools,mode.nativeTools.filter(name=>baseNames.includes(name)).sort());assert.equal(mode.webmcpStatus,'active');assert.deepEqual(mode.webmcpErrors,[]);}assert(item.calls.some(call=>call.transport===item.path&&call.name?.startsWith('angular_')),'No actual transport invocation: '+label+'/'+item.id);}
  for(const item of build.boundaries){framework++;noError(item,label+'/'+item.path+'/'+item.id);assert.equal(item.status,'passed');assert.equal(item.kind,'framework-boundary');}
 }
}
const packetFiles={},cohortFiles={};
function add(map,base,name){map[name]=digestFile(boundFile(base,name));}
function collect(map,base,path){const folder=boundFile(base,path);const walk=directory=>{for(const name of readdirSync(directory).sort()){const file=join(directory,name);if(statSync(file).isDirectory())walk(file);else add(map,base,relative(base,file));}};walk(folder);}
for(const file of ['projects.json',...expectedEvidence])add(cohortFiles,evidence,file);
collect(cohortFiles,evidence,'baseline-logs');collect(cohortFiles,evidence,'harness-snapshots/native-first-pass');
for(const project of report.projects){add(packetFiles,runDirectory,project.id+'/trusted-bootstrap.ts');for(const build of project.builds){const prefix=project.id+'/'+build.mode+'/';for(const name of ['reviewed-policy.json','source-id-review.json','build.log','trusted-audit.json','trusted-approvals.json'])add(packetFiles,runDirectory,prefix+name);add(packetFiles,runDirectory,build.artifacts.manifest);add(packetFiles,runDirectory,build.artifacts.runtime);collect(packetFiles,runDirectory,build.artifacts.browser);}}
assert(pointer.artifactManifest&&typeof pointer.artifactManifest.file==='string','Missing portable artifact manifest');
const artifactPath=boundFile(runDirectory,pointer.artifactManifest.file),artifact=read(artifactPath);assert.equal(pointer.artifactManifest.sha256,digestFile(artifactPath),'Artifact manifest bytes changed');assert.equal(artifact.formatVersion,1);reportIdentity(artifact.report);assert.equal(artifact.sha256,pointer.sha256);assert.deepEqual(artifact.files,packetFiles,'Portable packet artifact coverage or bytes changed');assert.deepEqual(artifact.cohortFiles,cohortFiles,'Frozen cohort artifact coverage or bytes changed');
assert.equal(stagingRoots.size,1,'All builds must belong to one matrix attempt');assert.equal(builds,9);assert.equal(business,64);assert.equal(positive,44);assert.equal(nativeBoundary,20);assert.equal(framework,132);assert.deepEqual(report.totals,{business:{passed:64,total:64,expected:64},framework:{passed:132,total:132,expected:132}});assert.equal(report.selectedScopePassed,true);
console.log(JSON.stringify({integrity:'passed',report:pointer.report,compilerDigest:report.compilerDigestAfter,builds,business:{passed:business,positive,nativeBoundary},framework:{passed:framework},originalSourcesUnchanged:true,resourcesClosed:'Frozen runner awaited browser and fixture server close',scope:report.scope,releaseReady:false},null,2));
