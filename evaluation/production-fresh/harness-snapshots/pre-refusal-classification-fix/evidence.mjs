import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {catalog,directory,hash} from './fixtures.mjs';

// Finalization is separate from the immutable report. Raw digests bind all
// replay inputs/artifacts; it does not retrofit or rewrite old run results.
export function writeEvidence(report,out,exitCode){
 const reportFile=join(out,'report.json'),reportSha=hash(readFileSync(reportFile)),evidenceFiles={};
 for(const project of catalog.projects)for(const file of['freeze.json','source-manifest.json','labels.json','inventory.json','LICENSE']){const name=project.id+'/'+file;evidenceFiles[name]=hash(readFileSync(join(directory,name)));}
 for(const name of['native-original.json','original-builds.json'])evidenceFiles[name]=hash(readFileSync(join(directory,name)));
 const files={},cohortFiles={};
 const add=(base,mapping,file)=>{assert(existsSync(file),'Missing evidence artifact: '+file);mapping[relative(base,file)]=hash(readFileSync(file));};
 const walk=(base,mapping,path)=>{for(const name of readdirSync(path).sort()){const file=join(path,name);if(statSync(file).isDirectory())walk(base,mapping,file);else add(base,mapping,file);}};
 add(directory,cohortFiles,join(directory,'projects.json'));for(const file of Object.keys(evidenceFiles))add(directory,cohortFiles,join(directory,file));walk(directory,cohortFiles,join(directory,'baseline-logs'));walk(directory,cohortFiles,join(directory,'harness-snapshots/native-first-pass'));
 for(const project of report.projects){
  add(out,files,join(out,project.id,'trusted-bootstrap.ts'));
  for(const build of project.builds){const folder=join(out,project.id,build.mode);for(const name of['reviewed-policy.json','source-id-review.json','build.log','trusted-audit.json','trusted-approvals.json'])if(existsSync(join(folder,name)))add(out,files,join(folder,name));if(build.artifacts){add(out,files,join(out,build.artifacts.manifest));add(out,files,join(out,build.artifacts.runtime));walk(out,files,join(out,build.artifacts.browser));}}
 }
 const artifactManifest={formatVersion:1,report:reportFile,sha256:reportSha,files,cohortFiles};const artifactFile=join(out,'evidence-manifest.json');writeFileSync(artifactFile,JSON.stringify(artifactManifest,null,2)+'\n');
 const completion={formatVersion:1,report:reportFile,sha256:reportSha,exitCode,browserCloseAwaited:report.browserClosed===true,basis:'Frozen run.mjs awaits browser.close before finishedAt; exitCode is the finalized process.exitCode.'};const completionFile=join(out,'run-completion.json');writeFileSync(completionFile,JSON.stringify(completion,null,2)+'\n');
 const common={formatVersion:1,sha256:reportSha,evidenceFiles,completion:{file:'run-completion.json',sha256:hash(readFileSync(completionFile))},artifactManifest:{file:'evidence-manifest.json',sha256:hash(readFileSync(artifactFile))}};
 writeFileSync(reportFile+'.sha256.json',JSON.stringify({...common,report:reportFile},null,2)+'\n');
 // Latest is an index, not immutable evidence. Older attempts remain untouched.
 writeFileSync(join(directory,'latest-matrix.json'),JSON.stringify({...common,report:relative(directory,reportFile)},null,2)+'\n');
 return reportFile+'.sha256.json';
}
