import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync,type ChildProcess} from 'node:child_process';
import {createServer,type AddressInfo} from 'node:net';
import {readFileSync,existsSync,mkdtempSync,cpSync,symlinkSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,type Browser,type Page} from 'playwright';
import {compile} from '../src/compiler.js';
import {browserAdapter} from '../src/browser-adapter.js';
import type {Capability,Manifest} from '../src/model.js';

// Development regression cases from the independently authored injection generator. Labels and app sources are unchanged.
let host:string;
let browser:Browser,child:ChildProcess,baseUrl:string,manifest:Manifest;
before(async()=>{
 const modules=resolve('samples/toolchains/course-crud/node_modules');assert(existsSync(resolve(modules,'@angular/cli/bin/ng.js')),'Run npm run samples:setup before the Angular development regressions');
 host=mkdtempSync(join(tmpdir(),'angular-discovery-runtime-'));cpSync(resolve('evaluation/injection/host'),host,{recursive:true,filter:source=>!/(^|\/)(node_modules|\.angular)$/.test(source)});symlinkSync(modules,resolve(host,'node_modules'));
 execFileSync(process.execPath,[resolve('evaluation/injection/generate.mjs'),resolve(host,'src/app/injected'),'2041','30'],{stdio:'pipe'});
 manifest=compile(resolve(host,'tsconfig.app.json'),'src/app/injected/injected.routes.ts#routes');
 const reservation=createServer();await new Promise<void>((done,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',done);});
 const port=(reservation.address() as AddressInfo).port;await new Promise<void>(done=>reservation.close(()=>done()));baseUrl=`http://127.0.0.1:${port}`;
 let output='';child=spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port',String(port),'--no-live-reload'],{cwd:host,env:{...process.env,CI:'true',NG_CLI_ANALYTICS:'false',NG_BUILD_MAX_WORKERS:'2'},stdio:['ignore','pipe','pipe']});
 child.stdout?.on('data',data=>{output=(output+data).slice(-8000);});child.stderr?.on('data',data=>{output=(output+data).slice(-8000);});
 const deadline=Date.now()+110000;let ready=false;
 while(Date.now()<deadline){if(child.exitCode!==null||/Application bundle generation failed|Failed to compile/.test(output))throw new Error(output);try{const response=await fetch(baseUrl,{signal:AbortSignal.timeout(1000)});if(response.ok&&(await response.text()).includes('<')){ready=true;break;}}catch{}await delay(200);}
 assert(ready,`Generated Angular app did not start: ${output}`);browser=await chromium.launch();
},{timeout:120000});
after(async()=>{await browser?.close();if(child&&child.exitCode===null){child.kill();await Promise.race([new Promise<void>(done=>child.once('exit',()=>done())),delay(2000)]);if(child.exitCode===null)child.kill('SIGKILL');}if(host)rmSync(host,{recursive:true,force:true});});
function action(handler:string,route:string):Capability{
 const cap=manifest.capabilities.find(c=>c.handler===handler&&c.route===route&&c.status==='candidate');assert(cap,`${handler} must be a runnable discovered operation`);return cap;
}
async function session(cap:Capability,check:(page:Page,invoke:(args:Record<string,unknown>)=>Promise<unknown>)=>Promise<void>){
 const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',route=>new URL(route.request().url()).origin===baseUrl&&['GET','HEAD'].includes(route.request().method())?route.continue():route.abort('blockedbyclient'));await context.routeWebSocket('**/*',socket=>socket.close());
 const page=await context.newPage();
 const adapter=browserAdapter(page,manifest,[{id:cap.id,fingerprint:cap.fingerprint,description:'Isolated development regression',effect:'write'}],baseUrl);
 try{await page.goto(baseUrl+cap.route);await page.waitForLoadState('networkidle');assert.equal(adapter.tools.length,1);await check(page,args=>adapter.invoke(adapter.tools[0].name,args));}finally{await context.close();}
}
const records=(page:Page,selector:string)=>page.evaluate(selector=>{const component=(window as any).ng.getComponent(document.querySelector(selector));return component.svc.list();},selector);
test('literal stepper arguments click the correct authored decrement and increment buttons',{timeout:30000},async()=>{
 const cap=action('adjust','/urgent-course-counter');await session(cap,async(page,invoke)=>{
  const qty=page.locator('app-urgent-course-counter span');assert.equal(await qty.textContent(),'10');
  await invoke({delta:1});assert.equal(await qty.textContent(),'11');await invoke({delta:-1});assert.equal(await qty.textContent(),'10');
  await assert.rejects(invoke({delta:2}),/allowed values/);assert.equal(await qty.textContent(),'10');
 });
});
test('trimmed search contracts reject whitespace-padded one-character queries before changing state',{timeout:30000},async()=>{
 const cap=action('onSearch','/regional-booking-finder');await session(cap,async(page,invoke)=>{
  await invoke({query:'Booking 2'});assert.equal(await page.locator('app-regional-booking-finder li').count(),1);
  const last=()=>page.evaluate(()=>((window as any).ng.getComponent(document.querySelector('app-regional-booking-finder'))).svc.lastQuery);
  assert.equal(await last(),'booking 2');await assert.rejects(invoke({query:' b '}),/pattern/);assert.equal(await last(),'booking 2');
 });
});
test('template-reference inline rename edits only the selected row through its UI',{timeout:30000},async()=>{
 const cap=action('saveName','/archive-booking-catalog');await session(cap,async(page,invoke)=>{
  const before=await records(page,'app-archive-booking-catalog');await invoke({id:'boo-2',name:'  Renamed booking  '});const after=await records(page,'app-archive-booking-catalog');
  assert.deepEqual(after.map((row:any)=>row.id),before.map((row:any)=>row.id));assert.equal(after[1].guestName,'Renamed booking');assert.deepEqual(after.filter((row:any)=>row.id!=='boo-2'),before.filter((row:any)=>row.id!=='boo-2'));
  assert.equal(await page.locator('app-archive-booking-catalog li input').nth(1).inputValue(),'Renamed booking');
  await assert.rejects(invoke({id:'missing-row',name:'Should not save'}),/Expected one UI action/);assert.deepEqual(await records(page,'app-archive-booking-catalog'),after);
 });
});
test('a forwarded child ngSubmit persists through the parent business handler',{timeout:30000},async()=>{
 const cap=action('handleSubmit','/seasonal-recipe-page');const truth=JSON.parse(readFileSync(resolve(host,'src/app/injected/truth.json'),'utf8')).find((label:any)=>label.idiom==='child-output-parent-handler');
 await session(cap,async(page,invoke)=>{
  const before=await records(page,'app-seasonal-recipe-page');await invoke(truth.validInput);const after=await records(page,'app-seasonal-recipe-page');assert.equal(after.length,before.length+1);
  const saved=after.find((row:any)=>!before.some((previous:any)=>previous.id===row.id));assert.equal(saved.dishName,truth.validInput.dishName);assert.equal(saved.cuisine,truth.validInput.cuisine);
  await page.getByText(truth.validInput.dishName,{exact:true}).waitFor({state:'visible'});await assert.rejects(invoke({...truth.validInput,dishName:'x'}),/fewer than 3/);assert.equal((await records(page,'app-seasonal-recipe-page')).length,after.length);
 });
});
test('a source signal input is filled before its click workflow and validated by trimmed guards',{timeout:30000},async()=>{
 const cap=action('addItem','/verified-course-queue');assert.deepEqual(cap.fields.map(field=>field.name),['instructorName']);
 await session(cap,async(page,invoke)=>{
  const before=await records(page,'app-verified-course-queue');await invoke({instructorName:'  Introductory course  '});const after=await records(page,'app-verified-course-queue');
  assert.equal(after.length,before.length+1);assert.equal(after.at(-1).instructorName,'Introductory course');assert.equal(await page.locator('app-verified-course-queue input').inputValue(),'');
  for(const value of [' x ', 'x'.repeat(61)])await assert.rejects(invoke({instructorName:value}),/pattern|fewer than/);
  assert.deepEqual(await records(page,'app-verified-course-queue'),after);
 });
});

