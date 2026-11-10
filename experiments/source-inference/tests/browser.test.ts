import {test} from 'node:test';
import assert from 'node:assert/strict';
import {samples,getSample} from '../src/samples.js';
import {runScenario} from '../samples/run-scenario.js';
import {ensureLocalApp} from '../src/local-app.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {chromium} from 'playwright';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {sampleDirectory} from '../src/samples.js';
import {compileSample,sampleApprovals,sampleUrl,scenarioCapability} from '../src/samples.js';
import {browserAdapter} from '../src/browser-adapter.js';
import {isolateSample} from '../samples/isolation.js';
import {generate} from '../src/codegen.js';
import {executeDom} from '../src/browser-runtime.js';
for(const sample of samples)test(`${sample.id}: real upstream UI — ${sample.complexity}`,{timeout:180000},async()=>{const result=await runScenario(sample);assert.equal(result.outcome,sample.scenario.expectedLimitation?'unsupported':'executed');});
test('external stdio MCP client executes the RealWorld registration workflow',{timeout:180000},async()=>{
 const app=await ensureLocalApp(getSample('realworld'));const client=new Client({name:'external-public-sample-test',version:'1'});
 try{await client.connect(new StdioClientTransport({command:process.execPath,args:['--import','tsx','tests/stdio-sample-server.ts','realworld'],cwd:process.cwd(),stderr:'pipe'}));const {tools}=await client.listTools();assert.equal(tools.length,1);const result=await client.callTool({name:tools[0].name,arguments:{username:'ExternalAgent',email:'agent@example.test',password:'Synthetic-123'}});assert(!result.isError,JSON.stringify(result));assert.equal(new URL((result.structuredContent as {url:string}).url).pathname,'/');}finally{await client.close();app?.kill();}
});
test('signup preserves the existing cross-field password validator',{timeout:180000},async()=>{
 const sample=getSample('signup');const app=await ensureLocalApp(sample);const browser=await chromium.launch();
 try{const context=await browser.newContext({serviceWorkers:'block'});await isolateSample(context,sample);const page=await context.newPage();const adapter=browserAdapter(page,compileSample(sample),sampleApprovals(sample),sampleUrl(sample));
 // The app's own validator refuses the values; the tool reports that refusal instead of an acknowledgement.
 await assert.rejects(adapter.invoke(adapter.tools[0].name,{...sample.scenario.args,confirmPassword:'Mismatch-123'}),/rejected the form values: confirmPassword \(mustMatch\)/);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('angular-15-signup-verification-boilerplate-accounts')??'[]').length),0);
 }finally{await browser.close();app?.kill();}
});
test('generated WebMCP registration contract executes the same public CRUD UI',{timeout:180000},async()=>{
 const sample=getSample('user-crud');const app=await ensureLocalApp(sample);const browser=await chromium.launch();
 try{const context=await browser.newContext({serviceWorkers:'block'});await isolateSample(context,sample);const page=await context.newPage();await page.goto(sampleUrl(sample)+sample.scenario.route);await page.waitForLoadState('networkidle');
 await generate(compileSample(sample),sampleApprovals(sample),'artifacts/webmcp-contract-test');
 const code=readFileSync('artifacts/webmcp-contract-test/webmcp.mjs','utf8');
 await page.evaluate(async({code,args})=>{
  const tools:Record<string,{execute:(args:Record<string,unknown>)=>Promise<string>}>={};
  Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(tool:{name:string;execute:(args:Record<string,unknown>)=>Promise<string>}){tools[tool.name]=tool;},unregisterTool(name:string){delete tools[name];}}});
  const module=await import(URL.createObjectURL(new Blob([code],{type:'text/javascript'})));const cleanup=await module.install();
  await Object.values(tools)[0].execute(args);cleanup();if(Object.keys(tools).length)throw new Error('WebMCP cleanup failed');
 },{code,args:sample.scenario.args});
 await page.waitForURL('**/users');const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),sample.scenario.storageKey!);assert(saved.some((u:{email:string})=>u.email===sample.scenario.args.email));
 }finally{await browser.close();app?.kill();}
});
test('course Signal Forms adds and removes rows through the original UI',{timeout:180000},async()=>{
 const sample=getSample('course-crud');const app=await ensureLocalApp(sample);const browser=await chromium.launch();
 try{const context=await browser.newContext({serviceWorkers:'block'});const fixture=await isolateSample(context,sample);const page=await context.newPage();
 await page.goto(sampleUrl(sample)+'/courses');await page.waitForLoadState('networkidle');await page.goto(sampleUrl(sample)+sample.scenario.route);await page.waitForLoadState('networkidle');
 const add=page.locator('mat-toolbar.lessons-toolbar button');await add.click();await page.waitForFunction(()=>document.querySelectorAll('table.full-width').length===2);await add.click();await page.waitForFunction(()=>document.querySelectorAll('table.full-width').length===3);
 const adapter=browserAdapter(page,compileSample(sample),sampleApprovals(sample),sampleUrl(sample));const lessons=(sample.scenario.args.lessons as unknown[]).slice(0,1);
 await adapter.invoke(adapter.tools[0].name,{...sample.scenario.args,lessons});await page.waitForURL('**/courses');assert.equal(fixture.writes.length,1);
 const saved=fixture.writes[0].body as {lessons:{name:string}[]};assert.equal(saved.lessons.length,1);assert.equal(saved.lessons[0].name,'Introduction to Angular');
 }finally{await browser.close();app?.kill();}
});
test('existing Signal Forms validation rejects invalid values even without transport schema validation',{timeout:180000},async()=>{
 const sample=getSample('course-crud');const app=await ensureLocalApp(sample);const browser=await chromium.launch();
 try{const context=await browser.newContext({serviceWorkers:'block'});const fixture=await isolateSample(context,sample);const page=await context.newPage();await page.goto(sampleUrl(sample)+sample.scenario.route);await page.waitForLoadState('networkidle');
 const capability=scenarioCapability(sample,compileSample(sample))!;
 try{await page.evaluate(executeDom,{capability,args:{...sample.scenario.args,name:'bad'}});}catch(error){assert.match(String(error),/rejected the form|disabled/);}
 assert.equal(fixture.writes.length,0);await page.getByText('Field cannot be less than 5 characters long.',{exact:true}).waitFor({state:'visible'});
 }finally{await browser.close();app?.kill();}
});
test('invalid draft edits do not bypass the original Angular form filter',{timeout:180000},async()=>{
 const sample=getSample('forms-course');const app=await ensureLocalApp(sample);const browser=await chromium.launch();
 try{const context=await browser.newContext({serviceWorkers:'block'});await isolateSample(context,sample);const page=await context.newPage();const adapter=browserAdapter(page,compileSample(sample),sampleApprovals(sample),sampleUrl(sample));
 // The generated contract now carries the form's minLength, so the transport rejects the value before the UI is touched...
 await assert.rejects(adapter.invoke(adapter.tools[0].name,{...sample.scenario.args,title:'bad'}),/fewer than 5 characters/);
 // ...and the original Angular filter still holds when the contract is bypassed.
 const capability=scenarioCapability(sample,compileSample(sample))!;
 await page.goto(sampleUrl(sample)+capability.route);await page.waitForLoadState('networkidle');
 try{await page.evaluate(executeDom,{capability,args:{...sample.scenario.args,title:'bad'}});}catch{/* the UI may refuse */}
 await page.waitForTimeout(500);
 assert.equal(await page.evaluate(()=>localStorage.getItem('STEP_1')),null);
 }finally{await browser.close();app?.kill();}
});
for(const id of ['forms-course','course-crud'])test(`${id}: external stdio client verifies the implemented workflow effect`,{timeout:180000},async()=>{
 const sample=getSample(id);const app=await ensureLocalApp(sample);const client=new Client({name:'external-workflow-test',version:'1'});
 try{await client.connect(new StdioClientTransport({command:process.execPath,args:['--import','tsx','tests/stdio-sample-server.ts',id],cwd:process.cwd(),stderr:'pipe'}));const {tools}=await client.listTools();assert.equal(tools.length,1);
 const result=await client.callTool({name:tools[0].name,arguments:sample.scenario.args});assert(!result.isError,JSON.stringify(result));
 const audit=JSON.parse(readFileSync(`artifacts/samples/${id}/stdio-runtime.json`,'utf8'));
 if(id==='forms-course'){assert.equal(audit.storage.title,sample.scenario.args.title);assert.equal(audit.storage.downloadsAllowed,true);}else{assert.equal(audit.writes.length,1);assert.equal(audit.writes[0].body.lessons.length,2);}
 }finally{await client.close();app?.kill();}
});
for(const id of ['forms-course','course-crud'])test(`${id}: generated WebMCP plan executes the same workflow`,{timeout:180000},async()=>{
 const sample=getSample(id);const app=await ensureLocalApp(sample);const browser=await chromium.launch();
 try{const context=await browser.newContext({serviceWorkers:'block'});const fixture=await isolateSample(context,sample);const page=await context.newPage();
 if(sample.scenario.preparePath){await page.goto(sampleUrl(sample)+sample.scenario.preparePath);await page.waitForLoadState('networkidle');}
 await page.goto(sampleUrl(sample)+sample.scenario.route);await page.waitForLoadState('networkidle');
 await generate(compileSample(sample),sampleApprovals(sample),`artifacts/samples/${id}/generated`);const code=readFileSync(`artifacts/samples/${id}/generated/webmcp.mjs`,'utf8');
 await page.evaluate(async({code,args})=>{
  const tools:Record<string,{execute:(args:Record<string,unknown>)=>Promise<string>}>={};
  Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(tool:{name:string;execute:(args:Record<string,unknown>)=>Promise<string>}){tools[tool.name]=tool;},unregisterTool(name:string){delete tools[name];}}});
  const module=await import(URL.createObjectURL(new Blob([code],{type:'text/javascript'})));const cleanup=await module.install();await Object.values(tools)[0].execute(args);cleanup();if(Object.keys(tools).length)throw new Error('WebMCP cleanup failed');
 },{code,args:sample.scenario.args});
 if(id==='forms-course'){assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('STEP_1')??'null').title),sample.scenario.args.title);}
 else{await page.waitForURL('**/courses');assert.equal(fixture.writes.length,1);assert.equal((fixture.writes[0].body as {lessons:unknown[]}).lessons.length,2);}
 }finally{await browser.close();app?.kill();}
});

test('the built package (dist/serve.js) drives a reviewed tool over stdio',{timeout:300000},async()=>{
 // The adapter ships as built JavaScript: serialization of the in-page runtime and the CLI wiring must work outside tsx.
 execFileSync(process.execPath,['tooling/build.mjs'],{stdio:'pipe'});
 const sample=getSample('user-crud');const app=await ensureLocalApp(sample);const client=new Client({name:'built-package-test',version:'1'});
 try{
  await client.connect(new StdioClientTransport({command:process.execPath,args:['dist/serve.js','--project',resolve(sampleDirectory(sample),sample.tsconfig),'--routes',sample.routes,'--approvals',`review/${sample.id}.json`,'--base-url',sampleUrl(sample)],cwd:process.cwd(),stderr:'pipe'}));
  const {tools}=await client.listTools();assert.equal(tools.length,1);
  const result=await client.callTool({name:tools[0].name,arguments:sample.scenario.args});
  assert(!result.isError,JSON.stringify(result));assert.equal((result.structuredContent as {status:string}).status,'ui-dispatched'); // dispatch only: the app's own timers finish later
 }finally{await client.close();app?.kill();}
});
