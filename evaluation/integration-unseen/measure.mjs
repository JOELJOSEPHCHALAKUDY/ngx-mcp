#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,createWriteStream,existsSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {catalog,directory,readJson,hash,checkFreeze,sourceDirectory,labels} from './fixtures.mjs';
const root=resolve(process.env.ANGULAR_MCP_ROOT??process.cwd()),args=process.argv.slice(2),opt=(name,fallback)=>args.includes('--'+name)?args[args.indexOf('--'+name)+1]:fallback;
process.chdir(root);
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=resolve(opt('out',resolve(directory,'runs',stamp))),basePort=Number(opt('base-port','4451'));
if(existsSync(out))throw new Error('Measurement output already exists; choose a new --out directory');mkdirSync(out,{recursive:true});
const digests=await import(pathToFileURL(resolve(root,'evaluation/digest.mjs')).href),files=['../digest.mjs','fixtures.mjs','cases.mjs','oracles.mjs','evidence.mjs','shopping/avatar-reference-adjudication.json','run.mjs','mcp-driver.mjs','catalog.mjs','measure.mjs','check.mjs','fetch.mjs','serve.mjs'];
const codeHashes=()=>Object.fromEntries(files.map(name=>[name,hash(readFileSync(resolve(directory,name)))]));
const summary={reportKind:'integration-unseen-measurement',startedAt:new Date().toISOString(),compilerDigestBefore:digests.treeDigest('src'),evaluatorFilesBefore:codeHashes(),goldPositiveScenarios:35,goldNegativeOrBoundaryCases:21,projects:[],sourcePolicy:'Pinned originals unchanged; only generic staged compiler/runtime instrumentation. All action-under-test calls are actual SDK MCP with no native reference fallback.'};
const live=new Set();const pause=ms=>new Promise(done=>setTimeout(done,ms));
function start(command,commandArgs,cwd,logName,env={}){const stream=createWriteStream(logName),child=spawn(command,commandArgs,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});child.stdout.pipe(stream);child.stderr.pipe(stream);const done=new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>{stream.end();done(code);});});return {child,done,command,commandArgs,cwd};}
async function command(commandArgs,cwd,logName,env={}){const task=start(process.execPath,commandArgs,cwd,logName,env),code=await task.done;if(code!==0)throw new Error(`Command failed (${code}); see ${logName}`);}
async function stop(server){if(!server)return;server.child.kill('SIGTERM');await Promise.race([server.done,pause(3000)]);if(server.child.exitCode===null){server.child.kill('SIGKILL');await server.done;}live.delete(server);}
async function serve(source,port,log){try{await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(300)});throw new Error('Refusing to use an already running server on port '+port);}catch(error){if(String(error).includes('Refusing'))throw error;}const server=start(process.execPath,[resolve(source,'node_modules/@angular/cli/bin/ng.js'),'serve','--host','127.0.0.1','--port',String(port)],source,log);live.add(server);for(let n=0;n<180;n++){if(server.child.exitCode!==null)throw new Error('Dev server exited; see '+log);try{const response=await fetch(`http://127.0.0.1:${port}`,{signal:AbortSignal.timeout(1000)});if(response.ok)return server;}catch{}await pause(500);}throw new Error('Dev server did not become ready; see '+log);}
try{
 if(args.includes('--install'))await command([resolve(directory,'fetch.mjs'),'--install'],root,resolve(out,'fetch.log'));
 for(const [index,project]of catalog.projects.entries()){
  console.log('MEASURE',project.id,'verifying frozen original');const source=sourceDirectory(project);await checkFreeze(project.id,source);
  const folder=resolve(out,project.id);mkdirSync(folder);const staged=resolve(tmpdir(),`angular-integration-unseen-${stamp}-${process.pid}`,project.id),originalPort=basePort+index,stagedPort=basePort+10+index;
  const record={id:project.id,commit:project.commit,originalPort,stagedPort,source,staged,compilerDigestBeforeStage:digests.treeDigest('src'),evidence:{}};summary.projects.push(record);
  await command(['--import','tsx',resolve(root,'src/integrate.ts'),'--project',resolve(source,project.tsconfig),'--out',staged],root,resolve(folder,'staging.log'));
  record.compilerDigestAfterStage=digests.treeDigest('src');const manifest=readJson(resolve(staged,'ngx-mcp.integration.json'));record.runtimeModuleSha256=hash(readFileSync(manifest.runtimeModule));record.manifestSha256=hash(readFileSync(resolve(staged,'ngx-mcp.integration.json')));
  let original,integrated;
  try{
   original=await serve(source,originalPort,resolve(folder,'original-server.log'));integrated=await serve(staged,stagedPort,resolve(folder,'staged-server.log'));record.serverOwnership={original:{pid:original.child.pid,cwd:source},staged:{pid:integrated.child.pid,cwd:staged}};
   for(const phase of ['reference','raw','ui']){
    console.log('MEASURE',project.id,phase);const report=resolve(folder,phase+'.json'),mode=phase==='reference'?'reference':'mcp',port=phase==='reference'?originalPort:stagedPort;
    await command(['--import','tsx',resolve(directory,'run.mjs'),'--mode',mode,'--project',project.id,'--base-url',`http://127.0.0.1:${port}`,'--stage-dir',staged,'--out',report],root,resolve(folder,phase+'.log'),{ANGULAR_MCP_ROOT:root,[`SOURCE_${project.id.toUpperCase()}`]:source,...phase==='ui'?{UNSEEN_TRANSPORT:'native-ui'}:{UNSEEN_TRANSPORT:'raw-frozen'}});
    record.evidence[phase]={path:relative(directory,report),sha256:hash(readFileSync(report))};
   }
  }finally{await stop(integrated);await stop(original);record.serversStopped=true;}
  await checkFreeze(project.id,source);
  const reference=readJson(resolve(directory,record.evidence.reference.path)),raw=readJson(resolve(directory,record.evidence.raw.path)),ui=readJson(resolve(directory,record.evidence.ui.path));
  record.counts={native:reference.totals,raw:raw.totals,ui:ui.totals};const nativeCases=reference.projects[0].cases,uiCases=ui.projects[0].cases;
  record.protocolBoundaryGaps=labels(project.id).negativeCases.filter(c=>c.expected==='ambiguous-target-refused').flatMap(c=>{const replay=uiCases.find(x=>x.id===c.id);return replay?.status==='passed'?[]:[{id:c.id,status:replay?.status??'missing'}];});
  record.nativePassing=nativeCases.filter(c=>c.status==='passed').length;record.nativeBlocked=nativeCases.filter(c=>c.kind==='positive'&&c.status!=='passed').map(c=>({id:c.id,status:c.status,error:c.error}));
  record.parityGaps=nativeCases.filter(c=>c.status==='passed').flatMap(c=>{const replay=uiCases.find(x=>x.id===c.id);return replay?.status==='passed'?[]:[{id:c.id,kind:c.kind,nativeStatus:c.status,mcpStatus:replay?.status??'missing',error:replay?.error??replay?.refusalReason}];});
 }
}catch(error){summary.infrastructureError=String(error);process.exitCode=1;}
finally{
 for(const server of [...live])await stop(server);summary.finishedAt=new Date().toISOString();summary.compilerDigestAfter=digests.treeDigest('src');summary.evaluatorFilesAfter=codeHashes();summary.compilerStable=summary.compilerDigestBefore===summary.compilerDigestAfter;summary.evaluatorStable=JSON.stringify(summary.evaluatorFilesBefore)===JSON.stringify(summary.evaluatorFilesAfter);
 summary.nativeParity=summary.projects.length===catalog.projects.length&&summary.projects.every(p=>Array.isArray(p.parityGaps)&&p.parityGaps.length===0)&&!summary.infrastructureError;summary.protocolBoundariesPassed=summary.projects.length===3&&summary.projects.every(p=>Array.isArray(p.protocolBoundaryGaps)&&p.protocolBoundaryGaps.length===0);summary.usableWithinNativePassingScope=summary.nativeParity&&summary.protocolBoundariesPassed&&summary.compilerStable&&summary.evaluatorStable;summary.releaseReady=false;summary.scope='Integrity and declared native-reference parity only. Frozen positive denominator remains35 including source-blocked1px avatar. Raw field values and explicit UI transport mappings are separate. This is not a production or full-schema guarantee.';
 const summaryFile=resolve(out,'summary.json');writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n');writeFileSync(resolve(directory,'latest-measurement.json'),JSON.stringify({path:relative(directory,summaryFile),sha256:hash(readFileSync(summaryFile))},null,2)+'\n');console.log('SUMMARY',summaryFile,JSON.stringify({nativeParity:summary.nativeParity,infrastructureError:summary.infrastructureError}));
}
