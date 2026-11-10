// Separate from frozen first-pass artifacts: actual remediated compiler-native MCP execution.
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
const bytes=readFileSync(resolve(artifact,'remediated-manifest.json'));const manifest=JSON.parse(bytes.toString());const labels=JSON.parse(readFileSync(resolve(artifact,'labels.json'),'utf8'));
const handlers={add_todo:'addTodo',toggle_todo:'toggleTodo',delete_todo:'removeTodo',toggle_all:'toggleAll',edit_todo:'commitEdit',clear_completed:'clearCompleted',filter_todos:'navigate'};
const choose=(id:string)=>manifest.capabilities.find((cap:any)=>cap.route==='/all'&&cap.handler===handlers[id]&&(id!=='delete_todo'||cap.component==='TodoListComponent')&&(id!=='filter_todos'||cap.component==='FooterComponent'));
const mappings={toggle_all:{source:{completed:true},compilerNative:{checked:true},kind:'source control-name rename only'},toggle_todo:{source:{todo:{title:'Read fixture article',completed:false}},compilerNative:{todo:{title:'Read fixture article',completed:false},value:true},kind:'explicit desired checkbox value, derived as !source.todo.completed'},filter_todos:{source:{filter:'active'},compilerNative:{route:'/active'},kind:'semantic filter selection mapped to authored RouterLink path'}};
writeFileSync(resolve(artifact,'remediated-input-mappings.json'),JSON.stringify({frozenLabelsModified:false,contextAdditions:[],mappings,sourcePreconditions:{delete_todo:'Hover selected row as already frozen in labels; runtime tool still performs real destroy click'}},null,2)+'\n');
const report:any={startedAt:new Date().toISOString(),protocol:'Real SDK Client, createMcpServer, linked InMemoryTransport, tools/list and tools/call',manifestSha256:createHash('sha256').update(bytes).digest('hex'),baseline:[],compilerNative:[],boundaries:[],sourcePatches:[],manifestPatches:[],runtimeContextAdditions:[]};
const browser=await chromium.launch({headless:true});
async function execute(id:string,args:any,phase:string,prepare?:(page:any)=>Promise<void>,expectRefused=false){
 const cap=choose(id);const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();const isolation=await installIsolation(page);await seedThroughUi(page);
 if(id==='delete_todo')await page.locator('app-todo-item').filter({hasText:'Clean fixture inbox'}).hover();
 if(prepare)await prepare(page);
 const selected=cap?.status==='candidate'?[{id:cap.id,fingerprint:cap.fingerprint,effect:'write',description:'Synthetic modern holdout remediated runtime'}]:[];
 const adapter=browserAdapter(page,manifest,selected,base,{hash:true});const server=createMcpServer(adapter);const client=new Client({name:'modern-holdout-remediation',version:'1'});const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);await client.connect(b);
 const row:any={id,phase,args,capability:cap?.id,before:await snapshot(page),network:isolation};
 try{
  const listed=await client.listTools();row.tools=listed.tools;
  if(!cap){row.status='missing';}
  else if(cap.status!=='candidate'){row.status='blocked';row.issues=cap.issues;}
  else{
   row.result=await client.callTool({name:listed.tools[0].name,arguments:args});row.after=await snapshot(page);
   const source=labels.operations.find((operation:any)=>operation.id===id).validInput;
   row.effectVerified=id==='add_todo'?row.after.rows.length===4&&row.after.rows.at(-1).title===source.title.trim()&&!row.after.rows.at(-1).completed&&row.after.input==='':id==='toggle_todo'?row.after.rows.find((todo:any)=>todo.title==='Read fixture article')?.completed===true&&row.after.activeCount==='1':id==='delete_todo'?row.after.rows.length===2&&!row.after.rows.some((todo:any)=>todo.title==='Clean fixture inbox'):id==='edit_todo'?row.after.rows.some((todo:any)=>todo.title===String(args.title).trim())&&!row.after.rows.some((todo:any)=>todo.editing):id==='clear_completed'?row.after.rows.length===2&&row.after.rows.every((todo:any)=>!todo.completed):id==='toggle_all'?row.after.rows.length===3&&row.after.rows.every((todo:any)=>todo.completed)&&row.after.activeCount==='0':id==='filter_todos'?row.after.url.endsWith('/#/active')&&row.after.rows.length===2&&row.after.rows.every((todo:any)=>!todo.completed):false;
   if(expectRefused){row.refusalVerified=!!row.result.isError&&JSON.stringify(row.before.rows)===JSON.stringify(row.after.rows);row.status=row.refusalVerified?'refused-without-mutation':'unexpected-boundary-result';}
   else row.status=row.result.isError?'tool-error':row.effectVerified?'effect-verified':'no-verified-effect';
  }
 }catch(error:any){row.status='harness-error';row.error={message:error.message,stack:error.stack};}finally{await client.close();await server.close();await context.close();}
 return row;
}
try{
 for(const operation of labels.operations)report.baseline.push(await execute(operation.id,operation.validInput,'exact-frozen-input'));
 for(const operation of labels.operations){const args=mappings[operation.id]?.compilerNative??operation.validInput;report.compilerNative.push(await execute(operation.id,args,'compiler-native-with-recorded-source-mapping'));}
 const edit=labels.operations.find((operation:any)=>operation.id==='edit_todo');
 report.boundaries.push(await execute('edit_todo',edit.validInput,'duplicate-titles-refused',async page=>{await page.locator('.new-todo').fill('Read fixture article');await page.locator('.new-todo').press('Enter');},true));
 report.boundaries.push(await execute('edit_todo',edit.validInput,'other-row-editor-refused',async page=>{await page.locator('app-todo-item').filter({hasText:'Clean fixture inbox'}).locator('label').dblclick();},true));
 report.boundaries.push(await execute('edit_todo',{...edit.validInput,title:'   '},'blank-edit-source-delete'));
 const blank=report.boundaries.at(-1);if(blank.after){blank.effectVerified=blank.after.rows.length===2&&!blank.after.rows.some((todo:any)=>todo.title==='Read fixture article');blank.status=blank.result?.isError?'tool-error':blank.effectVerified?'effect-verified':'no-verified-effect';}
 report.boundaries.push(await execute('add_todo',{title:'  '},'blank-add-contract-refused',undefined,true));
}finally{await browser.close();report.finishedAt=new Date().toISOString();report.totals={frozenOperations:labels.operations.length,exactBaselineEffects:report.baseline.filter((row:any)=>row.effectVerified&&!row.result?.isError).length,compilerNativeEffects:report.compilerNative.filter((row:any)=>row.effectVerified&&!row.result?.isError).length,boundariesPassed:report.boundaries.filter((row:any)=>row.refusalVerified||row.effectVerified&&!row.result?.isError).length};writeFileSync(resolve(artifact,'remediated-runtime-results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({totals:report.totals,baseline:report.baseline.map(({id,status,result,error}:any)=>({id,status,result,error})),compilerNative:report.compilerNative.map(({id,status,result,error}:any)=>({id,status,result,error})),boundaries:report.boundaries.map(({id,phase,status,result,error}:any)=>({id,phase,status,result,error}))},null,2));}
