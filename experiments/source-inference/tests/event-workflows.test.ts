import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import ts from 'typescript';
import {parseTemplate} from '@angular/compiler';
import {Project,nameOf} from '../src/project.js';
import {compile} from '../src/compiler.js';
import {allElements} from '../src/workflow-compiler.js';
import {textEventWorkflow,trackedDisplayIdentity} from '../src/event-workflows.js';
import {staticRouterLinks} from '../src/router-links.js';
const directory=mkdtempSync(resolve(tmpdir(),'angular-event-workflows-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Input,Injectable,inject} from '@angular/core';
interface Task {title:string;completed:boolean;}
@Injectable({providedIn:'root'}) export class Store {
 tasks:Task[]=[];
 getItems(filter='all'):Task[]{switch(filter){case 'active':return this.tasks.filter(task=>!task.completed);case 'completed':return this.tasks.filter(task=>task.completed);}return this.tasks;}
 add(title:string){this.tasks.push({title,completed:false});}
}
@Component({selector:'event-header',template:__T__<input class="new" [(ngModel)]="title" (keyup.enter)="add()">__T__})
export class Header {private store=inject(Store);title='';add(){const value=this.title.trim();if(value.length===0)return;this.store.add(value);this.title='';}}
@Component({selector:'event-row',template:__T__<li><label (dblclick)="begin()">{{task.title}}</label>@if(editing){<input class="edit" [(ngModel)]="draft" (blur)="save()" (keyup.enter)="save()">}</li>__T__})
export class Row {@Input({required:true}) task!:Task;draft='';editing=false;removed:Task[]=[];begin(){this.editing=true;}save(){if(!this.editing)return;const value=this.draft.trim();this.editing=false;if(value.length===0){this.removed.push(this.task);}else{this.task.title=value;}}}
@Component({selector:'event-host',template:__T__@for(task of tasks;track task){<event-row [task]="task"/>}<event-links/>__T__})
export class Host {private store=inject(Store);get tasks(){const filter='all';return this.store.getItems(filter);}}
@Component({selector:'direct-host',template:__T__@for(task of tasks;track task.title){<event-row [task]="task"/>}__T__})
export class DirectHost {tasks:Task[]=[];}
@Component({selector:'index-host',template:__T__@for(task of tasks;track $index){<event-row [task]="task"/>}__T__})
export class IndexHost {tasks:Task[]=[];}
@Component({selector:'unknown-host',template:__T__@for(task of tasks;track task){<event-row [task]="task"/>}__T__})
export class UnknownHost {get tasks():Task[]{return fetchRows();}}
declare function fetchRows():Task[];
@Component({selector:'unproven-row',template:__T__<label (dblclick)="begin()">{{task.title}}</label>@if(editing){<input [(ngModel)]="draft" (keyup.enter)="save()">}__T__})
export class Unproven {@Input() task!:Task;draft='';editing=false;begin(){this.editing=true;this.task.title='unexpected side effect';}save(){this.task.title=this.draft;}}
@Component({selector:'ordinary-header',template:__T__<input [(ngModel)]="title" (keyup.enter)="add()">__T__})
export class Ordinary {title='';add(){const value=this.title.trim();if(value.length===0){this.title='fallback';}this.title=value;}}
@Component({selector:'event-links',template:__T__<a routerLink="/">Everything</a><a [routerLink]="'/open'">Open</a><a routerLink="/done">Done</a><a [routerLink]="unknown">Dynamic</a><a routerLink="https://example.test">External</a><a routerLink="/unsafe" (click)="sideEffect()">Side effect</a><a routerLink="/query" [queryParams]="params">Query</a>@for(task of tasks;track task){<a routerLink="/row">Repeated</a>}__T__})
export class Links {unknown='/runtime';params={};tasks:Task[]=[];sideEffect(){}}
@Component({selector:'ambiguous-links',template:__T__<a routerLink="/one">Same</a><a routerLink="/two">Same</a>__T__})
export class AmbiguousLinks {}
export const routes=[{path:'items',component:Host},{path:'new',component:Header}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);
writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,strict:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const project=new Project(resolve(directory,'tsconfig.json'));
const cls=(name:string)=>project.classes.find(component=>nameOf(component)===name)!;
const nodes=(name:string)=>{const template=project.template(cls(name))!;return parseTemplate(template.text,template.file).nodes;};
const selector=(node:any)=>node.name+(node.attributes.find((attribute:any)=>attribute.name==='class')?.value.split(/\s+/).map((name:string)=>'.'+name).join('')??'');
const method=(name:string,handler:string)=>cls(name).members.find((member):member is ts.MethodDeclaration=>ts.isMethodDeclaration(member)&&nameOf(member)===handler)!;
const flow=(name:string,event:string,handler:string)=>{const tree=nodes(name),input=allElements(tree).find(element=>element.name==='input')!;return textEventWorkflow(project,cls(name),tree,input,event,method(name,handler),name==='Header'?'event-header':'event-row',selector);};
const identity=(host:string)=>{const tree=nodes(host),element=allElements(tree).find(element=>element.name==='event-row')!;return trackedDisplayIdentity(project,cls(host),tree,element,cls('Row'));};
test('Enter text creation is an authored scalar control and its trim guard rejects blank input',()=>{
 const result=flow('Header','keyup.enter','add')!;assert(result);assert.equal(result.field.name,'title');assert.deepEqual(result.field.schema,{type:'string',pattern:'\\S'});assert.deepEqual(result.commit,{event:'keyup',key:'Enter'});assert.equal(result.reveal,undefined);
});
test('double-click reveal is proven by the boolean condition enclosing the edit input',()=>{
 const result=flow('Row','keyup.enter','save')!;assert(result);assert.equal(result.field.name,'draft');assert.deepEqual(result.field.schema,{type:'string'});assert.deepEqual(result.reveal,{kind:'inline',trigger:'event-row label',panel:'event-row input.edit',owner:'event-row',event:'dblclick'});assert.deepEqual(result.commit,{event:'keyup',key:'Enter'});
});
test('the same edit bound to blur and Enter has one canonical commit',()=>{
 const result=flow('Row','blur','save')!;assert(result.duplicateOfEnter);assert.deepEqual(result.commit,{event:'blur'});
});
test('openers with extra effects are not synthesized and a non-exiting blank branch adds no validator',()=>{
 assert.equal(flow('Unproven','keyup.enter','save')!.reveal,undefined);assert.deepEqual(flow('Ordinary','keyup.enter','add')!.field.schema,{type:'string'});
});
test('tracked hosted display identity resolves the full source service array without runtime getters',()=>{
 const target=identity('Host')!;assert(target);assert.equal(target.param,'task');assert.equal(target.source,'context');assert.deepEqual(target.path,['title']);assert.deepEqual(target.valuePath,['title']);assert.deepEqual(target.projected,{owner:'event-host',collection:['store','tasks'],labelPath:['title'],rowSelector:'event-row',rowInputPath:['task']});assert.deepEqual(target.inputSchema,{type:'object',properties:{title:{type:'string'},completed:{type:'boolean'}},required:['title','completed'],additionalProperties:false});
});
test('explicit tracked display keys are supported, index tracks and dynamic data sources stay unresolved',()=>{
 assert.deepEqual(identity('DirectHost')?.projected,{owner:'direct-host',collection:['tasks'],labelPath:['title'],rowSelector:'event-row',rowInputPath:['task']});assert.equal(identity('IndexHost'),undefined);assert.equal(identity('UnknownHost'),undefined);
});

const compiled=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
test('compiler integrates Enter creation and one targeted double-click edit without direct handler calls',()=>{
 const add=compiled.capabilities.find(cap=>cap.component==='Header'&&cap.handler==='add')!;assert(add);assert.equal(add.status,'candidate');assert.deepEqual(add.plan?.commit,{event:'keyup',key:'Enter'});assert.deepEqual(add.inputSchema,{type:'object',properties:{title:{type:'string',pattern:'\\S'}},required:['title'],additionalProperties:false});
 const edits=compiled.capabilities.filter(cap=>cap.component==='Row'&&cap.handler==='save');assert.equal(edits.length,1);assert.equal(edits[0].status,'candidate');assert.equal(edits[0].reveal?.event,'dblclick');assert.deepEqual(edits[0].reveal?.target,edits[0].target);assert.deepEqual(edits[0].target?.projected,{owner:'event-host',collection:['store','tasks'],labelPath:['title'],rowSelector:'event-row',rowInputPath:['task']});
});

test('static RouterLinks expose only source-authored local paths and retain actual anchor selection',()=>{
 const tree=nodes('Links'),links=staticRouterLinks(project,cls('Links'),tree,'event-links',selector)!;assert(links);assert.deepEqual(links.drive.buttons,{param:'route',choices:[{value:'/',selector:'event-links a',matchText:'Everything'},{value:'/open',selector:'event-links a',matchText:'Open'},{value:'/done',selector:'event-links a',matchText:'Done'}]});assert.deepEqual(links.inputSchema,{type:'object',properties:{route:{type:'string',enum:['/','/open','/done']}},required:['route'],additionalProperties:false});
 const compiledLinks=compiled.capabilities.find(cap=>cap.component==='Links'&&cap.handler==='navigate')!;assert(compiledLinks);assert.equal(compiledLinks.status,'candidate');assert.deepEqual(compiledLinks.drive?.buttons?.choices.map(choice=>({value:choice.value,matchText:choice.matchText})),links.drive.buttons?.choices.map(choice=>({value:choice.value,matchText:choice.matchText})));assert(compiledLinks.drive?.buttons?.choices.every(choice=>choice.selector.startsWith('event-links a')));
});
test('same-selector links with duplicate visible labels stay unresolved',()=>{
 assert.equal(staticRouterLinks(project,cls('AmbiguousLinks'),nodes('AmbiguousLinks'),'ambiguous-links',selector),undefined);
});
