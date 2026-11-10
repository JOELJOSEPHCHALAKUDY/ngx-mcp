import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {Ajv} from 'ajv';
import {parseTemplate} from '@angular/compiler';
import {compile} from '../src/compiler.js';
import {Project} from '../src/project.js';
import {allElements,controls,resolveLoopOptions,staticTemplateValues} from '../src/workflow-compiler.js';

const directory=mkdtempSync(resolve(tmpdir(),'angular-schema-inference-'));
after(()=>rmSync(directory,{recursive:true,force:true}));
symlinkSync(resolve('node_modules'),resolve(directory,'node_modules'),'dir');
const source=String.raw`
import {Component,Injectable} from '@angular/core';
import {FormBuilder,FormControl,Validators} from '@angular/forms';
@Injectable() export class Writer {save(payload:object){return payload;}select(value:string){return value;}saveText(text:string){return text;}}
const PAGE_SIZES=[5,10,20] as const;
let DYNAMIC_SIZES=[4,8];
@Component({selector:'native-form',template:__T__
<form #entry="ngForm" (ngSubmit)="save(entry)">
<input name="title" [(ngModel)]="title" required [minLength]="minimum" [maxLength]="limits.maximum">
<input name="code" [(ngModel)]="code" required pattern="[A-Z]{2}[0-9]{3}">
<input type="number" name="amount" [(ngModel)]="amount" required [min]="minimumAmount" max="24">
<textarea name="memo" [(ngModel)]="memo" minlength="3" maxlength="8"></textarea>
<input type="checkbox" name="consent" [(ngModel)]="consent" required>
<button type="submit">Save</button></form>__T__})
export class NativeForm {
 readonly minimum=3;readonly limits={maximum:12};readonly minimumAmount=-2;
 title='';code='';amount=1;memo='';consent=false;
 constructor(private writer:Writer){}
 save(form:any){if(form.invalid)return;this.writer.save({title:this.title,code:this.code,amount:this.amount,memo:this.memo,consent:this.consent});}
}
@Component({selector:'bound-fields',template:__T__
<form #entry="ngForm" (ngSubmit)="save(entry)">
<input name="optional" [(ngModel)]="value" required="false" [minlength]="floor" [maxlength]="ceiling">
<input name="runtime" [(ngModel)]="other" [required]="runtimeRequired" [minlength]="changingMinimum">
<button type="submit">Save</button></form>__T__})
export class BoundFields {
 readonly floor=2;readonly ceiling=8;changingMinimum=3;runtimeRequired=false;value='';other='';
 constructor(private writer:Writer){}
 configure(n:number,required:boolean){this.changingMinimum=n;this.runtimeRequired=required;}
 save(form:any){if(form.invalid)return;this.writer.save({value:this.value,other:this.other});}
}
@Component({selector:'reactive-form',template:__T__
<form [formGroup]="form" (ngSubmit)="save()"><input formControlName="title" minlength="4" maxlength="8" pattern="[A-Z]*Z"><button type="submit">Save</button></form>__T__})
export class ReactiveForm {
 form=this.fb.group({title:['',[Validators.required,Validators.minLength(2),Validators.maxLength(20),Validators.pattern('[A-Z]+')]]});
 constructor(private fb:FormBuilder,private writer:Writer){}
 save(){if(this.form.invalid)return;this.writer.save(this.form.value);}
}
@Component({selector:'choices-form',template:__T__
<mat-radio-group (change)="select($event.value)">@for(option of options;track option){<mat-radio-button [value]="option">{{option}}</mat-radio-button>}</mat-radio-group>
<mat-button-toggle-group (change)="set($event.value)"><mat-button-toggle *ngFor="let option of options" [value]="option">{{option}}</mat-button-toggle></mat-button-toggle-group>__T__})
export class Choices {
 options=['low','medium','high'];readonly pageSizes=PAGE_SIZES;readonly dynamicSizes=DYNAMIC_SIZES;readonly settings={sizes:[3,6,9]};
 constructor(private writer:Writer){}
 select(value:string){this.writer.select(value);}set(value:string){this.writer.select(value);}
}
@Component({selector:'mutable-choices',template:__T__
<mat-radio-group (change)="select($event.value)">@for(option of options;track option){<mat-radio-button [value]="option">{{option}}</mat-radio-button>}</mat-radio-group>__T__})
export class MutableChoices {options=['low'];constructor(private writer:Writer){}configure(){this.options.push('runtime');}select(value:string){this.writer.select(value);}}
@Component({selector:'material-fields',template:__T__
<form><mat-form-field><mat-label>Amount</mat-label><input type="number" name="amount" [(ngModel)]="amount" required min="-3" max="7"></mat-form-field>
<mat-slide-toggle name="enabled" [(ngModel)]="enabled">Enabled</mat-slide-toggle></form>__T__})
export class MaterialFields {amount=0;enabled=false;}
@Component({selector:'standalone-fields',template:__T__<form (ngSubmit)="save()"><textarea [formControl]="content"></textarea><button type="submit">Save</button></form>__T__})
export class StandaloneFields {content=new FormControl('');constructor(private writer:Writer){}save(){this.writer.saveText(this.content.value);}}
@Component({selector:'disabled-fields',template:__T__<form (ngSubmit)="save()"><textarea [formControl]="content"></textarea><button type="submit" [disabled]="!content.value">Save</button></form>__T__})
export class DisabledFields {content=new FormControl('');constructor(private writer:Writer){}save(){this.writer.saveText(this.content.value);}}
@Component({selector:'required-fields',template:__T__<form (ngSubmit)="save()"><textarea [formControl]="content"></textarea><button type="submit">Save</button></form>__T__})
export class RequiredFields {content=new FormControl('',Validators.required);constructor(private writer:Writer){}save(){this.writer.saveText(this.content.value);}}
@Component({selector:'rich-fields',template:__T__<form (ngSubmit)="save()"><quill-editor [formControl]="content"></quill-editor><button type="submit">Save</button></form>__T__})
export class RichFields {content=new FormControl('');constructor(private writer:Writer){}save(){this.writer.saveText(this.content.value);}}
export const routes=[{path:'native',component:NativeForm},{path:'bound',component:BoundFields},{path:'reactive',component:ReactiveForm},{path:'choices',component:Choices},{path:'mutable',component:MutableChoices},{path:'standalone',component:StandaloneFields},{path:'disabled',component:DisabledFields},{path:'required',component:RequiredFields},{path:'rich',component:RichFields}];
`.replaceAll('__T__',String.fromCharCode(96));
writeFileSync(resolve(directory,'app.ts'),source);
writeFileSync(resolve(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},include:['app.ts']}));
const config=resolve(directory,'tsconfig.json'),manifest=compile(config,'app.ts#routes'),project=new Project(config),ajv=new Ajv({strict:false});
const capability=(route:string,handler='save')=>{const c=manifest.capabilities.find(c=>c.route===route&&c.handler===handler);assert(c,`Missing ${route}.${handler}`);return c;};
const input=(route:string)=>ajv.compile(capability(route).inputSchema);

