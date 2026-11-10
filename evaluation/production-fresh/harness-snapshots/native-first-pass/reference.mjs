import {mkdirSync,existsSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {parseArgs} from 'node:util';
import {catalog,directory,project,labels,sourceDirectory,assertFrozen,createStaticServer,freshContext,runCase,storageSnapshot,hash} from './fixtures.mjs';
const {values}=parseArgs({options:{out:{type:'string'},project:{type:'string'}}});
const output=resolve(values.out??join(directory,'native-original.json'));if(existsSync(output))throw new Error('Reference report exists; choose a fresh --out path.');
const root=resolve(directory,'../..'),require=createRequire(join(root,'package.json')),{chromium}=require('playwright');
const report={kind:'production-fresh-native-reference',startedAt:new Date().toISOString(),clock:catalog.clock,projects:[],scope:'Source-first selected workflows in unchanged public Angular production builds; synthetic browser data, no compiler metadata or integration runtime. No upstream account-security certification.'};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 report.browserVersion=browser.version();
 for(const info of catalog.projects.filter(item=>!values.project||item.id===values.project)){
  const id=info.id,integrityBefore=assertFrozen(id),browserDir=join(sourceDirectory(id),'dist',info.target,'browser');
  if(!existsSync(join(browserDir,'index.html')))throw new Error('Build the original production app first: '+id);
  const serving=createStaticServer(browserDir),baseUrl=await serving.start();const entry={id,integrityBefore,cases:[],originalProductionBuild:true};report.projects.push(entry);
  try{
   for(const item of labels(id).cases){
    process.stderr.write('Native '+id+'/'+item.id+'\n');
    const {context,page,blocked}=await freshContext(browser,id,item.id,baseUrl);const result={id:item.id,kind:item.kind,passed:false};entry.cases.push(result);
    try{
     await page.goto(baseUrl);await page.waitForTimeout(300);
     const baseline=await page.evaluate(()=>({bridge:typeof globalThis.__angularMcpBridge,instrumented:document.querySelectorAll('[angularMcpSource]').length,debug:typeof globalThis.ng}));
     if(baseline.bridge!=='undefined'||baseline.instrumented)throw new Error('Native reference must not include generated registry.');
     result.productionRuntime=baseline;
     Object.assign(result,await runCase(page,id,item.id,baseUrl));
    }catch(error){result.error=error instanceof Error?error.stack:String(error);try{result.after=await storageSnapshot(page,id);result.body=(await page.locator('body').innerText()).slice(0,5000);}catch{}}
    finally{result.blockedExternalRequests=blocked;await context.close();}
   }
  }finally{await serving.close();}
  entry.integrityAfter=assertFrozen(id);entry.sourcePreserved=JSON.stringify(entry.integrityBefore)===JSON.stringify(entry.integrityAfter);
 }
}finally{await browser.close();}
report.finishedAt=new Date().toISOString();report.resourcesClosed=true;
report.totals={passed:report.projects.reduce((n,p)=>n+p.cases.filter(c=>c.passed).length,0),total:report.projects.reduce((n,p)=>n+p.cases.length,0)};
report.harnessSha256=Object.fromEntries(['reference.mjs','fixtures.mjs'].map(name=>[name,hash(readFileSync(join(directory,name)))]));
mkdirSync(resolve(output,'..'),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,totals:report.totals,projects:report.projects.map(p=>({id:p.id,passed:p.cases.filter(c=>c.passed).length,total:p.cases.length,sourcePreserved:p.sourcePreserved}))},null,2));
if(report.totals.passed!==report.totals.total)process.exitCode=1;
