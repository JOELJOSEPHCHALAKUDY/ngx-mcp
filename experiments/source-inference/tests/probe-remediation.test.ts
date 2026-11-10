import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {chromium,type Browser} from 'playwright';
import {learnFieldsConstraints,learnFieldConstraints} from '../src/probe-learning.js';
import {probeCapability,applyProbes} from '../src/probe.js';
import {hash} from '../src/hash.js';
import type {Capability,Field,Manifest} from '../src/model.js';

test('membership scheduling visits every field before exhausting a shared budget',async()=>{
 const visited:string[]=[];let spent=0,active=0,peak=0;
 const fields=['first','middle','last'].map(name=>({name,current:'aaaa',schema:{type:'string'}}));
 const result=await learnFieldsConstraints(fields,async(name,value)=>{
   if(spent>=6)return undefined;spent++;visited.push(name);active++;peak=Math.max(peak,active);await Promise.resolve();active--;
   return typeof value==='string'&&value.length>=3&&value.length<=7;
 });
 assert.equal(spent,6);assert.deepEqual(visited,['first','middle','last','first','middle','last']);assert.equal(peak,1);
 for(const field of fields){assert.equal(result[field.name].patch.maxLength,undefined);assert(result[field.name].uncertainties.length>0);}
});
test('declared source boundaries are verified directly without repeating a complete search',async()=>{
 let spent=0;
 const result=await learnFieldsConstraints([{name:'username',schema:{type:'string',minLength:3,maxLength:64},current:'aaa'},{name:'password',schema:{type:'string',minLength:8,maxLength:64},current:'aaaaaaaa'}],async(name,value)=>{
   if(spent>=8)return undefined;spent++;return typeof value==='string'&&value.length>=(name==='username'?3:8)&&value.length<=64;
 });
 assert.equal(spent,8);assert.deepEqual(result.username.patch,{minLength:3,maxLength:64});assert.deepEqual(result.password.patch,{minLength:8,maxLength:64});
});
test('a source hint is never marked verified when the query budget expires',async()=>{
 let spent=0;const result=await learnFieldConstraints({type:'string',minLength:3,maxLength:64},'aaaa',async value=>++spent<=2?typeof value==='string'&&value.length>=3&&value.length<=64:undefined);
 assert.equal(result.patch.maxLength,undefined);assert(result.uncertainties.length);
});
test('failed membership queries settle all learners before propagating the error',async()=>{
 await assert.rejects(learnFieldsConstraints([{name:'a',schema:{type:'string'},current:'aaa'},{name:'b',schema:{type:'string'},current:'bbb'}],async()=>{throw new Error('fixture unavailable');}),/fixture unavailable/);
});
test('contradictory length witnesses do not produce a monotone maximum',async()=>{
 const result=await learnFieldConstraints({type:'string',maxLength:64},'aaa',async value=>typeof value==='string'&&value.length!==64);
 assert.equal(result.patch.maxLength,undefined);assert(result.uncertainties.some(x=>x.includes('Non-monotone')));
});

