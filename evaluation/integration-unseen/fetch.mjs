#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname,delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {checkFreeze,catalog,sourceDirectory} from './fixtures.mjs';
const here=dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),install=args.includes('--install'),verify=args.includes('--verify'),selected=args.includes('--project')?args[args.indexOf('--project')+1]:'all';
for(const project of catalog.projects.filter(p=>selected==='all'||p.id===selected)){
 const target=sourceDirectory(project);
 const run=(command,args,cwd=target)=>execFileSync(command,args,{cwd,stdio:'inherit'});
 if(!existsSync(target)){
  if(verify)throw new Error('Missing pinned source '+target);
  run('git',['clone','--no-checkout','--filter=blob:none',project.repository,target],here);run('git',['fetch','--depth','1','origin',project.commit]);run('git',['checkout','--detach',project.commit]);
 }
 const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:target,encoding:'utf8'}).trim();if(commit!==project.commit)throw new Error('Refusing changed checkout at '+target);
 await checkFreeze(project.id,target);
 if(install){const npmCli=process.env.NPM_CLI??process.env.npm_execpath;const installArgs=['ci','--ignore-scripts','--no-audit','--no-fund'];if(npmCli)run(process.execPath,[npmCli,...installArgs]);else execFileSync(process.platform==='win32'?'npm.cmd':'npm',installArgs,{cwd:target,stdio:'inherit',env:{...process.env,PATH:dirname(process.execPath)+delimiter+(process.env.PATH??'')}});await checkFreeze(project.id,target);}
 console.log(JSON.stringify({id:project.id,commit,source:target,verified:true}));
}
