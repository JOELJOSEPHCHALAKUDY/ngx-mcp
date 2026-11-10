#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareIntegration,buildIntegration} from './integration-project.js';
import type {IntegrationMode} from './integration-runtime.js';

const {values}=parseArgs({options:{project:{type:'string'},profile:{type:'string',default:'development'},policy:{type:'string'},'access-bootstrap':{type:'string'},mode:{type:'string',default:'mcp'},workspace:{type:'string'},out:{type:'string'},build:{type:'boolean',default:false},'compiler-only':{type:'boolean',default:false},target:{type:'string'},configuration:{type:'string'},help:{type:'boolean',short:'h'}}});
if(values.help){
  console.log('ngx-mcp generate --project /path/to/tsconfig.app.json [--mode mcp|webmcp|both] [--profile development|production] [--policy reviewed.json --access-bootstrap session.ts] [--out /new/staging/path] [--workspace /workspace] [--build] [--target project-name] [--configuration development]\nUses the application\'s installed Angular compiler to register exact template nodes in a staged copy. Original sources are unchanged. The generated runtime is compiled by the app\'s own Angular build.\nModes: mcp (default) uses the separate Node adapter; webmcp registers tools in a compatible browser; both enables both paths.');
}else{
  if(!values.project)throw new Error('Provide --project pointing to the application\'s actual TypeScript configuration.');
  if(!['mcp','webmcp','both'].includes(values.mode??''))throw new Error('Integration mode must be mcp, webmcp, or both.');
  const out=values.out?resolve(values.out):join(tmpdir(),'ngx-mcp-'+randomUUID());
  const result=await prepareIntegration(values.project,{outDir:out,workspace:values.workspace,runtimeDom:!values['compiler-only'],target:values.target,mode:values.mode as IntegrationMode,profile:values.profile as 'development'|'production',accessPolicy:values.policy?JSON.parse(readFileSync(values.policy,'utf8')):undefined,accessBootstrap:values['access-bootstrap'],policyFile:values.policy});
  console.log(JSON.stringify({workspace:result.workspace,mode:result.mode,profile:result.profile,buildId:result.buildId,project:result.project,angularVersion:result.angularVersion,nodes:result.nodes.length,diagnostics:result.diagnostics,manifest:join(out,'ngx-mcp.integration.json')},null,2));
  if(values.build)await buildIntegration(result,{target:values.target,configuration:values.configuration});
  else console.log('Build or serve this staged workspace with its normal Angular CLI.');
}