let browser:Browser,server:Server,baseUrl:string;
const html=(path:string)=>`<!doctype html><html><head><style>app-probe,mat-button-toggle-group,mat-button-toggle{display:block;padding:5px}</style></head><body><app-probe>${path==='/discover'?'<input id="display" required minlength="2" maxlength="8"><textarea id="notes" minlength="3" maxlength="40"></textarea><button type="button">Create</button>':'<mat-button-toggle-group><mat-button-toggle data-value="light"><button>Light</button></mat-button-toggle><mat-button-toggle data-value="dark"><button>Dark</button></mat-button-toggle><mat-button-toggle data-value="system"><button>System</button></mat-button-toggle></mat-button-toggle-group>'}</app-probe><script>
const host=document.querySelector('app-probe');
const service={persist(value){fetch('/settings',{method:'POST',body:JSON.stringify({theme:value})});},create(value){fetch('/records',{method:'POST',body:JSON.stringify(value)});}};
const component={service};let selected='light';
window.ng={getComponent(el){if(el===host)return component;if(el.tagName==='MAT-BUTTON-TOGGLE'&&!(location.pathname==='/partial'&&el.dataset.value==='light'))return {value:el.dataset.value};}};
if(location.pathname==='/discover')host.querySelector('button').onclick=()=>{const displayName=document.querySelector('#display').value,notes=document.querySelector('#notes').value;if(displayName.length<2||displayName.length>8||notes.length>40)return;service.create({displayName,notes});};
else for(const option of host.querySelectorAll('mat-button-toggle'))option.querySelector('button').onclick=()=>{if(selected===option.dataset.value)return;selected=option.dataset.value;service.persist(selected);};
</script></body></html>`;
before(async()=>{
 server=createServer((request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html(new URL(request.url!,'http://local').pathname));});
 await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;browser=await chromium.launch();
});
after(async()=>{await browser?.close();await new Promise<void>(done=>server?.close(()=>done()));});
function fixture(path:string,known=false){
 const discovery=path==='/discover';
 const fields:Field[]=discovery?[]:[{name:'theme',selector:'mat-button-toggle-group',element:'mat-button-toggle-group',type:'text',required:true,supported:true,adapter:'material-choice',schema:{type:'string'},...(known?{options:['light','dark','system'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))}:{})}];
 const cap:Capability={id:path,fingerprint:'',route:path,component:'ProbeRemediationFixture',componentSelector:'app-probe',action:{kind:discovery?'button':'workflow',selector:discovery?'app-probe button[type="button"]':'app-probe mat-button-toggle-group',label:'Save',event:discovery?'click':'change',expression:'save()',source:{file:'probe-remediation-fixture',line:1}},handler:'save',fields,callPath:[],bindings:['persist','create'].map(method=>({token:'FixtureService',service:'FixtureService',method,arguments:[],inputSchema:{},outputSchema:{},schemaIssues:[],source:{file:'probe-remediation-fixture',line:1}})),inputSchema:{type:'object',properties:discovery?{}:{theme:{type:'string',...(known?{enum:['light','dark','system']}:{})}},required:discovery?[]:['theme'],additionalProperties:false},outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate',...(discovery?{}:{plan:{mode:'edit' as const,root:'app-probe',repeats:[]}})};
 const manifest:Manifest={formatVersion:1,compilerVersion:'0.1.0',sourceDigest:'probe-remediation',routes:[],capabilities:[cap],diagnostics:[]};cap.fingerprint=hash(JSON.stringify({sourceDigest:manifest.sourceDigest,capability:cap}));return {cap,manifest};
}
test('live option values include the initially selected option without forcing a fake change event',{timeout:45000},async()=>{
 const {cap,manifest}=fixture('/choices');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:0});
 assert.equal(report.skipped,undefined);assert.deepEqual(report.options?.theme,[{value:'light',label:'Light'},{value:'dark',label:'Dark'},{value:'system',label:'System'}]);
 assert.deepEqual((applyProbes(manifest,[report]).capabilities[0].inputSchema as {properties:{theme:{enum:string[]}}}).properties.theme.enum,['light','dark','system']);
});
test('existing source options and enums are not replaced by sampled runtime options',{timeout:45000},async()=>{
 const {cap,manifest}=fixture('/known',true);const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:0});
 assert.equal(report.skipped,undefined);assert.equal(report.options,undefined);assert.deepEqual((applyProbes(manifest,[report]).capabilities[0].inputSchema as {properties:{theme:{enum:string[]}}}).properties.theme.enum,['light','dark','system']);
});
test('an incomplete observed option set never becomes a restrictive partial enum',{timeout:60000},async()=>{
 const {cap,manifest}=fixture('/partial');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:0});
 assert.equal(report.skipped,undefined);assert.equal(report.options?.theme,undefined);assert(report.uncertainties?.some(x=>x.includes('no partial enum')));
});
test('discovered controls retain authored bounds and optional fields',{timeout:60000},async()=>{
 const {cap,manifest}=fixture('/discover');const report=await probeCapability(browser,manifest,cap,{baseUrl,budget:0});
 assert.equal(report.skipped,undefined);const schema=report.synthesized?.inputSchema as {properties:Record<string,any>;required:string[]};
 assert.deepEqual(schema.required,['displayName']);assert.equal(schema.properties.displayName.minLength,2);assert.equal(schema.properties.displayName.maxLength,8);assert.equal(schema.properties.notes.maxLength,40);assert(!schema.required.includes('notes'));assert(schema.properties.notes.anyOf.some((branch:Record<string,unknown>)=>branch.const===''));
});

