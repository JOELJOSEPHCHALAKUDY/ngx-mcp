import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {directory,freshContext,prepareCase,executeCase,verifyCase,storageSnapshot,assertFrozen,hash} from './fixtures.mjs';
import {accessFixture} from './access-fixture.mjs';
import {transportDriver,originalDisabledRefusal,originalInvalidRefusal} from './driver.mjs';
const root=resolve(directory,'../..'),packet=join(directory,'runs/final-complete-2026-11-10'),previous=JSON.parse(readFileSync(join(packet,'report.json'))),build=previous.projects.find(project=>project.id==='sprint').builds.find(build=>build.mode==='mcp');
const fixture=accessFixture(),origin=await fixture.start(Number(new URL(build.origin).port));assert.equal(origin,build.origin);fixture.attach(join(packet,build.artifacts.browser));
const require=createRequire(join(root,'package.json')),{chromium}=require('playwright'),browser=await chromium.launch({channel:'chrome',headless:true}),report={kind:'focused-redacted-ui-refusal-driver',sourceBefore:assertFrozen('sprint'),cases:[],scope:'Existing unchanged production packet; guarded disabled metadata plus actual authenticated HTTP calls, no DOM-action fallback. Policy/auth/network failures must not be accepted as a native UI refusal.'};
const output=join(directory,'driver-refusal-focus.json');assert(!existsSync(output),'Preserve focused evidence; choose a new script output to rerun.');
try{
 for(const name of['original_disabled','denied_approval_not_native','revoked_auth_not_native','closed_transport_not_native']){
  const auth=fixture.session(),{context,page}=await freshContext(browser,'sprint','empty_project_blocked',origin),calls=[],entry={id:name,status:'failed',calls};report.cases.push(entry);let driver;
  try{
   await auth.attach(context);const item=await prepareCase(page,'sprint','empty_project_blocked',origin);await page.waitForFunction(()=>globalThis.__angularMcpBridge?.accessStatus?.().ready===true);driver=await transportDriver(page,origin,'mcp',root,{...auth.state.session},calls);const before=await storageSnapshot(page,'sprint');
   if(name==='original_disabled'){await executeCase(page,'sprint',item,driver);await verifyCase(page,'sprint',item,before);}
   else{
    await driver.activate(page.getByRole('button',{name:/Create Project/}));const dialog=page.locator('mat-dialog-container');await dialog.waitFor();await driver.fill(dialog.locator('input[name=name]'),'');await driver.fill(dialog.locator('textarea[name=description]'),'Must not save');const target=dialog.getByRole('button',{name:'Create',exact:true});assert.equal(await target.isDisabled(),true);
    if(name==='denied_approval_not_native')auth.denyApproval();else if(name==='revoked_auth_not_native')auth.revoke();else await driver.close();
    await assert.rejects(driver.activate(target,{expectUnavailable:true}),name==='denied_approval_not_native'?/Refusal must be the original disabled UI/:/session|403|closed|not connected|not_connected/i);
    assert.deepEqual(await storageSnapshot(page,'sprint'),before);assert.equal(await target.isDisabled(),true);
   }
   entry.status='passed';
  }catch(error){entry.error=String(error);entry.stack=error.stack;}finally{await driver?.close();await context.close();}
 }
 const target={instanceId:'exact'},base={error:true,data:{status:'not-dispatched',operation:'activate',target,changed:[]}};assert(originalDisabledRefusal('mcp',{disabled:true},base,target));for(const result of[{error:true,text:'operation-denied'},{error:true,text:'network unavailable disabled'},{error:true,data:{...base.data,status:'partial'}},{error:true,data:{...base.data,changed:['unexpected']}},{error:true,data:{...base.data,target:{instanceId:'another'}}}])assert.equal(originalDisabledRefusal('mcp',{disabled:true},result,target),false);assert.equal(originalInvalidRefusal({error:true,text:'session-invalid'},target),false);assert(originalInvalidRefusal({error:true,data:{...base.data,operation:'submit',validation:{status:'invalid'}}},target));report.classifierBoundaryChecks='passed';
}finally{await browser.close();await fixture.close();report.sourceAfter=assertFrozen('sprint');report.resourcesClosed=true;report.harnessSha256=Object.fromEntries(['driver.mjs','fixtures.mjs','access-fixture.mjs','focus-disabled.mjs'].map(name=>[name,hash(readFileSync(join(directory,name)))]));report.passed=report.cases.length===4&&report.cases.every(item=>item.status==='passed')&&report.classifierBoundaryChecks==='passed';writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('FOCUSED',report.passed,output);if(!report.passed)process.exitCode=1;}
