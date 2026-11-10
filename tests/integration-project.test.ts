import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,lstatSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {prepareIntegration} from '../src/integration-project.js';
const modules=resolve('samples/toolchains/course-crud/node_modules');
function fixture(){
 const temporary=mkdtempSync(join(tmpdir(),'integration-project-regression-')),source=join(temporary,'source'),out=join(temporary,'stage');mkdirSync(source);symlinkSync(modules,join(source,'node_modules'),'dir');
 const app=`import {Component} from '@angular/core';@Component({selector:'symlink-test',standalone:true,template:'<button (click)="save()">Save</button>'})export class App{save(){}}`;
 writeFileSync(join(source,'real.ts'),app);symlinkSync('real.ts',join(source,'app.ts'));
 writeFileSync(join(source,'package.json'),'{}');writeFileSync(join(source,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},files:['app.ts']}));
 return {temporary,source,out,app};
}
test('staging dereferences editable source symlinks and leaves original targets unchanged',{timeout:90000},async()=>{
 const f=fixture();try{
  const result=await prepareIntegration(join(f.source,'tsconfig.json'),{outDir:f.out});
  assert.equal(readFileSync(join(f.source,'real.ts'),'utf8'),f.app);assert.equal(readFileSync(join(f.source,'app.ts'),'utf8'),f.app);assert(lstatSync(join(f.source,'app.ts')).isSymbolicLink());
  assert(!lstatSync(join(f.out,'app.ts')).isSymbolicLink());assert(readFileSync(join(f.out,'app.ts'),'utf8').includes('angularMcpSource'));assert(result.nodes.length>0);
 }finally{rmSync(f.temporary,{recursive:true,force:true});}
});
test('a destination through a symlink into the source workspace is rejected before staging writes',async()=>{
 const f=fixture();try{
  const alias=join(f.temporary,'alias');symlinkSync(f.source,alias,'dir');
  await assert.rejects(prepareIntegration(join(f.source,'tsconfig.json'),{outDir:join(alias,'nested-stage')}),/outside.*source workspace/);
  assert(!existsSync(join(f.source,'nested-stage')));assert.equal(readFileSync(join(f.source,'real.ts'),'utf8'),f.app);
 }finally{rmSync(f.temporary,{recursive:true,force:true});}
});

for(const mode of ['mcp','webmcp','both'] as const)test(`generation selects ${mode} and preserves the source`,{timeout:90000},async()=>{
 const f=fixture();try{
  const result=await prepareIntegration(join(f.source,'tsconfig.json'),{outDir:f.out,mode});
  assert.equal(result.mode,mode);assert.equal(result.features.webmcp,mode!=='mcp');assert.equal(result.features.mcp,mode!=='webmcp');
  const generated=readFileSync(result.runtimeModule,'utf8');
  assert(generated.includes('mode:'+JSON.stringify(mode)));
  assert.equal(generated.includes('installAngularMcpWebMcp'),mode!=='mcp');
  if(mode!=='mcp')assert(!/from ['"](?:node:|playwright|@modelcontextprotocol)/.test(generated),'Browser output cannot depend on the Node adapter');
  assert.equal(JSON.parse(readFileSync(join(f.out,'ngx-mcp.integration.json'),'utf8')).mode,mode);
  assert.equal(readFileSync(join(f.source,'real.ts'),'utf8'),f.app);
 }finally{rmSync(f.temporary,{recursive:true,force:true});}
});
test('unknown transport mode is rejected before staging writes',async()=>{
 const f=fixture();try{
  await assert.rejects(prepareIntegration(join(f.source,'tsconfig.json'),{outDir:f.out,mode:'invalid' as any}),/mode must be mcp, webmcp, or both/);
  assert(!existsSync(f.out));assert.equal(readFileSync(join(f.source,'real.ts'),'utf8'),f.app);
 }finally{rmSync(f.temporary,{recursive:true,force:true});}
});

const trustedBootstrap=`export async function connectNgxMcpAccess(){const session={id:'build-test',subject:'build-owner',expiresAt:Date.now()+60000};return {session,validateSession:async()=>session,approve:async()=>false,audit:()=>{},origin:()=>location.origin,route:()=>location.pathname};}`;
test('production generation binds a reviewed policy and bootstrap to the exact app build',{timeout:90000},async()=>{
 const f=fixture();try{
  const bootstrap=join(f.temporary,'trusted-session.ts');writeFileSync(bootstrap,trustedBootstrap);
  const reviewed=await prepareIntegration(join(f.source,'tsconfig.json'),{outDir:join(f.temporary,'review'),mode:'both',accessBootstrap:bootstrap});
  const policy={version:1 as const,allowedOrigins:['https://app.example'],rules:[{sourceId:(reviewed.nodes[0] as any).id,operations:['describe' as const],label:'Reviewed action'}]};
  const production=await prepareIntegration(join(f.source,'tsconfig.json'),{outDir:f.out,mode:'both',profile:'production',runtimeDom:false,accessBootstrap:bootstrap,accessPolicy:{buildId:reviewed.buildId,policy}});
  assert.equal(production.buildId,reviewed.buildId);assert.equal(production.profile,'production');assert(production.access?.policySha256);
  const runtime=readFileSync(production.runtimeModule,'utf8');assert(runtime.includes('installIntegrationProduction('));assert(runtime.includes('bridge();'));assert(runtime.includes('__ngxMcpConnectAccess'));
  assert.equal(readFileSync(join(f.source,'real.ts'),'utf8'),f.app);
 }finally{rmSync(f.temporary,{recursive:true,force:true});}
});
test('production access configuration fails closed before staging',{timeout:90000},async()=>{
 const f=fixture();try{
  await assert.rejects(prepareIntegration(join(f.source,'tsconfig.json'),{outDir:f.out,profile:'production'}),/reviewed access policy/);assert(!existsSync(f.out));
  const bootstrap=join(f.temporary,'trusted-session.ts');writeFileSync(bootstrap,trustedBootstrap);
  await assert.rejects(prepareIntegration(join(f.source,'tsconfig.json'),{outDir:f.out,profile:'production',accessBootstrap:bootstrap,accessPolicy:{buildId:'stale',policy:{version:1,allowedOrigins:['https://app.example'],rules:[]}}}),/another application build/);assert(!existsSync(f.out));
  assert.equal(readFileSync(join(f.source,'real.ts'),'utf8'),f.app);
 }finally{rmSync(f.temporary,{recursive:true,force:true});}
});
test('an application source or trusted bootstrap change invalidates its reviewed build identity',{timeout:90000},async()=>{
 const f=fixture();try{
  const bootstrap=join(f.temporary,'trusted-session.ts');writeFileSync(bootstrap,trustedBootstrap);
  const first=await prepareIntegration(join(f.source,'tsconfig.json'),{outDir:join(f.temporary,'first'),accessBootstrap:bootstrap});
  writeFileSync(bootstrap,trustedBootstrap+'\n// changed owner integration');
  const next=await prepareIntegration(join(f.source,'tsconfig.json'),{outDir:join(f.temporary,'next'),accessBootstrap:bootstrap});assert.notEqual(first.buildId,next.buildId);
  await assert.rejects(prepareIntegration(join(f.source,'tsconfig.json'),{outDir:f.out,profile:'production',accessBootstrap:bootstrap,accessPolicy:{buildId:first.buildId,policy:{version:1,allowedOrigins:['https://app.example'],rules:[]}}}),/another application build/);assert(!existsSync(f.out));
 }finally{rmSync(f.temporary,{recursive:true,force:true});}
});
