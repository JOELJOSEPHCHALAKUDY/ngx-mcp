import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,readdirSync,statSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {catalog,directory,hash} from './fixtures.mjs';

// Finalization is separate from the immutable report. Raw digests bind all
// replay inputs/artifacts; it does not retrofit or rewrite old run results.
export function writeEvidence(report,out,exitCode){
 const reportFile=join(out,'report.json'),reportSha=hash(readFileSync(reportFile)),evidenceFiles={};
 for(const project of catalog.projects)for(const file of['freeze.json','source-manifest.json','labels.json','inventory.json','LICENSE']){const name=project.id+'/'+file;evidenceFiles[name]=hash(readFileSync(join(directory,name)));}
 for(const name of['native-original.json','original-builds.json'])evidenceFiles[name]=hash(readFileSync(join(directory,name)));
 const files={};const add=file=>{assert(existsSync(file),'Missing evidence artifact: '+file);files[resolve(file)]=hash(readFileSync(file));};
 const walk=path=>{for(const name of readdirSync(path).sort()){const file=join(path,name);if(statSync(file).isDirectory())walk(file);else add(file);}};
 add(join(directory,'projects.json'));for(const file of Object.keys(evidenceFiles))add(join(directory,file));walk(join(directory,'baseline-logs'));
 for(const project of report.projects){
  const manifest=JSON.parse(readFileSync(join(directory,project.id,'source-manifest.json')));for(const name of Object.keys(manifest))add(join(project.sourceCheckBefore.source,name));
  add(join(out,project.id,'trusted-bootstrap.ts'));
  for(const build of project.builds){const folder=join(out,project.id,build.mode);for(const name of['reviewed-policy.json','source-id-review.json','build.log','trusted-audit.json','trusted-approvals.json'])if(existsSync(join(folder,name)))add(join(folder,name));if(build.stage&&existsSync(join(build.stage,'ngx-mcp.integration.json'))){const manifestFile=join(build.stage,'ngx-mcp.integration.json');add(manifestFile);const manifest=JSON.parse(readFileSync(manifestFile));add(manifest.runtimeModule);}if(build.browserDirectory&&existsSync(build.browserDirectory))walk(build.browserDirectory);}
 }
 const artifactManifest={formatVersion:1,report:reportFile,sha256:reportSha,files};const artifactFile=join(out,'evidence-manifest.json');writeFileSync(artifactFile,JSON.stringify(artifactManifest,null,2)+'\n');
 const completion={formatVersion:1,report:reportFile,sha256:reportSha,exitCode,browserCloseAwaited:report.browserClosed===true,basis:'Frozen run.mjs awaits browser.close before finishedAt; exitCode is the finalized process.exitCode.'};const completionFile=join(out,'run-completion.json');writeFileSync(completionFile,JSON.stringify(completion,null,2)+'\n');
 const common={formatVersion:1,sha256:reportSha,evidenceFiles,completion:{file:'run-completion.json',sha256:hash(readFileSync(completionFile))},artifactManifest:{file:'evidence-manifest.json',sha256:hash(readFileSync(artifactFile))}};
 writeFileSync(reportFile+'.sha256.json',JSON.stringify({...common,report:reportFile},null,2)+'\n');
 // Latest is an index, not immutable evidence. Older attempts remain untouched.
 writeFileSync(join(directory,'latest-matrix.json'),JSON.stringify({...common,report:relative(directory,reportFile)},null,2)+'\n');
 return reportFile+'.sha256.json';
}
