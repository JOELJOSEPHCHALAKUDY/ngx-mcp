import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium,type Browser,type Page} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {integrationProductionSource} from '../src/integration-production.js';

const ts:any=createRequire(import.meta.url)('typescript');
let browser:Browser,url:string;
const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end('<!doctype html><form id="form" angularMcpSource="form"><label>PRIVATE LABEL<input id="field" angularMcpSource="field" value="PRIVATE VALUE"></label><input id="secret" angularMcpSource="secret" value="PRIVATE SECRET"><input id="blocked" angularMcpSource="blocked" value="PRIVATE BLOCKED"><button id="submitter" angularMcpSource="submitter" type="submit">Save PRIVATE CUSTOMER</button></form>');});
before(async()=>{await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));url='http://127.0.0.1:'+(server.address() as any).port;browser=await chromium.launch();});
after(async()=>{await browser?.close();await new Promise<void>(resolve=>server.close(()=>resolve()));});
function policy(extra:any={}){return {version:1,allowedOrigins:[url],rules:[{sourceId:'form',label:'Save form',operations:['describe','submit'],readFields:['field','secret'],writeFields:['field']},{sourceId:'field',label:'Title',operations:['describe','fill','read-model'],modelPaths:['/id']},{sourceId:'secret',label:'Private field',operations:['describe']},{sourceId:'submitter',label:'Save button',operations:['describe','activate','press-key']}],...extra} as any;}
async function session(fn:(page:Page)=>Promise<void>,options:any={}){
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(url);
  await page.addScriptTag({content:`
  const state=window.testState={approve:true,mutate:false,denyValues:false,effects:0,audit:[],session:{id:'session-1',subject:'alice',expiresAt:Date.now()+300000}};
  const element=target=>{const id=target.instanceId?.split('@')[0]||target.sourceId,node=document.getElementById(id);if(!node||!node.isConnected)throw new Error('Target is stale');return node;};
  const describe=target=>{const node=element(target),id=node.id,field=id!=='form'&&id!=='submitter';const result={sourceId:id,instanceId:id+'@1',kind:id==='form'?'form':field?'control':'action',tagName:node.tagName.toLowerCase(),label:'PRIVATE LABEL '+id,visible:true,disabled:!!node.disabled,readonly:false,events:id==='submitter'?['click']:[],operations:id==='form'?['submit']:field?['fill']:['activate'],validation:{status:'valid',fields:[],groups:[]}};if(field)Object.assign(result,{path:['PRIVATE PATH '+id],aria:{checked:'true',selected:'false',pressed:'mixed'},schema:{type:'string',enum:['PRIVATE CHOICE'],default:'PRIVATE DEFAULT',examples:['PRIVATE EXAMPLE']},value:node.value,modelValue:'PRIVATE MODEL VALUE',modelSize:10,options:[{value:'PRIVATE OPTION VALUE',label:'PRIVATE OPTION LABEL',selected:true}]});if(id==='form'){result.fields=['field','secret','blocked'].map(sourceId=>describe({sourceId}));result.validation.fields=result.fields.map(field=>({sourceId:field.sourceId,instanceId:field.instanceId,path:['PRIVATE VALIDATION PATH'],status:'VALID',errors:[]}));result.validation.groups=[{path:['PRIVATE GROUP PATH'],status:'valid',errors:[]}];}return result;};
  document.getElementById('form').addEventListener('submit',event=>{event.preventDefault();state.effects++;localStorage.setItem('saved',document.getElementById('field').value);});
  window.__angularMcpBridge={version:1,list:()=>['form','field','secret','blocked','submitter'].map(sourceId=>describe({sourceId})),describe,element,readModel:()=>({kind:'object',complete:true,value:{id:42,secret:'PRIVATE MODEL SECRET'}}),execute:async request=>{const node=element(request.target),changed=[];if(request.operation==='fill'){node.value=request.value;changed.push(describe(request.target));}else if(request.operation==='submit'){for(const field of request.values||[]){element(field.target).value=field.value;changed.push(describe(field.target));}node.requestSubmit();}else node.click();return {status:'ui-dispatched',reason:'PRIVATE ACK REASON',error:'PRIVATE ACK ERROR',message:'PRIVATE ACK MESSAGE',operation:request.operation,target:{sourceId:node.id,instanceId:node.id+'@1'},changed:changed.map(field=>field.instanceId),path:['PRIVATE ACK PATH'],aria:{selected:'true'},values:changed.map(field=>({sourceId:field.sourceId,instanceId:field.instanceId,path:['PRIVATE ACK FIELD PATH'],aria:{checked:'true'},value:field.value})),url:location.href+'?token=PRIVATE_URL_SECRET',validation:{status:'valid',fields:[{sourceId:'field',path:['PRIVATE ACK VALIDATION PATH'],status:'VALID'},{sourceId:'blocked',path:['PRIVATE BLOCKED PATH'],status:'INVALID'}],groups:[{path:['PRIVATE ACK GROUP PATH'],status:'valid',errors:[]}]},businessStatus:'unknown'};},notifyChanged:()=>{}};
  const __ngxMcpConnectAccess=async()=>{${options.bootstrapFailure?"throw new Error('PRIVATE BOOTSTRAP SECRET');":''}return {session:state.session,origin:()=>location.origin,validateSession:async()=>state.session,authorize:async request=>!(state.denyValues&&request.operation==='read-value'),approve:async challenge=>{if(state.mutate)document.getElementById('field').value='OTHER UI STATE';return state.approve;},audit:event=>state.audit.push(event)};};
  `});
  const source=integrationProductionSource(options.policy??policy(),'test-build');
  const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  await page.addScriptTag({content:javascript});
  await page.waitForFunction(()=>{const status=(window as any).__angularMcpBridge.accessStatus();return status.ready||status.error==='production-bootstrap-failed';});
  await fn(page);
 }finally{await context.close();}
}

