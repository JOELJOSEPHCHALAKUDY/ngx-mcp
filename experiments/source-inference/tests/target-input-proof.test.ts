import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {compile} from '../src/compiler.js';
const directory=mkdtempSync(resolve(tmpdir(),'angular-target-input-proof-'));
after(()=>rmSync(directory,{recursive:true,force:true}));symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Injectable,Input as AngularInput,input as angularInput,model as angularModel} from '@angular/core';
interface Item{id:string;name:string;}
@Injectable()export class Writer{save(item:Item){return item;}}
function input(value:Item){return ()=>value;}
function Input():PropertyDecorator{return ()=>{};}
@Component({selector:'local-input-row',template:__T__<button (click)="save(item())">Save</button>__T__})
export class LocalInputRow{item=input({id:'bad',name:'Decoy'});constructor(private writer:Writer){}save(item:Item){this.writer.save(item);}}
@Component({selector:'fake-decorator-row',template:__T__<button (click)="save(item)">Save</button>__T__})
export class FakeDecoratorRow{@Input()item:Item={id:'bad',name:'Decoy'};constructor(private writer:Writer){}save(item:Item){this.writer.save(item);}}
@Component({selector:'required-input-row',template:__T__<button (click)="save(item())">Save</button>__T__})
export class RequiredInputRow{item=angularInput.required<Item>();constructor(private writer:Writer){}save(item:Item){this.writer.save(item);}}
@Component({selector:'model-input-row',template:__T__<button (click)="save(item())">Save</button>__T__})
export class ModelInputRow{item=angularModel.required<Item>();constructor(private writer:Writer){}save(item:Item){this.writer.save(item);}}
@Component({selector:'decorated-row',template:__T__<button (click)="save(item)">Save</button>__T__})
export class DecoratedRow{@AngularInput()item:Item={id:'real',name:'Real'};constructor(private writer:Writer){}save(item:Item){this.writer.save(item);}}
@Component({selector:'callback-row',template:__T__<button (click)="save(item())">Save</button>__T__})
export class CallbackRow{@AngularInput()item=()=>({id:'callable',name:'Callback'});constructor(private writer:Writer){}save(item:Item){this.writer.save(item);}}
@Component({selector:'nested-callback-row',template:__T__<button (click)="save(container().callback())">Save</button>__T__})
export class NestedCallbackRow{container=angularInput.required<{callback:()=>Item}>();constructor(private writer:Writer){}save(item:Item){this.writer.save(item);}}
@Component({selector:'proof-host',template:__T__@for(row of rows;track row.id){<local-input-row/><fake-decorator-row/><required-input-row/><model-input-row/><decorated-row/><callback-row/><nested-callback-row/>}__T__})
export class Host{rows:Item[]=[{id:'1',name:'One'}];}
export const routes=[{path:'proof',component:Host}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,strict:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
const cap=(component:string)=>{const found=manifest.capabilities.find(capability=>capability.component===component&&capability.handler==='save');assert(found,component);return found;};
test('a local input function and fake Input decorator do not grant row-input or callable-signal trust',()=>{
 for(const name of ['LocalInputRow','FakeDecoratorRow']){const found=cap(name);assert.equal(found.status,'blocked');assert.equal(found.target,undefined);}
});
test('Angular aliased input.required/model.required and aliased Input retain proven targets',()=>{
 for(const name of ['RequiredInputRow','ModelInputRow']){const found=cap(name);assert.equal(found.status,'candidate');assert.deepEqual(found.target?.path,['item','id']);assert.deepEqual(found.target?.signals,['item']);}
 const found=cap('DecoratedRow');assert.equal(found.status,'candidate');assert.deepEqual(found.target?.path,['item','id']);assert.deepEqual(found.target?.signals,[]);
});
test('ordinary callable Input values and nested callbacks are never invoked as identity signals',()=>{
 for(const name of ['CallbackRow','NestedCallbackRow']){const found=cap(name);assert.equal(found.status,'blocked');assert.equal(found.target,undefined);}
});
