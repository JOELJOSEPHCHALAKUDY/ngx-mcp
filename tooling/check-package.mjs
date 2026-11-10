import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync,mkdtempSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {digest,treeDigest} from '../evaluation/digest.mjs';

const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run npm run pack:check');
const [result]=JSON.parse(execFileSync(process.execPath,[npm,'pack','--dry-run','--json','--ignore-scripts'],{encoding:'utf8'}));
const allowed=/^(dist\/|package\.json$|README\.md$|RELEASING\.md$|PRODUCTION\.md$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/;
for(const file of result.files){
 if(!allowed.test(file.path))throw new Error(`Unexpected package payload: ${file.path}`);
 if(/^dist\/(?:cli|serve|certify|browser-runtime)\./.test(file.path))throw new Error(`Legacy entry point leaked into package: ${file.path}`);
 if(file.path.startsWith('dist/')&&file.path.endsWith('.js')&&/test-apps|samples\/projects|experiments\/source-inference/.test(readFileSync(file.path,'utf8')))throw new Error(`Experiment harness leaked into package: ${file.path}`);
}
const metadata=JSON.parse(readFileSync('package.json','utf8'));
assert.deepEqual(Object.keys(metadata.bin).sort(),['ngx-mcp']);
assert.deepEqual(Object.keys(metadata.exports),['.']);
assert(result.files.some(file=>file.path==='PRODUCTION.md'),'The linked production guide must ship with the package');
mkdirSync('artifacts',{recursive:true});
const report={compilerDigest:treeDigest('src'),packageJsonSha256:digest(readFileSync('package.json')),lockSha256:digest(readFileSync('package-lock.json')),name:result.name,version:result.version,compressedBytes:result.size,unpackedBytes:result.unpackedSize,files:result.files.map(f=>f.path),sampleApplicationsIncluded:false,legacyExperimentIncluded:false,published:false};
writeFileSync('artifacts/package-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));

mkdirSync('release',{recursive:true});
const [packed]=JSON.parse(execFileSync(process.execPath,[npm,'pack','--json','--ignore-scripts','--pack-destination','release'],{encoding:'utf8'}));
const temporary=mkdtempSync(join(tmpdir(),'ngx-mcp-package-'));
try{
 execFileSync('tar',['-xzf',resolve('release',packed.filename),'-C',temporary]);
 const installed=join(temporary,'package');
 symlinkSync(resolve('node_modules'),join(installed,'node_modules'),'dir');
 const cli=join(installed,'dist/ngx-mcp.js');
 for(const args of [['--help'],['generate','--help'],['serve','--help'],['host','--help']]){
  const help=execFileSync(process.execPath,[cli,...args],{cwd:temporary,encoding:'utf8',stdio:'pipe'});
  assert(help.includes('ngx-mcp '+(args[0]==='--help'?'generate':args[0])),'Extracted public command prints its help');
 }
 assert.throws(()=>execFileSync(process.execPath,[cli,'unknown-command'],{cwd:temporary,stdio:'pipe'}),error=>error.status===1&&error.stderr.toString().includes('Unknown command'),'Public CLI rejects unknown subcommands');
 assert.throws(()=>execFileSync(process.execPath,[cli,'serve','--base-url','https://example.invalid'],{cwd:temporary,stdio:'pipe'}),error=>error.status===1&&error.stderr.toString().includes('Use a local HTTP application origin.'),'Public serve command forwards options and rejects remote origins before launching a browser');
 const apiUrl=pathToFileURL(join(installed,'dist/index.js')).href;
 execFileSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict'; const api=await import(${JSON.stringify(apiUrl)}); for(const name of ['instrumentProject','integrationRuntimeSource','integrationUiSource','integrationWebMcpSource','prepareIntegration','buildIntegration','createIntegrationMcpServer','integrationAccessSource','createHostedMcpServer','createJwtAccessVerifier','createBrowserSessionFactory','validateApplicationUrl'])assert.equal(typeof api[name],'function',name); for(const name of ['compile','certify','reviewedTools','generate','refineManifest'])assert.equal(name in api,false,name);`],{cwd:temporary,stdio:'pipe'});
 const modules=resolve(process.env.INTEGRATION_TEST_MODULES??'samples/toolchains/course-crud/node_modules');
 if(!existsSync(join(modules,'@angular/compiler-cli')))throw new Error('Install the integration test toolchain before running pack:check; INTEGRATION_TEST_MODULES can select an installed Angular toolchain.');
 const app=join(temporary,'consumer-app');
 mkdirSync(app);symlinkSync(modules,join(app,'node_modules'),'dir');
 const appSource=`import {Component} from '@angular/core';import {FormsModule} from '@angular/forms';@Component({selector:'consumer-app',standalone:true,imports:[FormsModule],template:'<form (ngSubmit)="save()"><input name="title" [(ngModel)]="title"><button>Save</button></form>'})export class ConsumerApp{title='';save(){}}`;
 const appConfig=JSON.stringify({compilerOptions:{target:'ES2022',module:'ES2022',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true,types:[]},files:['app.ts']});
 writeFileSync(join(app,'app.ts'),appSource);writeFileSync(join(app,'tsconfig.json'),appConfig);
 const stage=join(temporary,'consumer-integrated');
 execFileSync(process.execPath,[cli,'generate','--project',join(app,'tsconfig.json'),'--out',stage],{cwd:temporary,stdio:'pipe'});
 const integration=JSON.parse(readFileSync(join(stage,'ngx-mcp.integration.json'),'utf8'));
 assert.equal(integration.nodes.length,3,'Extracted integration discovers the real form and controls');
 assert.equal(readFileSync(join(app,'app.ts'),'utf8'),appSource,'Original application source stays unchanged');
 assert.equal(readFileSync(join(app,'tsconfig.json'),'utf8'),appConfig,'Original application configuration stays unchanged');
 assert(readFileSync(join(stage,'app.ts'),'utf8').includes('angularMcpSource'),'Staged application receives registrations');
 assert(existsSync(integration.runtimeModule),'Generated runtime is present');
 for(const mode of ['webmcp','both']){
  const selected=join(temporary,'consumer-'+mode);
  execFileSync(process.execPath,[cli,'generate','--project',join(app,'tsconfig.json'),'--out',selected,'--mode',mode],{cwd:temporary,stdio:'pipe'});
  const selectedIntegration=JSON.parse(readFileSync(join(selected,'ngx-mcp.integration.json'),'utf8'));
  assert.equal(selectedIntegration.mode,mode);assert.equal(selectedIntegration.features.webmcp,true);assert.equal(selectedIntegration.features.mcp,mode==='both');
  assert(readFileSync(selectedIntegration.runtimeModule,'utf8').includes('installAngularMcpWebMcp'),'Selected browser publisher is present in extracted generation');
  const ts=createRequire(join(app,'tsconfig.json'))('typescript');
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,moduleResolution:ts.ModuleResolutionKind.Bundler,experimentalDecorators:true,skipLibCheck:true,noEmit:true,types:[],strict:true,noPropertyAccessFromIndexSignature:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,noUnusedLocals:true,noUnusedParameters:true,noImplicitReturns:true};
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([join(selected,'app.ts')],options));
  assert.equal(diagnostics.length,0,'Extracted '+mode+' generation must compile with the target app: '+ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>selected,getCanonicalFileName:path=>path,getNewLine:()=>String.fromCharCode(10)}));
 }
 const bootstrap=join(temporary,'trusted-access.ts');
 // The consumer owns the authenticated provider. This compile-only example stays locked.
 writeFileSync(bootstrap,"export async function connectNgxMcpAccess():Promise<never>{throw new Error('Configure the application authentication, approval, and audit providers');}\n");
 const review=join(temporary,'consumer-reviewed');
 execFileSync(process.execPath,[cli,'generate','--project',join(app,'tsconfig.json'),'--out',review,'--access-bootstrap',bootstrap],{cwd:temporary,stdio:'pipe'});
 const reviewed=JSON.parse(readFileSync(join(review,'ngx-mcp.integration.json'),'utf8'));
 const policy=join(temporary,'reviewed-policy.json');
 writeFileSync(policy,JSON.stringify({buildId:reviewed.buildId,policy:{version:1,allowedOrigins:['https://consumer.example'],rules:[]}}));
 for(const mode of ['mcp','webmcp','both']){
  const destination=join(temporary,'consumer-production-'+mode);
  execFileSync(process.execPath,[cli,'generate','--project',join(app,'tsconfig.json'),'--out',destination,'--mode',mode,'--profile','production','--policy',policy,'--access-bootstrap',bootstrap],{cwd:temporary,stdio:'pipe'});
  const generated=JSON.parse(readFileSync(join(destination,'ngx-mcp.integration.json'),'utf8'));
  assert.equal(generated.profile,'production');assert.equal(generated.buildId,reviewed.buildId);assert(generated.access.policySha256);assert(generated.access.bootstrapSha256);
  const ts=createRequire(join(app,'tsconfig.json'))('typescript');
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,moduleResolution:ts.ModuleResolutionKind.Bundler,experimentalDecorators:true,skipLibCheck:true,noEmit:true,types:[],strict:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true};
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([join(destination,'app.ts')],options));
  assert.equal(diagnostics.length,0,'Extracted production '+mode+' compiles: '+ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>destination,getCanonicalFileName:path=>path,getNewLine:()=>String.fromCharCode(10)}));
 }
 assert.throws(()=>execFileSync(process.execPath,[cli,'generate','--project',join(app,'tsconfig.json'),'--out',join(temporary,'invalid'),'--mode','invalid'],{cwd:temporary,stdio:'pipe'}),error=>error.status===1&&error.stderr.toString().includes('mode must be mcp, webmcp, or both'),'Public CLI rejects unknown modes');
 const checked={...report,archive:'release/'+packed.filename,archiveSha256:digest(readFileSync(resolve('release',packed.filename))),extractedCliSmokePassed:true,extractedApiSmokePassed:true,extractedIntegrationSmokePassed:true,extractedProductionModesSmokePassed:true,extractedHostedCliSmokePassed:true,smokeDependencies:'Uses installed npm dependencies and the target Angular toolchain; does not import compiler source or the archived experiment'};
 writeFileSync('artifacts/package-report.json',JSON.stringify(checked,null,2)+'\n');
 console.log('Extracted current-integration CLI, API, and code generation passed.');
}finally{rmSync(temporary,{recursive:true,force:true});}
