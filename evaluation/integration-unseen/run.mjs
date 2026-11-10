import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {catalog,directory,readJson,labels,checkFreeze,sourceDirectory,shoppingApi,blockExternal,snapshot,nativeDriver,delay,hash} from './fixtures.mjs';
import {prepare,act,verify} from './cases.mjs';
import {traceNativeDriver,observeSubmitRefusal,assessNegative} from './evidence.mjs';
const root=resolve(process.env.ANGULAR_MCP_ROOT??process.cwd());process.chdir(root);
const require=createRequire(resolve(root,'package.json'));
const {chromium}=require('playwright');
const argv=process.argv.slice(2),option=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];};
const mode=option('mode','reference'),selected=option('project','all'),caseId=option('case','all');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const output=option('out',resolve(directory,`results-${mode}-${stamp}.json`));
if(existsSync(output))throw new Error('Reports are immutable; choose another --out filename');
const report={reportKind:mode==='reference'?'independent-native-reference':'integration-mcp-replay',startedAt:new Date().toISOString(),mode,transport:process.env.UNSEEN_TRANSPORT??'raw-frozen',node:process.version,fixedBrowserTime:'2026-11-10T12:00:00Z',externalNetwork:'All origins blocked except designated local app; /api handled by deterministic in-process source-contract fixture.',sourceOverlays:[],frozenInputRewrites:[],harnessSha256:Object.fromEntries(['../digest.mjs','run.mjs','fixtures.mjs','cases.mjs','oracles.mjs','mcp-driver.mjs','evidence.mjs'].map(f=>[f,hash(readFileSync(resolve(directory,f)))])),projects:[]};
const digests=mode==='reference'?undefined:await import(pathToFileURL(resolve(process.env.ANGULAR_MCP_ROOT??process.cwd(),'evaluation/digest.mjs')).href);if(digests)report.compilerDigestBefore=digests.treeDigest('src');
report.appSpecificSourcePatches=[];report.instrumentation=mode==='reference'?'Untouched original app CLI':'Separate generic compiler-instrumented app staged copy; original source manifest is checked unchanged.';
const browser=await chromium.launch();report.browser=browser.version();
try{
 for(const project of catalog.projects.filter(p=>selected==='all'||p.id===selected)){
  const staged=option('stage-dir',`/tmp/integration-unseen-${project.id}-integrated-v3`),stagedManifest=resolve(staged,'ngx-mcp.integration.json');const stage=mode==='mcp'&&existsSync(stagedManifest)?{directory:staged,manifestSha256:hash(readFileSync(stagedManifest)),runtimeModule:readJson(stagedManifest).runtimeModule,runtimeSha256:hash(readFileSync(readJson(stagedManifest).runtimeModule))}:undefined;
  const projectReport={id:project.id,commit:project.commit,stage,integrity:await checkFreeze(project.id,sourceDirectory(project)),cases:[]};report.projects.push(projectReport);
  const gold=labels(project.id);const all=[...gold.operations.map(op=>({op})),...gold.negativeCases.map(negative=>({op:gold.operations.find(x=>x.id===negative.operation),negative}))];
  for(const {op,negative}of all.filter(({op,negative})=>caseId==='all'||(negative?.id??op.id)===caseId)){
   const entry={id:negative?.id??op.id,operation:op.id,kind:negative?'negative':'positive',frozenInput:structuredClone(op.validInput),inputPatch:negative?.inputPatch,routeContext:op.routeContext,targetContext:op.targetContext,calls:[]};projectReport.cases.push(entry);
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100},locale:'en-US'}),page=await context.newPage();page.setDefaultTimeout(2500);const errors=[],consoleErrors=[];page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});page.on('pageerror',error=>errors.push(String(error)));
   const baseUrl=option('base-url',`http://127.0.0.1:${project.port+(mode==='reference'?0:10)}`),api=project.id==='shopping'?shoppingApi():undefined;let closeDriver;
   try{
    await page.clock.install({time:new Date(report.fixedBrowserTime)});
    entry.network=await blockExternal(context,baseUrl,api?.handle);
    const meta=await prepare(page,baseUrl,project.id,op,negative,api);entry.setup={url:page.url(),meta};
    entry.before=await snapshot(page,project.id,api);
    const args={...structuredClone(op.validInput),...structuredClone(negative?.inputPatch??{})};entry.businessInput=args;
    if(negative?.expected==='ambiguous-target-refused'&&mode==='reference'){entry.status='protocol-boundary-not-applicable';entry.evidence='Native UI exposes individually selectable source rows; sourceId-only ambiguity is a generated-protocol boundary tested in MCP mode.';continue;}
    const driver=mode==='reference'?traceNativeDriver(nativeDriver(page),entry.calls):await (await import('./mcp-driver.mjs')).mcpDriver(page,baseUrl,entry.calls,process.env.ANGULAR_MCP_ROOT??process.cwd());closeDriver=driver.close;
    let result;try{result=await act(page,baseUrl,project.id,op,args,driver,negative);}catch(error){entry.actionError=String(error);if(!negative)throw error;}
    await delay(page);entry.after=await snapshot(page,project.id,api);
    if(negative){
     const actionCalls=entry.calls.slice();
     if(mode==='reference')entry.inputEvidence=await driver.inspectValidation(negative.inputPatch??{});
     else{
      try{entry.inputEvidence=await driver.inspectValidation?.(negative.inputPatch??{})??[];}catch(error){entry.inputEvidence=[];entry.inputInspectionError=String(error);}
      entry.submitRefusal=await observeSubmitRefusal(page,actionCalls).catch(()=>undefined);
     }
     entry.oracle=await verify(page,project.id,op,args,entry.before,entry.after,meta,negative,result);
     entry.negativeEvidence=assessNegative({mode,negative,calls:entry.calls,actionError:entry.actionError,inputEvidence:entry.inputEvidence,submitRefusal:entry.submitRefusal,oracle:entry.oracle,before:entry.before,after:entry.after});
     if(!entry.negativeEvidence.covered){assert.deepEqual(entry.after,entry.before,'A blocked attempt changed domain state');entry.status='blocked-before-validation';entry.negativeExercised=false;entry.refusalReason=entry.negativeEvidence.reason;continue;}
     entry.negativeCoverage=entry.negativeEvidence.kind;
    }else entry.oracle=await verify(page,project.id,op,args,entry.before,entry.after,meta,negative,result);
    entry.negativeExercised=negative?true:undefined;
    if(!negative&&project.id!=='shopping'){const expected=JSON.stringify(entry.after);await page.reload();await page.waitForTimeout(250);const persisted=await snapshot(page,project.id,api);if(JSON.stringify(persisted)!==expected)throw new Error('Business effect did not survive reload');entry.persistedAfterReload=true;}
    entry.status='passed';
   }catch(error){entry.status=mode==='reference'?'reference-failed':'integration-failed';entry.error=String(error);entry.after=await snapshot(page,project.id,api).catch(()=>undefined);entry.rendered=(await page.locator('body').innerText().catch(()=>'' )).slice(-2400);}
   finally{entry.pageErrors=errors;entry.consoleErrors=consoleErrors;await closeDriver?.();await context.close();console.log(project.id,entry.id,entry.status,entry.error?.split('\n')[0]??'');writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  }
 }
}finally{await browser.close();report.finishedAt=new Date().toISOString();report.harnessSha256After=Object.fromEntries(Object.keys(report.harnessSha256).map(f=>[f,hash(readFileSync(resolve(directory,f)))]));report.harnessStable=JSON.stringify(report.harnessSha256After)===JSON.stringify(report.harnessSha256);if(digests){report.compilerDigestAfter=digests.treeDigest('src');report.compilerStable=report.compilerDigestBefore===report.compilerDigestAfter;}report.totals={positive:report.projects.flatMap(p=>p.cases).filter(c=>c.kind==='positive').length,positivePassed:report.projects.flatMap(p=>p.cases).filter(c=>c.kind==='positive'&&c.status==='passed').length,negative:report.projects.flatMap(p=>p.cases).filter(c=>c.kind==='negative').length,negativePassed:report.projects.flatMap(p=>p.cases).filter(c=>c.kind==='negative'&&c.status==='passed').length,protocolBoundaryNotApplicable:report.projects.flatMap(p=>p.cases).filter(c=>c.status==='protocol-boundary-not-applicable').length};writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('REPORT',output,JSON.stringify(report.totals));}
