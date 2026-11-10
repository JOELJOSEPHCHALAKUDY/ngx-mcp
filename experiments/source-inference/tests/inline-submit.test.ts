import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {compile} from '../src/compiler.js';

const directory=mkdtempSync(resolve(tmpdir(),'angular-inline-submit-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Injectable,Input} from '@angular/core';
import {FormControl} from '@angular/forms';
@Injectable() export class Writer {save(value:string){}}
@Component({selector:'submit-control',template:'<button [type]="buttonType"><ng-content /></button>'})
export class SubmitControl {@Input('type') buttonType='button';}
@Component({selector:'inline-comment',template:__T__<textarea [formControl]="content" (click)="edit(true)"></textarea>@if(editing){<button id="save" (click)="save()">Save</button>}__T__})
export class InlineComment {editing=false;content=new FormControl('');constructor(private writer:Writer){}edit(mode:boolean){this.editing=mode;}save(){this.writer.save(this.content.value);}}
@Component({selector:'inline-description',template:__T__@if(editing){<textarea [formControl]="content"></textarea><button id="save" (click)="save()">Save</button>}@else{<button id="edit" (click)="edit(true)">Edit</button>}__T__})
export class InlineDescription {editing=false;content=new FormControl('');constructor(private writer:Writer){}edit(mode:boolean){this.editing=mode;}save(){this.writer.save(this.content.value);}}
@Component({selector:'submit-form',imports:[SubmitControl],template:__T__<form (ngSubmit)="save()"><input name="title" [(ngModel)]="title"><submit-control type="submit">Save</submit-control></form>__T__})
export class SubmitForm {title='';constructor(private writer:Writer){}save(){this.writer.save(this.title);}}
@Component({selector:'layout-page',template:'<button (click)="save()">Layout</button><router-outlet />'})
export class Layout {constructor(private writer:Writer){}save(){this.writer.save('layout');}}
export function ContentValidator(){return (control:any)=>{let text=control.value;if(typeof text==='number'){text=String(text);}const blank=(text||'').trim().length===0;const okay=!blank;return okay?null:{blank:'Content needed'};};}
export function UnrelatedValidator(){return (control:any)=>{const text='';const blank=text.trim().length===0;return blank?{blank:true}:null;};}
@Component({selector:'validated-form',template:__T__<form [formGroup]="form" (ngSubmit)="save()"><input formControlName="title"><button type="submit" [disabled]="form.invalid">Save</button></form>__T__})
export class ValidatedForm {form=this.fb.group({title:['',ContentValidator()]});constructor(private fb:FormBuilder,private writer:Writer){}save(){this.writer.save(this.form.value);}}
@Component({selector:'model-fields',template:__T__<section><label>Title<input [(ngModel)]="title" required minlength="2"></label><textarea [(ngModel)]="note" maxlength="10"></textarea><button (click)="save()">Save</button></section>__T__})
export class ModelFields {title='';note='';constructor(private writer:Writer){}save(){this.writer.save({title:this.title,note:this.note});this.title='';}}
@Component({selector:'visible-result',template:'<p>{{result}}</p>'})
export class VisibleResult {result='';constructor(private route:ActivatedRoute,private writer:Writer){}ngOnInit(){const token=this.route.snapshot.queryParamMap.get('token');if(!token)return;this.result=this.writer.save(token)?'yes':'no';}}
export const routes=[{path:'comment',component:InlineComment},{path:'description',component:InlineDescription},{path:'form',component:SubmitForm},{path:'validated',component:ValidatedForm},{path:'models',component:ModelFields},{path:'result',component:VisibleResult},{path:'project',component:Layout,children:[{path:'comment',component:InlineComment}]}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);
writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const manifest=compile(resolve(directory,'tsconfig.json'),'app.ts#routes');
test('an always-visible inline input opens the gated Save action before filling',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/comment'&&c.handler==='save');assert(c);
  assert.equal(c.reveal?.trigger,'inline-comment textarea');assert.equal(c.reveal?.panel,'inline-comment button#save');assert.equal(c.reveal?.kind,'inline');
});
test('inline edit branches use the action as readiness proof',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/description'&&c.handler==='save');assert(c);
  assert.equal(c.reveal?.trigger,'inline-description button#edit');assert.equal(c.reveal?.panel,'inline-description button#save');
});
test('custom submit controls resolve the source-bound native submit button',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/form'&&c.handler==='save');assert(c);
  assert.equal(c.status,'candidate');assert.equal(c.action.submitSelector,'submit-control[type="submit"] button[type="submit"]');
});
test('layout actions are valid only on source-proven mounted child routes',()=>{
  const c=manifest.capabilities.find(c=>c.component==='Layout'&&c.handler==='save');assert(c);
  assert.deepEqual(c.allowedRoutes,['/project/comment']);assert.equal(c.global,undefined);
});
test('source-defined nonblank validators preserve whitespace rules without executing application code',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/validated'&&c.handler==='save');assert(c);
  const schema=c.inputSchema as any;assert.deepEqual(schema.required,['title']);
  assert(schema.properties.title.allOf?.some((s:any)=>String(s.pattern).includes('\\S'))||String(schema.properties.title.pattern).includes('\\S'));
});
test('ngModel fields outside a form are filled only when passed to the traced operation',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/models'&&c.handler==='save');assert(c);
  assert.deepEqual(c.fields.map(f=>f.name).sort(),['note','title']);assert.equal(c.plan?.targetRoot,'model-fields');
  assert.deepEqual((c.inputSchema as any).required,['title']);
});
test('query-parameter page loads include a source service result rendered in the template',()=>{
  const c=manifest.capabilities.find(c=>c.route==='/result'&&c.handler==='ngOnInit');assert(c);
  assert.equal(c.action.kind,'navigation');assert.deepEqual(c.queryParams,['token']);
});
