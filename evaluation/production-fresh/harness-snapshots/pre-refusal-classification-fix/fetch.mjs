import {execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,dirname,delimiter} from 'node:path';
import {parseArgs} from 'node:util';
import {catalog,directory,sourceDirectory,assertFrozen} from './fixtures.mjs';
const {values}=parseArgs({options:{install:{type:'boolean',default:false},verify:{type:'boolean',default:false},project:{type:'string'}}});
if(values.project&&!catalog.projects.some(item=>item.id===values.project))throw new Error('Unknown fresh project: '+values.project);
if(values.verify&&values.install)throw new Error('Verify is read-only; install separately.');
function run(args,cwd){execFileSync(args[0],args.slice(1),{cwd,stdio:'inherit',env:{...process.env,PATH:dirname(process.execPath)+delimiter+(process.env.PATH??''),NG_CLI_ANALYTICS:'false',HUSKY:'0'}});}
function npmPath(){if(process.env.npm_execpath&&existsSync(process.env.npm_execpath))return process.env.npm_execpath;if(process.env.NPM_CLI&&existsSync(process.env.NPM_CLI))return process.env.NPM_CLI;for(const part of(process.env.PATH??'').split(delimiter)){const path=resolve(part,'npm');if(existsSync(path)){const real=realpathSync(path);if(/\.(c?js|mjs)$/.test(real))return real;}}throw new Error('Set NPM_CLI to the npm CLI JavaScript path, or run via npm.');}
for(const entry of catalog.projects.filter(item=>!values.project||item.id===values.project)){
 const source=sourceDirectory(entry.id);
 if(!existsSync(source)){
  if(values.verify)throw new Error('Missing pinned source: '+source);
  mkdirSync(dirname(source),{recursive:true});run(['git','clone','--filter=blob:none','--no-checkout',entry.repository+'.git',source],directory);run(['git','checkout','--detach',entry.commit],source);
 }
 assertFrozen(entry.id);
 if(values.install){run([process.execPath,npmPath(),'ci','--ignore-scripts','--no-audit','--no-fund','--prefer-offline'],source);assertFrozen(entry.id);}
 console.log('Verified '+entry.id+' '+entry.commit);
}
