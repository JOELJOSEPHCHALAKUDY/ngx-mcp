import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import type {IntegrationDescriptor} from '../src/integration-runtime.js';
import {integrationFormTools,integrationToolCatalogSource,integrationValidateInput} from '../src/integration-catalog.js';

const name=(id:string)=>'angular_form_'+createHash('sha256').update(id).digest('hex').slice(0,16);
function node(overrides:Partial<IntegrationDescriptor>={}):IntegrationDescriptor {
 return {sourceId:'source-field',instanceId:'field@nonce:1',kind:'control',tagName:'input',visible:true,disabled:false,readonly:false,label:'Title',events:[],operations:['fill'],schema:{type:'string'},path:['title'],validation:{status:'unknown',fields:[],groups:[]},...overrides};
}
function form(fields:IntegrationDescriptor[],overrides:Partial<IntegrationDescriptor>={}):IntegrationDescriptor {
 return node({sourceId:'source-form',instanceId:'form@nonce:1',kind:'form',tagName:'form',label:'Add title',operations:['submit'],fields,...overrides});
}

test('shared form catalog preserves names, exact ownership, optional fields, and current visibility policy',()=>{
 const field=node(),ignored=node({instanceId:'hidden@nonce:2',visible:false,schema:false});
 const source=form([field,ignored,node({readonly:true,schema:false}),node({disabled:true,schema:false})]);
 const tools=integrationFormTools([source,form([field],{visible:false}),form([field],{disabled:true}),field],name);
 assert.equal(tools.length,1);
 const tool=tools[0]!;
 assert.equal(tool.name,name(source.instanceId));assert.equal(tool.node,source);assert.equal(tool.bindings['title'],field);
 assert.deepEqual(tool._meta,{angularMcpTarget:{sourceId:source.sourceId,instanceId:source.instanceId}});
 assert.deepEqual(tool.inputSchema,{type:'object',properties:{title:{type:'string',title:'Title'}},additionalProperties:false});
 integrationValidateInput(tool.inputSchema,{});
 assert.throws(()=>integrationValidateInput(tool.inputSchema,{title:10}),/invalid type/);
 assert.throws(()=>integrationValidateInput(tool.inputSchema,{unexpected:'value'}),/Unexpected/);
});

test('unsupported visible fields and duplicate control paths suppress a form instead of inventing ownership',()=>{
 const repeated=node({instanceId:'field@nonce:2'});
 assert.deepEqual(integrationFormTools([form([node(),repeated])],name),[]);
 assert.deepEqual(integrationFormTools([form([node({schema:false})])],name),[]);
 assert.deepEqual(integrationFormTools([form([node({operations:[]})])],name),[]);
 const tools=integrationFormTools([form([node({path:[],instanceId:'anonymous@nonce:1'})])],name);
 assert.deepEqual(Object.keys(tools[0]!.inputSchema['properties'] as object),['anonymous@nonce:1']);
});

test('schema and binding keys remain data when a control is named __proto__ or constructor',()=>{
 const fields=[node({path:['__proto__']}),node({path:['constructor'],instanceId:'field@nonce:2'})];
 const tool=integrationFormTools([form(fields)],name)[0]!;
 const properties=tool.inputSchema['properties'] as Record<string,unknown>;
 assert.equal(Object.getPrototypeOf(properties),Object.prototype);
 assert.equal(Object.getPrototypeOf(tool.bindings),null);
 assert(Object.hasOwn(properties,'__proto__'));assert(Object.hasOwn(properties,'constructor'));
 integrationValidateInput(tool.inputSchema,JSON.parse('{"__proto__":"value","constructor":"value"}'));
 assert.equal(({} as Record<string,unknown>)['polluted'],undefined);
});

test('browser argument validation covers current target alternatives, nullable fields, arrays and primitive choices',()=>{
 const schema={type:'object',properties:{target:{type:'object',properties:{sourceId:{type:'string'},instanceId:{type:'string'}},anyOf:[{required:['sourceId']},{required:['instanceId']}],additionalProperties:false},amount:{type:['number','null'],minimum:0},selected:{type:'array',items:{type:'string'},maxItems:2},mode:{enum:['input','paste']},timeout:{type:'integer',minimum:0,maximum:30000}},required:['target'],additionalProperties:false};
 integrationValidateInput(schema,{target:{instanceId:'exact'},amount:null,selected:['a'],mode:'input',timeout:0});
 for(const input of [{target:{}},{target:{sourceId:'s',extra:true}},{target:{sourceId:1}},{target:{sourceId:'s'},amount:-1},{target:{sourceId:'s'},selected:['a',4]},{target:{sourceId:'s'},mode:'unknown'},{target:{sourceId:'s'},timeout:0.5}])assert.throws(()=>integrationValidateInput(schema,input));
});

test('browser validation fails closed on unknown rules, getters, non-JSON objects and cycles',()=>{
 assert.throws(()=>integrationValidateInput({type:'string',pattern:'^x$'},'x'),/Unsupported/);
 assert.throws(()=>integrationValidateInput({anyOf:[{},{$ref:'#/missing'}]},'x'),/Unsupported/);
 assert.throws(()=>integrationValidateInput({type:'number'},NaN),/finite/);
 assert.throws(()=>integrationValidateInput({},new Date()),/plain JSON/);
 const cyclic:Record<string,unknown>={};cyclic['self']=cyclic;assert.throws(()=>integrationValidateInput({},cyclic),/cyclic/);
 let calls=0;const getter=Object.defineProperty({},'secret',{get(){calls++;return 'secret';},enumerable:true});
 assert.throws(()=>integrationValidateInput({},getter),/accessors/);assert.equal(calls,0);
 assert.throws(()=>integrationValidateInput({},[,'x']),/sparse/);
});

test('the exact emitted catalog compiles with strict application flags and executes without Node closures',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'integration-shared-catalog-'));
 try{
  const source=integrationToolCatalogSource()+'\nexport {integrationFormTools,integrationValidateInput};';
  const file=join(directory,'catalog.ts');writeFileSync(file,source);
  const ts:any=createRequire(import.meta.url)('typescript');
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,moduleResolution:ts.ModuleResolutionKind.Bundler,skipLibCheck:true,noEmit:true,types:[],strict:true,noPropertyAccessFromIndexSignature:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,noUnusedLocals:true,noUnusedParameters:true,noImplicitReturns:true};
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([file],options));
  assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>directory,getCanonicalFileName:(path:string)=>path,getNewLine:()=> '\n'}));
  const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
  const emitted=await import('data:text/javascript;base64,'+Buffer.from(javascript).toString('base64'));
  const original=integrationFormTools([form([node()])],name),actual=emitted.integrationFormTools([form([node()])],name);
  assert.deepEqual(actual,original);emitted.integrationValidateInput(actual[0].inputSchema,{title:'Browser code'});
  assert.throws(()=>emitted.integrationValidateInput(actual[0].inputSchema,{title:false}),/invalid type/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
