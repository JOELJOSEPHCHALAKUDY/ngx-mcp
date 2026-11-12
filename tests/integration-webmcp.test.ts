import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createContext,runInContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ts from 'typescript';
import {integrationWebMcpSource} from '../src/integration-webmcp.js';

const fixture=String.raw`
const documentTools=new Map(),legacyTools=new Map();
const foreignRemovals=[];
function nativeContext(tools){return {
 registerTool(tool,options){if(tools.has(tool.name))throw new Error('A tool with this name already exists');tools.set(tool.name,tool);options.signal.addEventListener('abort',()=>{if(tools.get(tool.name)===tool)tools.delete(tool.name);});},
 unregisterTool(name){if(name==='angular_list_nodes'&&tools.get(name)?.foreign)foreignRemovals.push(name);tools.delete(name);}
};}
const document={documentElement:{},modelContext:nativeContext(documentTools)};
const navigator={modelContext:nativeContext(legacyTools)};
const location={origin:'http://localhost',hostname:'localhost'};
const window=globalThis;
const windowListeners=new Map();
window.addEventListener=(name,listener)=>{if(!windowListeners.has(name))windowListeners.set(name,new Set());windowListeners.get(name).add(listener);};
window.removeEventListener=(name,listener)=>{windowListeners.get(name)?.delete(listener);};
function dispatchLifecycle(name,persisted){for(const listener of Array.from(windowListeners.get(name)||[]))listener({type:name,persisted});}
class MutationObserver{observe(){}disconnect(){}}
const first={sourceId:'first',instanceId:'first@document:1',kind:'control',tagName:'input',label:'First',path:['first'],schema:{type:'string'},visible:true,disabled:false,readonly:false,operations:['fill']};
const second={sourceId:'second',instanceId:'second@document:2',kind:'control',tagName:'input',label:'Second',path:['second'],schema:{type:'boolean'},visible:true,disabled:false,readonly:false,operations:['fill']};
const form={sourceId:'form',instanceId:'form@document:3',kind:'form',tagName:'form',label:'Save form',visible:true,disabled:false,readonly:false,operations:['submit'],fields:[first,second]};
const __angularMcpBridge={version:1,mode:'webmcp',nodes:[first,second,form],executions:[],list(){return this.nodes;},describe(target){const matches=this.nodes.filter(node=>target.instanceId?node.instanceId===target.instanceId&&(!target.sourceId||target.sourceId===node.sourceId):node.sourceId===target.sourceId);if(matches.length!==1)throw new Error('Missing or stale target');return matches[0];},readModel(){return {kind:'string',complete:true,value:'Current'};},execute(request){this.executions.push(request);return {status:'ui-dispatched',businessStatus:'unknown'};},subscribe(){return ()=>{};}};
window.__angularMcpBridge=__angularMcpBridge;
function bridge(){return __angularMcpBridge;}
`;

function session(setup=''){
 const context=createContext({crypto:webcrypto,TextEncoder,AbortController,console});
 const source=integrationWebMcpSource().replace('export function installAngularMcpWebMcp','function installAngularMcpWebMcp');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 runInContext(fixture+'\n'+setup+'\n'+compiled,context);
 return {context,evaluate:(code:string)=>runInContext(code,context),async refresh(){await runInContext('__angularMcpBridge.__angularMcpWebMcp.refresh()',context);},dispose(){runInContext('__angularMcpBridge.__angularMcpWebMcp.dispose()',context);}};
}

test('publisher is opt-in and prefers the document WebMCP API over legacy navigator',async()=>{
 const disabled=session("__angularMcpBridge.mode='mcp';");await disabled.refresh();assert.equal(disabled.evaluate('__angularMcpBridge.__angularMcpWebMcp.status'),'unavailable');assert.equal(disabled.evaluate('documentTools.size'),0);assert.equal(disabled.evaluate('legacyTools.size'),0);
 const unavailable=session('document.modelContext=undefined;navigator.modelContext=undefined;');await unavailable.refresh();assert.equal(unavailable.evaluate('__angularMcpBridge.__angularMcpWebMcp.status'),'unavailable');
 const current=session("Object.defineProperty(navigator,'modelContext',{get(){throw new Error('Legacy API blocked');}});");try{await current.refresh();assert.equal(current.evaluate('__angularMcpBridge.__angularMcpWebMcp.api'),'document.modelContext');assert.equal(current.evaluate('documentTools.size'),8);assert.equal(current.evaluate('legacyTools.size'),0);}finally{current.dispose();}
});

