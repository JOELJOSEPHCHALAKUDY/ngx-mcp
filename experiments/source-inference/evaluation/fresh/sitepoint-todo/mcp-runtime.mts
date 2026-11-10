// Separate runtime harness: imports the real compiler MCP server and browser adapter.
// No application source patches, direct component/service calls, or manifest patches.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/node_modules/playwright/index.mjs';
import {Client} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {createMcpServer} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/src/mcp.ts';
import {browserAdapter} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/src/browser-adapter.ts';
import {installFixture} from './fixture.mjs';
const artifact=process.env.HOLDOUT_ARTIFACT_DIR??'/private/tmp/fresh-sitepoint-todo-evaluation';
const hash=(data:any)=>createHash('sha256').update(data).digest('hex');
const manifestBytes=readFileSync(resolve(artifact,'first-pass-manifest.json'));
const manifest=JSON.parse(manifestBytes.toString());
const labels=JSON.parse(readFileSync(resolve(artifact,'labels.json'),'utf8'));
const candidates=manifest.capabilities.filter((cap:any)=>cap.status==='candidate');
const approvals=candidates.map((cap:any)=>({id:cap.id,fingerprint:cap.fingerprint,effect:'write',description:'Independent synthetic holdout runtime check'}));
writeFileSync(resolve(artifact,'runtime-approvals.json'),JSON.stringify(approvals,null,2)+'\n');
const augmentations={note:'Separate from frozen-label baseline. Additional payload object data comes from the frozen synthetic fixture because compiler leaf schemas require complete Todo objects. No manifest changes or component calls.',cases:[{id:'toggle_todo_complete',args:{todo:{id:1,title:'Read fixture article',complete:false}},source:'prerequisites.json fixtureTodos[0]'},{id:'delete_todo',args:{todo:{id:2,title:'Clean fixture inbox',complete:false}},source:'prerequisites.json fixtureTodos[1]'}]};
writeFileSync(resolve(artifact,'runtime-context-augmentation.json'),JSON.stringify(augmentations,null,2)+'\n');
const report:any={startedAt:new Date().toISOString(),protocol:'Real MCP Client + createMcpServer over SDK InMemoryTransport linked pair; each invocation passes MCP callTool request and real browserAdapter',manifestSha256:hash(manifestBytes),labelsSha256:hash(readFileSync(resolve(artifact,'labels.json'))),sourcePatches:[],manifestPatches:[],baseline:[],schemaNativeRetries:[],contextRetries:[],tools:[]};
const browser=await chromium.launch({headless:true});
const snapshot=async(page:any,fixture:any)=>({rows:await page.locator('.todo-list li').evaluateAll((rows:any[])=>rows.map(row=>({title:row.querySelector('label').textContent,complete:row.querySelector('input').checked,class:row.className}))),fixture:structuredClone(fixture.todos),calls:structuredClone(fixture.calls)});
async function invoke(id:string,cap:any,args:any,phase:string,prepare?: (page:any)=>Promise<void>) {
 const context=await browser.newContext({serviceWorkers:'block'}); const page=await context.newPage(); const fixture=await installFixture(page);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:4341/',{waitUntil:'networkidle'});await page.locator('.todo-list li').nth(2).waitFor();
 if(prepare)await prepare(page);
 const adapter=browserAdapter(page,manifest,approvals,'http://127.0.0.1:4341/');
 const server=createMcpServer(adapter);const client=new Client({name:'sitepoint-independent-holdout',version:'1'});const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
 await server.connect(serverTransport);await client.connect(clientTransport);
 const row:any={id,phase,capability:cap?.id,args,setup:'Source prerequisite: root page loaded with synthetic fixture',before:await snapshot(page,fixture)};
 try{
  const listed=await client.listTools(); if(!report.tools.length)report.tools=listed.tools;
  if(!cap){row.status='missing';row.reason='No candidate tool for frozen source operation';}
  else {
   const tool=listed.tools.find(tool=>tool.name===adapter.tools.find((tool:any)=>tool.description.includes(cap.component))?.name)??listed.tools.find(tool=>tool.name===cap.id);
   const targetIndex=candidates.findIndex((candidate:any)=>candidate.id===cap.id);
   row.tool=listed.tools[targetIndex]?.name;
   if(!row.tool)throw new Error('Reviewed candidate was absent from actual MCP tools/list');
   row.result=await client.callTool({name:row.tool,arguments:args});
   row.after=await snapshot(page,fixture);
   const effectCalls=row.after.calls.slice(row.before.calls.length);
   row.effectCalls=effectCalls;
   row.effectVerified=id==='toggle_todo_complete'?effectCalls.some((call:any)=>call.method==='PUT'&&call.url.endsWith('/1')&&call.body.complete===true)&&fixture.todos.find((todo:any)=>todo.id===1)?.complete===true:id==='delete_todo'?effectCalls.some((call:any)=>call.method==='DELETE'&&call.url.endsWith('/2'))&&!fixture.todos.some((todo:any)=>todo.id===2):false;
   row.status=row.result.isError?'tool-error':row.effectVerified?'effect-verified':'no-verified-effect';
  }
 }catch(error:any){row.status='harness-error';row.error={message:error.message,stack:error.stack};}
 finally{row.pageErrors=errors;await client.close();await server.close();await context.close();}
 return row;
}
try{
 for(const operation of labels.operations){
  const handler=operation.id==='toggle_todo_complete'?'toggleTodoComplete':operation.id==='delete_todo'?'removeTodo':undefined;
  const cap=handler?candidates.find((cap:any)=>cap.handler===handler):undefined;
  report.baseline.push(await invoke(operation.id,cap,operation.validInput,'frozen-label-exact-input'));
 }
 for(const retry of augmentations.cases){const handler=retry.id==='toggle_todo_complete'?'toggleTodoComplete':'removeTodo';const cap=candidates.find((cap:any)=>cap.handler===handler);report.schemaNativeRetries.push(await invoke(retry.id,cap,retry.args,'compiler-schema-native-payload'));}
 const deleteCap=candidates.find((cap:any)=>cap.handler==='removeTodo');
 report.contextRetries.push(await invoke('delete_todo',deleteCap,augmentations.cases[1].args,'compiler-schema-native-plus-first-row-hover',async page=>{await page.locator('.todo-list li').first().hover();}));
}finally{await browser.close();report.finishedAt=new Date().toISOString();report.totals={frozenOperations:labels.operations.length,candidateTools:candidates.length,baselineEffectVerified:report.baseline.filter((r:any)=>r.effectVerified).length,schemaNativeEffectVerified:report.schemaNativeRetries.filter((r:any)=>r.effectVerified).length,contextEffectVerified:report.contextRetries.filter((r:any)=>r.effectVerified).length};writeFileSync(resolve(artifact,'first-pass-runtime-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({totals:report.totals,baseline:report.baseline.map((r:any)=>({id:r.id,status:r.status,result:r.result,error:r.error})),retries:report.schemaNativeRetries.map((r:any)=>({id:r.id,status:r.status,result:r.result,error:r.error})),contextRetries:report.contextRetries.map((r:any)=>({id:r.id,status:r.status,result:r.result,error:r.error}))},null,2));}
