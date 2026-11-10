import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {chromium,type Browser} from 'playwright';
import {probeCapability,applyProbes} from '../src/probe.js';
import {hash} from '../src/hash.js';
import {certify,certificationReport} from '../src/certification.js';
import {reviewedTools} from '../src/approval.js';
import type {Capability,Manifest,Field} from '../src/model.js';

// A small native DOM fixture exercises the serialized adapter and probe independently of compiler discovery.
// Angular integration is covered by the public corpus and seeded injection apps; only its debug observer API is mocked here.
let server:Server,browser:Browser,baseUrl:string,networkMutations=0;
const html=(path:string)=>`<!doctype html><html><body><app-probe>${path==='/toggle'?'<input type="checkbox" name="enabled">':['/state','/noop'].includes(path)?'<button type="button">Switch</button><p id="result">Cold</p>':`<form ${path==='/native'?'action="/native-receiver" method="post"':''}><input name="summary"><button type="submit">Save</button></form>`}</app-probe><script>
const host=document.querySelector('app-probe');
const service={validate(){fetch('/validate',{method:'POST'});},save(value){fetch('/orders',{method:'POST',body:JSON.stringify(value)});},set(value){fetch('/settings',{method:'POST',body:JSON.stringify(value)});}};
window.ng={getComponent:el=>el===host?{service}:undefined};
if(location.pathname==='/state')host.querySelector('button').onclick=()=>document.querySelector('#result').textContent='Warm';
else if(location.pathname==='/noop')host.querySelector('button').onclick=()=>undefined;
else if(location.pathname==='/toggle')host.querySelector('input').onchange=event=>service.set(event.target.checked);
else if(location.pathname!=='/native')host.querySelector('form').onsubmit=event=>{event.preventDefault();const summary=host.querySelector('input').value;service.validate();localStorage.setItem('audit',summary);if(summary.length<2||summary.length>4)return;service.save({summary});};
</script></body></html>`;
before(async()=>{
 server=createServer((request,response)=>{if(request.method!=='GET'){networkMutations++;response.writeHead(200,{'content-type':'application/json'});response.end('{}');return;}response.writeHead(200,{'content-type':'text/html'});response.end(html(new URL(request.url!,'http://localhost').pathname));});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 browser=await chromium.launch();
});
after(async()=>{await browser?.close();await new Promise<void>(done=>server?.close(()=>done()));});
function fixture(path:string){
 const toggle=path==='/toggle',state=['/state','/noop'].includes(path);
 const fields:Field[]=state||path==='/native'?[]:[{name:toggle?'enabled':'summary',selector:toggle?'input[name="enabled"]':'input[name="summary"]',element:'input',type:toggle?'checkbox':'text',required:true,supported:true,schema:{type:toggle?'boolean':'string'},adapter:'native'}];
 const cap:Capability={id:`fixture${path}`,fingerprint:'',route:path,component:'ProbeFixture',componentSelector:'app-probe',action:{kind:state?'button':toggle?'workflow':'form',selector:state?'app-probe button':toggle?'app-probe':'app-probe form',label:'Fixture action',event:state?'click':'submit',expression:'save()',source:{file:'native-fixture',line:1}},fields,handler:'save',callPath:[],bindings:['validate','save','set'].map(method=>({token:'FixtureService',service:'FixtureService',method,source:{file:'native-fixture',line:1},arguments:[],inputSchema:{},outputSchema:{},schemaIssues:[]})),inputSchema:{type:'object',properties:Object.fromEntries(fields.map(f=>[f.name,f.schema])),required:fields.map(f=>f.name),additionalProperties:false},outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate',...(toggle?{plan:{mode:'edit' as const,root:'app-probe',repeats:[]}}:{})};
 const manifest:Manifest={formatVersion:1,compilerVersion:'0.1.0',sourceDigest:'native-probe-fixture',routes:[],diagnostics:[],capabilities:[cap]};
 cap.fingerprint=hash(JSON.stringify({sourceDigest:manifest.sourceDigest,capability:cap}));return {manifest,cap};
}
test('runtime probing learns a narrow range despite validation POSTs and audit writes',{timeout:60000},async()=>{
 const {manifest,cap}=fixture('/range');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:12});
 assert.equal(report.skipped,undefined);assert.deepEqual(report.learned.summary,{minLength:2,maxLength:4});assert(report.probes.some(p=>p.note==='empty string'&&!p.accepted));
 const next=applyProbes(manifest,[report]).capabilities[0];assert.equal((next.fields[0].schema as {maxLength:number}).maxLength,4);
 assert(next.observed?.http.every(request=>!Object.hasOwn(request,'body')));assert.equal(networkMutations,0);
});
test('runtime membership budget is respected and an incomplete upper bound stays unknown',{timeout:60000},async()=>{
 const {manifest,cap}=fixture('/range');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:4});
 assert.equal(report.probes.length,4);assert.equal(report.learned.summary?.maxLength,undefined);assert(report.uncertainties?.length);
});
test('an idempotent checkbox choice does not acquire a required-true constraint',{timeout:30000},async()=>{
 const {manifest,cap}=fixture('/toggle');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:4});
 assert.equal(report.skipped,undefined);assert.equal(report.learned.enabled,undefined);assert(report.uncertainties?.some(x=>x.includes('idempotence')));
});
test('synchronous UI changes are observed against the state before dispatch',{timeout:30000},async()=>{
 const {manifest,cap}=fixture('/state');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:0});
 assert.equal(report.effectClass,'ui-state');assert.equal(report.effects.domChanged,true);
});
test('native form POSTs are recorded and intercepted before reaching the server',{timeout:30000},async()=>{
 const {manifest,cap}=fixture('/native');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:0});
 assert(report.effects.http.some(r=>r.method==='POST'&&r.path==='/native-receiver'));assert.equal(networkMutations,0);
});

test('loading the action route is not misreported as an action changing UI state',{timeout:30000},async()=>{
 const {manifest,cap}=fixture('/noop');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:0});
 assert.equal(report.effectClass,'none-observed');assert.equal(report.effects.domChanged,false);
});

test('certification repairs a contract from the app, re-probes it, and proposes only actions that ran',{timeout:120000},async()=>{
 const range=fixture('/range'),noop=fixture('/noop');
 const manifest:Manifest={...range.manifest,capabilities:[range.cap,noop.cap,{...fixture('/state').cap,id:'fixture/blocked',status:'blocked',issues:['unsupported control']}]};
 for(const c of manifest.capabilities){c.fingerprint='';c.fingerprint=hash(JSON.stringify({sourceDigest:manifest.sourceDigest,capability:c}));}
 const result=await certify(browser,manifest,{baseUrl,budget:12});
 const [ranged,idle,blocked]=result.entries;
 assert.equal(ranged.verdict,'proven',JSON.stringify(ranged));assert(ranged.rounds>=2);assert.deepEqual(ranged.repaired,['summary']);
 assert.equal(idle.verdict,'unverified');assert.equal(blocked.verdict,'blocked');
 assert.deepEqual(result.approvals.map(a=>a.id),['fixture/range']);assert.equal(result.approvals[0].effect,'write');
 assert.equal(reviewedTools(result.manifest,result.approvals).length,1);
 assert.match(certificationReport(result),/1 of 3 discovered actions ran/);assert.equal(networkMutations,0);
});