test('native template validators preserve string, regex, numeric and checkbox constraints',()=>{
 const validate=input('/native'),good={title:'Course',code:'AB123',amount:1.5,memo:'',consent:true};assert(validate(good),ajv.errorsText(validate.errors));
 for(const patch of [{title:'xx'},{title:'x'.repeat(13)},{code:'ab123'},{code:'prefixAB123'},{amount:-3},{amount:25},{memo:'x'},{memo:'x'.repeat(9)},{consent:false}])assert(!validate({...good,...patch}),JSON.stringify(patch));
});
test('bound validator aliases resolve constants while mutable rules remain unknown',()=>{
 const c=capability('/bound'),props=(c.inputSchema as {properties:Record<string,any>}).properties;
 assert(!((c.inputSchema as {required:string[]}).required).includes('optional'));
 assert(ajv.compile(c.inputSchema)({optional:'',runtime:''}));assert(!ajv.compile(c.inputSchema)({optional:'x',runtime:''}));
 assert.equal(JSON.stringify(props.runtime).includes('minLength'),false);
 const cls=project.classes.find(c=>c.name?.text==='Choices')!;
 assert.deepEqual(staticTemplateValues(project,cls,'pageSizes'),[5,10,20]);assert.deepEqual(staticTemplateValues(project,cls,'settings.sizes'),[3,6,9]);
 assert.equal(staticTemplateValues(project,cls,'dynamicSizes'),undefined);
});
test('reactive and template validators combine instead of overriding each other',()=>{
 const validate=input('/reactive');assert(validate({title:'ABCDZ'}));for(const title of ['ABZ','ABCDEF','abcz','ABCDEFGHZ'])assert(!validate({title}),title);
});
test('radio and button-toggle loops expose their complete static option set',()=>{
 for(const handler of ['select','set']){const validate=ajv.compile(capability('/choices',handler).inputSchema);assert(validate({value:'medium'}));assert(!validate({value:'runtime'}));}
});
test('mutated option arrays are not mistaken for a fixed enum',()=>{
 const cls=project.classes.find(c=>c.name?.text==='MutableChoices')!,template=project.template(cls)!,group=allElements(parseTemplate(template.text,template.file).nodes).find(n=>n.name==='mat-radio-group')!;
 assert.equal(resolveLoopOptions(project,cls,group),undefined);assert.equal(staticTemplateValues(project,cls,'options'),undefined);
});
test('workflow controls share native bounds and support Material toggle adapters',()=>{
 const cls=project.classes.find(c=>c.name?.text==='MaterialFields')!,template=project.template(cls)!,bound=controls(project,cls,parseTemplate(template.text,template.file).nodes);
 const amount=bound.fields.find(f=>f.name==='amount')!,toggle=bound.fields.find(f=>f.name==='enabled')!;
 assert.deepEqual(amount.schema,{type:'number',minimum:-3,maximum:7});assert.equal(amount.required,true);assert.equal(toggle.adapter,'material-toggle');assert.equal(toggle.supported,true);
});
test('standalone controls require an explicit argument but allow clearing without an actual required constraint',()=>{
 const validate=input('/standalone');assert(!validate({}));assert(validate({text:''}));
 for(const route of ['/disabled','/required']){const check=input(route);assert(!check({text:''}));assert(check({text:'value'}));}
});
test('Quill controls use the dedicated adapter and preserve empty content when clearing is allowed',()=>{
 const c=capability('/rich');assert.equal(c.fields[0].adapter,'contenteditable');assert.equal(c.fields[0].supported,true);assert(ajv.compile(c.inputSchema)({text:''}));
});
