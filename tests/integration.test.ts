import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {chromium,type Page} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {prepareIntegration,buildIntegration} from '../src/integration-project.js';
import {createIntegrationMcpServer} from '../src/integration-mcp.js';

const appSource=String.raw`
import {Component,enableProdMode,provideZonelessChangeDetection,signal} from '@angular/core';
import {bootstrapApplication} from '@angular/platform-browser';
import {AbstractControl,FormArray,FormControl,FormGroup,ReactiveFormsModule,Validators} from '@angular/forms';
import {form,required,validate,FormField,FormRoot} from '@angular/forms/signals';
const conditional=(c:AbstractControl)=>Validators.maxLength(c.parent?.get('shortMode')?.value?8:100)(c);
@Component({selector:'integration-app',standalone:true,imports:[ReactiveFormsModule,FormField,FormRoot],template:__T__
<form id="conditional" [formGroup]="conditional" (ngSubmit)="saveConditional()">
 <label>Short mode<input type="checkbox" formControlName="shortMode"></label>
 <label>Note<input formControlName="note"></label><button type="submit">Save note</button>
</form>
<form id="submit-timing" [formGroup]="timed" (ngSubmit)="saveTimed()">
 <label>Title<input formControlName="title"></label><button type="submit">Create</button>
</form>
<form id="async" [formGroup]="asynchronous" (ngSubmit)="saveAsync()">
 <label>User<input formControlName="user"></label><button type="submit" [disabled]="asynchronous.pending || asynchronous.invalid">Register</button>
</form>
<form id="nested" [formGroup]="nested" (ngSubmit)="saveNested()">
 <div formArrayName="rows">@for(row of nested.controls.rows.controls;track row;let index=$index){
  <div [formGroupName]="index"><label>Row<input formControlName="name"></label></div>
 }</div><button type="submit">Save rows</button>
</form>
<form id="signals" [formRoot]="signalForm" (submit)="saveSignal($event)"><label>Signal name<input [formField]="signalForm.name"></label><button type="submit" [disabled]="signalForm().invalid()">Save signal</button></form>
<div style="display:contents"><div style="display:contents"><button id="contents-action" type="button" (click)="removeRow()">Wrapped action</button></div></div>
<label>Upload<input id="upload" type="file" (change)="upload($event)"></label>
<button id="remove" (click)="removeRow()">Remove row</button>
<output id="saved">{{saved.length}}|{{timedSaved.length}}|{{asyncSaved.length}}|{{nestedSaved.length}}</output>
__T__})
export class IntegrationApp {
 readonly minimum=10;
 readonly conditional=new FormGroup({shortMode:new FormControl(true,{nonNullable:true}),note:new FormControl('',{nonNullable:true,validators:[Validators.required,conditional]})});
 readonly timed=new FormGroup({title:new FormControl('',{nonNullable:true,validators:[Validators.required,Validators.minLength(this.minimum)],updateOn:'submit'})});
 readonly asynchronous=new FormGroup({user:new FormControl('',{nonNullable:true,validators:[Validators.required],asyncValidators:[c=>new Promise<any>(done=>setTimeout(()=>done(c.value==='reserved'?{reserved:true}:null),80))]})});
 readonly nested=new FormGroup({rows:new FormArray([new FormGroup({name:new FormControl('First',{nonNullable:true,validators:[Validators.required]})}),new FormGroup({name:new FormControl('Second',{nonNullable:true,validators:[Validators.required]})})])});
 signalModel=signal({name:''});signalForm=form(this.signalModel,path=>{required(path.name);validate(path,({value})=>value().name==='forbidden'?{kind:'reservedName'}:null);});
 saveSignal(event:Event){event.preventDefault();if(this.signalForm().invalid())return;localStorage.setItem('signal-saved',JSON.stringify(this.signalModel()));}
 saved:any[]=[];timedSaved:any[]=[];asyncSaved:any[]=[];nestedSaved:any[]=[];
 constructor(){this.conditional.controls.shortMode.valueChanges.subscribe(()=>this.conditional.controls.note.updateValueAndValidity());}
 saveConditional(){if(this.conditional.invalid||this.conditional.pending)return;this.saved.push(this.conditional.getRawValue());localStorage.setItem('conditional-saved',JSON.stringify(this.saved));}
 saveTimed(){if(this.timed.invalid||this.timed.pending)return;this.timedSaved.push(this.timed.getRawValue());localStorage.setItem('timed-saved',JSON.stringify(this.timedSaved));}
 saveAsync(){if(this.asynchronous.invalid||this.asynchronous.pending)return;this.asyncSaved.push(this.asynchronous.getRawValue());localStorage.setItem('async-saved',JSON.stringify(this.asyncSaved));}
 saveNested(){if(this.nested.invalid||this.nested.pending)return;this.nestedSaved.push(this.nested.getRawValue());localStorage.setItem('nested-saved',JSON.stringify(this.nestedSaved));}
 async upload(event:Event){const file=(event.target as HTMLInputElement).files?.[0];if(file)localStorage.setItem('uploaded-text',await file.text());}
 removeRow(){this.nested.controls.rows.removeAt(1);}
}
enableProdMode();bootstrapApplication(IntegrationApp,{providers:[provideZonelessChangeDetection()]}).catch(console.error);
`.replaceAll('__T__',String.fromCharCode(96));