test('production bootstrap locks by default and never exposes owner errors or runtime environments',async()=>{
 await session(async page=>{
  const state=await page.evaluate(()=>(window as any).__angularMcpBridge.accessStatus());assert.equal(state.ready,false);assert.equal(state.error,'production-bootstrap-failed');
  assert.deepEqual(await page.evaluate(()=>(window as any).__angularMcpBridge.list()),[]);
  const error=await page.evaluate(async()=>{try{await(window as any).__angularMcpBridge.catalog();return '';}catch(error){return String(error);}});assert(!error.includes('PRIVATE'));assert(error.includes('production-bootstrap-failed'));
 },{bootstrapFailure:true});
});

test('production catalog/inspect use reviewed labels and metadata; explicit model reads project data',async()=>{
 await session(async page=>{
  const catalog=await page.evaluate(()=>(window as any).__angularMcpBridge.catalog());assert(!JSON.stringify(catalog).includes('PRIVATE'));assert(!catalog.some((node:any)=>node.sourceId==='blocked'));
  const form=catalog.find((node:any)=>node.sourceId==='form');assert.equal(form.label,'Save form');assert.equal(form.fields.length,2);assert.equal(form.validation.fields.length,2);
  assert(!JSON.stringify(await page.evaluate(()=>(window as any).__angularMcpBridge.inspect({sourceId:'field'}))).includes('PRIVATE'));
  const model=await page.evaluate(()=>(window as any).__angularMcpBridge.readModel({sourceId:'field'}));assert.deepEqual(model.value,{'/id':42});assert.equal(model.complete,false);assert(!JSON.stringify(model).includes('PRIVATE'));
  const tools=await page.evaluate(()=>(window as any).__angularMcpBridge.toolAllowed('angular_form_1234567890abcdef'));assert.equal(tools,true);
  assert.equal(await page.evaluate(()=>(window as any).__angularMcpBridge.toolAllowed('angular_navigate')),false);
 });
});

test('explicit descriptor values also require backend read-value authorization',async()=>{
 const config=policy();config.rules[1].operations.push('read-value');
 await session(async page=>{
  const first=await page.evaluate(()=>(window as any).__angularMcpBridge.describe({sourceId:'field'}));assert.equal(first.value,'PRIVATE VALUE');assert.deepEqual(first.path,['PRIVATE PATH field']);assert.equal(first.aria.checked,'true');assert.deepEqual(first.schema.enum,['PRIVATE CHOICE']);
  await page.evaluate(()=>(window as any).testState.denyValues=true);
  const denied=await page.evaluate(()=>(window as any).__angularMcpBridge.describe({sourceId:'field'}));assert.equal(denied.value,undefined);assert(!JSON.stringify(denied).includes('PRIVATE'));
  assert(!JSON.stringify(await page.evaluate(()=>(window as any).__angularMcpBridge.list())).includes('PRIVATE'));
 },{policy:config});
});

