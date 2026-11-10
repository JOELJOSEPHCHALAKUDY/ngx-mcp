import {createHash} from 'node:crypto';
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {instrumentProject} from './integration-compiler.js';
import {integrationRuntimeSource,type IntegrationMode} from './integration-runtime.js';
import {integrationWebMcpSource} from './integration-webmcp.js';
import {integrationUiSource} from './integration-ui.js';
import {integrationProductionSource} from './integration-production.js';
import type {IntegrationAccessPolicy} from './integration-access.js';

export interface PrepareIntegrationOptions {
  /** An empty, new directory outside the source workspace. The source project is never rewritten. */
  outDir: string;
  workspace?: string;
  runtimeDom?: boolean;
  target?: string;
  /** Select browser-native WebMCP, the Node MCP adapter, or both. Defaults to mcp. */
  mode?: IntegrationMode;
  profile?: 'development' | 'production';
  accessPolicy?: {buildId: string; policy: IntegrationAccessPolicy};
  /** Trusted browser module exporting connectNgxMcpAccess(). No secrets belong in this module. */
  accessBootstrap?: string;
  policyFile?: string;
}
export interface PreparedIntegration {
  formatVersion: 1;
  mode: IntegrationMode;
  profile: 'development' | 'production';
  buildId: string;
  workspace: string;
  project: string;
  runtimeModule: string;
  buildTarget?: string;
  angularVersion: string;
  typescriptVersion: string;
  nodes: unknown[];
  diagnostics: unknown[];
  features: {signalForms:boolean;runtimeDom:boolean;webmcp:boolean;mcp:boolean;entry?:string};
  sourceHashes: Record<string,string>;
  access?: {policySha256: string; bootstrapSha256: string};
}
const within = (root:string,path:string) => { const part=relative(root,path);return part===''||!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part); };
const sha = (text:string) => createHash('sha256').update(text).digest('hex');
const physicalDestination = (path:string):string => {let ancestor=resolve(path),tail:string[]=[];while(!existsSync(ancestor)){tail.unshift(basename(ancestor));const parent=dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}return resolve(realpathSync(ancestor),...tail);};
const OMIT = new Set(['node_modules','.git','.angular','dist','coverage','.cache','.ngx-mcp','playwright-report','test-results']);

export function angularWorkspace(project:string):string {
  let path=dirname(resolve(project));
  for(;;){if(existsSync(join(path,'angular.json')))return path;const parent=dirname(path);if(parent===path)return dirname(resolve(project));path=parent;}
}

