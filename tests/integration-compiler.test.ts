import {after,before,test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {instrumentProject,type IntegrationPlan} from '../src/integration-compiler.js';
import {integrationRuntimeSource} from '../src/integration-runtime.js';

const directory=mkdtempSync(join(tmpdir(),'ngtsc-integration-source-')),stage=mkdtempSync(join(tmpdir(),'ngtsc-integration-stage-'));
const modules=resolve('samples/toolchains/course-crud/node_modules');
for(const root of [directory,stage])symlinkSync(modules,join(root,'node_modules'),'dir');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const shared=`<form #form="ngForm" (ngSubmit)="save()"><input name="title" [(ngModel)]="title" [mark]="title" (changed)="change($event)" (keyup.enter)="save()"><custom-control name="custom" [(ngModel)]="title"></custom-control>@for(item of items;track item){<div role="button" (click)="save()"><button (click)="save()">Go</button></div>}</form>`;
const inline=`<section title="A\\B and 'single'"><input name="inline" [(ngModel)]="title" (keyup.enter)="save()"></section>`;
const app=String.raw`
import {Component as ActualComponent,Directive,Input,Output,EventEmitter,forwardRef} from '@angular/core';
import {FormsModule,ControlValueAccessor,NG_VALUE_ACCESSOR} from '@angular/forms';
@Directive({selector:'[mark]',standalone:true})export class Marker{@Input('mark') tint='';@Output() changed=new EventEmitter<string>();}
@Directive({selector:'[mark]',standalone:true})export class OtherMarker{@Input('mark') shading='';@Output() changed=new EventEmitter<string>();}
@ActualComponent({selector:'custom-control',standalone:true,providers:[{provide:NG_VALUE_ACCESSOR,useExisting:forwardRef(()=>CustomControl),multi:true}],template:'<input>'})
export class CustomControl implements ControlValueAccessor{writeValue(value:any){}registerOnChange(fn:any){}registerOnTouched(fn:any){}}
@ActualComponent({selector:'first-page',standalone:true,imports:[FormsModule,Marker,CustomControl],templateUrl:'./shared.html'})
export class First{title='first';items=['one','two'];save(){}change(value:string){}}
@ActualComponent({selector:'second-page',standalone:true,imports:[FormsModule,OtherMarker,CustomControl],templateUrl:'./shared.html'})
export class Second{title='second';items=['one'];save(){}change(value:string){}}
@ActualComponent({selector:'inline-page',standalone:true,imports:[FormsModule],template:__INLINE__})
export class Inline{title='inline';save(){}}
`.replace('__INLINE__',JSON.stringify(inline));
const legacy=String.raw`
import {Component,NgModule} from '@angular/core';
@Component({selector:'legacy-page',standalone:false,template:'<button (click)="save()">Legacy</button>'})export class Legacy{save(){}}
@NgModule({declarations:[Legacy],imports:[]})export class LegacyModule{}
`;
const fake=`function Component(value:unknown):ClassDecorator{return ()=>{};}@Component({template:'<button (click)="save()">Fake</button>'})export class Fake{save(){}}`;
const indirectHtml=`<form #form="ngForm" (ngSubmit)="save()"><input name="title" [(ngModel)]="title" [mark]="title" (changed)="change($event)"><button (click)="save()">Go</button>@for(item of ['a','b'];track item){<button (click)="save()">{{ item }}</button>}</form>`;
const importedHtml="<section title=\"a 'quote' and \\\\slash ${literal}\"><button (click)=\"save()\">Line\n` and dollar</button></section>";
const noSubstitution=(value:string)=>'`'+value.replaceAll('\\','\\\\').replaceAll('`','\\`').replaceAll('${','\\${')+'`';
const templateValues='export const EXPORTED_TEMPLATE = '+noSubstitution(importedHtml)+';';
const indirect=`
import {Component,NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Marker,OtherMarker} from './app';
import {EXPORTED_TEMPLATE as importedTemplate} from './template-values';
const LOCAL_TEMPLATE = ${noSubstitution(indirectHtml)};
@Component({selector:'constant-one',standalone:true,imports:[FormsModule,Marker],template:LOCAL_TEMPLATE})
export class ConstantOne{title='one';save(){}change(value:string){}}
@Component({selector:'constant-two',standalone:true,imports:[FormsModule,OtherMarker],template:LOCAL_TEMPLATE})
export class ConstantTwo{title='two';save(){}change(value:string){}}
@Component({selector:'imported-page',standalone:true,template:importedTemplate})export class ImportedTemplate{save(){}}
@Component({selector:'constant-legacy',standalone:false,template:LOCAL_TEMPLATE})export class ConstantLegacy{title='legacy';save(){}change(value:string){}}
@NgModule({declarations:[ConstantLegacy],imports:[FormsModule,Marker]})export class ConstantModule{}
`;
const config=JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[],useDefineForClassFields:false},angularCompilerOptions:{strictTemplates:true},files:['app.ts','legacy.ts','fake.ts','indirect.ts','template-values.ts']});
const originals=new Map<string,string>([['app.ts',app],['legacy.ts',legacy],['fake.ts',fake],['shared.html',shared],['indirect.ts',indirect],['template-values.ts',templateValues],['tsconfig.json',config]]);
for(const [file,content]of originals)writeFileSync(join(directory,file),content);
let plan:IntegrationPlan;
before(async()=>{plan=await instrumentProject(join(directory,'tsconfig.json'),{workspaceRoot:directory,bridgeModuleSpecifier:file=>'./bridge-runtime'});});
after(()=>{rmSync(directory,{recursive:true,force:true});rmSync(stage,{recursive:true,force:true});});

