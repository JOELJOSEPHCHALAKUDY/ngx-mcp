#!/usr/bin/env node
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,existsSync,createWriteStream,readdirSync,statSync,cpSync} from 'node:fs';
import {resolve,join,dirname,relative} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {catalog,directory,labels,sourceDirectory,assertFrozen,freshContext,prepareCase,executeCase,verifyCase,storageSnapshot,hash} from './fixtures.mjs';
import {accessFixture,accessBootstrapSource} from './access-fixture.mjs';
import {transportDriver} from './driver.mjs';
import {writeEvidence} from './evidence.mjs';
const root=resolve(directory,'../..');
const {values}=parseArgs({options:{out:{type:'string'},project:{type:'string'},modes:{type:'string',default:'mcp,webmcp,both'},'no-boundaries':{type:'boolean',default:false}}});
const projects=catalog.projects.filter(item=>!values.project||item.id===values.project);assert(projects.length,'Unknown fresh project: '+values.project);
const modes=values.modes.split(',');assert(modes.length&&modes.every(item=>['mcp','webmcp','both'].includes(item))&&new Set(modes).size===modes.length,'Invalid modes');
const stamp=new Date().toISOString().replace(/[:.]/g,'-'),out=resolve(values.out??join(directory,'runs',stamp));assert(!existsSync(out),'Never overwrite a prior fresh attempt: '+out);mkdirSync(out,{recursive:true});
const treeHash=folder=>{const files={};const walk=path=>{for(const name of readdirSync(path).sort()){const file=join(path,name);if(statSync(file).isDirectory())walk(file);else files[relative(folder,file)]=hash(readFileSync(file));}};walk(folder);return hash(JSON.stringify(files));};
const harnessFiles=['projects.json','fixtures.mjs','reference.mjs','fetch.mjs','driver.mjs','access-fixture.mjs','run.mjs','evidence.mjs'];
const harnessHashes=()=>Object.fromEntries(harnessFiles.map(name=>[name,hash(readFileSync(join(directory,name)))]));
const report={kind:'production-fresh-all-modes',evidenceRole:'Regression on the source-first fresh cohort after the preserved first integration attempt; not a newly unseen holdout.',firstIntegrationAttempt:{file:'runs/first-full-matrix-2026-11-10/report.json',sha256:hash(readFileSync(join(directory,'runs/first-full-matrix-2026-11-10/report.json')))},startedAt:new Date().toISOString(),sourceClock:catalog.clock,compilerDigestBefore:treeHash(join(root,'src')),harnessFilesBefore:harnessHashes(),projects:[],configuration:{projects:projects.map(item=>item.id),modes},firstAttemptsAreImmutable:true,scope:'Source-first selected synthetic business workflows and separate integration authorization boundaries. Exact reviewed compiler source IDs only; no per-app source patches and no DOM action fallback under test. SDK MCP uses an authenticated ES256 JWT Streamable HTTP gateway on explicit test-only loopback HTTP; external TLS and real IdP are outside this run.',nativeReference:{file:'native-original.json',sha256:hash(readFileSync(join(directory,'native-original.json')))},releaseReady:false};
let stopRequested=false;process.once('SIGTERM',()=>{stopRequested=true;report.aborted=true;report.abortReason='Requested stop before completing the matrix';});const assertRunning=()=>{if(stopRequested)throw new Error('Matrix aborted by termination request');};
const require=createRequire(join(root,'package.json')),{chromium}=require('playwright');let browser;
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
function command(args,cwd,log){return new Promise((done,reject)=>{const stream=createWriteStream(log),child=spawn(process.execPath,args,{cwd,env:{...process.env,PATH:dirname(process.execPath)+':'+process.env.PATH},stdio:['ignore','pipe','pipe']});child.stdout.pipe(stream);child.stderr.pipe(stream);child.once('error',reject);child.once('close',code=>{stream.end();code===0?done():reject(new Error('Build failed ('+code+'); see '+log));});});}
function browserFolder(stage){const candidates=[];const walk=(path,depth)=>{if(depth>5||!existsSync(path))return;for(const name of readdirSync(path)){const file=join(path,name);if(statSync(file).isDirectory())walk(file,depth+1);else if(name==='index.html')candidates.push(path);}};walk(join(stage,'dist'),0);assert.equal(candidates.length,1,'Expected one original CLI browser output');return candidates[0];}
const policyFiles={
 todo:['src/app/home/home.html','src/app/add-todo/add-todo.html','src/app/item-view/item-view.html'],
 sprint:['src/app/components/auth/login/login.component.ts','src/app/components/auth/register/register.component.ts','src/app/components/dashboard/dashboard.component.ts','src/app/components/kanban/kanban.component.ts','src/app/components/dialogs/create-project-dialog/create-project-dialog.component.ts','src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts'],
 expense:['src/app/features/categories/components/category-form/category-form.html','src/app/features/categories/components/budget-form/budget-form.html','src/app/features/expenses/pages/expense-form-page/expense-form-page.html','src/app/shared/money-input/money-input.html']
};
function reviewedPolicy(id,manifest,origin){
 const selected=manifest.nodes.filter(node=>policyFiles[id].includes(node.source.file)&&['input','textarea','select','button','form','mat-select','mat-option','app-money-input'].includes(node.tag));
 assert(selected.length>0,'Source-reviewed surface has no compiler nodes');
 const staticLabel=node=>{const body=readFileSync(join(sourceDirectory(id),node.source.file),'utf8'),fragment=body.slice(node.source.start,node.source.end),opening=fragment.slice(0,fragment.indexOf('>')+1),attribute=opening.match(/\s(?:name|id|placeholder|aria-label)\s*=\s*["']([^"']+)["']/)?.[1],literal=attribute&&!attribute.includes('{{')?attribute:'';return (node.tag+(literal?' '+literal:'')+' — '+node.source.file+':'+node.source.line).slice(0,240);};
 const review=selected.map(node=>({sourceId:node.id,label:staticLabel(node),tag:node.tag,source:node.source,...node.formId?{formId:node.formId}:{},operations:node.tag==='form'?['describe','submit']:node.tag==='button'||node.tag==='mat-select'||node.tag==='mat-option'?['describe','activate']:['describe','fill','activate'],basis:'Exact app-authored source element in a frozen, inspected selected workflow component. UI runtime determines actual supported operation; no arbitrary backend method is inferred.'}));
 const policy={version:1,allowedOrigins:[origin],rules:review.map(node=>({sourceId:node.sourceId,label:node.label,operations:node.operations,...node.tag==='form'?{writeFields:review.filter(field=>field.formId===node.sourceId&&field.operations.includes('fill')).map(field=>field.sourceId)}:{} })),sessionMaxAgeMs:3600000,approvalMaxAgeMs:60000,maxAuditRecords:100000};
 return {wrapper:{buildId:manifest.buildId,policy},review};
}
async function ready(page){await page.waitForFunction(()=>globalThis.__angularMcpBridge?.accessStatus?.().ready===true,null,{timeout:20000});}
const nativeNames=['angular_list_nodes','angular_describe_node','angular_read_model','angular_fill','angular_activate','angular_submit'];
async function nativeState(page){return page.evaluate(async names=>{const api=globalThis.__angularMcpBridge,context=document.modelContext,tools=context?Array.from(await context.getTools()).map(tool=>tool.name):[];return{nativeTools:tools,nativeBaseTools:tools.filter(name=>names.includes(name)).sort(),nativeExpectedNames:names.filter(name=>api?.toolAllowed?.(name)).sort(),webmcpStatus:api?.__angularMcpWebMcp?.status,webmcpErrors:api?.__angularMcpWebMcp?.errors??[]};},nativeNames);}
async function modeEvidence(page,mode){
 if(mode!=='mcp')await page.waitForFunction(async names=>{const api=globalThis.__angularMcpBridge;if(api?.__angularMcpWebMcp?.status!=='active'||!document.modelContext)return false;const tools=Array.from(await document.modelContext.getTools()).map(tool=>tool.name),actual=tools.filter(name=>names.includes(name)).sort(),expected=names.filter(name=>api.toolAllowed(name)).sort();return expected.includes('angular_list_nodes')&&JSON.stringify(actual)===JSON.stringify(expected);},nativeNames,{timeout:15000});
 const value={...await page.evaluate(()=>({bridge:globalThis.__angularMcpBridge?.mode,profile:globalThis.__angularMcpBridge?.profile,access:globalThis.__angularMcpBridge?.accessStatus?.(),nativeApi:typeof document.modelContext?.executeTool,ngDebug:typeof globalThis.ng?.getComponent})),...await nativeState(page)};assert.equal(value.bridge,mode);assert.equal(value.profile,'production');assert.equal(value.ngDebug,'undefined');if(mode==='mcp')assert.equal(value.nativeTools.length,0);else{assert(value.nativeTools.includes('angular_list_nodes'),'Native catalog publication is required');assert.deepEqual(value.nativeBaseTools,value.nativeExpectedNames,'Native tool names must match current policy capabilities');assert.equal(value.webmcpStatus,'active');}return value;
}

