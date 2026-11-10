import {after,test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {resolve,join} from 'node:path';import {compile} from '../src/compiler.js';
const directory=mkdtempSync(join(tmpdir(),'angular-nonform-safety-'));after(()=>rmSync(directory,{recursive:true,force:true}));symlinkSync(resolve('node_modules'),join(directory,'node_modules'),'dir');writeFileSync(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true},files:['app.ts']}));writeFileSync(join(directory,'app.ts'),`
import {Component,Injectable} from '@angular/core';import {ActivatedRoute} from '@angular/router';
@Injectable() class Store{save(value:{left:string;right:string}|string):string{return JSON.stringify(value);}}
@Component({selector:'duplicate-models',template:'<section><input [(ngModel)]="left.title"><input [(ngModel)]="right.title"><button (click)="save()">Save</button></section>'})
class DuplicateModels{left={title:''};right={title:''};constructor(private store:Store){}save(){this.store.save({left:this.left.title,right:this.right.title});}}
@Component({selector:'discarded-result',template:'<p>{{result}}</p>'})
class DiscardedResult{result='';constructor(private route:ActivatedRoute,private store:Store){}ngOnInit(){const token=this.route.snapshot.queryParamMap.get('token');this.result=(this.store.save(token),'constant');}}
function ignore(value:unknown):string{return 'constant';}
@Component({selector:'ignored-call-result',template:'<p>{{result}}</p>'})
class IgnoredCallResult{result='';constructor(private route:ActivatedRoute,private store:Store){}ngOnInit(){const token=this.route.snapshot.queryParamMap.get('token');this.result=ignore(this.store.save(token));}}
@Component({selector:'uncalled-result',template:'<p>{{result}}</p>'})
class UncalledResult{result:unknown;constructor(private route:ActivatedRoute,private store:Store){}ngOnInit(){const token=this.route.snapshot.queryParamMap.get('token');this.result=()=>this.store.save(token);}}
export const routes=[{path:'duplicate',component:DuplicateModels},{path:'discarded',component:DiscardedResult},{path:'ignored',component:IgnoredCallResult},{path:'uncalled',component:UncalledResult}];
`);const manifest=compile(join(directory,'tsconfig.json'),'app.ts#routes');
test('nonform ngModel controls sharing a public leaf name cannot silently collapse into one input',()=>{const cap=manifest.capabilities.find(cap=>cap.component==='DuplicateModels'&&cap.handler==='save');assert(cap);assert.equal(cap.status,'blocked');assert(cap.issues.some(issue=>/Duplicate|distinct|Repeated/.test(issue)),JSON.stringify({fields:cap.fields,issues:cap.issues}));});
test('a discarded service result does not prove that a page-load outcome is rendered',()=>{assert(!manifest.capabilities.some(cap=>cap.component==='DiscardedResult'&&cap.handler==='ngOnInit'));});
test('arbitrary call arguments and uninvoked functions do not establish a rendered service result',()=>{for(const name of ['IgnoredCallResult','UncalledResult'])assert(!manifest.capabilities.some(cap=>cap.component===name&&cap.handler==='ngOnInit'),name);});
