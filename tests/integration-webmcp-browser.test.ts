import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,existsSync,rmSync} from 'node:fs';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {chromium,type Browser,type Page} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';

const source=String.raw`
import {Component,enableProdMode,provideZonelessChangeDetection,signal} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {FormControl,FormGroup,ReactiveFormsModule,Validators} from '@angular/forms';
@Component({selector:'native-webmcp-app',standalone:true,imports:[ReactiveFormsModule],template:__T__
 <form id="task-form" [formGroup]="task" (ngSubmit)="save()">
  <label>Task title<input formControlName="title"></label><button type="submit">Add task</button>
 </form>
 @if(showExtra()){
  <form id="extra-form" [formGroup]="extra" (ngSubmit)="saveExtra()">
   <label>Extra title<input formControlName="extraTitle"></label><button type="submit">Save extra</button>
  </form>
 }
 <button id="remove-extra" type="button" (click)="showExtra.set(false)">Remove extra form</button>
 @for(row of rows();track row.id){<button class="row-action" [id]="'row-'+row.id" type="button" (click)="remove(row.id)">Remove {{row.title}}</button>}
 <output id="saved-count">{{saved().length}}</output>
__T__})
class NativeWebMcpApp{
 task=new FormGroup({title:new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.minLength(3)],updateOn:'submit'})});
 extra=new FormGroup({extraTitle:new FormControl('',{nonNullable:true,validators:[Validators.required]})});
 showExtra=signal(true);saved=signal<{title:string}[]>([]);rows=signal([{id:1,title:'First'},{id:2,title:'Second'}]);
 save(){if(this.task.invalid||this.task.pending)return;this.saved.update(items=>[...items,this.task.getRawValue()]);localStorage.setItem('saved-tasks',JSON.stringify(this.saved()));}
 saveExtra(){if(this.extra.invalid)return;localStorage.setItem('saved-extra',JSON.stringify(this.extra.getRawValue()));}
 remove(id:number){this.rows.update(rows=>rows.filter(row=>row.id!==id));localStorage.setItem('removed-row',String(id));}
}
enableProdMode();bootstrapApplication(NativeWebMcpApp,{providers:[provideZonelessChangeDetection()]}).catch(console.error);
`.replaceAll('__T__',String.fromCharCode(96));

function body(result:any):any{
 if(typeof result==='string')return body(JSON.parse(result));
 if(result?.structuredContent)return result.structuredContent;
 const content=result?.content?.find((item:any)=>item.type==='text');
 if(content)try{return JSON.parse(content.text);}catch{/* A native error can be plain text. */}
 return result;
}

async function nativeTools(page:Page):Promise<any[]>{
 return page.evaluate(async()=>{
  const tools=await(document as any).modelContext.getTools();
  return tools.map((tool:any)=>({name:tool.name,inputSchema:tool.inputSchema,description:tool.description}));
 });
}

async function nativeCall(page:Page,name:string,args:Record<string,unknown>):Promise<any>{
 return page.evaluate(async({name,args})=>{
  try{
   const context=(document as any).modelContext,tool=(await context.getTools()).find((candidate:any)=>candidate.name===name);
   if(!tool)throw new Error('Native WebMCP tool is not registered: '+name);
   const result=await context.executeTool(tool,args);
   return typeof result==='string'?JSON.parse(result):result;
  }catch(error){return {isError:true,nativeException:String(error)};}
 },{name,args});
}

async function refresh(page:Page){
 await page.evaluate(async()=>{await(globalThis as any).__angularMcpBridge.__angularMcpWebMcp.refresh();});
}

async function target(page:Page,selector:string){
 const sourceId=await page.locator(selector).getAttribute('angularMcpSource');
 const instanceId=await page.locator(selector).getAttribute('data-angular-mcp-instance');
 assert(sourceId);assert(instanceId);return {sourceId,instanceId};
}

