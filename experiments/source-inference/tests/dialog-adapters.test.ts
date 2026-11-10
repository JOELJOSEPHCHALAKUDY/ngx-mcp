import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {compile} from '../src/compiler.js';
import {executeDom} from '../src/browser-runtime.js';
import {browserAdapter} from '../src/browser-adapter.js';
import type {Capability} from '../src/model.js';

const directory=mkdtempSync(resolve(tmpdir(),'angular-dialog-adapters-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Injectable} from '@angular/core';
import {FormBuilder} from '@angular/forms';
@Injectable() export class Writer {save(value:object){return value;}remove(){}}
@Injectable() export class MatDialog {open(component:unknown){}}
@Injectable() export class NzModalService {create(options:object){}confirm(options:object){}}
@Component({selector:'mat-editor',template:__T__<form [formGroup]="form" (ngSubmit)="save()"><input formControlName="title"><button type="submit">Save Material</button></form>__T__})
export class MaterialEditor {form=this.fb.group({title:['']});constructor(private fb:FormBuilder,private writer:Writer){}save(){this.writer.save(this.form.value);}}
@Component({selector:'zorro-editor',template:__T__<form [formGroup]="form" (ngSubmit)="save()"><input formControlName="title"><button type="submit">Save Zorro</button></form>__T__})
export class ZorroEditor {form=this.fb.group({title:['']});constructor(private fb:FormBuilder,private writer:Writer){}save(){this.writer.save(this.form.value);}}
@Component({selector:'zorro-confirm',template:__T__<button (click)="confirm()">Delete</button>__T__})
export class Confirmation {constructor(private writer:Writer){}confirm(){this.writer.remove();}}
@Injectable() export class EditorCoordinator {
 constructor(private modal:NzModalService){}
 open(){this.helper();}private helper(){const config={nzContent:ZorroEditor,nzFooter:null};this.modal.create(config);}
}
@Component({selector:'dialog-host',template:__T__<button id="material" (click)="material()">Material</button><button id="zorro" (click)="zorro()">Zorro</button><button id="helper" (click)="helper()">Helper</button><button id="confirmation" (click)="confirmation()">Confirm</button>__T__})
export class Host {
 constructor(private mat:MatDialog,private modal:NzModalService,private coordinator:EditorCoordinator){}
 material(){this.materialHelper();}private materialHelper(){this.mat.open(MaterialEditor);}
 zorro(){this.modal.create({nzContent:ZorroEditor,nzFooter:null});}
 helper(){this.helperCycle();this.coordinator.open();}private helperCycle(){this.helper();}
 confirmation(){this.modal.create({nzContent:Confirmation});this.modal.confirm({nzContent:ZorroEditor});}
}
export const routes=[{path:'dialogs',component:Host}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);
writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');

test('Material dialogs still resolve through component helpers',()=>{
 const edit=manifest.capabilities.find(c=>c.component==='MaterialEditor'&&c.handler==='save');assert(edit);
 assert.equal(edit.reveal?.panel,'mat-dialog-container');assert.equal(edit.reveal?.trigger,'dialog-host button#material');
});
test('NgZorro create options expose editable dialogs directly and through injected helpers',()=>{
 const edits=manifest.capabilities.filter(c=>c.component==='ZorroEditor'&&c.handler==='save');
 assert.deepEqual(edits.map(c=>c.reveal?.trigger).sort(),['dialog-host button#helper','dialog-host button#zorro']);
 assert(edits.every(c=>c.reveal?.panel==='.ant-modal'&&c.reveal.kind==='dialog'));
});
test('authored confirmation actions need host context; generic confirmation APIs stay unresolved',()=>{
 const action=manifest.capabilities.find(c=>c.component==='Confirmation');assert(action);assert.equal(action.workflow.requiresConfirmation,true);
 assert.deepEqual((action.contextSchema as {properties:unknown}).properties,{confirmedCapability:{const:action.id}});
 assert(!manifest.capabilities.some(c=>c.component==='ZorroEditor'&&c.reveal?.trigger==='dialog-host button#confirmation'));
});

// Optional integration uses the pinned, unmodified local Jira app. No editor/control APIs are invoked:
// executeDom sends DOM selection/paste/input events and clicks the original create button.
const jira=process.env.FRESH_JIRA_URL;
function createCapability():Capability{return {
 id:'reference-rich-text-create',fingerprint:'test',route:'/project/board',component:'AddIssueModalComponent',componentSelector:'add-issue-modal',
 action:{kind:'form',owner:'add-issue-modal',selector:'add-issue-modal form',submitSelector:'j-button button[type="submit"]',label:'Create Issue',event:'ngSubmit',expression:'submitForm()',source:{file:'source-ui',line:1}},
 fields:[{name:'title',selector:'input[formcontrolname="title"]',element:'input',type:'text',required:true,supported:true,schema:{type:'string'}},{name:'description',selector:'quill-editor[formcontrolname="description"]',element:'quill-editor',type:'text',adapter:'contenteditable',required:false,supported:true,schema:{type:'string'}}],
 handler:'submitForm',callPath:[],bindings:[],inputSchema:{type:'object'},outputSchema:true,guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'};}

test('Quill DOM adapter reaches the original CVA and creates a rich-text issue',{skip:!jira,timeout:30000},async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:1600,height:1100}});
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(jira!).origin?r.continue():r.abort());
 await page.goto(jira!+'/project/board');await page.locator('app-navbar-left .itemIcon').nth(1).click();await page.locator('add-issue-modal input[formcontrolname="title"]').waitFor();
 const title='Runtime adapter benchmark';
 await page.evaluate(executeDom,{capability:createCapability(),args:{title,description:'<p>Rich <strong>benchmark</strong> content</p>'}});
 await page.waitForFunction(title=>{const p=(window as any).ng.getComponent(document.querySelector('app-project'))._projectService._store.getValue();return p.issues.some((i:any)=>i.title===title);},title);
 const created=await page.evaluate(title=>(window as any).ng.getComponent(document.querySelector('app-project'))._projectService._store.getValue().issues.find((i:any)=>i.title===title),title);
 assert.match(created.description,/benchmark/);assert.match(created.description,/<strong>benchmark<\/strong>/);assert.equal(created.status,'Backlog');await page.locator('.ant-modal').waitFor({state:'detached'});
 }finally{await browser.close();}
});
test('runtime refuses to stack an automated reveal over an existing NgZorro dialog',{skip:!jira,timeout:30000},async()=>{
 const browser=await chromium.launch();try{const page=await browser.newPage();await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(jira!).origin?r.continue():r.abort());
 await page.goto(jira!+'/project/board');await page.locator('app-navbar-left .itemIcon').nth(1).click();await page.locator('.ant-modal').waitFor();
 const capability={...createCapability(),reveal:{trigger:'app-navbar-left .itemIcon',panel:'.ant-modal',kind:'dialog' as const}};
 await assert.rejects(page.evaluate(executeDom,{capability,args:{title:'must not run'}}),/dialog is already open/);
 assert.equal(await page.locator('.ant-modal').count(),1);
 }finally{await browser.close();}
});

