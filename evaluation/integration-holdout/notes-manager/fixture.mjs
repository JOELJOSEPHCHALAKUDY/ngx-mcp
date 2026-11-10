import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export const artifactRoot=dirname(fileURLToPath(import.meta.url));
export const projectRoot=resolve(process.env.COMPILER_PROJECT_ROOT??process.cwd());
export const sourceRoot=resolve(process.env.HOLDOUT_SOURCE_DIR??join(projectRoot,'test-apps/fresh-notes-manager'));
export const seed=[{id:1,text:'First fixture note'},{id:2,text:'Second fixture note'}];
export const require=createRequire(join(projectRoot,'package.json'));
export function assertFrozen(){
 for(const line of readFileSync(join(artifactRoot,'FREEZE.sha256'),'utf8').trim().split('\n')){const [hash,file]=line.split(/\s+/);const actual=createHash('sha256').update(readFileSync(join(artifactRoot,file))).digest('hex');if(actual!==hash)throw new Error('Frozen artifact changed: '+file);}
 const manifest=JSON.parse(readFileSync(join(artifactRoot,'source-manifest.json'),'utf8'));
 for(const file of manifest.files){const actual=createHash('sha256').update(readFileSync(join(sourceRoot,file.file))).digest('hex');if(actual!==file.sha256)throw new Error('Upstream source changed: '+file.file);}
}
export async function launchOriginal(){
 const baseUrl=process.env.HOLDOUT_BASE_URL??'http://127.0.0.1:4375/';let child;
 if(!process.env.HOLDOUT_BASE_URL){child=spawn(process.execPath,[join(sourceRoot,'node_modules/@angular/cli/bin/ng.js'),'serve','--host','127.0.0.1','--port',new URL(baseUrl).port,'--configuration','production'],{cwd:sourceRoot,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>process.stderr.write(b));child.stderr.on('data',b=>process.stderr.write(b));
  for(let n=0;n<120;n++){if(child.exitCode!==null)throw new Error('Reference server exited '+child.exitCode);try{if((await fetch(baseUrl)).ok)break;}catch{}if(n===119)throw new Error('Reference server readiness timeout');await new Promise(r=>setTimeout(r,500));}
 }
 const {chromium}=require('playwright');const browser=await chromium.launch({headless:true});
 return {browser,baseUrl,close:async()=>{await browser.close();child?.kill('SIGTERM');}};
}
export async function freshPage(browser,baseUrl,empty=false){const context=await browser.newContext();await context.addInitScript(({seed,empty})=>localStorage.setItem('notes',JSON.stringify(empty?[]:seed)),{seed,empty});const page=await context.newPage();await page.goto(baseUrl);await page.locator('textarea').waitFor();return {page,context};}
export async function snapshot(page){return page.evaluate(()=>({textarea:document.querySelector('textarea')?.value,rows:[...document.querySelectorAll('app-note-list-item')].map(e=>({title:e.querySelector('app-note-title')?.textContent?.trim(),selected:!!e.querySelector('li.selected'),dirty:!!e.querySelector('li.not-saved')})),storage:JSON.parse(localStorage.getItem('notes')??'null')}));}
export async function setText(page,value){await page.locator('textarea').fill(value);await page.locator('textarea').press('ArrowRight');}
export async function confirmClick(page,selector,accept){const dialogs=[];page.once('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message(),decision:accept?'accept':'dismiss'});await(accept?dialog.accept():dialog.dismiss());});await page.locator(selector).click();return dialogs;}
