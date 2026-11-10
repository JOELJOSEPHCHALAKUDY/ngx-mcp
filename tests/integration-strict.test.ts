import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,symlinkSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {integrationRuntimeSource} from '../src/integration-runtime.js';
import {integrationUiSource} from '../src/integration-ui.js';
import {integrationWebMcpSource} from '../src/integration-webmcp.js';

for(const signalForms of [false,true])test(`generated runtime compiles with all strict application flags (signals=${signalForms})`,()=>{
 const directory=mkdtempSync(join(tmpdir(),'ngx-mcp-strict-'));
 try{
  symlinkSync(resolve('samples/toolchains/course-crud/node_modules'),join(directory,'node_modules'),'dir');
  const file=join(directory,'bridge.ts');writeFileSync(file,integrationRuntimeSource({signalForms,mode:'both'})+'\n'+integrationUiSource()+'\n'+integrationWebMcpSource());
  const ts:any=createRequire(join(directory,'tsconfig.json'))('typescript');
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,moduleResolution:ts.ModuleResolutionKind.Bundler,experimentalDecorators:true,skipLibCheck:true,noEmit:true,types:[],strict:true,noPropertyAccessFromIndexSignature:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,noUnusedLocals:true,noUnusedParameters:true,noImplicitReturns:true};
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([file],options));
  assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>directory,getCanonicalFileName:(path:string)=>path,getNewLine:()=> '\n'}));
 }finally{rmSync(directory,{recursive:true,force:true});}
});
