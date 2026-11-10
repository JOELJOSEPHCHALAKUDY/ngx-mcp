import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {chromium,type Browser} from 'playwright';
import {hash} from '../src/hash.js';
import {certify} from '../src/certification.js';
import {browserAdapter} from '../src/browser-adapter.js';
import {livePatch,liveValue,repairFromLive,schemaPattern} from '../src/live-rules.js';
import type {LiveForm} from '../src/live-forms.js';
import type {Capability,Manifest,Field} from '../src/model.js';

// A sign-up page with the shape of an Angular reactive form in a development build: `ng.getDirectives` exposes a control per
// input, each with validators that report Angular's error keys, plus two rules no schema can state (a strength check and a
// repeated password). The submit handler clears an alert before it validates, as real applications do.
let server:Server,browser:Browser,baseUrl:string,networkMutations=0;
const page=`<!doctype html><html><body><app-signup><form><input name="username"><input name="password" type="password"><input name="confirmPassword" type="password"><input name="nickname"><input name="code"><button type="submit">Create</button></form></app-signup><script>
const host=document.querySelector('app-signup'),form=host.querySelector('form');
const service={clear(){},create(value){fetch('/users',{method:'POST',body:JSON.stringify(value)});}};
const V={
 required:c=>c.value===''||c.value==null?{required:true}:null,
 min:n=>c=>c.value!=null&&typeof c.value.length==='number'&&c.value.length>0&&c.value.length<n?{minlength:{requiredLength:n,actualLength:c.value.length}}:null,
 max:n=>c=>c.value!=null&&typeof c.value.length==='number'&&c.value.length>n?{maxlength:{requiredLength:n,actualLength:c.value.length}}:null,
 pattern:p=>c=>c.value===''||c.value==null||new RegExp(p).test(c.value)?null:{pattern:{requiredPattern:p,actualValue:c.value}},
 strong:c=>typeof c.value==='string'&&c.value&&!/[0-9]/.test(c.value)?{weak:true}:null,
 compose:list=>c=>{const out=Object.assign({},...list.map(v=>v(c)));return Object.keys(out).length?out:null;},
};
const group={controls:{},errors:null,status:'VALID',parent:null,updateOn:'change',validate(){
 const list=Object.values(group.controls);
 for(const c of list)c.errors=c.validator(c);
 const first=group.controls.password,again=group.controls.confirmPassword;
 if(!again.errors&&again.value!==first.value)again.errors={mustMatch:true};
 for(const c of list)c.status=c.errors?'INVALID':'VALID';
 group.status=list.some(c=>c.errors)?'INVALID':'VALID';
}};
const control=validator=>{const c={value:'',errors:null,status:'VALID',validator,updateOn:'change',parent:group,root:group,setValue(v){c.value=v;group.validate();},updateValueAndValidity(){group.validate();}};return c;};
Object.assign(group.controls,{username:control(V.compose([V.required,V.min(3),V.max(8)])),password:control(V.compose([V.required,V.min(6),V.strong])),confirmPassword:control(V.required),nickname:control(V.min(2)),code:control(V.compose([V.required,V.pattern('^[0-9]{5}$')]))});
group.validate();
window.ng={getComponent:el=>el===host?{service}:undefined,getDirectives:el=>group.controls[el.name]?[{control:group.controls[el.name]}]:[]};
for(const input of form.querySelectorAll('input'))input.addEventListener('input',()=>{group.controls[input.name].value=input.value;group.validate();});
form.onsubmit=event=>{event.preventDefault();service.clear();if(group.status==='INVALID')return;service.create(Object.fromEntries(Object.entries(group.controls).map(([k,c])=>[k,c.value])));};
</script></body></html>`;
before(async()=>{
 server=createServer((request,response)=>{if(request.method!=='GET'){networkMutations++;response.writeHead(200,{'content-type':'application/json'});response.end('{}');return;}response.writeHead(200,{'content-type':'text/html'});response.end(page);});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 browser=await chromium.launch();
});
after(async()=>{await browser?.close();await new Promise<void>(done=>server?.close(()=>done()));});