test('approved execution uses exact UI state, blocks cross-field writes, and never returns mutation values or URLs',async()=>{
 await session(async page=>{
  const call=async(input:any)=>page.evaluate(async input=>{try{return await(window as any).__angularMcpBridge.execute(input);}catch(error){return {error:String(error)};}},input);
  await page.evaluate(()=>(window as any).testState.approve=false);
  assert((await call({operation:'fill',target:{sourceId:'field'},value:'Denied'})).error.includes('approval-denied'));assert.equal(await page.locator('#field').inputValue(),'PRIVATE VALUE');
  await page.evaluate(()=>{(window as any).testState.approve=true;(window as any).testState.mutate=true;});
  assert((await call({operation:'fill',target:{sourceId:'field'},value:'Approved value'})).error.includes('state changed'));assert.equal(await page.locator('#field').inputValue(),'OTHER UI STATE');
  await page.evaluate(()=>(window as any).testState.mutate=false);
  const blocked=await call({operation:'submit',target:{sourceId:'form'},values:[{target:{sourceId:'field'},value:'Must not change'},{target:{sourceId:'secret'},value:'Forbidden'}]});assert(blocked.error.includes('operation-denied')); assert.equal(await page.locator('#field').inputValue(),'OTHER UI STATE');
  const result=await call({operation:'submit',target:{sourceId:'form'},values:[{target:{sourceId:'field'},value:'Allowed'}]});assert.equal(result.status,'ui-dispatched');assert.equal(result.url,undefined);assert.equal(result.values[0].value,undefined);assert.equal(result.validation.fields.length,1);assert.equal(result.path,undefined);assert.equal(result.aria,undefined);assert.equal(result.values[0].path,undefined);assert.equal(result.values[0].aria,undefined);assert(!JSON.stringify(result).includes('PRIVATE'));assert.equal(await page.evaluate(()=>localStorage.getItem('saved')),'Allowed');
  const audit=await page.evaluate(()=>(window as any).testState.audit);assert(!JSON.stringify(audit).includes('PRIVATE'));assert(!JSON.stringify(audit).includes('Allowed'));
 });
});

test('external operations have one-use completion, identity binding, and fail-closed navigation',async()=>{
 const config=policy();config.rules[1].operations.push('press-key');
 await session(async page=>{
  const external=await page.evaluate(()=>(window as any).__angularMcpBridge.beginExternal('press-key',{target:{sourceId:'field'},key:'Tab'}));assert.match(external.id,/^[a-f0-9]{32}$/);
  const result=await page.evaluate(async id=>(window as any).__angularMcpBridge.finishExternal(id,{ok:true,result:{status:'ui-dispatched',url:'PRIVATE_URL',businessStatus:'unknown'}}),external.id);assert.equal(result.url,undefined);
  const replay=await page.evaluate(async id=>{try{await(window as any).__angularMcpBridge.finishExternal(id,{ok:true,result:{}});return '';}catch(error){return String(error);}},external.id);assert(replay.includes('already completed'));
  const wrong=await page.evaluate(async()=>{try{await(window as any).__angularMcpBridge.assertIdentity('bob');return '';}catch(error){return String(error);}});assert(wrong.includes('identity'));
  const navigation=await page.evaluate(async()=>{try{await(window as any).__angularMcpBridge.beginExternal('navigate',{path:'/other'});return '';}catch(error){return String(error);}});assert(navigation.includes('not enabled'));
  await page.evaluate(()=>(window as any).__angularMcpBridge.revokeAccess());assert.equal((await page.evaluate(()=>(window as any).__angularMcpBridge.accessStatus())).ready,false);
 },{policy:config});
});

test('NumpadEnter cannot bypass the containing form submit permission',async()=>{
 const config=policy();config.rules[0].operations=['describe'];config.rules[1].operations.push('press-key');
 await session(async page=>{
  for(const key of ['Enter','NumpadEnter']){
   const result=await page.evaluate(async key=>{try{await(window as any).__angularMcpBridge.beginExternal('press-key',{target:{sourceId:'field'},key});return '';}catch(error){return String(error);}},key);
   assert(result.includes('operation-denied')||result.includes('form submission'),key+' must require explicit form submission permission');
  }
  assert.equal(await page.evaluate(()=>(window as any).testState.effects),0);
 });
});

test('production generation rejects private policy fields and compiles with strict flags',()=>{
 assert.throws(()=>integrationProductionSource({...policy(),token:'DO_NOT_COMPILE'} as any,'test'),/Unexpected/);
 const directory=mkdtempSync(join(tmpdir(),'ngx-mcp-production-strict-'));
 try{
  const source='declare const __ngxMcpConnectAccess:()=>Promise<any>;\n'+integrationProductionSource(policy(),'test-build');
  const file=join(directory,'production.ts');writeFileSync(file,source);
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,moduleResolution:ts.ModuleResolutionKind.Bundler,noEmit:true,types:[],strict:true,skipLibCheck:true,noPropertyAccessFromIndexSignature:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,noUnusedLocals:true,noUnusedParameters:true,noImplicitReturns:true};
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([file],options));
  assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>directory,getCanonicalFileName:(file:string)=>file,getNewLine:()=> '\n'}));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
