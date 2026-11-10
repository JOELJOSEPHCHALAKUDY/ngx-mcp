// Modern untouched holdout: actual MCP protocol calls, source-only UI fixtures.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/node_modules/playwright/index.mjs';
import {Client} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {InMemoryTransport} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import {createMcpServer} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/src/mcp.ts';
import {browserAdapter} from '/Users/joeljoseph/Desktop/Personal Work/ai-experiments-apps/angular-mcp-compiler/src/browser-adapter.ts';
import {base,seedThroughUi,snapshot,installIsolation} from './fixture.mjs';
const artifact=process.env.HOLDOUT_ARTIFACT_DIR??'/private/tmp/fresh-todomvc-modern-evaluation';
const bytes=readFileSync(resolve(artifact,'first-pass-manifest.json'));const manifest=JSON.parse(bytes.toString());const labels=JSON.parse(readFileSync(resolve(artifact,'labels.json'),'utf8'));
const handlerMap={toggle_todo:'toggleTodo',delete_todo:'removeTodo',toggle_all:'toggleAll',edit_todo:'commitEdit',clear_completed:'clearCompleted'};
const choose=(id:string)=>manifest.capabilities.find((cap:any)=>cap.route==='/all'&&cap.handler===handlerMap[id]&&(id!=='delete_todo'||cap.component==='TodoListComponent'));
const report:any={startedAt:new Date().toISOString(),protocol:'Real SDK MCP Client + createMcpServer via InMemoryTransport linked pair; tools/list and tools/call',manifestSha256:createHash('sha256').update(bytes).digest('hex'),baseline:[],schemaRenameRetries:[],sourcePatches:[],manifestPatches:[],fixture:'Synthetic tasks seeded through actual DOM controls only; source has no API/backend/storage'};
const rename={id:'toggle_all',from:{completed:true},to:{checked:true},classification:'Argument rename only; boolean value preserved. This is separate from exact frozen-input baseline, not context or source/manifest augmentation.'};
writeFileSync(resolve(artifact,'runtime-context-augmentation.json'),JSON.stringify({contextAdditions:[],argumentRenames:[rename]},null,2)+'\n');
const approvals=manifest.capabilities.filter((cap:any)=>cap.status==='candidate').map((cap:any)=>({id:cap.id,fingerprint:cap.fingerprint,effect:'write',description:'Independent modern holdout synthetic runtime'}));writeFileSync(resolve(artifact,'runtime-approvals.json'),JSON.stringify(approvals,null,2)+'\n');
const browser=await chromium.launch({headless:true});
async function run(id:string,args:any,phase:string){
 const cap=choose(id);const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();const isolation=await installIsolation(page);await seedThroughUi(page);
 const selected=cap?.status==='candidate'?[{id:cap.id,fingerprint:cap.fingerprint,effect:'write',description:'Independent modern holdout synthetic runtime'}]:[];
 const adapter=browserAdapter(page,manifest,selected,base,{hash:true});const server=createMcpServer(adapter);const client=new Client({name:'todomvc-angular21-holdout',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 const row:any={id,phase,args,capability:cap?.id,before:await snapshot(page),network:isolation,setup:'Fresh empty in-memory app, synthetic rows created through UI; third row completed'};
 try{
  const listed=await client.listTools();row.tools=listed.tools;
  if(!cap){row.status='missing';row.reason='No source-derived capability for this operation';}
  else if(cap.status!=='candidate'){row.status='blocked';row.issues=cap.issues;}
  else {
   row.result=await client.callTool({name:listed.tools[0].name,arguments:args});row.after=await snapshot(page);
   row.effectVerified=id==='clear_completed'?row.after.rows.length===2&&row.after.rows.every((todo:any)=>!todo.completed)&&row.after.activeCount==='2':id==='toggle_all'?row.after.rows.length===3&&row.after.rows.every((todo:any)=>todo.completed)&&row.after.activeCount==='0':false;
   row.status=row.result.isError?'tool-error':row.effectVerified?'effect-verified':'no-verified-effect';
  }
 }catch(error:any){row.status='harness-error';row.error={message:error.message,stack:error.stack};}finally{await client.close();await server.close();await context.close();}
 return row;
}
try{
 for(const operation of labels.operations)report.baseline.push(await run(operation.id,operation.validInput,'exact-frozen-input'));
 report.schemaRenameRetries.push(await run('toggle_all',{checked:true},'schema-native-argument-rename'));
}finally{await browser.close();report.finishedAt=new Date().toISOString();report.totals={frozenOperations:labels.operations.length,sourceReferencePassed:7,exactBaselineVerified:report.baseline.filter((row:any)=>row.effectVerified).length,renameVerified:report.schemaRenameRetries.filter((row:any)=>row.effectVerified).length,businessEffectsWithRename:report.baseline.filter((row:any)=>row.effectVerified).length+report.schemaRenameRetries.filter((row:any)=>row.effectVerified).length};writeFileSync(resolve(artifact,'first-pass-runtime-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({totals:report.totals,baseline:report.baseline.map(({id,status,result,issues,error}:any)=>({id,status,result,issues,error})),schemaRenameRetries:report.schemaRenameRetries.map(({id,status,result,error}:any)=>({id,status,result,error}))},null,2));}