function signup(){
 const names=['username','password','confirmPassword','nickname','code'];
 const fields:Field[]=names.map(name=>({name,selector:`input[name="${name}"]`,element:'input',type:name.toLowerCase().includes('password')?'password':'text',required:name!=='nickname',supported:true,schema:{type:'string'},adapter:'native'}));
 const cap:Capability={id:'fixture/signup',fingerprint:'',route:'/signup',component:'SignupFixture',componentSelector:'app-signup',action:{kind:'form',selector:'app-signup form',label:'Create',event:'submit',expression:'onSubmit()',source:{file:'live-fixture',line:1}},fields,handler:'onSubmit',callPath:[],bindings:['clear','create'].map(method=>({token:'FixtureService',service:'FixtureService',method,source:{file:'live-fixture',line:1},arguments:[],inputSchema:{},outputSchema:{},schemaIssues:[]})),inputSchema:{type:'object',properties:Object.fromEntries(fields.map(f=>[f.name,f.schema])),required:names.filter(name=>name!=='nickname'),additionalProperties:false},outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'};
 const manifest:Manifest={formatVersion:1,compilerVersion:'0.1.0',sourceDigest:'live-forms-fixture',routes:[],diagnostics:[],capabilities:[cap]};
 cap.fingerprint=hash(JSON.stringify({sourceDigest:manifest.sourceDigest,capability:cap}));return manifest;
}

test('rules read from a live form model become schema rules, and only where a schema can carry them',()=>{
 assert.equal(schemaPattern('^abc$'),'^abc$');assert.equal(schemaPattern('/abc/'),'abc');assert.equal(schemaPattern('/abc/i'),undefined);
 assert.deepEqual(livePatch({type:'string'},{required:true,minLength:3,maxLength:8}).patch,{maxLength:8,minLength:3});
 assert.deepEqual(livePatch({type:'string'},{minLength:2}).patch,{anyOf:[{const:''},{type:'string',minLength:2}]});
 assert.deepEqual(livePatch({type:'integer'},{min:1.5,max:9}).patch,{minimum:2,maximum:9});
 assert.deepEqual(livePatch({type:'boolean'},{requiredTrue:true}).patch,{const:true});
 // A rule the contract already states (in the compiler's own anchoring) is not stated twice.
 assert.deepEqual(livePatch({type:'string',minLength:1,pattern:'^(?:[0-9]{5})$'},{required:true,patterns:['^[0-9]{5}$']}).patch,{});
 const own=livePatch({type:'string'},{required:true,custom:['weak'],patterns:['/abc/i']});
 assert.deepEqual(own.patch,{minLength:1});assert.equal(own.notes.length,2);
});

test('a rejected example is repaired from what the form model said about it',()=>{
 assert.equal(liveValue({type:'string'},{required:true,minLength:6},'aaaaaa',['aaaaaa']),'Aa1!aaaa');
 assert.equal(liveValue({type:'string'},{required:true,patterns:['^[0-9]{5}$']},'aaa'),'12345');
 assert.equal(liveValue({type:'string'},{required:true,email:true},'aaa'),'probe@example.test');
 const form:LiveForm={fields:[{name:'password',kind:'reactive',errors:['weak'],rules:{required:true,minLength:6,custom:['weak']}},{name:'confirmPassword',kind:'reactive',errors:['mustMatch'],rules:{required:true,custom:['mustMatch']}}],group:[],invalid:true,unfilled:[]};
 const next=repairFromLive(['password','confirmPassword'],{password:{type:'string'},confirmPassword:{type:'string'}},{password:'aaaaaa',confirmPassword:'aaa'},form,{},{});
 // The repeated field is tried as a copy of the one it names, and follows it to the value chosen in the same step.
 assert.deepEqual(next,{values:{password:'Aa1!aaaa',confirmPassword:'Aa1!aaaa'},mirrors:{confirmPassword:'password'}});
});

test('certification reads validators from the live form, proves the contract, and the served tool refuses what the form refuses',{timeout:300000},async()=>{
 const result=await certify(browser,signup(),{baseUrl});
 const [entry]=result.entries,capability=result.manifest.capabilities[0];
 assert.equal(entry.verdict,'proven',JSON.stringify(entry));assert.equal(entry.rounds,2);assert.equal(entry.agreement,1);
 assert.deepEqual(entry.repaired,['username','password','confirmPassword','nickname','code']);
 assert.equal(entry.reason,'confirmPassword must equal password; the application also enforces its own rule (weak) when called');
 assert.deepEqual((capability.inputSchema as {properties:object}).properties,{
  username:{type:'string',minLength:3,maxLength:8},
  // No example is published for a password field.
  password:{type:'string',minLength:6},
  confirmPassword:{type:'string',description:'Must equal the value of "password".'},
  nickname:{type:'string',anyOf:[{const:''},{type:'string',minLength:2}]},
  code:{type:'string',minLength:1,pattern:'^[0-9]{5}$',examples:['12345']},
 });
 assert.equal(capability.fields.find(field=>field.name==='confirmPassword')?.sameAs,'password');
 assert.deepEqual(result.approvals.map(a=>[a.id,a.effect]),[['fixture/signup','write']]);
 assert.equal(networkMutations,0);
 // The reviewed tool, outside the sandbox: a pair of values the schema allows but the form rejects is never submitted.
 const context=await browser.newContext(),tab=await context.newPage();let posted:unknown;
 await context.route('**/users',route=>{posted=JSON.parse(route.request().postData()??'null');return route.fulfill({status:200,contentType:'application/json',body:'{}'});});
 const adapter=browserAdapter(tab,result.manifest,result.approvals,baseUrl),tool=adapter.tools[0].name;
 await assert.rejects(adapter.invoke(tool,{username:'abc',password:'Aa1!aaaa',confirmPassword:'Aa1!aaab',code:'12345'}),/confirmPassword \(mustMatch\)/);
 await assert.rejects(adapter.invoke(tool,{username:'abc',password:'aaaaaaaa',confirmPassword:'aaaaaaaa',code:'12345'}),/password \(weak\)/);
 assert.equal(posted,undefined);
 await adapter.invoke(tool,{username:'abc',password:'Aa1!aaaa',confirmPassword:'Aa1!aaaa',code:'12345'});
 assert.deepEqual(posted,{username:'abc',password:'Aa1!aaaa',confirmPassword:'Aa1!aaaa',nickname:'',code:'12345'});
 await context.close();assert.equal(networkMutations,0);
});
