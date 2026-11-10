#!/usr/bin/env node
import {readFileSync,writeFileSync,existsSync,mkdirSync,lstatSync,unlinkSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,dirname,delimiter,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{install:{type:'boolean',default:false},verify:{type:'boolean',default:false},'dry-run':{type:'boolean',default:false},only:{type:'string'}}});
if(values.verify&&values.install)throw new Error('--verify is read-only; run --install separately.');
const catalog=JSON.parse(readFileSync(resolve(root,'evaluation/fresh/projects.json'),'utf8'));
const fixtures=catalog.fixtures.filter(f=>!values.only||f.id===values.only);
if(!fixtures.length)throw new Error(`Unknown fresh fixture: ${values.only}`);
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const run=(command,args,cwd=root)=>execFileSync(command,args,{cwd,stdio:'inherit',env:{...process.env,NG_CLI_ANALYTICS:'false',HUSKY:'0'}});
const gitText=(args,cwd)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const within=(parent,path)=>path===parent||path.startsWith(parent+'/');
function manifestEntries(fixture){const manifest=JSON.parse(readFileSync(resolve(root,fixture.sourceManifest),'utf8'));return Array.isArray(manifest.files)?manifest.files.map(f=>[f.path,f.sha256]):Object.entries(manifest);}
function verify(fixture,clone){
 if(gitText(['rev-parse','HEAD'],clone)!==fixture.commit)throw new Error(`Unexpected revision for ${fixture.id}; use a separate clean checkout.`);
 const origin=gitText(['remote','get-url','origin'],clone).replace(/\.git$/,'');if(origin!==fixture.repository)throw new Error(`Unexpected source repository for ${fixture.id}`);
 run('git',['diff','--exit-code','HEAD','--'],clone);
 const sourcePath=fixture.subdirectory==='.'?'src':fixture.subdirectory+'/src';
 const extraSource=gitText(['ls-files','--others','--exclude-standard','--',sourcePath],clone);if(extraSource)throw new Error(`Unfrozen source files in ${fixture.id}: ${extraSource}`);
 const entries=manifestEntries(fixture);
 for(const [name,expected]of entries){const path=resolve(clone,name);if(!within(clone,path)||!existsSync(path)||hash(path)!==expected)throw new Error(`Frozen source hash mismatch: ${fixture.id}/${name}`);}
 const app=resolve(clone,fixture.subdirectory);if(hash(resolve(app,'package-lock.json'))!==fixture.lockSha256)throw new Error(`Committed lock changed for ${fixture.id}`);
 return {verifiedFiles:entries.length,lockSha256:fixture.lockSha256};
}
function npmCli(){
 if(process.env.npm_execpath&&existsSync(process.env.npm_execpath))return process.env.npm_execpath;
 for(const part of (process.env.PATH??'').split(delimiter)){const bin=resolve(part,'npm');if(existsSync(bin)){const file=realpathSync(bin);if(file.endsWith('.js')||file.endsWith('.cjs'))return file;}}
 throw new Error('Cannot locate npm CLI JavaScript. Run through npm run samples:fresh -- --install with the pinned Node runtime.');
}
if(values['dry-run']){console.log(JSON.stringify({recommendedNode:catalog.recommendedNode,mode:values.verify?'verify':values.install?'fetch-and-install':'fetch',fixtures},null,2));process.exit(0);}
if(values.install){const [major,minor,patch]=process.versions.node.split('.').map(Number);if(!(major>=26||major===24&&minor>=15||major===22&&(minor>22||minor===22&&patch>=3)))throw new Error('Locked installs require the workspace Node24.15.0 (or another supported root engine), not the system Node.');}
const results=[];
for(const fixture of fixtures){
 if(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(fixture.repository)||!/^\w[\w.-]*$/.test(fixture.id)||!(/^[a-f0-9]{40}$/).test(fixture.commit))throw new Error('Invalid pinned fixture metadata');
 const clone=resolve(root,fixture.destination);if(!within(resolve(root,'test-apps'),clone)||clone===resolve(root,'test-apps'))throw new Error('Fresh fixture path escapes test-apps');
 if(!existsSync(clone)){
  if(values.verify)throw new Error(`Missing ${fixture.id}; fetch it with npm run samples:fresh -- --only ${fixture.id}`);
  mkdirSync(dirname(clone),{recursive:true});run('git',['init',clone]);run('git',['remote','add','origin',fixture.repository+'.git'],clone);
  run('git',['fetch','--filter=blob:none','--depth','1','origin',fixture.commit],clone);
  if(fixture.sparsePaths?.length){if(fixture.sparsePaths.some(p=>p.includes('..')||p.startsWith('/')))throw new Error('Invalid sparse source path');run('git',['sparse-checkout','init','--no-cone'],clone);run('git',['sparse-checkout','set','--no-cone','--',...fixture.sparsePaths.map(p=>'/'+p)],clone);}
  run('git',['checkout','--detach',fixture.commit],clone);
 }
 const checked=verify(fixture,clone),app=resolve(clone,fixture.subdirectory);
 if(values.install){const modules=resolve(app,'node_modules');if(existsSync(modules)&&lstatSync(modules).isSymbolicLink())unlinkSync(modules);run(process.execPath,[npmCli(),...fixture.install],app);verify(fixture,clone);}
 results.push({id:fixture.id,repository:fixture.repository,commit:fixture.commit,source:relative(root,app),...checked,installed:values.install,install:fixture.install,license:fixture.license,licenseEvidence:fixture.licenseEvidence,licenseQualification:fixture.licenseQualification});
 console.log(`Ready: ${fixture.id} @ ${fixture.commit} (${checked.verifiedFiles} frozen files verified)`);
}
if(!values.verify)writeFileSync(resolve(root,'evaluation/fresh/fetch-results.json'),JSON.stringify({formatVersion:1,measuredAt:new Date().toISOString(),node:process.version,fixtures:results},null,2)+'\n');