/** Analyze with the app's Angular compiler, then apply only its verified edit plan to a staged copy. */
export async function prepareIntegration(project:string, options:PrepareIntegrationOptions):Promise<PreparedIntegration> {
  const profile=options.profile??'development';
  if(!['development','production'].includes(profile))throw new Error('Integration profile must be development or production.');
  if(profile==='production'&&(!options.accessPolicy||!options.accessBootstrap))throw new Error('Production generation requires a reviewed access policy and a trusted access bootstrap module.');
  const mode=options.mode??'mcp';
  if(!['mcp','webmcp','both'].includes(mode))throw new Error('Integration mode must be mcp, webmcp, or both.');
  project=realpathSync(resolve(project));
  const workspace=realpathSync(resolve(options.workspace??angularWorkspace(project))),out=physicalDestination(options.outDir);
  if(!within(workspace,project))throw new Error('The project configuration must belong to the workspace.');
  if(within(workspace,out)||within(out,workspace))throw new Error('Staging directory must be outside, and must not contain, the source workspace.');
  if(existsSync(out))throw new Error('Staging directory already exists; choose a new directory.');
  const sourceDirectory=existsSync(join(dirname(project),'src'))?join(dirname(project),'src'):dirname(project);
  const runtime=join(sourceDirectory,'ngx-mcp.generated.ts');
  if(existsSync(runtime))throw new Error('Generated runtime filename conflicts with an existing source file.');
  const plan=await instrumentProject(project,{
    workspaceRoot:workspace,
    bridgeModuleSpecifier:(file:string)=>{let path=relative(dirname(file),runtime).split(sep).join('/').replace(/\.ts$/,'');if(!path.startsWith('.'))path='./'+path;return path;},
  });
  if(!plan.valid)throw new Error('Angular integration analysis failed:\n'+plan.diagnostics.filter(d=>d.category==='error').map(d=>(d.file?d.file+': ':'')+d.message).join('\n'));
  let signalForms=false;
  if(plan.nodes.some(node=>node.resolvedDirectives.some(d=>d.file.includes('@angular/forms/')&&['FormField','FormRoot','Field'].includes(d.name)))){
    try{
      const appRequire=createRequire(project),entry=appRequire.resolve('@angular/forms/signals'),ts=appRequire('typescript');
      const source=ts.createSourceFile(entry,readFileSync(entry,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
      const exports=new Set<string>();
      for(const statement of source.statements)if(ts.isExportDeclaration(statement)&&statement.exportClause&&ts.isNamedExports(statement.exportClause))for(const symbol of statement.exportClause.elements)exports.add(symbol.name.text);
      signalForms=exports.has('FormField')&&exports.has('FormRoot');
    }catch{/* Unknown target API keeps model validation explicitly unobserved. */}
    if(!signalForms)plan.diagnostics.push({category:'warning',code:'signal-forms-api-unavailable',message:'This Signal Forms version does not expose the supported FormField/FormRoot API. Angular model validation is unobserved; original application validation still runs.'});
  }

  const runtimeDom=options.runtimeDom!==false;
  const edits=plan.edits.map(edit=>({...edit,file:isAbsolute(edit.file)?edit.file:resolve(plan.projectRoot,edit.file)}));
  let entry:string|undefined,buildTarget:string|undefined;
  if(existsSync(join(workspace,'angular.json'))){
    const ts=createRequire(project)('typescript'),parsed=ts.parseConfigFileTextToJson('angular.json',readFileSync(join(workspace,'angular.json'),'utf8'));
    if(parsed.error)throw new Error('The Angular workspace configuration could not be parsed.');
    const candidates:{entry:string;target:string}[]=[];
    for(const [name,value] of Object.entries(parsed.config.projects??{}) as [string,any][]){
      if(options.target&&name!==options.target)continue;
      const build=(value.architect??value.targets)?.build,config=build?.options;
      if(!config||!config.tsConfig)continue;
      if(!existsSync(resolve(workspace,config.tsConfig))||realpathSync(resolve(workspace,config.tsConfig))!==project)continue;
      const browser=config.browser??config.main;if(typeof browser==='string')candidates.push({entry:resolve(workspace,browser),target:name});
    }
    if(candidates.length===1){
      entry=candidates[0].entry;buildTarget=candidates[0].target;if(!within(workspace,entry))throw new Error('The browser entry is outside the selected workspace.');
      let specifier=relative(dirname(entry),runtime).split(sep).join('/').replace(/\.ts$/,'');if(!specifier.startsWith('.'))specifier='./'+specifier;
      const existing=edits.find(edit=>edit.file===entry),original=readFileSync(entry,'utf8'),content=existing?.content??original;
      const importText='import '+JSON.stringify(specifier)+';\n';
      if(existing)existing.content=importText+content;else edits.push({file:entry,beforeSha256:sha(original),content:importText+content});
    }
  }
  const sourceHashes:Record<string,string>={};
  for(const edit of edits){
    if(!within(workspace,edit.file))throw new Error('Compiler edit escaped the source workspace: '+edit.file);
    const current=readFileSync(edit.file,'utf8');
    if(sha(current)!==edit.beforeSha256)throw new Error('Source changed during analysis: '+edit.file);
    sourceHashes[relative(workspace,edit.file).split(sep).join('/')]=sha(current);
  }
  const bootstrap=options.accessBootstrap?readFileSync(resolve(options.accessBootstrap),'utf8'):undefined;
  const bootstrapSha256=bootstrap===undefined?undefined:sha(bootstrap);
  const inputs:Record<string,string>={};
  const policyFile=options.policyFile?resolve(options.policyFile):undefined;
  function fingerprintSources(directory:string){
    for(const item of readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      if(OMIT.has(item.name))continue;
      const file=join(directory,item.name);if(file===policyFile)continue;
      if(item.isDirectory())fingerprintSources(file);
      else if((item.isFile()||item.isSymbolicLink())&&/\.(?:[cm]?[jt]sx?|html|css|scss|sass|less|json)$/.test(item.name))inputs[relative(workspace,file).split(sep).join('/')]=sha(readFileSync(file,'utf8'));
    }
  }
  fingerprintSources(workspace);
  const kernelSha256=sha(integrationRuntimeSource({signalForms,mode:'both'})+integrationUiSource()+integrationWebMcpSource()+integrationProductionSource({version:1,allowedOrigins:['http://localhost'],rules:[]},'kernel-fingerprint'));
  const buildId=sha(JSON.stringify({angular:plan.angularVersion,typescript:plan.typescriptVersion,inputs,edits:edits.map(edit=>[relative(workspace,edit.file).split(sep).join('/'),sha(edit.content)]),kernelSha256,bootstrapSha256}));
  if(profile==='production'&&options.accessPolicy!.buildId!==buildId)throw new Error('The access policy belongs to another application build. Review the current manifest buildId before enabling production access.');
  const productionRuntime=profile==='production'?integrationProductionSource(options.accessPolicy!.policy,buildId):'';
  mkdirSync(dirname(out),{recursive:true});
  cpSync(workspace,out,{recursive:true,dereference:true,filter:(path)=>!relative(workspace,path).split(sep).some(part=>OMIT.has(part))});
  // Resolve dependencies through the same physical installation used by Angular's compiler.
  let dependencyRoot=dirname(project);
  while(!existsSync(join(dependencyRoot,'node_modules'))&&dirname(dependencyRoot)!==dependencyRoot)dependencyRoot=dirname(dependencyRoot);
  if(!existsSync(join(dependencyRoot,'node_modules')))throw new Error('Install this project\'s dependencies before preparing its integration.');
  symlinkSync(realpathSync(join(dependencyRoot,'node_modules')),join(out,'node_modules'),'dir');
  for(const edit of edits)writeFileSync(join(out,relative(workspace,edit.file)),edit.content);
  const stagedRuntime=join(out,relative(workspace,runtime));mkdirSync(dirname(stagedRuntime),{recursive:true});
  let accessSource='';
  if(profile==='production'){
    const originalBootstrap=realpathSync(resolve(options.accessBootstrap!));
    const bootstrapFile=within(workspace,originalBootstrap)?join(out,relative(workspace,originalBootstrap)):join(dirname(stagedRuntime),'ngx-mcp.access-bootstrap.ts');
    if(!within(workspace,originalBootstrap)){
      if(existsSync(bootstrapFile)&&readFileSync(bootstrapFile,'utf8')!==bootstrap)throw new Error('Access bootstrap filename conflicts with an existing staged source file.');
      writeFileSync(bootstrapFile,bootstrap!);
    }
    let specifier=relative(dirname(stagedRuntime),bootstrapFile).split(sep).join('/').replace(/\.[cm]?tsx?$/,'');if(!specifier.startsWith('.'))specifier='./'+specifier;
    accessSource='\nimport {connectNgxMcpAccess as __ngxMcpConnectAccess} from '+JSON.stringify(specifier)+';\nbridge();\n'+productionRuntime;
  }
  writeFileSync(stagedRuntime,integrationRuntimeSource({signalForms,mode})+(runtimeDom?'\n'+integrationUiSource():'')+accessSource+(mode!=='mcp'?'\n'+integrationWebMcpSource():''));
  const result:PreparedIntegration={formatVersion:1,mode,profile,buildId,workspace:out,project:join(out,relative(workspace,project)),runtimeModule:stagedRuntime,...buildTarget?{buildTarget}:{},angularVersion:plan.angularVersion,typescriptVersion:plan.typescriptVersion,nodes:plan.nodes,diagnostics:plan.diagnostics,features:{signalForms,runtimeDom,webmcp:mode!=='mcp',mcp:mode!=='webmcp',...entry?{entry:relative(workspace,entry).split(sep).join('/')}:{}} ,sourceHashes,...profile==='production'?{access:{policySha256:sha(JSON.stringify(options.accessPolicy!.policy)),bootstrapSha256:bootstrapSha256!}}:{}};
  writeFileSync(join(out,'ngx-mcp.integration.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}

/** Delegate compilation to the staged app's installed CLI; no alternate Angular compiler is shipped. */
export async function buildIntegration(prepared:PreparedIntegration,options:{target?:string;configuration?:string}={}):Promise<void> {
  const require=createRequire(join(prepared.workspace,'package.json'));
  const cli=require.resolve('@angular/cli/bin/ng.js');
  const target=options.target??prepared.buildTarget;
  const args=[cli,'build',...(target?[target]:[]),...(options.configuration?['--configuration',options.configuration]:[])];
  await new Promise<void>((done,fail)=>{const child=spawn(process.execPath,args,{cwd:prepared.workspace,stdio:'inherit'});child.once('error',fail);child.once('exit',(code,signal)=>code===0?done():fail(new Error('Angular build failed ('+(signal??code)+').')));});
}
