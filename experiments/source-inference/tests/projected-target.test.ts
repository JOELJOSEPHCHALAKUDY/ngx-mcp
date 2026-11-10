import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {compile} from '../src/compiler.js';
import {browserAdapter} from '../src/browser-adapter.js';
import {executeDom} from '../src/browser-runtime.js';
const directory=mkdtempSync(resolve(tmpdir(),'angular-projected-target-'));after(()=>rmSync(directory,{recursive:true,force:true}));symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Input,Injectable} from '@angular/core';
@Injectable() export class Writer{save(value:unknown){return value;}}
interface Person{id:string;name:string;}
@Component({selector:'person-name',template:__T__<span>{{user?.name}}</span>__T__})
export class PersonName{@Input() user:Person;}
@Component({selector:'projected-options',template:__T__<button nz-dropdown [nzDropdownMenu]="menu">Options</button><nz-dropdown-menu #menu><ul>@for(option of options;track option.value){@if(option.value!=='hidden'){<li (click)="select(option.value)"><span>{{option.label}}</span></li>}}</ul></nz-dropdown-menu>__T__})
export class Options{options=[{value:'selected',label:'Selected for Work'}];constructor(private writer:Writer){}select(value:string){this.writer.save(value);}}
@Component({selector:'person-options',template:__T__<button nz-dropdown [nzDropdownMenu]="menu">People</button><nz-dropdown-menu #menu><ul>@for(option of people;track option.id){<li (click)="select(option)"><person-name [user]="option"></person-name></li>}</ul></nz-dropdown-menu>__T__})
export class People{people:Person[]=[{id:'1',name:'One'}];constructor(private writer:Writer){}select(person:Person){this.writer.save(person);}}
@Component({selector:'unproven-options',template:__T__<button nz-dropdown [nzDropdownMenu]="menu">Options</button><nz-dropdown-menu #menu><ul>@for(option of options;track option.id){<li (click)="select(option)">Choose {{option.label}}</li>}</ul></nz-dropdown-menu>__T__})
export class Unproven{options=[{id:'1',label:'One'}];constructor(private writer:Writer){}select(option:{id:string,label:string}){this.writer.save(option);}}
export const routes=[{path:'options',component:Options},{path:'people',component:People},{path:'unproven',component:Unproven}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
test('projected option metadata proves its collection and distinct identity/display fields',()=>{const cap=manifest.capabilities.find(c=>c.component==='Options'&&c.handler==='select');assert(cap);assert.deepEqual(cap.target?.projected,{owner:'projected-options',collection:['options'],labelPath:['label']});assert.deepEqual(cap.target?.path,['value']);});
test('source child input projection derives a person label without guessing row text',()=>{const cap=manifest.capabilities.find(c=>c.component==='People'&&c.handler==='select');assert(cap);assert.deepEqual(cap.target?.projected,{owner:'person-options',collection:['people'],labelPath:['name']});});
test('mixed or unknown text projection does not receive fallback metadata',()=>{const cap=manifest.capabilities.find(c=>c.component==='Unproven'&&c.handler==='select');assert(cap);assert.equal(cap.target?.projected,undefined);});
const jira=process.env.FRESH_JIRA_URL;
test('real projected status row uses source label mapping with no loop context',{skip:!jira,timeout:30000},async()=>{
 const m=compile(resolve('test-apps/fresh-jira-clone/tsconfig.app.json'),'src/app/app.routes.ts#appRoutes');const c=m.capabilities.find(c=>c.component==='IssueStatusComponent'&&c.handler==='updateIssue'&&c.route==='/project/issue/:issueId');assert(c);assert.deepEqual(c.target?.projected?.labelPath,['label']);
 const b=await chromium.launch();try{const p=await b.newPage({viewport:{width:1600,height:1100}});await p.route('**/*',r=>new URL(r.request().url()).origin===new URL(jira!).origin?r.continue():r.abort());await p.goto(jira!+'/project/issue/2021');await p.locator('issue-status').waitFor();await p.waitForLoadState('networkidle');const adapter=browserAdapter(p,m,[{id:c.id,fingerprint:c.fingerprint,description:'Source status projection test',effect:'write'}],jira!);await adapter.invoke(adapter.tools[0].name,{status:'Selected',issueId:'2021'});await p.waitForFunction(()=>(window as any).ng.getComponent(document.querySelector('app-project'))._projectService._store.getValue().issues.find((i:any)=>i.id==='2021').status==='Selected');}finally{await b.close();}
});

test('projected fallback refuses duplicate identity, duplicate label and ambiguous visible row before dispatch',{skip:!jira,timeout:30000},async()=>{
 const c=manifest.capabilities.find(c=>c.component==='Options'&&c.handler==='select')!;const b=await chromium.launch();
 try{for(const fixture of [
  {items:[{value:'one',label:'Same'},{value:'two',label:'Same'}],labels:['Same','Same'],error:/label is missing or ambiguous in the source collection/},
  {items:[{value:'one',label:'One'},{value:'one',label:'Other'}],labels:['One','Other'],error:/identity is missing or ambiguous/},
  {items:[{value:'one',label:'One'}],labels:['One','One'],error:/label or input identity is missing or ambiguous in visible rows/},
 ]){const p=await b.newPage();await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<projected-options><button>Options</button></projected-options>'}));await p.goto('http://127.0.0.1:41999/options');await p.evaluate(({items,labels})=>{
  const owner={options:items};(window as any).writes=0;(window as any).ng={getOwningComponent(){return owner;},getContext(){return undefined;},getComponent(){return owner;}};
  document.querySelector('button')!.addEventListener('click',()=>{const panel=document.createElement('div');panel.className='ant-dropdown';for(const text of labels){const li=document.createElement('li');li.textContent=text;li.addEventListener('click',()=>{(window as any).writes++;});panel.append(li);}document.body.append(panel);});
 },fixture);await assert.rejects(p.evaluate(executeDom,{capability:c,args:{},targetValue:'one'}),fixture.error);assert.equal(await p.evaluate(()=>(window as any).writes),0);await p.close();}
 }finally{await b.close();}
});