const boundaryIds=['missing_auth','ungranted_source','expired_auth','revoked_auth','denied_source','denied_model_read','denied_value_read','denied_approval','wrong_subject','cross_session_target','audit_redaction'];
function boundaryField(page,id){return page.locator(id==='todo'?'#todoTitle':id==='sprint'?'input[name=username]':'#category-name');}
const boundaryCase=id=>id==='todo'?'create_task':id==='sprint'?'register_user':'create_category';
async function setupBoundary(page,id,origin){await prepareCase(page,id,boundaryCase(id),origin);if(id==='todo'){await page.locator('button[data-bs-target="#addTodoModal"]').click();await page.locator('#addTodoModal.show').waitFor();}}
async function runBoundary(info,mode,path,name,fixture,origin){
 const calls=[],record={id:name,path,kind:'framework-boundary',status:'failed',calls};let context,page,driver,other,otherDriver;
 const auth=fixture.session(),initial={...auth.state.session},second=fixture.session('synthetic-owner-b');
 try{
  ({context,page}=await freshContext(browser,info.id,boundaryCase(info.id),origin));
  if(name!=='missing_auth')await auth.attach(context);
  await setupBoundary(page,info.id,origin);
  if(name==='missing_auth'){
   await page.waitForFunction(()=>globalThis.__angularMcpBridge?.profile==='production');await page.waitForTimeout(400);const before=await storageSnapshot(page,info.id);
   await assert.rejects(async()=>{driver=await transportDriver(page,origin,path,root,initial,calls);const result=await driver.rawCall('angular_list_nodes',{});if(result.error)throw new Error(result.text);},/access|session|identity|not exposed|production|not.ready|403|503|service_unavailable/i);
   if(path==='mcp')assert(calls.some(item=>item.audit?.some(event=>event.reason==='app_session_denied')),'Missing app authentication must fail gateway app-session validation');record.access=await page.evaluate(()=>globalThis.__angularMcpBridge?.accessStatus?.());assert.equal(record.access.ready,false);if(path==='native'){record.nativeAfter=await nativeState(page);assert.equal(record.nativeAfter.nativeTools.length,0,'Unauthenticated native publication must be empty');}assert.deepEqual(await storageSnapshot(page,info.id),before);record.status='passed';return record;
  }
  await ready(page);driver=await transportDriver(page,origin,path,root,initial,calls);const field=boundaryField(page,info.id),target=await driver.target(field),before=await storageSnapshot(page,info.id),beforeValue=await field.inputValue();
  if(name==='expired_auth')auth.expire();
  if(name==='revoked_auth')auth.revoke();
  if(name==='denied_source')auth.denySource(target.sourceId);
  if(name==='denied_approval')auth.denyApproval();
  if(name==='wrong_subject')auth.state.session.subject='synthetic-wrong-subject';
  if(name==='ungranted_source'){
   const ungranted=await page.evaluate(allowed=>{const nodes=Array.from(document.querySelectorAll('[data-angular-mcp-instance]'));for(const node of nodes){const instanceId=node.getAttribute('data-angular-mcp-instance'),sourceId=instanceId.split('@')[0];if(!allowed.includes(sourceId)&&!sourceId.startsWith('runtime-dom'))return{instanceId,sourceId};}return null;},fixture.allowedSourceIds);assert(ungranted,'Need an app-authored default-denied target');const result=await driver.rawCall('angular_describe_node',{target:ungranted});assert.equal(result.error,true,'Default-denied source must not be describable');record.deniedTarget=ungranted;
  }else if(name==='denied_value_read'){
   const secret='Private metadata 8472';await driver.fill(field,secret);
   const described=await driver.call('angular_describe_node',{target}),listed=await driver.call('angular_list_nodes',{}),inspected=await page.evaluate(target=>globalThis.__angularMcpBridge.inspect(target),target);
   for(const value of[described.data,listed.data,inspected]){assert(!JSON.stringify(value).includes(secret),'Denied private value leaked through metadata');}
   assert.equal(await field.inputValue(),secret);record.metadataValueRedacted=true;
  }else if(name==='audit_redaction'){
   const secret='Secret audit fixture 84192';const start=fixture.audit.length;await driver.fill(field,secret);assert(fixture.audit.length>start,'Trusted audit backend must receive operation events');const rows=fixture.audit.slice(start);assert(!JSON.stringify(rows).includes(secret));assert(rows.some(row=>row.event==='completed'));assert(rows.every(row=>Object.keys(row).every(key=>['sessionId','subject','sequence','time','event','operation','sourceId','requestHash','code'].includes(key))));record.audit=rows;
  }else if(name==='cross_session_target'){
   other=await freshContext(browser,info.id,boundaryCase(info.id),origin);await second.attach(other.context);await setupBoundary(other.page,info.id,origin);await ready(other.page);otherDriver=await transportDriver(other.page,origin,path,root,{...second.state.session},calls);const otherBefore=await storageSnapshot(other.page,info.id),otherValue=await boundaryField(other.page,info.id).inputValue();
   const result=await otherDriver.rawCall('angular_fill',{target,value:'Cross session must not land'});assert.equal(result.error,true,'Session A target must not address browser B');assert.deepEqual(await storageSnapshot(other.page,info.id),otherBefore);assert.equal(await boundaryField(other.page,info.id).inputValue(),otherValue);
  }else{
   const operation=name==='denied_model_read'?'angular_read_model':'angular_fill',args=name==='denied_model_read'?{target}:{target,value:'Forbidden mutation must not land'};
   let denied=false;try{const result=await driver.rawCall(operation,args);denied=result.error;}catch(error){denied=/session|identity|not exposed|policy|denied|target|registry/i.test(String(error));if(!denied)throw error;}
   assert(denied,'Boundary must refuse the actual '+path+' tool call');assert.equal(await field.inputValue(),beforeValue,'Denied operation changed original UI field');
  }
  if(path==='native'&&['expired_auth','revoked_auth','wrong_subject'].includes(name)){await page.waitForFunction(async()=>Array.from(await document.modelContext.getTools()).length===0,null,{timeout:10000});record.nativeAfter=await nativeState(page);assert.equal(record.nativeAfter.nativeTools.length,0,'Invalid session must withdraw all native tools');}
  assert.deepEqual(await storageSnapshot(page,info.id),before,'Boundary changed business storage');record.status='passed';
 }catch(error){record.error=String(error);record.stack=error.stack;}finally{await driver?.close();await otherDriver?.close();await context?.close();await other?.context.close();}
 return record;
}
try{
 const {prepareIntegration}=await import(pathToFileURL(join(root,'src/integration-project.ts')).href);
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-features=WebMCP','--enable-blink-features=WebMCP']});report.browserVersion=browser.version();
 for(const info of projects){assertRunning();
  console.log('FRESH',info.id,'frozen source check');const source=sourceDirectory(info.id),record={id:info.id,commit:info.commit,sourceCheckBefore:assertFrozen(info.id),builds:[]};report.projects.push(record);save();
  const folder=join(out,info.id);mkdirSync(folder);const bootstrap=join(folder,'trusted-bootstrap.ts');writeFileSync(bootstrap,accessBootstrapSource);
  let analysis;
  try{analysis=await prepareIntegration(join(source,info.tsconfig),{outDir:join('/tmp','ngx-mcp-fresh-review-'+stamp,info.id),mode:'both',profile:'development',accessBootstrap:bootstrap,target:info.target});record.analysis={buildId:analysis.buildId,nodes:analysis.nodes.length,diagnostics:analysis.diagnostics};}catch(error){record.analysisError=String(error);save();continue;}
  for(const mode of modes){assertRunning();
   const fixture=accessFixture(),origin=await fixture.start(),modeFolder=join(folder,mode);mkdirSync(modeFolder);const build={mode,origin,cases:[],boundaries:[]};record.builds.push(build);
   try{
    const reviewed=reviewedPolicy(info.id,analysis,origin);writeFileSync(join(modeFolder,'reviewed-policy.json'),JSON.stringify(reviewed.wrapper,null,2)+'\n');writeFileSync(join(modeFolder,'source-id-review.json'),JSON.stringify(reviewed.review,null,2)+'\n');fixture.allowedSourceIds=reviewed.review.map(node=>node.sourceId);build.policySha256=hash(JSON.stringify(reviewed.wrapper));build.reviewedSourceCount=reviewed.review.length;
    const staged=join('/tmp','ngx-mcp-fresh-production-'+stamp,info.id,mode);console.log('FRESH',info.id,mode,'production stage/build');
    const manifest=await prepareIntegration(join(source,info.tsconfig),{outDir:staged,mode,profile:'production',accessBootstrap:bootstrap,accessPolicy:reviewed.wrapper,target:info.target});build.stage=staged;build.buildId=manifest.buildId;build.manifestSha256=hash(readFileSync(join(staged,'ngx-mcp.integration.json')));build.runtimeSha256=hash(readFileSync(manifest.runtimeModule));
    await command([join(staged,'node_modules/@angular/cli/bin/ng.js'),'build',info.target,'--configuration','production'],staged,join(modeFolder,'build.log'));build.browserDirectory=browserFolder(staged);build.outputDigest=treeHash(build.browserDirectory);const artifacts=join(modeFolder,'artifacts');mkdirSync(artifacts);cpSync(join(staged,'ngx-mcp.integration.json'),join(artifacts,'ngx-mcp.integration.json'));cpSync(manifest.runtimeModule,join(artifacts,'ngx-mcp.generated.ts'));cpSync(build.browserDirectory,join(artifacts,'browser'),{recursive:true});build.artifacts={manifest:relative(out,join(artifacts,'ngx-mcp.integration.json')),runtime:relative(out,join(artifacts,'ngx-mcp.generated.ts')),browser:relative(out,join(artifacts,'browser'))};assert.equal(hash(readFileSync(join(out,build.artifacts.manifest))),build.manifestSha256);assert.equal(hash(readFileSync(join(out,build.artifacts.runtime))),build.runtimeSha256);assert.equal(treeHash(join(out,build.artifacts.browser)),build.outputDigest);fixture.attach(build.browserDirectory);build.productionBuild='passed';
    for(const path of mode==='both'?['mcp','native']:[mode==='mcp'?'mcp':'native']){assertRunning();
     for(const item of labels(info.id).cases){assertRunning();
      console.log('FRESH',info.id,mode,path,item.id);const calls=[],entry={id:item.id,kind:item.kind,path,status:'failed',calls};build.cases.push(entry);let context,page,driver;
      const auth=fixture.session();try{
       ({context,page}=await freshContext(browser,info.id,item.id,origin));await auth.attach(context);await prepareCase(page,info.id,item.id,origin);await ready(page);await page.waitForTimeout(300);entry.modeEvidence=await modeEvidence(page,mode);driver=await transportDriver(page,origin,path,root,{...auth.state.session},calls);const before=await storageSnapshot(page,info.id);await executeCase(page,info.id,item,driver);Object.assign(entry,await verifyCase(page,info.id,item,before));entry.status='passed';
      }catch(error){entry.error=String(error);entry.stack=error.stack;if(page)try{entry.after=await storageSnapshot(page,info.id);entry.access=await page.evaluate(()=>globalThis.__angularMcpBridge?.accessStatus?.());entry.nativeFailure=await nativeState(page);entry.consoleBody=(await page.locator('body').innerText()).slice(0,2500);}catch{}}
      finally{await driver?.close();await context?.close();}save();
     }
     if(!values['no-boundaries'])for(const name of boundaryIds){assertRunning();console.log('BOUNDARY',info.id,mode,path,name);build.boundaries.push(await runBoundary(info,mode,path,name,fixture,origin));save();}
    }
    build.auditEvents=fixture.audit.length;build.approvals=fixture.approvals.length;build.auditSha256=hash(JSON.stringify(fixture.audit));writeFileSync(join(modeFolder,'trusted-audit.json'),JSON.stringify(fixture.audit,null,2)+'\n');writeFileSync(join(modeFolder,'trusted-approvals.json'),JSON.stringify(fixture.approvals,null,2)+'\n');
   }catch(error){build.infrastructureError=String(error);build.stack=error.stack;save();}
   finally{await fixture.close();build.serverStopped=true;}
  }
  record.sourceCheckAfter=assertFrozen(info.id);save();
 }
}catch(error){report.infrastructureError=String(error);report.stack=error.stack;process.exitCode=1;}
finally{
 try{await browser?.close();report.browserClosed=!!browser;}catch(error){report.cleanupError=String(error);process.exitCode=1;}report.resourcesClosed=report.browserClosed===true&&report.projects.every(project=>project.builds.every(build=>build.serverStopped===true));report.finishedAt=new Date().toISOString();report.compilerDigestAfter=treeHash(join(root,'src'));report.compilerStable=report.compilerDigestBefore===report.compilerDigestAfter;report.harnessFilesAfter=harnessHashes();report.harnessStable=JSON.stringify(report.harnessFilesBefore)===JSON.stringify(report.harnessFilesAfter);report.originalSourcesUnchanged=report.projects.every(item=>item.sourceCheckAfter&&item.sourceCheckAfter.commit===item.commit);
 const cases=report.projects.flatMap(item=>item.builds.flatMap(build=>build.cases)),boundaries=report.projects.flatMap(item=>item.builds.flatMap(build=>build.boundaries));report.totals={business:{passed:cases.filter(item=>item.status==='passed').length,total:cases.length,expected:projects.reduce((sum,item)=>sum+labels(item.id).cases.length,0)*modes.reduce((sum,mode)=>sum+(mode==='both'?2:1),0)},framework:{passed:boundaries.filter(item=>item.status==='passed').length,total:boundaries.length,expected:values['no-boundaries']?0:projects.length*boundaryIds.length*modes.reduce((sum,mode)=>sum+(mode==='both'?2:1),0)}};
 report.buildMatrixComplete=report.projects.length===projects.length&&report.projects.every(project=>!project.analysisError&&project.builds.length===modes.length&&project.builds.every(build=>!build.infrastructureError&&build.productionBuild==='passed'&&build.serverStopped===true));
 report.selectedScopePassed=!report.aborted&&report.buildMatrixComplete&&!report.infrastructureError&&!report.cleanupError&&report.resourcesClosed&&report.compilerStable&&report.harnessStable&&report.originalSourcesUnchanged&&report.totals.business.passed===report.totals.business.expected&&report.totals.framework.passed===report.totals.framework.expected;
 if(!report.selectedScopePassed)process.exitCode=1;save();writeEvidence(report,out,process.exitCode??0);console.log('REPORT',join(out,'report.json'),JSON.stringify({totals:report.totals,compilerStable:report.compilerStable,selectedScopePassed:report.selectedScopePassed,infrastructureError:report.infrastructureError}));if(!report.selectedScopePassed)process.exitCode=1;
}
