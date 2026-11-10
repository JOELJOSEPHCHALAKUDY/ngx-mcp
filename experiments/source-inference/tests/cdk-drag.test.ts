import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer,type Server} from 'node:http';
import {spawnSync} from 'node:child_process';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {build} from 'esbuild';
import {chromium,type Browser,type BrowserContext,type Page} from 'playwright';
import {compile} from '../src/compiler.js';
import {browserAdapter} from '../src/browser-adapter.js';
import {generate} from '../src/codegen.js';
import type {Capability} from '../src/model.js';

const directory=mkdtempSync(resolve(tmpdir(),'angular-cdk-drag-'));
const modules=resolve('samples/toolchains/course-crud/node_modules');
symlinkSync(modules,resolve(directory,'node_modules'),'dir');
writeFileSync(resolve(directory,'app.ts'),`
import {Component} from '@angular/core';
import {CdkDropListGroup,CdkDropList,CdkDrag,moveItemInArray,transferArrayItem,CdkDragDrop} from '@angular/cdk/drag-drop';
interface Row {id:string;name:string;}
@Component({selector:'drag-test',standalone:true,imports:[CdkDropListGroup,CdkDropList,CdkDrag],template:__T__
<button id="disable" (click)="disabled=!disabled">Toggle disabled</button>
<div cdkDropListGroup class="board">
@for(column of columns;track column.id){
 <div class="list" cdkDropList [id]="column.id" [cdkDropListData]="column.rows" [cdkDropListDisabled]="disabled" (cdkDropListDropped)="drop($event)">
 @for(item of column.rows;track item.id){<div cdkDrag [cdkDragData]="item" class="item" [attr.data-id]="item.id">{{item.name}}</div>}
 </div>
}
</div><output id="events">{{events.join(';')}}</output>__T__,styles:__T__
:host{display:block;padding:20px}.board{display:flex;gap:30px}.list{width:260px;min-height:360px;padding:8px;background:#eee}.item{display:block;box-sizing:border-box;height:70px;padding:20px;margin:6px;background:white;border:1px solid #aaa}.cdk-drag-placeholder{opacity:.2}.cdk-drag-animating{transition:transform 80ms}
__T__})
export class DragPage {
disabled=false;events:string[]=[];
columns=[{id:'left',rows:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}]},{id:'right',rows:[{id:'c',name:'Gamma'}]}];
drop(event:CdkDragDrop<Row[]>){
 if(event.previousContainer===event.container)moveItemInArray(event.container.data,event.previousIndex,event.currentIndex);
 else transferArrayItem(event.previousContainer.data,event.container.data,event.previousIndex,event.currentIndex);
 this.events.push(event.previousContainer.id+'>'+event.container.id+':'+event.previousIndex+'-'+event.currentIndex);
}
}
export const routes=[{path:'board',component:DragPage}];
`.replaceAll('__T__',String.fromCharCode(96)));
writeFileSync(resolve(directory,'main.ts'),`import '@angular/compiler';import {bootstrapApplication} from '@angular/platform-browser';import {provideZonelessChangeDetection} from '@angular/core';import {DragPage} from './app';bootstrapApplication(DragPage,{providers:[provideZonelessChangeDetection()]}).catch(error=>{document.body.textContent=String(error);});`);
writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
const capability=(mode:'reorder'|'transfer')=>{const cap=manifest.capabilities.find(c=>c.drive?.drag?.mode===mode);assert(cap,`Missing CDK ${mode}`);return cap;};
const approval=(cap:Capability)=>[{id:cap.id,fingerprint:cap.fingerprint,description:'Test the authored drag operation',effect:'write' as const}];
let browser:Browser,server:Server,baseUrl:string;
before(async()=>{
 const bundle=await build({entryPoints:[resolve(directory,'main.ts')],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',tsconfigRaw:{compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false}}});
 server=createServer((req,res)=>{res.writeHead(200,{'content-type':req.url==='/app.js'?'text/javascript':'text/html'});res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><drag-test></drag-test><script type="module" src="/app.js"></script></body></html>');});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 browser=await chromium.launch();
});
after(async()=>{await browser?.close();if(server)await new Promise<void>(done=>server.close(()=>done()));rmSync(directory,{recursive:true,force:true});});
async function fresh(){const context=await browser.newContext({viewport:{width:1200,height:900},serviceWorkers:'block'});const page=await context.newPage();await page.goto(baseUrl+'/board');await page.locator('#left .cdk-drag').first().waitFor();return {context,page};}
const ids=(page:Page,id:string)=>page.locator(`#${id} .cdk-drag`).evaluateAll(items=>items.map(el=>el.getAttribute('data-id')));
async function invoke(page:Page,mode:'reorder'|'transfer',args:Record<string,unknown>,source='left'){
 const c=capability(mode),adapter=browserAdapter(page,manifest,approval(c),baseUrl,{context:{sourceContainerId:source}});
 return adapter.invoke(adapter.tools[0].name,args);
}
test('CDK source emits distinct normalized mode contracts and explicit source context',()=>{
 const reorder=capability('reorder'),transfer=capability('transfer');
 assert.equal(reorder.status,'candidate');assert.equal(transfer.status,'candidate');
 assert.deepEqual((reorder.inputSchema as {required:string[]}).required,['previousIndex','currentIndex']);
 assert.deepEqual((transfer.inputSchema as {required:string[]}).required,['previousIndex','currentIndex','targetContainerId']);
 assert.deepEqual((reorder.contextSchema as {required:string[]}).required,['sourceContainerId']);
 assert.equal(reorder.drive?.drag?.itemAttribute,'data-id');
});
test('stock Angular CDK reorders through DOM mouse events and its original output handler',{timeout:60000},async()=>{
 const {context,page}=await fresh();try{await invoke(page,'reorder',{previousIndex:0,currentIndex:1});assert.deepEqual(await ids(page,'left'),['b','a']);assert.equal(await page.locator('#events').textContent(),'left>left:0-1');}finally{await context.close();}
});
test('stock Angular CDK transfers to an explicit destination and insertion index',{timeout:60000},async()=>{
 const {context,page}=await fresh();try{await invoke(page,'transfer',{targetContainerId:'right',previousIndex:0,currentIndex:0});assert.deepEqual(await ids(page,'left'),['b']);assert.deepEqual(await ids(page,'right'),['a','c']);assert.equal(await page.locator('#events').textContent(),'left>right:0-0');}finally{await context.close();}
});
test('CDK supports reverse reorder, append and an emptied destination without guessing',{timeout:60000},async()=>{
 const {context,page}=await fresh();try{
  await invoke(page,'reorder',{previousIndex:1,currentIndex:0});assert.deepEqual(await ids(page,'left'),['b','a']);
  await invoke(page,'transfer',{targetContainerId:'left',previousIndex:0,currentIndex:2},'right');assert.deepEqual(await ids(page,'left'),['b','a','c']);assert.deepEqual(await ids(page,'right'),[]);
  await invoke(page,'transfer',{targetContainerId:'right',previousIndex:1,currentIndex:0});assert.deepEqual(await ids(page,'left'),['b','c']);assert.deepEqual(await ids(page,'right'),['a']);
 }finally{await context.close();}
});
test('missing context, duplicate containers, invalid indices and disabled lists refuse without moving items',{timeout:60000},async()=>{
 const {context,page}=await fresh();try{
  const c=capability('reorder'),adapter=browserAdapter(page,manifest,approval(c),baseUrl);await assert.rejects(()=>adapter.invoke(adapter.tools[0].name,{previousIndex:0,currentIndex:1}),/runtime context/);
  await assert.rejects(()=>invoke(page,'reorder',{previousIndex:8,currentIndex:0}),/source index/);
  const stale=browserAdapter(page,manifest,approval(c),baseUrl,{context:{sourceContainerId:'left',expectedItemIdentity:'stale'}});await assert.rejects(()=>stale.invoke(stale.tools[0].name,{previousIndex:0,currentIndex:1}),/expected item/);
  await page.evaluate(()=>{const overlay=document.createElement('div');overlay.id='cover';overlay.style.cssText='position:fixed;inset:0;z-index:999999;background:white';document.body.appendChild(overlay);});
  await assert.rejects(()=>invoke(page,'reorder',{previousIndex:0,currentIndex:1}),/covering/);await page.evaluate(()=>document.querySelector('#cover')!.remove());
  await page.evaluate(()=>document.querySelectorAll('#left .cdk-drag')[1].setAttribute('data-id','a'));await assert.rejects(()=>invoke(page,'reorder',{previousIndex:0,currentIndex:1}),/unique rendered identity/);await page.evaluate(()=>document.querySelectorAll('#left .cdk-drag')[1].setAttribute('data-id','b'));
  await page.evaluate(()=>{const extra=document.querySelector('#left')!.cloneNode(false);document.querySelector('drag-test')!.appendChild(extra);});
  await assert.rejects(()=>invoke(page,'reorder',{previousIndex:0,currentIndex:1}),/ambiguous/);
  await page.evaluate(()=>document.querySelectorAll('#left')[1].remove());await page.locator('#disable').click();
  await assert.rejects(()=>invoke(page,'reorder',{previousIndex:0,currentIndex:1}),/disabled/);
  assert.deepEqual(await ids(page,'left'),['a','b']);assert.equal(await page.locator('#events').textContent(),'');
 }finally{await context.close();}
});
test('generated WebMCP accepts explicit embedding context and uses the same CDK driver',{timeout:60000},async()=>{
 const {context,page}=await fresh();try{
  const c=capability('reorder'),out=resolve(directory,'generated');await generate(manifest,approval(c),out);
  const {readFileSync}=await import('node:fs');const code=readFileSync(resolve(out,'webmcp.mjs'),'utf8');
  await page.evaluate(async({code})=>{const tools:Record<string,{execute(args:Record<string,unknown>):Promise<string>}>={};Object.defineProperty(document,'modelContext',{configurable:true,value:{registerTool(tool:{name:string;execute(args:Record<string,unknown>):Promise<string>}){tools[tool.name]=tool;},unregisterTool(name:string){delete tools[name];}}});const module=await import(URL.createObjectURL(new Blob([code],{type:'text/javascript'})));const cleanup=await module.install({context:{sourceContainerId:'left'}});await Object.values(tools)[0].execute({previousIndex:0,currentIndex:1});cleanup();},{code});
  assert.deepEqual(await ids(page,'left'),['b','a']);
 }finally{await context.close();}
});
test('stdio CLI loads explicit JSON context and rejects invalid context before launching a browser',{timeout:60000},async()=>{
 const cap=capability('reorder'),manifestFile=resolve(directory,'manifest.json'),reviewFile=resolve(directory,'review.json'),contextFile=resolve(directory,'context.json'),invalidFile=resolve(directory,'invalid-context.json');
 writeFileSync(manifestFile,JSON.stringify(manifest));writeFileSync(reviewFile,JSON.stringify(approval(cap)));writeFileSync(contextFile,JSON.stringify({sourceContainerId:'left'}));writeFileSync(invalidFile,'[]');
 const args=['--import','tsx','src/serve.ts','--manifest',manifestFile,'--approvals',reviewFile,'--base-url',baseUrl];
 const rejected=spawnSync(process.execPath,[...args,'--context',invalidFile],{cwd:process.cwd(),encoding:'utf8'});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/--context must contain a JSON object/);
 const missing=spawnSync(process.execPath,args,{cwd:process.cwd(),encoding:'utf8'});assert.notEqual(missing.status,0);assert.match(missing.stderr,/--context does not satisfy/);
 const client=new Client({name:'cdk-context-test',version:'1'});
 try{await client.connect(new StdioClientTransport({command:process.execPath,args:[...args,'--context',contextFile],cwd:process.cwd(),stderr:'pipe'}));const list=await client.listTools();assert.equal(list.tools.length,1);assert.match(list.tools[0].description??'',/sourceContainerId/);const result=await client.callTool({name:list.tools[0].name,arguments:{previousIndex:0,currentIndex:1}});assert(!result.isError,JSON.stringify(result));assert.equal((result.structuredContent as {status:string}).status,'ui-dispatched');}finally{await client.close();}
});
test('frozen Jira board uses the generated normalized drag plan',{timeout:60000,skip:!process.env.FRESH_JIRA_URL},async()=>{
 const context=await browser.newContext({viewport:{width:1600,height:1100}});try{
  const page=await context.newPage(),url=process.env.FRESH_JIRA_URL!;await page.goto(url+'/project/board');await page.locator('#Backlog .cdk-drag').first().waitFor();
  const jira=compile(resolve('test-apps/fresh-jira-clone/tsconfig.app.json'),'src/app/app.routes.ts#appRoutes'),cap=jira.capabilities.find(c=>c.component==='BoardDndListComponent'&&c.drive?.drag?.mode==='reorder');assert(cap);
  const before=await page.locator('#Backlog .cdk-drag').allTextContents(),adapter=browserAdapter(page,jira,approval(cap),url,{context:{sourceStatus:'Backlog'}});
  await adapter.invoke(adapter.tools[0].name,{previousIndex:0,currentIndex:1});const after=await page.locator('#Backlog .cdk-drag').allTextContents();assert.equal(after[0],before[1]);assert.equal(after[1],before[0]);
  await page.reload();await page.locator('#Backlog .cdk-drag').first().waitFor();
  const moved=(await page.locator('#Backlog .cdk-drag').first().textContent())!.replace(/\s+/g,' ').trim(),transfer=jira.capabilities.find(c=>c.component==='BoardDndListComponent'&&c.drive?.drag?.mode==='transfer');assert(transfer);
  const moveAdapter=browserAdapter(page,jira,approval(transfer),url,{context:{sourceStatus:'Backlog'}});await moveAdapter.invoke(moveAdapter.tools[0].name,{targetStatus:'Selected',previousIndex:0,currentIndex:0});
  assert((await page.locator('#Selected .cdk-drag').allTextContents()).some(t=>t.replace(/\s+/g,' ').trim()===moved));assert(!(await page.locator('#Backlog .cdk-drag').allTextContents()).some(t=>t.replace(/\s+/g,' ').trim()===moved));
 }finally{await context.close();}
});