async function sourceId(page:Page,selector:string){const id=await page.locator(selector).first().getAttribute('angularMcpSource');assert(id,'Node must be emitted by the Angular compiler integration');return id;}
async function list(page:Page):Promise<any[]>{return page.evaluate(()=>(globalThis as any).__angularMcpBridge.list());}

test('AOT production runtime: exact controls, dynamic validation, submit timing, async rules and repeated instances over MCP',{timeout:180000},async()=>{
 const modules=resolve('samples/toolchains/course-crud/node_modules');assert(existsSync(join(modules,'@angular/compiler-cli')),'Run npm run test:setup first.');
 const temporary=mkdtempSync(join(tmpdir(),'ngx-mcp-conformance-')),workspace=join(temporary,'original'),out=join(temporary,'instrumented');
 const {mkdirSync}=await import('node:fs');mkdirSync(workspace);symlinkSync(modules,join(workspace,'node_modules'),'dir');
 writeFileSync(join(workspace,'package.json'),JSON.stringify({name:'integration-conformance',private:true,type:'module'}));
 writeFileSync(join(workspace,'app.ts'),appSource);
 writeFileSync(join(workspace,'index.html'),'<!doctype html><html><head><base href="/"></head><body><integration-app></integration-app></body></html>');
 writeFileSync(join(workspace,'angular.json'),JSON.stringify({version:1,projects:{conformance:{projectType:'application',root:'',sourceRoot:'.',architect:{build:{builder:'@angular/build:application',options:{browser:'app.ts',tsConfig:'tsconfig.json',index:'index.html',outputPath:'build',optimization:true,outputHashing:'none',aot:true,polyfills:[],styles:[]}}}}}}));
 writeFileSync(join(workspace,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[],outDir:'output',useDefineForClassFields:false},angularCompilerOptions:{strictTemplates:true},files:['app.ts']}));
 const angular=JSON.parse(readFileSync(join(workspace,'angular.json'),'utf8'));angular.projects.other={...angular.projects.conformance,architect:{build:{...angular.projects.conformance.architect.build,options:{...angular.projects.conformance.architect.build.options,tsConfig:'other.json',browser:'other.ts',outputPath:'other-build'}}}};writeFileSync(join(workspace,'angular.json'),JSON.stringify(angular));writeFileSync(join(workspace,'other.json'),JSON.stringify({extends:'./tsconfig.json',files:['other.ts']}));writeFileSync(join(workspace,'other.ts'),'export const otherApplication=true;');
 const prepared=await prepareIntegration(join(workspace,'tsconfig.json'),{outDir:out});assert(prepared.nodes.length>10);assert.equal(prepared.buildTarget,'conformance','Infer the selected app in a multi-project workspace.');assert.equal(prepared.features.signalForms,true,'Enable only the target public Signal Forms API.');
 assert.equal(readFileSync(join(workspace,'app.ts'),'utf8'),appSource,'Source workspace remains unchanged.');
 await buildIntegration(prepared);
 const browserDirectory=join(out,'build/browser');
 let foreignUrl:string|undefined,foreignServer:ReturnType<typeof createServer>|undefined;
 const serve=(request:any,response:any)=>{const path=join(browserDirectory,new URL(request.url??'/', 'http://local').pathname);const file=existsSync(path)&&!request.url?.endsWith('/')?path:join(browserDirectory,'index.html');response.writeHead(200,{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});response.end(readFileSync(file));};
 const server=createServer((request,response)=>{if(request.url==='/redirect'&&foreignUrl){response.writeHead(302,{location:foreignUrl});response.end();}else serve(request,response);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const url='http://127.0.0.1:'+(server.address() as any).port;
 const browser=await chromium.launch();const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 const client=new Client({name:'compiler-runtime-conformance',version:'1'});const transport=InMemoryTransport.createLinkedPair();const mcp=createIntegrationMcpServer(page,url);
 try{
  await page.goto(url);await page.waitForFunction(()=>!!(globalThis as any).__angularMcpBridge,undefined,{timeout:10000}).catch(error=>{throw new Error(String(error)+'; browser errors: '+JSON.stringify(errors));});assert.equal(await page.evaluate(()=>typeof(globalThis as any).ng),'undefined','Production build has no Angular debug APIs.');
  await mcp.connect(transport[0]);await client.connect(transport[1]);
  const call=async(name:string,args:any)=>{const result=await client.callTool({name,arguments:args});assert(!result.isError,JSON.stringify(result));return result.structuredContent as any;};
  const fill=async(selector:string,value:unknown)=>call('angular_fill',{target:{sourceId:await sourceId(page,selector)},value});
  const submit=async(selector:string)=>call('angular_submit',{target:{sourceId:await sourceId(page,selector)}});
  const discovered=await call('angular_list_nodes',{});assert(discovered.nodes.length>10);const view=await call('angular_read_view',{});assert(JSON.stringify(view.view).includes('First'));assert(JSON.stringify(view.view).includes('Second'));assert(JSON.stringify(view.view).includes('Wrapped action'),'Read descendants of layout-less display:contents containers.');assert.equal(view.truncated,false);
  // Same runtime rule changes with the checkbox; no constant maxLength is learned from one state.
  const advertised=await client.listTools();const formTool=advertised.tools.find(tool=>tool.name.startsWith('angular_form_')&&(tool.inputSchema.properties as any)?.shortMode);assert(formTool,'Live Angular form must generate its own typed MCP tool');assert.equal(((formTool.inputSchema.properties as any).note).maxLength,undefined);
  await call(formTool.name,{shortMode:false,note:'x'.repeat(50)});assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('conditional-saved')??'[]')),[{shortMode:false,note:'x'.repeat(50)}]);
  await fill('#conditional [formcontrolname="shortMode"]',true);await client.callTool({name:'angular_submit',arguments:{target:{sourceId:await sourceId(page,'#conditional')}}});assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('conditional-saved')??'[]').length),1);
  // Normal submit commits the pending Angular value before its own handler tests validity.
  await fill('#submit-timing input','a');await client.callTool({name:'angular_submit',arguments:{target:{sourceId:await sourceId(page,'#submit-timing')}}});assert.equal(await page.evaluate(()=>localStorage.getItem('timed-saved')),null);
  await fill('#submit-timing input','1234567890');await submit('#submit-timing');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('timed-saved')??'[]')[0]?.title),'1234567890');
  await fill('#async input','reserved');await client.callTool({name:'angular_submit',arguments:{target:{sourceId:await sourceId(page,'#async')}}});assert.equal(await page.evaluate(()=>localStorage.getItem('async-saved')),null);
  await fill('#async input','available');await submit('#async');assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('async-saved')??'[]')[0]?.user),'available');
  await fill('#signals input','forbidden');await client.callTool({name:'angular_submit',arguments:{target:{sourceId:await sourceId(page,'#signals')}}});assert.equal(await page.evaluate(()=>localStorage.getItem('signal-saved')),null);
  await fill('#signals input','Signal value');await submit('#signals');assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('signal-saved')??'null')),{name:'Signal value'});
  await call('angular_upload_file',{target:{sourceId:await sourceId(page,'#upload')},files:[{name:'sample.txt',mimeType:'text/plain',base64:Buffer.from('hello upload').toString('base64')}]});await page.waitForFunction(()=>localStorage.getItem('uploaded-text')==='hello upload');
  const invalidFile=await client.callTool({name:'angular_upload_file',arguments:{target:{sourceId:await sourceId(page,'#upload')},files:[{name:'sample.txt',mimeType:'text/plain',base64:'@@'}]}});assert(invalidFile.isError);assert.equal(await page.evaluate(()=>localStorage.getItem('uploaded-text')),'hello upload');
  const repeatedId=await sourceId(page,'#nested input:first-of-type');const repeated=(await list(page)).filter(item=>item.sourceId===repeatedId);assert.equal(repeated.length,2);assert.notEqual(repeated[0].instanceId,repeated[1].instanceId);
  const ambiguous=await client.callTool({name:'angular_fill',arguments:{target:{sourceId:repeatedId},value:'Must not write'}});assert(ambiguous.isError,'A repeated source ID must not select a row by accident.');
  await call('angular_fill',{target:{instanceId:repeated[1].instanceId},value:'Changed second'});assert.deepEqual(await page.locator('#nested input').evaluateAll(nodes=>nodes.map(node=>(node as HTMLInputElement).value)),['First','Changed second']);
  await submit('#nested');assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('nested-saved')??'[]')[0]?.rows),[{name:'First'},{name:'Changed second'}]);
  await call('angular_activate',{target:{sourceId:await sourceId(page,'#remove')}});assert.equal((await list(page)).filter(item=>item.sourceId===repeatedId).length,1);
  const stale=await client.callTool({name:'angular_fill',arguments:{target:{instanceId:repeated[1].instanceId},value:'Stale must refuse'}});assert(stale.isError);
  const oldSourceId=await sourceId(page,'#conditional [formcontrolname="note"]');const oldControl=(await list(page)).find(node=>node.sourceId===oldSourceId);assert(oldControl);
  assert.deepEqual(errors,[]);
  foreignServer=createServer(serve);await new Promise<void>(done=>foreignServer!.listen(0,'127.0.0.1',done));foreignUrl='http://127.0.0.1:'+(foreignServer.address() as any).port;
  const redirected=await client.callTool({name:'angular_navigate',arguments:{path:'/redirect'}});assert(redirected.isError,'A same-origin request must not authorize a foreign redirect.');
  const foreignRead=await client.callTool({name:'angular_list_nodes',arguments:{}});assert(foreignRead.isError,'Foreign registered pages must not be readable through this app connection.');
  await call('angular_navigate',{path:'/'});
  const reloadedStale=await client.callTool({name:'angular_describe_node',arguments:{target:{instanceId:oldControl.instanceId}}});assert(reloadedStale.isError,'Reload must not reuse the previous document instance handles.');
 }finally{await client.close();await mcp.close();await browser.close();if(foreignServer)await new Promise<void>(done=>foreignServer!.close(()=>done()));await new Promise<void>(done=>server.close(()=>done()));}
});
