#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {prepareIntegration,buildIntegration} from './integration-project.js';

const {values}=parseArgs({options:{project:{type:'string'},workspace:{type:'string'},out:{type:'string'},build:{type:'boolean',default:false},'compiler-only':{type:'boolean',default:false},target:{type:'string'},configuration:{type:'string'},help:{type:'boolean',short:'h'}}});
if(values.help){
  console.log('angular-mcp-integrate --project /path/to/tsconfig.app.json [--out /new/staging/path] [--workspace /workspace] [--build] [--target project-name] [--configuration development]\nUses the application\'s installed Angular compiler to register exact template nodes in a staged copy. Original sources are unchanged. The generated runtime is compiled by the app\'s own Angular build.');
}else{
  if(!values.project)throw new Error('Provide --project pointing to the application\'s actual TypeScript configuration.');
  const out=values.out?resolve(values.out):join(tmpdir(),'angular-mcp-'+randomUUID());
  const result=await prepareIntegration(values.project,{outDir:out,workspace:values.workspace,runtimeDom:!values['compiler-only'],target:values.target});
  console.log(JSON.stringify({workspace:result.workspace,project:result.project,angularVersion:result.angularVersion,nodes:result.nodes.length,diagnostics:result.diagnostics,manifest:join(out,'angular-mcp.integration.json')},null,2));
  if(values.build)await buildIntegration(result,{target:values.target,configuration:values.configuration});
  else console.log('Build or serve this staged workspace with its normal Angular CLI.');
}