test('native browser WebMCP: production AOT, explicit modes, original effects and lifecycle',{timeout:300000},async t=>{
 const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
 const harness=['tests/integration-webmcp-browser.test.ts','evaluation/digest.mjs','tooling/check-webmcp-evidence.mjs'];
 const harnessHashes=()=>Object.fromEntries(harness.map(file=>[file,hash(readFileSync(file))]));
 const harnessSha256Before=harnessHashes();
 const {treeDigest}=await import(pathToFileURL(resolve('evaluation/digest.mjs')).href);
 const compilerDigestBefore=treeDigest('src');
 const {prepareIntegration,buildIntegration}=await import('../src/integration-project.js');
 const {createIntegrationMcpServer}=await import('../src/integration-mcp.js');
 const temporary=mkdtempSync(join(tmpdir(),'ngx-mcp-native-webmcp-'));
 const evidence:any={formatVersion:1,compilerDigestBefore,harnessSha256Before,kind:'native-webmcp-conformance',startedAt:new Date().toISOString(),nativeVerified:false,browserChannel:process.env['WEBMCP_BROWSER_EXECUTABLE']?'custom executable':'chrome',browserFlags:['--enable-features=WebMCP','--enable-blink-features=WebMCP'],modes:[],scope:'Native browser API and production Angular fixtures; no claim of ChatGPT or Claude product interoperability. Publisher lifecycle uses persisted page events, not actual BFCache navigation.'};
 let browser:Browser|undefined,browserDirectory:string|undefined;
 const server=createServer((request,response)=>{
  if(!browserDirectory){response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><title>Native WebMCP capability probe</title>');return;}
  const requested=join(browserDirectory,new URL(request.url??'/','http://local').pathname);
  const path=existsSync(requested)&&!request.url?.endsWith('/')?requested:join(browserDirectory,'index.html');
  response.writeHead(200,{'content-type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html'});response.end(readFileSync(path));
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const url='http://127.0.0.1:'+(server.address() as any).port;
 try{
  try{
   browser=await chromium.launch({...(process.env['WEBMCP_BROWSER_EXECUTABLE']?{executablePath:process.env['WEBMCP_BROWSER_EXECUTABLE']}:{channel:'chrome'}),headless:true,args:['--enable-features=WebMCP','--enable-blink-features=WebMCP']});
  }catch(error){
   if(process.env['WEBMCP_REQUIRE_NATIVE']==='1')throw error;
   evidence.unavailable=String(error);t.skip('Current native WebMCP conformance needs installed Chrome (or WEBMCP_BROWSER_EXECUTABLE); deterministic publisher tests remain separate.');return;
  }
  evidence.browserVersion=browser.version();
  const probe=await browser.newPage();await probe.goto(url);
  const capability=await probe.evaluate(()=>{const context=(document as any).modelContext;return {secure:isSecureContext,current:!!context,register:typeof context?.registerTool,getTools:typeof context?.getTools,executeTool:typeof context?.executeTool,nativeMethods:!!context&&['registerTool','getTools','executeTool'].every(name=>typeof context[name]==='function'&&Function.prototype.toString.call(context[name]).includes('[native code]')),legacy:!!(navigator as any).modelContext};});
  evidence.capability=capability;await probe.close();
  if(!capability.current||!capability.nativeMethods||capability.getTools!=='function'||capability.executeTool!=='function'){
   if(process.env['WEBMCP_REQUIRE_NATIVE']==='1')assert.fail('The selected browser does not expose current document.modelContext registration and invocation APIs: '+JSON.stringify(capability));
   t.skip('The selected browser lacks current document.modelContext.getTools/executeTool; this is not a native interoperability pass.');return;
  }
  const modules=resolve('samples/toolchains/course-crud/node_modules');
  assert(existsSync(join(modules,'@angular/compiler-cli')),'Run npm run test:setup first.');
  for(const mode of ['mcp','webmcp','both'] as const)await t.test(mode,{timeout:90000},async()=>{
   const workspace=join(temporary,mode),out=join(temporary,mode+'-generated');mkdirSync(workspace);
   symlinkSync(modules,join(workspace,'node_modules'),'dir');
   writeFileSync(join(workspace,'app.ts'),source);writeFileSync(join(workspace,'package.json'),JSON.stringify({name:'native-webmcp-'+mode,private:true,type:'module'}));
   writeFileSync(join(workspace,'index.html'),'<!doctype html><html><head><base href="/"></head><body><native-webmcp-app></native-webmcp-app></body></html>');
   writeFileSync(join(workspace,'angular.json'),JSON.stringify({version:1,projects:{native:{projectType:'application',root:'',sourceRoot:'.',architect:{build:{builder:'@angular/build:application',options:{browser:'app.ts',tsConfig:'tsconfig.json',index:'index.html',outputPath:'build',optimization:true,aot:true,outputHashing:'none',polyfills:[],styles:[]}}}}}}));
   writeFileSync(join(workspace,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[],outDir:'output',useDefineForClassFields:false},angularCompilerOptions:{strictTemplates:true},files:['app.ts']}));
   const prepared=await prepareIntegration(join(workspace,'tsconfig.json'),{outDir:out,mode});
   assert.equal(readFileSync(join(workspace,'app.ts'),'utf8'),source,'Generating each mode preserves the original application.');
   await buildIntegration(prepared);browserDirectory=join(out,'build/browser');
   const context=await browser!.newContext(),page=await context.newPage();const errors:string[]=[];
   page.on('pageerror',error=>errors.push(error.message));
   let client:Client|undefined,mcp:ReturnType<typeof createIntegrationMcpServer>|undefined,modePassed=false;
   try{
    await page.goto(url);await page.waitForFunction(()=>!!(globalThis as any).__angularMcpBridge);
    assert.equal(await page.evaluate(()=>typeof(globalThis as any).ng),'undefined','Production conformance does not use Angular debug APIs.');
    assert.equal(await page.evaluate(()=>(globalThis as any).__angularMcpBridge.mode),mode);
    if(mode==='mcp'){
     assert.deepEqual(await nativeTools(page),[],'MCP-only mode does not publish native browser tools.');
     assert.equal(await page.evaluate(()=>!!(globalThis as any).__angularMcpBridge.__angularMcpWebMcp),false);
    }else{
     await page.waitForFunction(()=>(globalThis as any).__angularMcpBridge.__angularMcpWebMcp?.status==='active');await refresh(page);
     const tools=await nativeTools(page),form=tools.find(tool=>tool.name.startsWith('angular_form_')&&tool.inputSchema.properties.title);
     assert(form,'An actual native browser tool describes the exact Angular form.');
     assert.equal(form.inputSchema.properties.title.type,'string');
     assert(!tools.some(tool=>['angular_press_key','angular_upload_file','angular_navigate'].includes(tool.name)),'Native publication does not pretend to supply browser-privileged Node operations.');
     const before=await page.locator('#task-form input').inputValue();
     const invalid=await nativeCall(page,form.name,{title:42});assert(invalid.isError,JSON.stringify(invalid));
     assert.equal(await page.locator('#task-form input').inputValue(),before,'Malformed tool input cannot partially change the live form.');
     assert.equal(await page.evaluate(()=>localStorage.getItem('saved-tasks')),null);
     const unknown=await nativeCall(page,form.name,{title:'Must not write',unexpected:'field'});assert(unknown.isError,JSON.stringify(unknown));assert.equal(await page.locator('#task-form input').inputValue(),before);
     const saved=await nativeCall(page,form.name,{title:'From native WebMCP'});assert(!saved.isError,JSON.stringify(saved));
     assert.equal(body(saved).status,'ui-dispatched');assert.equal(body(saved).businessStatus,'unknown');
     assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('saved-tasks')??'null')),[{title:'From native WebMCP'}]);
     await nativeCall(page,form.name,{title:'a'});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('saved-tasks')??'[]').length),1,'Original Angular validators still reject invalid business input.');
     // Keep the actual RegisteredTool object, then remove its Angular view using a published action.
     await page.evaluate(async()=>{(globalThis as any).__nativeStaleForm=(await(document as any).modelContext.getTools()).find((tool:any)=>tool.name.startsWith('angular_form_')&&tool.inputSchema.properties.extraTitle);});
     const extraName=await page.evaluate(()=>(globalThis as any).__nativeStaleForm.name);
     const removal=await nativeCall(page,'angular_activate',{target:await target(page,'#remove-extra')});assert(!removal.isError,JSON.stringify(removal));
     await page.waitForFunction(()=>!document.querySelector('#extra-form'));await refresh(page);
     assert(!(await nativeTools(page)).some(tool=>tool.name===extraName),'Destroyed Angular views unregister their actual browser tools.');
     const stale=await page.evaluate(async()=>{try{await(document as any).modelContext.executeTool((globalThis as any).__nativeStaleForm,{extraTitle:'Stale must not save'});return false;}catch{return true;}});
     assert(stale,'A retained native tool handle cannot execute a destroyed form.');assert.equal(await page.evaluate(()=>localStorage.getItem('saved-extra')),null);
     const second=await target(page,'#row-2');
     const ambiguous=await nativeCall(page,'angular_activate',{target:{sourceId:second.sourceId}});assert(ambiguous.isError,JSON.stringify(ambiguous));assert.equal(await page.locator('.row-action').count(),2);
     const removed=await nativeCall(page,'angular_activate',{target:second});assert(!removed.isError,JSON.stringify(removed));
     await page.waitForFunction(()=>!document.querySelector('#row-2'));assert.equal(await page.locator('#row-1').textContent(),'Remove First');assert.equal(await page.evaluate(()=>localStorage.getItem('removed-row')),'2');
     const reused=await nativeCall(page,'angular_activate',{target:second});assert(reused.isError,JSON.stringify(reused));assert.equal(await page.locator('#row-1').textContent(),'Remove First');
    }
    const pair=InMemoryTransport.createLinkedPair();mcp=createIntegrationMcpServer(page,url);client=new Client({name:'native-webmcp-parity',version:'1'});
    await mcp.connect(pair[0]);await client.connect(pair[1]);
    if(mode==='webmcp')await assert.rejects(client.listTools(),/mode|WebMCP|webmcp/,'WebMCP-only mode is not silently exposed over the Node adapter.');
    else{
     const listed=await client.listTools(),form=listed.tools.find(tool=>tool.name.startsWith('angular_form_')&&(tool.inputSchema.properties as any)?.title);assert(form);
     if(mode==='both'){
      const native=(await nativeTools(page)).find(tool=>tool.name===form.name);assert(native);assert.deepEqual(native.inputSchema,form.inputSchema,'Both transports share the same form input contract on the same page.');
     }
     const result=await client.callTool({name:form.name,arguments:{title:'From Node MCP'}});assert(!result.isError,JSON.stringify(result));
     assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('saved-tasks')??'null')),mode==='both'?[{title:'From native WebMCP'},{title:'From Node MCP'}]:[{title:'From Node MCP'}]);
    }
    if(mode!=='mcp'){
     // Exercise the publisher's persisted page-event lifecycle against native registrations.
     // These events do not claim that the browser actually entered its back-forward cache.
     const beforeRestore=await page.evaluate(()=>JSON.parse(localStorage.getItem('saved-tasks')??'[]').length);
     await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
     assert.deepEqual(await nativeTools(page),[],'A persisted pagehide removes native registrations.');
     await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
     await page.waitForFunction(()=>(globalThis as any).__angularMcpBridge.__angularMcpWebMcp?.status==='active');await refresh(page);
     const restoredForm=(await nativeTools(page)).find(tool=>tool.name.startsWith('angular_form_')&&tool.inputSchema.properties.title);assert(restoredForm);
     const restored=await nativeCall(page,restoredForm.name,{title:'After page restore'});assert(!restored.isError,JSON.stringify(restored));
     const restoredTasks=await page.evaluate(()=>JSON.parse(localStorage.getItem('saved-tasks')??'[]'));assert.equal(restoredTasks.length,beforeRestore+1);assert.deepEqual(restoredTasks.at(-1),{title:'After page restore'});
     await page.evaluate(()=>(globalThis as any).__angularMcpBridge.__angularMcpWebMcp.dispose());
     await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
     assert.deepEqual(await nativeTools(page),[],'Explicit disposal cannot be undone by a later pageshow event.');
    }
    assert.deepEqual(errors,[]);modePassed=true;
   }finally{await client?.close();await mcp?.close();await context.close();}
   if(modePassed)evidence.modes.push({mode,productionAot:true,sourcePreserved:true,nativePublished:mode!=='mcp',nodeAvailable:mode!=='webmcp',nativeEffectsVerified:mode!=='mcp',sharedPageParity:mode==='both',pageLifecycle:mode!=='mcp'});
  });
  evidence.nativeVerified=evidence.modes.length===3;
 }finally{
  await browser?.close();await new Promise<void>(done=>server.close(()=>done()));rmSync(temporary,{recursive:true,force:true});
  evidence.finishedAt=new Date().toISOString();evidence.resourcesClosed=true;
  evidence.compilerDigestAfter=treeDigest('src');evidence.compilerStable=evidence.compilerDigestBefore===evidence.compilerDigestAfter;
  evidence.harnessSha256After=harnessHashes();evidence.harnessStable=JSON.stringify(evidence.harnessSha256Before)===JSON.stringify(evidence.harnessSha256After);
  evidence.nativeVerified=evidence.nativeVerified&&evidence.compilerStable&&evidence.harnessStable;
  if(process.env['WEBMCP_NATIVE_REPORT']){
   const path=resolve(process.env['WEBMCP_NATIVE_REPORT']),bytes=JSON.stringify(evidence,null,2)+'\n';mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);
   writeFileSync(path+'.sha256.json',JSON.stringify({path:basename(path),sha256:hash(bytes)},null,2)+'\n');
  }
  assert.equal(evidence.compilerStable,true,'Compiler source changed during native conformance');
  assert.equal(evidence.harnessStable,true,'Native test harness changed during conformance');
 }
});