test('deployed development builds do not publish native tools',async()=>{
 const s=session("location.origin='https://app.example';location.hostname='app.example';__angularMcpBridge.profile='development';");
 await s.refresh();assert.equal(s.evaluate('documentTools.size'),0);assert.equal(s.evaluate('__angularMcpBridge.__angularMcpWebMcp.status'),'unavailable');
});

test('production catalog denial withdraws registrations and retained callbacks fail closed',async()=>{
 const s=session("__angularMcpBridge.profile='production';__angularMcpBridge.catalog=async()=>__angularMcpBridge.nodes;");try{
  await s.refresh();assert.equal(s.evaluate('documentTools.size'),8);
  s.evaluate("const retainedTool=documentTools.get('angular_fill');__angularMcpBridge.catalog=async()=>{throw new Error('access-revoked');};");
  await s.refresh();assert.equal(s.evaluate('documentTools.size'),0);assert.equal(s.evaluate('__angularMcpBridge.__angularMcpWebMcp.registered.length'),0);
  const denied=await s.evaluate("retainedTool.execute({target:{sourceId:'first'},value:'Denied'})");assert.equal(denied.isError,true);assert.equal(s.evaluate('__angularMcpBridge.executions.length'),0);
  s.evaluate('__angularMcpBridge.catalog=async()=>__angularMcpBridge.nodes;');await s.refresh();assert.equal(s.evaluate('documentTools.size'),8);
 }finally{s.dispose();}
});

test('browser calls validate arguments and every submitted field before any mutation',async()=>{
 const s=session();try{
  await s.refresh();
  const extra=await s.evaluate("documentTools.get('angular_fill').execute({target:{sourceId:'first'},value:'Valid',unexpected:true})");assert.equal(extra.isError,true);
  const wrongType=await s.evaluate("documentTools.get('angular_fill').execute({target:{sourceId:'first'},value:42})");assert.equal(wrongType.isError,true);
  const partial=await s.evaluate("documentTools.get('angular_submit').execute({target:{sourceId:'form'},values:[{target:{sourceId:'first'},value:'Valid'},{target:{sourceId:'second'},value:'Wrong boolean'}]})");assert.equal(partial.isError,true);assert.equal(s.evaluate('__angularMcpBridge.executions.length'),0);
  const valid=await s.evaluate("documentTools.get('angular_submit').execute({target:{sourceId:'form'},values:[{target:{sourceId:'first'},value:'Valid'},{target:{sourceId:'second'},value:true}]})");assert.equal(valid.structuredContent.status,'ui-dispatched');assert.equal(s.evaluate('__angularMcpBridge.executions.length'),1);
 }finally{s.dispose();}
});

test('cancellation during catalog refresh prevents a mutation from starting',async()=>{
 const s=session();try{
  await s.refresh();
  const cancelled=await s.evaluate("const cancellation=new AbortController();const pendingCall=documentTools.get('angular_fill').execute({target:{sourceId:'first'},value:'Cancelled'},{signal:cancellation.signal});cancellation.abort();pendingCall");
  assert.equal(cancelled.isError,true);assert.match(cancelled.content[0].text,/cancelled/);assert.equal(s.evaluate('__angularMcpBridge.executions.length'),0);
 }finally{s.dispose();}
});

