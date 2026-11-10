import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseTemplate} from '@angular/compiler';
import {Project} from '../src/project.js';
import {nonblankValidator} from '../src/validator-constraints.js';
import {allElements,resolveLoopOptions,staticTemplateValues} from '../src/workflow-compiler.js';
const directory=mkdtempSync(join(tmpdir(),'angular-source-proofs-'));after(()=>rmSync(directory,{recursive:true,force:true}));
writeFileSync(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',skipLibCheck:true,types:[]},files:['source.ts']}));
writeFileSync(join(directory,'source.ts'),`
const MUTATED=['first'];MUTATED.push('second');class GlobalMutation {choices=MUTATED;}
const ROOT=['one'];const ALIAS=ROOT;ALIAS.push('two');class IndirectMutation {choices=ROOT;}
class MemberAliasMutation {choices=['before'];constructor(){const alias=this.choices;alias.push('after');}}
const STABLE=['red','blue'];const STABLE_ALIAS=STABLE;class StableChoices {readonly choices=STABLE_ALIAS;}
class SpacedChoices {choices=['  New   York  ','a\\tb','x\\u00a0y'];}
function ReboundParameter(){return (control:any)=>{var control:any={value:'always nonblank'};return control.value.trim().length!==0?null:{blank:true};};}
function ProvenValidator(){return (control:any)=>{const blank=control.value.trim().length===0;return blank?{blank:true}:null;};}
const rebound=ReboundParameter();const proven=ProvenValidator();
`);
const project=new Project(join(directory,'tsconfig.json'));const cls=(name:string)=>project.classes.find(cls=>cls.name?.text===name)!;
const select=(extra='')=>allElements(parseTemplate(`<select>@for(label of choices;track label){<option>{{label}}</option>}${extra}</select>`,'fixture.html').nodes).find(element=>element.name==='select')!;
function invocation(name:string){const source=project.files.find(file=>file.fileName.endsWith('/source.ts'))!;const declaration=source.statements.filter(ts.isVariableStatement).flatMap(statement=>statement.declarationList.declarations).find(declaration=>declaration.name.getText()===name)!;return declaration.initializer!;}
test('external and transitive alias mutations cannot publish a restrictive static option set',()=>{
 for(const name of ['GlobalMutation','IndirectMutation','MemberAliasMutation']){assert.equal(staticTemplateValues(project,cls(name),'choices'),undefined,name);assert.equal(resolveLoopOptions(project,cls(name),select()),undefined,name);}
});
test('unmodified const aliases remain source-provable',()=>{assert.deepEqual(staticTemplateValues(project,cls('StableChoices'),'choices'),['red','blue']);});
test('a validator that overwrites its control parameter cannot establish an input constraint',()=>{assert.equal(nonblankValidator(project,invocation('rebound')),false);assert.equal(nonblankValidator(project,invocation('proven')),true);});
test('implicit native option values use native ASCII whitespace normalization',()=>{assert.deepEqual(resolveLoopOptions(project,cls('SpacedChoices'),select()),['New York','a b','x\u00a0y']);});
test('known literal siblings join the full source option enum instead of being omitted',()=>{assert.deepEqual(resolveLoopOptions(project,cls('StableChoices'),select('<option value="extra">Extra</option>')),['red','blue','extra']);});
test('known native placeholders and one ngFor loop retain the complete source set',()=>{const element=allElements(parseTemplate('<select><option value="">Select</option><option *ngFor="let label of choices" [value]="label">{{label}}</option></select>','fixture.html').nodes).find(element=>element.name==='select')!;assert.deepEqual(resolveLoopOptions(project,cls('StableChoices'),element),['','red','blue']);});
test('unknown bound siblings and a second unresolved loop cannot publish a partial enum',()=>{
 assert.equal(resolveLoopOptions(project,cls('StableChoices'),select('<option [value]="loaded">Loaded</option>')),undefined);
 assert.equal(resolveLoopOptions(project,cls('StableChoices'),select('@for(other of loaded;track other){<option [value]="other">{{other}}</option>}')),undefined);
 assert.equal(resolveLoopOptions(project,cls('StableChoices'),select('@if(flag){<option value="conditional">Conditional</option>}')),undefined);
});
test('explicit native option value bindings preserve authored whitespace',()=>{const element=allElements(parseTemplate('<select>@for(label of choices;track label){<option [value]="label">{{label}}</option>}</select>','fixture.html').nodes).find(element=>element.name==='select')!;assert.deepEqual(resolveLoopOptions(project,cls('SpacedChoices'),element),['  New   York  ','a\tb','x\u00a0y']);});