test('the real project compiler resolves aliases, NgModel and output consumers, with stable source IDs',async()=>{
 assert(plan.valid,JSON.stringify(plan.diagnostics));assert.equal(plan.angularVersion,JSON.parse(readFileSync(join(modules,'@angular/compiler/package.json'),'utf8')).version);assert.equal(plan.compilerCliVersion,plan.angularVersion);assert.equal(plan.typescriptVersion,JSON.parse(readFileSync(join(modules,'typescript/package.json'),'utf8')).version);
 assert(plan.toolchain.compilerCli.startsWith(modules));
 const input=plan.nodes.find(node=>node.source.file==='shared.html'&&node.tag==='input')!;assert(input);assert.equal(input.contexts.length,2);assert(input.resolvedDirectives.some(directive=>directive.name==='NgModel'));
 assert(input.contexts.find(context=>context.component.name==='First')?.resolvedDirectives.some(directive=>directive.name==='Marker'));assert(!input.contexts.find(context=>context.component.name==='First')?.resolvedDirectives.some(directive=>directive.name==='OtherMarker'));assert(input.contexts.find(context=>context.component.name==='Second')?.resolvedDirectives.some(directive=>directive.name==='OtherMarker'));assert(!input.contexts.find(context=>context.component.name==='Second')?.resolvedDirectives.some(directive=>directive.name==='Marker'));
 const marked=input.inputs.find(binding=>binding.name==='mark')!;assert(marked.resolved);assert(marked.consumers.some(consumer=>consumer.kind==='directive'&&consumer.name==='Marker'&&consumer.member==='tint'&&consumer.type==='string'));
 assert(input.outputs.find(output=>output.name==='changed')?.consumers.some(consumer=>consumer.name==='Marker'&&consumer.type?.includes('EventEmitter<string>')));assert(input.outputs.find(output=>output.name==='keyup.enter')?.consumers.some(consumer=>consumer.kind==='native'));
 assert.deepEqual(input.events,['changed','keyup.enter']);assert(input.outputs.find(output=>output.name==='ngModelChange')?.twoWay);
 const again=await instrumentProject(join(directory,'tsconfig.json'),{workspaceRoot:directory,bridgeModuleSpecifier:'./bridge-runtime'});assert.deepEqual(again.nodes.map(node=>node.id),plan.nodes.map(node=>node.id));
});

test('shared resources have one edit and explicit per-component scopes, and form/view associations are preserved',()=>{
 const html=plan.edits.filter(edit=>edit.file==='shared.html');assert.equal(html.length,1);
 const authored=plan.nodes.filter(node=>node.source.file==='shared.html');assert(authored.every(node=>node.contexts.length===2));
 assert.equal(new Set(plan.nodes.map(node=>node.id)).size,plan.nodes.length);
 const form=authored.find(node=>node.tag==='form')!;assert(form);
 assert(authored.filter(node=>node.tag!=='form').every(node=>node.formId===form.id));
 const repeated=authored.find(node=>node.tag==='button')!;assert(repeated.repeated);assert(repeated.viewPath.some(view=>view.kind==='for'));
 const cva=authored.find(node=>node.tag==='custom-control')!;assert(cva);assert.equal(cva.native,false);assert(cva.resolvedDirectives.some(directive=>directive.name==='NgModel'));
 const div=authored.find(node=>node.tag==='div')!;assert(div);assert.deepEqual(div.events,['click']);assert(div.outputs[0].consumers.some(consumer=>consumer.kind==='native'));
 assert(plan.diagnostics.some(diagnostic=>diagnostic.code==='directive-output-dispatch'));
});

test('only actual Angular standalone/component module scopes change; source originals remain untouched',()=>{
 assert(!plan.edits.some(edit=>edit.file==='fake.ts'));
 assert(plan.edits.find(edit=>edit.file==='app.ts')?.content.includes('AngularMcpBridgeModule as __AngularMcpBridgeModule'));
 const legacyEdit=plan.edits.find(edit=>edit.file==='legacy.ts')!;assert(legacyEdit.content.includes('imports: [\n        __AngularMcpBridgeModule\n    ]')||legacyEdit.content.includes('imports: [__AngularMcpBridgeModule]'));
 for(const [file,content]of originals){assert.equal(readFileSync(join(directory,file),'utf8'),content);const edit=plan.edits.find(edit=>edit.file===file);if(edit)assert.equal(edit.beforeSha256,hash(content));}
});


