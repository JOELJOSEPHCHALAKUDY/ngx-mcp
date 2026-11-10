import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {Ajv} from 'ajv';
import {compile} from '../src/compiler.js';
const directory=mkdtempSync(join(tmpdir(),'angular-scalar-workflows-'));symlinkSync(resolve('node_modules'),join(directory,'node_modules'),'dir');
writeFileSync(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true},files:['app.ts']}));
writeFileSync(join(directory,'app.ts'),`import {Component,Injectable,signal} from '@angular/core';
@Injectable() class Store { save(label:string):string{return label;} }
@Component({selector:'scalar-draft',template:'<section><input [value]="draft()" (input)="draft.set($any($event.target).value)"/><button (click)="submit()">Save</button></section>'})
class Draft { draft=signal('');constructor(private store:Store){}submit(){const label=this.draft().trim();if(label.length<2||label.length>7)return;this.store.save(label);this.draft.set('');} }
@Component({selector:'scalar-model',template:'<section><input [ngModel]="draft()" (ngModelChange)="draft.set($event)"/><button (click)="submit()">Save</button></section>'})
class Model { draft=signal('');constructor(private store:Store){}submit(){this.store.save(this.draft());} }
@Component({selector:'scalar-unsupported',template:'<section><input [value]="draft()" (input)="update($event)"/><button (click)="submit()">Save</button></section>'})
class Unsupported { draft=signal('');constructor(private store:Store){}update(event:any){}submit(){this.store.save(this.draft());} }
@Component({selector:'scalar-duplicate',template:'<section><input [value]="draft()" (input)="draft.set($any($event.target).value)"/><input [value]="draft()" (input)="draft.set($any($event.target).value)"/><button (click)="submit()">Save</button></section>'})
class Duplicate { draft=signal('');constructor(private store:Store){}submit(){this.store.save(this.draft());} }
@Component({selector:'scalar-overwritten',template:'<section><input [value]="draft()" (input)="draft.set($any($event.target).value)"/><button (click)="submit()">Save</button></section>'})
class Overwritten { draft=signal('');constructor(private store:Store){}submit(){this.draft.set('constant');const label=this.draft();this.store.save(label);} }
export const routes=[{path:'draft',component:Draft},{path:'model',component:Model},{path:'unsupported',component:Unsupported},{path:'duplicate',component:Duplicate},{path:'overwritten',component:Overwritten}];
`);
const manifest=compile(join(directory,'tsconfig.json'),'app.ts#routes');const cap=(name:string)=>{const capability=manifest.capabilities.find(capability=>capability.component===name);assert(capability);return capability;};
after(()=>rmSync(directory,{recursive:true,force:true}));
test('source signal UI fields take their public name from the consumed service parameter',()=>{
 const c=cap('Draft');assert.equal(c.status,'candidate');assert.deepEqual(c.fields.map(field=>field.name),['label']);assert.equal(c.fields[0].sourceName,'draft');assert.equal(c.fields[0].selector,'input');assert.equal(c.plan?.targetRoot,'scalar-draft');assert.deepEqual((c.inputSchema as any).required,['label']);const accepts=new Ajv({strict:false}).compile(c.inputSchema);assert(accepts({label:'  okay  '}));assert(!accepts({label:' x '}));assert(!accepts({label:'12345678'}));assert(!accepts({}));
});
test('source signal ngModelChange uses the same native workflow',()=>{const c=cap('Model');assert.equal(c.status,'candidate');assert.equal(c.fields[0].name,'label');assert(c.plan?.submit);});
test('unproven setters and duplicated editable source controls remain blocked',()=>{const unsupported=cap('Unsupported');assert.equal(unsupported.status,'blocked');assert(unsupported.issues.some(issue=>issue.includes('setter')));const duplicate=cap('Duplicate');assert.equal(duplicate.status,'blocked');assert(duplicate.issues.some(issue=>issue.includes('2 authored')));});
test('a signal overwritten before the business read does not become a caller input',()=>{assert.deepEqual(cap('Overwritten').fields,[]);});