const shop=process.env.FRESH_SHOP_URL;
test('compiled Material signup capability preserves the unmodified source dialog workflow',{skip:!shop,timeout:30000},async()=>{
 const m=compile(resolve('test-apps/fresh-modern-store/tsconfig.app.json'),'src/app/app.routes.ts#routes');
 const capability=m.capabilities.find(c=>c.component==='SignUpDialog'&&c.handler==='signUp'&&c.reveal?.owner==='app-header-actions');assert(capability);assert.equal(capability.status,'candidate');
 const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:1440,height:1000}});
 await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(shop!).origin?r.continue():r.abort());
 await page.goto(shop!+'/products/all');await page.locator('app-product-card').first().waitFor();await page.waitForLoadState('networkidle');
 const adapter=browserAdapter(page,m,[{id:capability.id,fingerprint:capability.fingerprint,description:'Test original mock signup',effect:'write'}],shop!);
 assert.equal(adapter.tools.length,1);await adapter.invoke(adapter.tools[0].name,{name:'Runtime User',email:'adapter@example.test',password:'sample123',confirmPassword:'sample123'});
 await page.waitForFunction(()=>(window as any).ng.getComponent(document.querySelector('app-header-actions')).store.user()?.email==='adapter@example.test');
 const user=await page.evaluate(()=>(window as any).ng.getComponent(document.querySelector('app-header-actions')).store.user());assert.equal(user.name,'John Doe');await page.locator('mat-dialog-container').waitFor({state:'detached'});
 }finally{await browser.close();}
});

test('source-proven NavItem callback opens and submits the compiled NgZorro Quill capability',{skip:!jira,timeout:30000},async()=>{
 const m=compile(resolve('test-apps/fresh-jira-clone/tsconfig.app.json'),'src/app/app.routes.ts#appRoutes');
 const capability=m.capabilities.find(c=>c.component==='AddIssueModalComponent'&&c.handler==='submitForm');assert(capability);assert.equal(capability.status,'candidate');assert.equal(capability.reveal?.target?.literalValue,'Create issue');
 assert(!JSON.stringify(capability.inputSchema).includes('__callbackItem'));
 const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:1600,height:1100}});await page.route('**/*',r=>new URL(r.request().url()).origin===new URL(jira!).origin?r.continue():r.abort());
 await page.goto(jira!+'/project/board');await page.locator('#Backlog issue-card').first().waitFor();await page.waitForLoadState('networkidle');
 const adapter=browserAdapter(page,m,[{id:capability.id,fingerprint:capability.fingerprint,description:'Test original issue create',effect:'write'}],jira!);assert.equal(adapter.tools.length,1);
 const title='Compiled dialog callback benchmark';await adapter.invoke(adapter.tools[0].name,{title,description:'<p>Original <strong>callback</strong> workflow</p>'});
 await page.waitForFunction(title=>(window as any).ng.getComponent(document.querySelector('app-project'))._projectService._store.getValue().issues.some((i:any)=>i.title===title),title);
 const issue=await page.evaluate(title=>(window as any).ng.getComponent(document.querySelector('app-project'))._projectService._store.getValue().issues.find((i:any)=>i.title===title),title);assert.match(issue.description,/<strong>callback<\/strong>/);assert.equal(issue.status,'Backlog');
 }finally{await browser.close();}
});
