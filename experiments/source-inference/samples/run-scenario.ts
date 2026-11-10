import {chromium} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {ensureLocalApp} from '../src/local-app.js';
import {compileSample,sampleApprovals,sampleDirectory,sampleUrl,scenarioCapability,type Sample} from '../src/samples.js';
import {browserAdapter} from '../src/browser-adapter.js';
import {createMcpServer} from '../src/mcp.js';
import {isolateSample,redact} from './isolation.js';

export async function runScenario(sample:Sample,headed=false){
  const manifest=compileSample(sample);const capability=scenarioCapability(sample,manifest);
  const approvals=sampleApprovals(sample);
  const app=await ensureLocalApp(sample);
  const browser=await chromium.launch({headless:!headed});
  const context=await browser.newContext({viewport:{width:1400,height:1100},serviceWorkers:'block'});
  const fixture=await isolateSample(context,sample);const page=await context.newPage();
  const pageErrors:string[]=[];page.on('pageerror',e=>pageErrors.push(e.message));
  const adapter=browserAdapter(page,manifest,approvals,sampleUrl(sample));
  const client=new Client({name:'public-corpus-agent',version:'0.1.0'});const server=createMcpServer(adapter);
  try{
    if(sample.scenario.preparePath){await page.goto(sampleUrl(sample)+sample.scenario.preparePath);await page.waitForLoadState('networkidle');}
    await page.goto(sampleUrl(sample)+sample.scenario.route);await page.waitForLoadState('networkidle');
    await page.locator('form,mat-stepper,mat-horizontal-stepper').first().waitFor({state:'visible',timeout:10000});
    mkdirSync(`artifacts/samples/${sample.id}`,{recursive:true});
    let outcome:'executed'|'unsupported';let evidence:unknown;
    if(sample.scenario.expectedLimitation){
      assert.equal(adapter.tools.length,0);
      assert(!capability || capability.status==='blocked');
      assert.equal(fixture.writes.length,0);
      outcome='unsupported';evidence={reason:sample.scenario.expectedLimitation,compilerIssues:capability?.issues??['No injected business-service call in selected handler']};
    }else{
      assert(capability&&capability.status==='candidate','Expected a compilable UI form');
      const [a,b]=InMemoryTransport.createLinkedPair();await Promise.all([client.connect(a),server.connect(b)]);
      const list=await client.listTools();assert.equal(list.tools.length,1);
      const result=await client.callTool({name:list.tools[0].name,arguments:sample.scenario.args});
      assert(!result.isError,JSON.stringify(result));
      await page.waitForURL(url=>url.pathname===sample.scenario.expectedPath,{timeout:10000});
      if(sample.id==='realworld'){
        assert.equal(fixture.writes.length,1);assert.equal((fixture.writes[0].body as {user:{email:string}}).user.email,sample.scenario.args.email);
        evidence=redact(fixture.writes);
      }else if(sample.id==='course-crud'){
        assert.equal(fixture.writes.length,1);const saved=fixture.writes[0].body as Record<string,unknown>;
        assert.equal(saved.name,sample.scenario.args.name);assert.equal(saved.category,sample.scenario.args.category);assert.deepEqual((saved.lessons as {name:string;youtubeUrl:string}[]).map(({name,youtubeUrl})=>({name,youtubeUrl})),sample.scenario.args.lessons);
        await page.getByText(String(sample.scenario.args.name),{exact:true}).waitFor({state:'visible'});evidence=redact(fixture.writes);
      }else if(sample.id==='forms-course'){
        const draft=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null'),sample.scenario.storageKey!) as Record<string,unknown>;
        assert(draft,'The original valueChanges subscription should save a draft');assert.equal(draft.title,sample.scenario.args.title);assert.equal(draft.category,'ADVANCED');assert.equal(draft.downloadsAllowed,true);assert.equal(draft.longDescription,sample.scenario.args.longDescription);
        await page.reload();await page.waitForLoadState('networkidle');
        const title=await page.locator('create-course-step-1 input[formcontrolname="title"]').inputValue();assert.equal(title,draft.title);evidence={draft,restoredTitle:title};
      }else{
        const key=sample.id==='signup'?'angular-15-signup-verification-boilerplate-accounts':sample.scenario.storageKey!;
        const saved=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'[]'),key) as Record<string,unknown>[];
        const record=saved.find(user=>user.email===sample.scenario.args.email);assert(record,'Original fake backend should persist the submitted record');
        evidence=redact(record);
      }
      outcome='executed';
    }
    await page.screenshot({path:`artifacts/samples/${sample.id}/result.png`});
    assert.deepEqual(pageErrors,[],'The upstream application should render without uncaught errors');
    execFileSync('git',['diff','--exit-code','HEAD','--','src'],{cwd:sampleDirectory(sample),stdio:'pipe'});
    const report={id:sample.id,repository:sample.repository,revision:sample.revision,complexity:sample.complexity,outcome,capability:capability?{id:capability.id,fingerprint:capability.fingerprint}:null,routes:manifest.routes.length,candidates:manifest.capabilities.length,reviewedTools:adapter.tools.length,finalPath:new URL(page.url()).pathname,evidence,pageErrors,offOriginRequestsBlocked:fixture.blocked.length,applicationSourceModified:false};
    writeFileSync(`artifacts/samples/${sample.id}/runtime.json`,JSON.stringify(report,null,2)+'\n');
    return report;
  }finally{await client.close();await server.close();await context.close();await browser.close();app?.kill();}
}
