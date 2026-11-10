import assert from 'node:assert/strict';
import {writeFileSync,readFileSync,mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareIntegration,buildIntegration} from '../../../src/integration-project.js';
import {createIntegrationMcpServer} from '../../../src/integration-mcp.js';
import {treeDigest} from '../../metrics.js';
import {assertFrozen,freshPage,snapshot,seed,sourceRoot,projectRoot,artifactRoot,require} from './fixture.mjs';
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {InMemoryTransport}=require('@modelcontextprotocol/sdk/inMemory.js');
const {chromium}=require('playwright');
assertFrozen();const beforeDigest=treeDigest('src');const output=process.env.HOLDOUT_MCP_OUT??join(artifactRoot,'mcp-remediated-second-pass.json');
if(existsSync(output))throw new Error('Preserve existing first-pass evidence; choose HOLDOUT_MCP_OUT for a replay.');
const report:any={formatVersion:1,kind:process.env.HOLDOUT_RUN_KIND??'remediated-second-pass-after-evaluated-template-support',developmentExposure:'The first pass exposed shared constant template mapping failure. The generic compiler was repaired with real Angular tests before this second pass; this is not untouched holdout evidence.',startedAt:new Date().toISOString(),labelFreeze:'23cd7896c6ff015f4f080c1e9d82c3a026e79bf78f3407a1e3336c3b936005d7',compilerTreeDigestBefore:beforeDigest,sourceUnchangedBefore:true,confirmationPolicy:'Native confirm decisions are independent external UI/human steps, recorded per case; they are not MCP automation successes.',schemaMapping:'Frozen business operations map to generic node actions by source-authored DOM selector and exact current registry instanceId. Text workflows call fill then the authored keyup action. No component, service, Angular debug API or model mutation is used.',cases:[]};
let browser:any,child:any;
try{
 const out=join(mkdtempSync(join(tmpdir(),'notes-holdout-')),'integrated');
 const prepared=await prepareIntegration(join(sourceRoot,'tsconfig.app.json'),{outDir:out});report.instrumentation={workspace:out,angularVersion:prepared.angularVersion,nodes:prepared.nodes,diagnostics:prepared.diagnostics};
 await buildIntegration(prepared,{configuration:'production'});report.build='passed';
 const baseUrl=process.env.HOLDOUT_INTEGRATED_URL??'http://127.0.0.1:4376/';
 child=spawn(process.execPath,[join(out,'node_modules/@angular/cli/bin/ng.js'),'serve','--host','127.0.0.1','--port',new URL(baseUrl).port,'--configuration','production'],{cwd:out,stdio:['ignore','pipe','pipe']});let serverLog='';child.stdout.on('data',(b:Buffer)=>{serverLog+=b;process.stderr.write(b);});child.stderr.on('data',(b:Buffer)=>{serverLog+=b;process.stderr.write(b);});
 for(let n=0;n<120;n++){if(child.exitCode!==null)throw new Error('Integrated server exited '+child.exitCode);try{if((await fetch(baseUrl)).ok)break;}catch{}if(n===119)throw new Error('Integrated server timeout');await new Promise(r=>setTimeout(r,500));}
 browser=await chromium.launch({headless:true});
 const run=async(id:string,fn:(page:any,call:any,target:any)=>Promise<any>,empty=false)=>{
  const {page,context}=await freshPage(browser,baseUrl,empty);let client:any,server:any;const calls:any[]=[];let result:any;
  try{
   await page.waitForFunction(()=>!!(globalThis as any).__angularMcpBridge);
   server=createIntegrationMcpServer(page,baseUrl);client=new Client({name:'independent-notes-holdout',version:'1.0.0'},{capabilities:{}});const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();await server.connect(serverTransport);await client.connect(clientTransport);
   const listed=await client.listTools();const before=await snapshot(page);
   const call=async(name:string,args:any)=>{const response=await client.callTool({name,arguments:args});calls.push({name,args,response});assert(!response.isError,JSON.stringify(response));return response;};
   const target=async(selector:string)=>{const node=page.locator(selector);assert.equal(await node.count(),1,'Source-authored selector must identify exactly one node');const instanceId=await node.getAttribute('data-angular-mcp-instance');assert(instanceId,'Authored node is unregistered: '+selector);const t={instanceId};await call('angular_describe_node',{target:t});return t;};
   await call('angular_list_nodes',{});const extra=await fn(page,call,target);const after=await snapshot(page);result={id,pass:true,before,after,toolNames:listed.tools.map((t:any)=>t.name),calls,...extra};
  }catch(error:any){result={id,pass:false,error:error.stack,calls,after:await snapshot(page)};}finally{await client?.close();await server?.close();await context.close();}report.cases.push(result);console.log(JSON.stringify(result));
 };
 const edit=async(call:any,target:any,value:string)=>{const t=await target('app-note-detail textarea');await call('angular_fill',{target:t,value});await call('angular_activate',{target:t,event:'keyup'});};
 const activate=async(call:any,target:any,selector:string)=>call('angular_activate',{target:await target(selector)});
 const confirm=async(page:any,call:any,target:any,selector:string,accept:boolean)=>{const dialogs:any[]=[];page.once('dialog',async(d:any)=>{dialogs.push({type:d.type(),message:d.message(),decision:accept?'accept':'dismiss',externalHumanStep:true});await(accept?d.accept():d.dismiss());});await activate(call,target,selector);return dialogs;};
 await run('load_seeded',async(page,call)=>{await call('angular_navigate',{path:'/'});const s=await snapshot(page);assert.equal(s.rows.length,2);assert.equal(s.textarea,seed[0].text);assert(s.rows[0].selected);assert.deepEqual(s.storage,seed);});
 await run('load_empty',async(page,call)=>{await call('angular_navigate',{path:'/'});const s=await snapshot(page);assert.equal(s.rows.length,1);assert.equal(s.textarea,'');assert(s.rows[0].dirty);assert.deepEqual(s.storage,[]);},true);
 await run('create_blank',async(page,call,target)=>{await activate(call,target,'app-new-button a');const s=await snapshot(page);assert.equal(s.rows.length,3);assert.equal(s.textarea,'');assert(s.rows[2].dirty);assert(s.rows[2].selected);assert.deepEqual(s.storage,seed);});
 await run('edit_selected',async(page,call,target)=>{await edit(call,target,'Revised first fixture note');const s=await snapshot(page);assert.equal(s.textarea,'Revised first fixture note');assert.equal(s.rows[0].title,'Revised first fixtur...');assert(s.rows[0].dirty);assert.deepEqual(s.storage,seed);});
 await run('select_other',async(page,call,target)=>{await activate(call,target,'app-note-list-item:nth-of-type(2)');const s=await snapshot(page);assert.equal(s.textarea,seed[1].text);assert(s.rows[1].selected);assert.deepEqual(s.storage,seed);});
 await run('save_existing',async(page,call,target)=>{await edit(call,target,'Saved fixture revision');await activate(call,target,'app-save-button a');const s=await snapshot(page);assert.deepEqual(s.storage,[{id:1,text:'Saved fixture revision'},seed[1]]);assert(!s.rows[0].dirty);});
 await run('delete_header_accept',async(page,call,target)=>{const dialogs=await confirm(page,call,target,'header app-delete-button a',true);const s=await snapshot(page);assert.deepEqual(s.storage,[seed[1]]);assert.equal(s.rows.length,1);assert.equal(s.textarea,seed[1].text);assert.equal(dialogs[0]?.type,'confirm');return {dialogs};});
 await run('delete_row_accept',async(page,call,target)=>{const dialogs=await confirm(page,call,target,'app-note-list-item:nth-of-type(2) app-delete-button a',true);const s=await snapshot(page);assert.deepEqual(s.storage,[seed[0]]);assert.equal(s.rows.length,1);assert.equal(dialogs[0]?.type,'confirm');return {dialogs};});
 await run('delete_header_cancel',async(page,call,target)=>{const dialogs=await confirm(page,call,target,'header app-delete-button a',false);const s=await snapshot(page);assert.deepEqual(s.storage,seed);assert.equal(s.rows.length,2);assert.equal(dialogs[0]?.decision,'dismiss');return {dialogs};});
 await run('delete_row_cancel',async(page,call,target)=>{const dialogs=await confirm(page,call,target,'app-note-list-item:nth-of-type(2) app-delete-button a',false);const s=await snapshot(page);assert.deepEqual(s.storage,seed);assert.equal(s.rows.length,2);assert.equal(dialogs[0]?.decision,'dismiss');return {dialogs};});
 await run('empty_text_allowed',async(page,call,target)=>{await edit(call,target,'');const s=await snapshot(page);assert.equal(s.textarea,'');assert(s.rows[0].dirty);assert.deepEqual(s.storage,seed);});
 await run('long_title_truncated_only',async(page,call,target)=>{const text='12345678901234567890 additional complete text';await edit(call,target,text);const s=await snapshot(page);assert.equal(s.textarea,text);assert.equal(s.rows[0].title,'12345678901234567890...');assert.deepEqual(s.storage,seed);});
 report.serverLog=serverLog;
}catch(error:any){report.failureStage=report.build==='passed'?'runtime':'instrumentation-or-build';report.error=error.stack;process.exitCode=1;
}finally{
 await browser?.close();child?.kill('SIGTERM');report.finishedAt=new Date().toISOString();report.compilerTreeDigestAfter=treeDigest('src');report.compilerSourceUnchanged=report.compilerTreeDigestAfter===beforeDigest;try{assertFrozen();report.sourceUnchangedAfter=true;}catch(error:any){report.sourceUnchangedAfter=false;report.sourceIntegrityError=error.message;}
 const reference=JSON.parse(readFileSync(join(artifactRoot,'reference-results.json'),'utf8'));for(const result of report.cases){result.nativeReferencePass=reference.cases.find((c:any)=>c.id===result.id)?.pass;result.upstreamReferenceFailure=result.nativeReferencePass===false;}report.additionalIntegrationFailures=report.cases.filter((c:any)=>c.nativeReferencePass&&!c.pass).map((c:any)=>c.id);report.nativeReferencePassed=reference.passed;
 report.passed=report.cases.filter((c:any)=>c.pass).length;report.total=12;report.executed=report.cases.length;report.validForFinalGate=report.compilerSourceUnchanged&&report.sourceUnchangedAfter;
 report.evaluatorSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,passed:report.passed,total:report.total,executed:report.executed,error:report.error,validForFinalGate:report.validForFinalGate}));if(report.passed!==report.total||!report.validForFinalGate)process.exitCode=1;
}
