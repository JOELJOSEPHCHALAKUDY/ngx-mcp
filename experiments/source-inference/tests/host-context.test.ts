import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {compile} from '../src/compiler.js';
const directory=mkdtempSync(resolve(tmpdir(),'angular-host-context-'));after(()=>rmSync(directory,{recursive:true,force:true}));symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Input,Injectable} from '@angular/core';
@Injectable() export class Writer {save(value:object){return value;}}
interface Row{id:string;name:string;}
@Component({selector:'entry-row',template:__T__@if(createMode){<button (click)="add()">Add</button>}@else{<button (click)="view()">View</button>}__T__})
export class EntryRow {@Input() createMode=false;@Input() row:Row;constructor(private writer:Writer){}add(){this.writer.save({kind:'create'});}view(){this.writer.save(this.row);}}
@Component({selector:'chip-row',template:__T__@if(row){<button (click)="view()">View</button>}@if(!row){<button (click)="create()">Create</button>}__T__})
export class Chip {@Input() row:Row;constructor(private writer:Writer){}view(){this.writer.save(this.row);}create(){this.writer.save({kind:'new'});}}
@Component({selector:'nullable-chip',template:__T__@if(row){<button (click)="view()">View</button>}@if(!row){<button (click)="create()">Create</button>}__T__})
export class NullableChip {@Input() row:Row;constructor(private writer:Writer){}view(){this.writer.save(this.row);}create(){this.writer.save({kind:'nullable'});}}
@Component({selector:'mutable-entry',template:__T__@if(createMode){<button (click)="add()">Add</button>}@else{<button (click)="view()">View</button>}__T__})
export class MutableEntry {@Input() createMode=false;constructor(private writer:Writer){}toggle(){this.createMode=!this.createMode;}add(){this.writer.save({kind:'create'});}view(){this.writer.save({kind:'view'});}}
@Component({selector:'mode-entry',template:__T__@if(mode === 'edit'){<button (click)="edit()">Edit</button>}@else if(mode === 'preview'){<button (click)="preview()">Preview</button>}@else{<button (click)="view()">View</button>}__T__})
export class ModeEntry {@Input('display-mode') mode='view';constructor(private writer:Writer){}edit(){this.writer.save({kind:'edit'});}preview(){this.writer.save({kind:'preview'});}view(){this.writer.save({kind:'view'});}}
@Component({selector:'legacy-entry',template:__T__<button *ngIf="createMode" (click)="add()">Add</button><button *ngIf="!createMode" (click)="view()">View</button>__T__})
export class LegacyEntry {@Input() createMode=false;constructor(private writer:Writer){}add(){this.writer.save({kind:'create'});}view(){this.writer.save({kind:'view'});}}
@Component({selector:'host-page',template:__T__<entry-row [createMode]="true"></entry-row>@for(row of rows;track row.id){<entry-row [row]="row"></entry-row>}<chip-row></chip-row>@for(row of rows;track row.id){<chip-row [row]="row"></chip-row>}__T__})
export class HostPage {rows:Row[]=[{id:'1',name:'One'}];}
@Component({selector:'unknown-page',template:__T__<entry-row [createMode]="runtimeMode"></entry-row><mutable-entry [createMode]="true"></mutable-entry>@for(row of rows;track row){<nullable-chip [row]="row"></nullable-chip>}__T__})
export class UnknownPage {runtimeMode=false;rows:(Row|null)[]=[null];configure(){this.runtimeMode=true;}}
@Component({selector:'literal-page',template:__T__<mode-entry [display-mode]="'edit'"></mode-entry><legacy-entry [createMode]="true"></legacy-entry>__T__})
export class LiteralPage {}
export const routes=[{path:'host',component:HostPage},{path:'unknown',component:UnknownPage},{path:'literal',component:LiteralPage}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
const actions=(component:string,route:string)=>manifest.capabilities.filter(c=>c.component===component&&c.route===route);
test('literal creation host and omitted input defaults prune display-loop duplicates',()=>{const add=actions('EntryRow','/host').filter(c=>c.handler==='add');assert.equal(add.length,1);assert.equal(add[0].status,'candidate');assert(actions('EntryRow','/host').some(c=>c.handler==='view'));});
test('non-null typed object loop input distinguishes existing rows from the unbound creation host',()=>{const create=actions('Chip','/host').filter(c=>c.handler==='create');assert.equal(create.length,1);assert.equal(create[0].status,'candidate');assert(actions('Chip','/host').some(c=>c.handler==='view'));});
test('unknown bindings, child input mutations and nullable loop elements are not folded to defaults',()=>{for(const component of ['EntryRow','MutableEntry'])assert.deepEqual(actions(component,'/unknown').map(c=>c.handler).sort(),['add','view']);assert(actions('NullableChip','/unknown').some(c=>c.handler==='create'));assert(actions('NullableChip','/unknown').some(c=>c.handler==='view'));});
test('aliased literal inputs select only their authored if branch and legacy ngIf receives the same fold',()=>{assert.deepEqual(actions('ModeEntry','/literal').map(c=>c.handler),['edit']);assert.deepEqual(actions('LegacyEntry','/literal').map(c=>c.handler),['add']);});
