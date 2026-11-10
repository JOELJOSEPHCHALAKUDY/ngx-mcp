import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {compile} from '../src/compiler.js';

const directory=mkdtempSync(resolve(tmpdir(),'angular-template-callbacks-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Injectable} from '@angular/core';
@Injectable() export class Writer {save(value:object){return value;}}
class Item {constructor(public icon:string,public tooltip:string,public handler:()=>void){}}
class Wrapped {constructor(public icon:string,public tooltip:string,public handler:()=>void){this.handler=()=>{};}}
@Component({selector:'callback-menu',template:__T__@for(item of items;track item.icon){<button (click)="item.handler()">{{item.tooltip}}</button>}__T__})
export class Menu {
 items:Item[];constructor(private writer:Writer){}
 ngOnInit(){this.items=[new Item('plus','Create item',this.create.bind(this)),new Item('trash','Archive item',this.archive.bind(this))];}
 create(){this.writer.save({kind:'create'});}archive(){this.writer.save({kind:'archive'});}
}
@Component({selector:'duplicate-label-menu',template:__T__@for(item of items;track item.icon){<button (click)="item.handler()">{{item.tooltip}}</button>}__T__})
export class DuplicateLabels {
 items=[new Item('plus','Action',this.create.bind(this)),new Item('trash','Action',this.archive.bind(this))];constructor(private writer:Writer){}
 create(){this.writer.save({kind:'create'});}archive(){this.writer.save({kind:'archive'});}
}
@Component({selector:'legacy-menu',template:__T__<button *ngFor="let item of items" (click)="item.callback()">{{item.label}}</button>__T__})
export class Legacy {items=[{key:'create',label:'Create item',callback:this.create.bind(this)}];constructor(private writer:Writer){}create(){this.writer.save({kind:'legacy'});}}
@Component({selector:'mutable-menu',template:__T__@for(item of items;track item.icon){<button (click)="item.handler()">{{item.tooltip}}</button>}__T__})
export class Mutable {items=[new Item('plus','Create item',this.create.bind(this))];constructor(private writer:Writer){}configure(){this.items.push(new Item('trash','Runtime',this.create.bind(this)));}create(){this.writer.save({kind:'dynamic'});}}
@Component({selector:'unbound-menu',template:__T__@for(item of items;track item.icon){<button (click)="item.handler()">{{item.tooltip}}</button>}__T__})
export class Unbound {items=[new Item('plus','Create item',this.create)];constructor(private writer:Writer){}create(){this.writer.save({kind:'unbound'});}}
@Component({selector:'wrapped-menu',template:__T__@for(item of items;track item.icon){<button (click)="item.handler()">{{item.tooltip}}</button>}__T__})
export class ConstructorEffects {items=[new Wrapped('plus','Create item',this.create.bind(this))];constructor(private writer:Writer){}create(){this.writer.save({kind:'wrapped'});}}
@Component({selector:'ambiguous-menu',template:__T__@for(item of items;track item){<button (click)="item.handler()">{{item.tooltip}}</button>}__T__})
export class Ambiguous {items=[new Item('same','Same',this.create.bind(this)),new Item('same','Same',this.archive.bind(this))];constructor(private writer:Writer){}create(){this.writer.save({kind:'one'});}archive(){this.writer.save({kind:'two'});}}
export const routes=[{path:'menu',component:Menu},{path:'duplicate',component:DuplicateLabels},{path:'legacy',component:Legacy},{path:'mutable',component:Mutable},{path:'unbound',component:Unbound},{path:'wrapped',component:ConstructorEffects},{path:'ambiguous',component:Ambiguous}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);
writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
test('constructor parameter-property bound callbacks resolve to distinct underlying methods',()=>{
 const actions=manifest.capabilities.filter(c=>c.component==='Menu');assert.deepEqual(actions.map(c=>c.handler).sort(),['archive','create']);
 for(const action of actions){assert.equal(action.target?.literalValue,action.handler==='create'?'Create item':'Archive item');assert.deepEqual(action.target?.path,['tooltip']);assert.equal(action.status,'candidate');assert(!JSON.stringify(action.inputSchema).includes('__callbackItem'));}
});
test('a unique authored icon identifies rows whose labels are duplicated',()=>{
 const actions=manifest.capabilities.filter(c=>c.component==='DuplicateLabels');assert.equal(actions.length,2);assert(actions.every(c=>c.target?.path[0]==='icon'));assert.deepEqual(actions.map(c=>c.target?.literalValue).sort(),['plus','trash']);
});
test('object-literal callbacks in legacy ngFor templates use the same source proof',()=>{
 const action=manifest.capabilities.find(c=>c.component==='Legacy');assert(action);assert.equal(action.handler,'create');assert.equal(action.target?.literalValue,'create');assert.deepEqual(action.target?.path,['key']);
});
test('mutable collections, unbound methods, constructor transforms and ambiguous identities remain unsupported',()=>{
 for(const component of ['Mutable','Unbound','ConstructorEffects','Ambiguous'])assert(!manifest.capabilities.some(c=>c.component===component),component);
});
