import {readFileSync,existsSync,mkdirSync,copyFileSync,rmSync,symlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {resolve,join,relative} from 'node:path';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{install:{type:'boolean',default:false},only:{type:'string'}}});
const root=process.cwd();const projects=JSON.parse(readFileSync('samples/projects.json','utf8'));
mkdirSync('test-apps',{recursive:true});mkdirSync('.cache/npm',{recursive:true});
function run(command,args,cwd=root){execFileSync(command,args,{cwd,stdio:'inherit',env:{...process.env,NG_CLI_ANALYTICS:'false',HUSKY:'0'}});}
function install(cwd){const npm=process.env.npm_execpath;if(!npm)throw new Error('Run this command through npm run samples:setup');run(process.execPath,[npm,'ci','--ignore-scripts','--legacy-peer-deps','--no-audit','--no-fund','--maxsockets','3','--prefer-offline','--cache',resolve('.cache/npm')],cwd);}
for(const sample of projects.filter(p=>!values.only||p.id===values.only)){
 const clone=resolve('test-apps',sample.id);if(!clone.startsWith(resolve('test-apps')+'/'))throw new Error('Invalid sample path');
 if(!existsSync(clone)){run('git',['clone','--filter=blob:none','--no-checkout',sample.repository+'.git',clone]);run('git',['fetch','--depth','1','origin',sample.revision],clone);run('git',['checkout','--detach',sample.revision],clone);}
 const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:clone,encoding:'utf8'}).trim();if(sha!==sample.revision)throw new Error(`Unexpected revision in ${sample.id}; use an independent clean checkout.`);
 if(existsSync(join(clone,'.gitmodules')))run('git',['submodule','update','--init','--depth','1'],clone);
 run('git',['diff','--exit-code','HEAD','--','src',sample.subdirectory+'/src'],clone);
 if(values.install){
  const cwd=resolve(clone,sample.subdirectory);
  if(sample.toolchain){const overlay=resolve(sample.toolchain);install(overlay);const target=join(cwd,'node_modules');rmSync(target,{recursive:true,force:true});symlinkSync(relative(cwd,join(overlay,'node_modules')),target,'dir');}
  else {const lock=resolve('samples/locks',sample.id+'-package-lock.json');if(existsSync(lock))copyFileSync(lock,join(cwd,'package-lock.json'));install(cwd);}
 }
 console.log(`Ready: ${sample.id} @ ${sample.revision.slice(0,12)}`);
}