test('catalog schema changes replace registrations and retained callbacks cannot execute',async()=>{
 const s=session();try{
  await s.refresh();s.evaluate("const formName=Array.from(documentTools.keys()).find(name=>name.startsWith('angular_form_'));const oldTool=documentTools.get(formName);first.schema={type:'number'};");
  await s.refresh();
  const stale=await s.evaluate("oldTool.execute({first:'Old text',second:true})");assert.equal(stale.isError,true);assert.match(stale.content[0].text,/stale/);assert.equal(s.evaluate('__angularMcpBridge.executions.length'),0);
  const current=await s.evaluate("documentTools.get(formName).execute({first:3,second:true})");assert.equal(current.structuredContent.status,'ui-dispatched');
  s.evaluate('__angularMcpBridge.nodes=[first,second];');await s.refresh();assert.equal(s.evaluate("Array.from(documentTools.keys()).some(name=>name.startsWith('angular_form_'))"),false);
 }finally{s.dispose();}
 assert.equal(s.evaluate('documentTools.size'),0);assert.equal(s.evaluate('__angularMcpBridge.__angularMcpWebMcp.status'),'disposed');
});

test('persisted page restoration republishes tools once without reviving explicit disposal',async()=>{
 const s=session();try{
  await s.refresh();s.evaluate('const originalHandle=__angularMcpBridge.__angularMcpWebMcp;');
  assert.equal(s.evaluate("windowListeners.get('pageshow').size"),1);
  s.evaluate("dispatchLifecycle('pagehide',true);");assert.equal(s.evaluate('documentTools.size'),0);assert.equal(s.evaluate('originalHandle.status'),'disposed');
  s.evaluate("dispatchLifecycle('pageshow',false);");await s.refresh();assert.equal(s.evaluate('documentTools.size'),0);
  s.evaluate("dispatchLifecycle('pageshow',true);");await s.refresh();
  assert.equal(s.evaluate('__angularMcpBridge.__angularMcpWebMcp===originalHandle'),false);assert.equal(s.evaluate('documentTools.size'),8);assert.equal(s.evaluate("windowListeners.get('pageshow').size"),1);
  const result=await s.evaluate("documentTools.get('angular_fill').execute({target:{sourceId:'first'},value:'Restored'})");assert.equal(result.structuredContent.status,'ui-dispatched');
  s.evaluate("dispatchLifecycle('pagehide',true);");s.dispose();s.evaluate("dispatchLifecycle('pageshow',true);");await s.refresh();assert.equal(s.evaluate('documentTools.size'),0);assert.equal(s.evaluate('__angularMcpBridge.__angularMcpWebMcp.status'),'disposed');
  s.evaluate('installAngularMcpWebMcp();');await s.refresh();assert.equal(s.evaluate('documentTools.size'),8);assert.equal(s.evaluate("windowListeners.get('pageshow').size"),1);
  s.dispose();s.evaluate("dispatchLifecycle('pagehide',true);dispatchLifecycle('pageshow',true);");await s.refresh();assert.equal(s.evaluate('documentTools.size'),0);
 }finally{s.dispose();}
});

test('registration collisions leave an existing foreign tool intact',async()=>{
 const s=session("documentTools.set('angular_list_nodes',{name:'angular_list_nodes',foreign:true});");try{await s.refresh();assert.equal(s.evaluate('__angularMcpBridge.__angularMcpWebMcp.status'),'error');assert.equal(s.evaluate("documentTools.get('angular_list_nodes').foreign"),true);}finally{s.dispose();}
 assert.equal(s.evaluate('foreignRemovals.length'),0);assert.equal(s.evaluate("documentTools.get('angular_list_nodes').foreign"),true);
});

test('generated publisher compiles under strict application flags without Node or external runtime dependencies',()=>{
 const directory=mkdtempSync(join(tmpdir(),'ngx-mcp-webmcp-strict-'));
 try{
  const file=join(directory,'webmcp.ts');writeFileSync(file,'declare function bridge():any;\n'+integrationWebMcpSource());
  const options:ts.CompilerOptions={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,moduleResolution:ts.ModuleResolutionKind.Bundler,types:[],skipLibCheck:true,noEmit:true,strict:true,noPropertyAccessFromIndexSignature:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,noUnusedLocals:true,noUnusedParameters:true,noImplicitReturns:true};
  const errors=ts.getPreEmitDiagnostics(ts.createProgram([file],options));assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:()=>directory,getCanonicalFileName:path=>path,getNewLine:()=> '\n'}));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