test('constant and imported templates use explicit evaluated mappings and preserve shared declarations',async()=>{
 assert(plan.valid,JSON.stringify(plan.diagnostics));
 const mapped=plan.nodes.filter(node=>node.source.mapping==='evaluated-template');assert(mapped.length>=10);
 for(const name of ['ConstantOne','ConstantTwo','ConstantLegacy','ImportedTemplate']){
  const nodes=mapped.filter(node=>node.contexts.some(context=>context.component.name===name));assert(nodes.length>0,name);
  assert(nodes.every(node=>node.contexts.length===1));
  for(const node of nodes){assert(node.source.templateExpression);assert(node.source.templateSha256);assert(node.source.start<node.source.end);}
 }
 const one=mapped.find(node=>node.tag==='input'&&node.contexts[0].component.name==='ConstantOne')!,two=mapped.find(node=>node.tag==='input'&&node.contexts[0].component.name==='ConstantTwo')!;
 assert.notEqual(one.id,two.id);assert(one.resolvedDirectives.some(d=>d.name==='Marker'));assert(!one.resolvedDirectives.some(d=>d.name==='OtherMarker'));assert(two.resolvedDirectives.some(d=>d.name==='OtherMarker'));assert(!two.resolvedDirectives.some(d=>d.name==='Marker'));
 assert(mapped.some(node=>node.repeated&&node.viewPath.some(view=>view.mapping==='evaluated-template'&&view.templateExpressionStart!==undefined)));
 assert(!plan.edits.some(edit=>edit.file==='template-values.ts'));
 const require=createRequire(join(directory,'tsconfig.json')),ts=require('typescript'),edited=plan.edits.find(edit=>edit.file==='indirect.ts')!.content;
 const ast=ts.createSourceFile('indirect.ts',edited,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);let localValue:string|undefined;const values=new Map<string,string>();
 const visit=(node:any)=>{
  if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='LOCAL_TEMPLATE')localValue=node.initializer.text;
  if(ts.isClassDeclaration(node)){for(const decorator of ts.getDecorators(node)??[]){if(!ts.isCallExpression(decorator.expression))continue;const metadata=decorator.expression.arguments[0];if(!metadata||!ts.isObjectLiteralExpression(metadata))continue;for(const property of metadata.properties)if(ts.isPropertyAssignment(property)&&property.name.text==='template'){assert(ts.isStringLiteral(property.initializer));values.set(node.name.text,property.initializer.text);}}}
  ts.forEachChild(node,visit);
 };visit(ast);assert.equal(localValue,indirectHtml);assert(!localValue!.includes('angularMcpSource'));
 const clean=(value:string)=>value.replace(/ angularMcpSource="[^"]*" angularMcpEvents="[^"]*"/g,'');
 for(const name of ['ConstantOne','ConstantTwo','ConstantLegacy'])assert.equal(clean(values.get(name)!),indirectHtml);
 assert.equal(clean(values.get('ImportedTemplate')!),importedHtml);
 const again=await instrumentProject(join(directory,'tsconfig.json'),{workspaceRoot:directory,bridgeModuleSpecifier:'./bridge-runtime'});
 assert.deepEqual(again.nodes.filter(node=>node.source.mapping==='evaluated-template').map(node=>node.id),mapped.map(node=>node.id));
});

test('escaped inline templates and shared-template instrumentation compile through the real AOT compiler',{timeout:90000},async()=>{
 for(const [file,content]of originals)writeFileSync(join(stage,file),content);
 for(const edit of plan.edits)writeFileSync(join(stage,edit.file),edit.content);
 writeFileSync(join(stage,'bridge-runtime.ts'),integrationRuntimeSource());
 const require=createRequire(join(stage,'tsconfig.json')),entry=require.resolve('@angular/compiler-cli'),ngc:any=await import(pathToFileURL(entry).href);
 const parsed=ngc.readConfiguration(join(stage,'tsconfig.json'));const options={...parsed.options,noEmit:false,outDir:join(stage,'out'),_enableTemplateTypeChecker:true};
 const program=new ngc.NgtscProgram(parsed.rootNames,options,ngc.createCompilerHost({options}));await program.loadNgStructureAsync();
 const diagnostics=[...program.getTsSyntacticDiagnostics(),...program.getTsSemanticDiagnostics(),...program.getNgStructuralDiagnostics(),...program.getNgSemanticDiagnostics()];
 assert.equal(diagnostics.filter((diagnostic:any)=>diagnostic.category===1).length,0,ngc.formatDiagnostics(diagnostics));
 const emitted=program.emit();assert.equal(emitted.emitSkipped,false);
 const js=readFileSync(join(stage,'out/app.js'),'utf8');assert(js.includes('angularMcpSource'));assert(js.includes('ngmcp_'));assert(!js.includes('window.ng'));
 const indirectJs=readFileSync(join(stage,'out/indirect.js'),'utf8');assert(indirectJs.includes('angularMcpSource'));assert(indirectJs.includes('ConstantOne'));assert(indirectJs.includes('ConstantLegacy'));assert(indirectJs.includes('ImportedTemplate'));
});
