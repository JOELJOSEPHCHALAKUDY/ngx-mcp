import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {integrationAccessSource} from '../src/integration-access.js';
import {integrationFormTools} from '../src/integration-catalog.js';

const ts:any=createRequire(import.meta.url)('typescript');
const javascript=ts.transpileModule(integrationAccessSource()+'\nexport {createIntegrationAccess};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {createIntegrationAccess}=await import('data:text/javascript;base64,'+Buffer.from(javascript).toString('base64'));
function setup(overrides:any={},policyOverrides:any={}){
 const state:any={now:1700000000000,session:{id:'session-A',subject:'alice',expiresAt:1700000300000},origin:'https://app.example',route:'/app/tasks',validations:0,approvals:[],audit:[]};
 const policy={version:1,allowedOrigins:['https://app.example'],routePrefixes:['/app'],rules:[
  {sourceId:'form',operations:['describe','submit'],readFields:['field'],writeFields:['field']},
  {sourceId:'field',operations:['describe','fill','read-model'],modelPaths:['/id','/label','/nested/name']},
  {sourceId:'secret',operations:['describe']},
  {sourceId:'delete',operations:['describe','activate']},
  {sourceId:'@page',operations:['navigate','read-view']},
 ]};
 const env:any={session:state.session,origin:()=>state.origin,route:()=>state.route,now:()=>state.now,validateSession:async()=>{state.validations++;return state.session;},approve:async(challenge:any)=>{state.approvals.push(challenge);return true;},audit:(event:any)=>state.audit.push(event),...overrides};
 const access=createIntegrationAccess({...policy,...policyOverrides},env);
 return {state,policy,env,access};
}
const request=(args:any={value:'Example'})=>({operation:'fill',sourceId:'field',instanceId:'field@nonce:1',args});

test('access is default-deny and validates exact origins, routes, policy keys and mandatory hooks',async()=>{
 const {access,state,env,policy}=setup();let effects=0;
 await assert.rejects(access.run({...request(),sourceId:'unlisted-secret-string'},()=>effects++),/operation-denied/);
 assert.equal(effects,0);assert.equal(access.allows('fill','unlisted'),false);
 assert.equal(state.audit.at(-1).sourceId,undefined,'Unknown attacker-selected target data is not copied to the audit');
 state.origin='https://app.example.attacker.test';await assert.rejects(access.run(request(),()=>effects++),/origin-denied/);
 state.origin='https://app.example';state.route='/application/tasks';await assert.rejects(access.run(request(),()=>effects++),/route-denied/);
 assert.equal(effects,0);
 assert.throws(()=>createIntegrationAccess({...policy,allowedOrigins:['https://*.example']},env));
 assert.throws(()=>createIntegrationAccess({...policy,allowedOrigins:['http://public.example']},env));
 assert.throws(()=>createIntegrationAccess({...policy,allowedOrigins:['https://app.example/path']},env));
 assert.throws(()=>createIntegrationAccess({...policy,extra:true},env),/Unknown access policy/);
 assert.throws(()=>createIntegrationAccess({...policy,rules:[{sourceId:'*',operations:['fill']}]},env),/exact source/);
 assert.throws(()=>createIntegrationAccess(policy,{...env,validateSession:undefined}),/trusted session/);
 assert.throws(()=>createIntegrationAccess(policy,{...env,audit:undefined}),/audit/);
});

test('catalog session checks and source/field data scopes are independent',async()=>{
 const {access,state}=setup();
 assert.equal(await access.run({operation:'catalog',sourceId:'@page',args:{}},()=>42),42);
 assert(state.validations>=2,'Catalog exposure requires fresh session checks');
 assert.equal(access.allowsField('form','field','fill'),true);
 assert.equal(access.allowsField('form','secret','fill'),false);
 assert.equal(access.allowsField('form','unlisted','describe'),false);
 state.session=null;await assert.rejects(access.run({operation:'catalog',sourceId:'@page',args:{}},()=>42),/session-invalid/);
});

test('metadata and nested forms redact values; explicit object-model paths limit returned data',()=>{
 const {access}=setup();
 const descriptor={sourceId:'form',instanceId:'form:1',value:'private',modelValue:'private',modelSize:20,operations:['submit','activate'],fields:[{sourceId:'field',value:'private',modelValue:'private',modelSize:20,operations:['fill'],options:[{value:'x',label:'X',selected:true}]},{sourceId:'secret',label:'PRIVATE CUSTOMER',value:'secret',options:[{label:'PRIVATE OPTION',value:'SECRET ID',selected:true}],operations:[]},{sourceId:'unlisted',value:'secret'}]};
 const result=access.redactDescriptor('form',descriptor);
 assert.equal(result.value,undefined);assert.equal(result.modelValue,undefined);assert.equal(result.modelSize,undefined);
 assert.deepEqual(result.operations,['submit']);assert.equal(result.fields.length,1);assert.equal(result.fields[0].value,undefined);assert.equal(result.fields[0].options,undefined);
 assert.equal(access.redactDescriptor('unlisted',descriptor),undefined);
 const privateMetadata=access.redactDescriptor('secret',descriptor.fields[1]);assert(!JSON.stringify(privateMetadata).includes('PRIVATE'));assert(!JSON.stringify(privateMetadata).includes('SECRET ID'));
 assert(!JSON.stringify(result).includes('PRIVATE'));
 const projected=access.projectModel('field',{kind:'object',complete:true,value:{id:2,label:'Allowed',token:'DO_NOT_EXPOSE',nested:{name:'Allowed name',private:'DO_NOT_EXPOSE'}}});
 assert.equal(projected.complete,false);assert.equal(projected.projected,true);
 assert.deepEqual({...projected.value},{'/id':2,'/label':'Allowed','/nested/name':'Allowed name'});
 assert(!JSON.stringify(projected).includes('DO_NOT_EXPOSE'));
 assert.equal(access.projectModel('secret',{kind:'string',complete:true,value:'secret'}).value,undefined);
 assert.equal(access.projectModel('field',{kind:'string',complete:true,value:'PRIVATE CHANGED MODEL'}).value,undefined,'A model type change cannot bypass configured object-path restrictions');
 const scalar=setup({}, {rules:[{sourceId:'field',operations:['read-model']}]});assert.equal(scalar.access.projectModel('field',{kind:'string',complete:true,value:'explicit primitive'}).value,'explicit primitive');
});

test('metadata hides private control paths and ARIA values recursively while authorized reads retain them',()=>{
 const {access}=setup({}, {rules:[
  {sourceId:'form',label:'Reviewed form',operations:['describe','submit','read-value'],readFields:['field']},
  {sourceId:'field',label:'Reviewed checkbox',operations:['describe','fill','read-value']},
 ]});
 const field={sourceId:'field',instanceId:'field@nonce:1',kind:'control',tagName:'input',label:'PRIVATE LABEL',visible:true,disabled:false,readonly:false,operations:['fill'],schema:{type:'boolean'},path:['PRIVATE-CUSTOMER-ID','PRIVATE-CONTROL-NAME'],aria:{checked:'true',selected:'false',pressed:'mixed',controls:'PRIVATE-DOM-ID'},validation:{status:'valid',fields:[],groups:[]}};
 const descriptor={sourceId:'form',instanceId:'form@nonce:1',kind:'form',tagName:'form',label:'PRIVATE FORM',visible:true,disabled:false,operations:['submit'],path:['PRIVATE-FORM-PATH'],aria:{selected:'true'},fields:[field],validation:{status:'valid',fields:[{sourceId:'field',instanceId:field.instanceId,path:[...field.path],status:'valid',errors:[]}],groups:[{path:['PRIVATE-GROUP-PATH'],status:'valid',errors:[]}]}};
 const metadata=access.redactDescriptor('form',descriptor);
 assert.equal(metadata.label,'Reviewed form');assert.equal(metadata.fields[0].label,'Reviewed checkbox');
 assert.equal(metadata.path,undefined);assert.equal(metadata.aria,undefined);assert.equal(metadata.fields[0].path,undefined);assert.equal(metadata.fields[0].aria,undefined);
 assert.equal(metadata.validation.fields[0].path,undefined);assert.equal(metadata.validation.groups[0].path,undefined);
 assert(!JSON.stringify(metadata).includes('PRIVATE'));
 const [tool]=integrationFormTools([metadata],()=> 'angular_form_example');
 assert.deepEqual(Object.keys((tool.inputSchema as any).properties),[field.instanceId]);
 assert.equal(tool.bindings[field.instanceId].instanceId,field.instanceId,'Typed forms bind the same exact instance without a dynamic path');
 const readable=access.redactDescriptor('field',field,true);
 assert.deepEqual(readable.path,field.path);assert.deepEqual(readable.aria,field.aria);assert.equal(readable.label,'Reviewed checkbox');
 const readableForm=access.redactDescriptor('form',descriptor,true);
 assert.deepEqual(readableForm.path,descriptor.path);assert.deepEqual(readableForm.aria,descriptor.aria);
 assert.equal(readableForm.fields[0].path,undefined,'A parent read approval does not authorize nested field data');
 assert.deepEqual(field.path,['PRIVATE-CUSTOMER-ID','PRIVATE-CONTROL-NAME'],'Redaction does not change the live descriptor');
});

test('metadata schemas omit private choice and annotation values without corrupting property names',()=>{
 const {access}=setup({}, {rules:[{sourceId:'field',label:'Reviewed field',operations:['describe','fill','read-value']}]});
 const schema={type:'object',properties:{const:{type:'string',enum:['PRIVATE-ENUM'],default:'PRIVATE-DEFAULT',minLength:1},values:{type:'array',items:{type:'string',enum:['PRIVATE-NESTED-OPTION']},examples:[['PRIVATE-ITEM-EXAMPLE']]}},additionalProperties:false,examples:[{const:'PRIVATE-EXAMPLE'}],anyOf:[{type:'object',const:{choice:'PRIVATE-CONST'}}]};
 const descriptor={sourceId:'field',instanceId:'field:1',schema};
 const metadata=access.redactDescriptor('field',descriptor);
 assert(!JSON.stringify(metadata).includes('PRIVATE'));
 assert.deepEqual(metadata.schema,{type:'object',properties:{const:{type:'string',minLength:1},values:{type:'array',items:{type:'string'}}},additionalProperties:false,anyOf:[{type:'object'}]});
 assert.deepEqual(access.redactDescriptor('field',descriptor,true).schema,schema,'Only a separately authorized value read retains choices/defaults/examples');
 const nested=setup({}, {rules:[{sourceId:'form',operations:['describe'],readFields:['field']},{sourceId:'field',operations:['describe']}]});
 assert(!JSON.stringify(nested.access.redactDescriptor('form',{fields:[descriptor]})).includes('PRIVATE'),'Nested form descriptors redact schema values too');
 assert.equal(schema.properties.const.default,'PRIVATE-DEFAULT','Metadata projection does not mutate the original validation schema');
});

test('mutation approval is bound to immutable canonical arguments and one-use session permits',async()=>{
 const {access,state}=setup();
 const input=request({b:2,a:{text:'approved'}}),permit=await access.authorize(input);
 assert(Object.isFrozen(permit));assert.equal(state.approvals.length,1);
 assert.equal(Object.isFrozen(state.approvals[0].args.a),true);
 const args=await access.consume(permit,request({a:{text:'approved'},b:2}));
 assert.deepEqual(args,{a:{text:'approved'},b:2});assert(Object.isFrozen(args.a));
 await assert.rejects(access.consume(permit,input),/permit-invalid/);
 const changed=await access.authorize(input);
 await assert.rejects(access.consume(changed,request({a:{text:'changed'},b:2})),/request-changed/);
 await assert.rejects(access.consume(changed,input),/permit-invalid/,'Failed consumption is not replayable');
 const otherTarget=await access.authorize(input);
 await assert.rejects(access.consume(otherTarget,{...input,instanceId:'field@nonce:2'}),/request-changed/);
});

test('permissions and expiry are rechecked after approval; cross-session, revoked and stale permits fail',{timeout:10000},async()=>{
 const {access,state}=setup();
 const permit=await access.authorize(request());state.session={...state.session,id:'session-B',subject:'bob'};
 await assert.rejects(access.consume(permit,request()),/session-invalid/);
 const expired=setup();expired.state.now+=300000;
 await assert.rejects(expired.access.run(request(),()=>true),/session-expired/);
 const delayed=setup({approve:async()=>{delayed.state.now+=60001;return true;}});
 await assert.rejects(delayed.access.run(request(),()=>true),/approval-expired/);
 let release:(value:boolean)=>void=()=>{},approveStarted:()=>void=()=>{};
 const started=new Promise<void>(resolve=>{approveStarted=resolve;});
 const waiting=setup({approve:()=>new Promise<boolean>(resolve=>{release=resolve;approveStarted();})});
 const running=waiting.access.run(request(),()=>assert.fail('Revoked approval must not execute'));
 const rejected=assert.rejects(running,/approval-stale|access-revoked/);
 await started;await waiting.access.revoke();release(true);
 await rejected;
 const before=setup(),live=await before.access.authorize(request());await before.access.revoke();
 await assert.rejects(before.access.consume(live,request()),/permit-invalid/);
});

test('approval refusal and audit outage cannot mutate; later audit failure never claims no execution',async()=>{
 let effects=0;const denied=setup({approve:async()=>false});
 await assert.rejects(denied.access.run(request(),()=>effects++),/approval-denied/);
 const missing=setup({approve:undefined});await assert.rejects(missing.access.run(request(),()=>effects++),/approval-unavailable/);
 const broken=setup({audit:()=>{throw new Error('sensitive audit transport detail');}});
 await assert.rejects(broken.access.run(request(),()=>effects++),/audit-unavailable/);assert.equal(effects,0);
 const after=setup({audit:(event:any)=>{if(event.event==='completed')throw new Error('secret');}});
 await assert.rejects(after.access.run(request(),()=>++effects),(error:any)=>error.message==='audit-unavailable-after-execution'&&error.executionStarted===true);
 assert.equal(effects,1);
});

test('audit records omit raw arguments, subjects, errors and unsalted request identifiers',async()=>{
 const first=setup(),second=setup();
 await first.access.run(request({password:'DO_NOT_LOG',email:'PRIVATE@example.test'}),()=>42);
 await second.access.run(request({password:'DO_NOT_LOG',email:'PRIVATE@example.test'}),()=>42);
 assert.equal(first.state.audit[0].event,'allowed');assert.equal(first.state.audit[1].event,'completed');
 assert.equal(first.state.audit[0].requestHash,first.state.audit[1].requestHash);
 assert.notEqual(first.state.audit[0].requestHash,second.state.audit[0].requestHash,'Per-engine random salt prevents cross-session dictionary/correlation of low-entropy arguments');
 assert(!JSON.stringify(first.state.audit).includes('DO_NOT_LOG'));assert(!JSON.stringify(first.state.audit).includes('PRIVATE'));assert(!JSON.stringify(first.state.audit).includes('alice'));
 assert(first.state.audit.every((event:any)=>Object.isFrozen(event)));
 const copied=first.access.auditRecords();copied.length=0;assert.equal(first.access.auditRecords().length,2);
});

test('JSON getters, cycles, prototype objects and mutable policy/hook replacement cannot bypass the gate',async()=>{
 const {access,state,policy,env}=setup();let getterCalls=0;
 const getter=Object.defineProperty({},'value',{get(){getterCalls++;return 'secret';},enumerable:true});
 await assert.rejects(access.run(request(getter),()=>assert.fail('Getter payload executed')));assert.equal(getterCalls,0);
 const cycle:any={};cycle.self=cycle;await assert.rejects(access.authorize(request(cycle)));
 await assert.rejects(access.authorize(request(new Date())));
 policy.rules.push({sourceId:'unlisted',operations:['fill']} as any);
 assert.equal(access.allows('fill','unlisted'),false);
 env.validateSession=async()=>null;env.approve=async()=>false;
 await access.run(request(),()=>42);assert.equal(state.approvals.length,1,'Original trusted hooks are captured rather than mutable properties');
});

test('optional backend authorization applies to catalogs, requests and a previously approved permit',async()=>{
 let allowed=true;const seen:any[]=[];
 const {access}=setup({authorize:async(request:any,session:any)=>{seen.push({operation:request.operation,subject:session.subject});return allowed;}});
 await access.run({operation:'catalog',sourceId:'@page',args:{}},()=>[]);
 const permit=await access.authorize(request());allowed=false;
 await assert.rejects(access.consume(permit,request()),/operation-denied/);
 await assert.rejects(access.run({operation:'catalog',sourceId:'@page',args:{}},()=>[]),/operation-denied/);
 assert(seen.some(item=>item.operation==='catalog'));assert(seen.every(item=>item.subject==='alice'));
});

test('trusted callback deadlines reject late approval and bound pending authorization work',async()=>{
 const never=setup({validateSession:()=>new Promise(()=>{})},{approvalMaxAgeMs:5});
 await assert.rejects(never.access.run(request(),()=>assert.fail('Timed out session executed')),/session-invalid/);
 let late:(value:boolean)=>void=()=>{};
 const slow=setup({approve:()=>new Promise<boolean>(resolve=>{late=resolve;})},{approvalMaxAgeMs:5});
 let effects=0;await assert.rejects(slow.access.run(request(),()=>effects++),/approval-expired/);late(true);await new Promise(resolve=>setTimeout(resolve,5));assert.equal(effects,0);
 const releases:((value:boolean)=>void)[]=[];
 const capped=setup({approve:()=>new Promise<boolean>(resolve=>releases.push(resolve))});
 const waits=Array.from({length:16},()=>capped.access.authorize(request()));
 const deadline=Date.now()+5000;
 while(releases.length<16&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(releases.length,16,'All capped approval callbacks must be pending before release');
 await assert.rejects(capped.access.authorize(request()),/access-busy/);
 for(const release of releases)release(false);
 const results=await Promise.allSettled(waits);assert(results.every(result=>result.status==='rejected'));
});

test('emitted access controls compile with strict target flags and contain no Node imports or eval',()=>{
 const directory=mkdtempSync(join(tmpdir(),'ngx-mcp-access-strict-'));
 try{
  const source=integrationAccessSource()+'\nexport {createIntegrationAccess};';
  assert(!/from ['"](?:node:|playwright|@modelcontextprotocol)/.test(source));assert(!/\b(?:eval|Function)\s*\(/.test(source));
  const file=join(directory,'access.ts');writeFileSync(file,source);
  const options={target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,moduleResolution:ts.ModuleResolutionKind.Bundler,noEmit:true,types:[],strict:true,skipLibCheck:true,noPropertyAccessFromIndexSignature:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,noUnusedLocals:true,noUnusedParameters:true,noImplicitReturns:true};
  const diagnostics=ts.getPreEmitDiagnostics(ts.createProgram([file],options));
  assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>directory,getCanonicalFileName:(file:string)=>file,getNewLine:()=> '\n'}));
 }finally{rmSync(directory,{recursive:true,force:true});}
});


test('timed-out trusted callbacks retain slots until their underlying work settles',async()=>{
 const releases:((value:any)=>void)[]=[],signals:AbortSignal[]=[];let effects=0;
 const bounded=setup({validateSession:({signal}:{signal:AbortSignal})=>{signals.push(signal);return new Promise(resolve=>releases.push(resolve));}},{approvalMaxAgeMs:2,maxAuditRecords:1000});
 for(let index=0;index<80;index++)await assert.rejects(bounded.access.run(request(),()=>effects++));
 assert.equal(releases.length,64,'An ignored abort must not free the underlying callback reservation');
 assert(signals.every(signal=>signal.aborted));assert.equal(effects,0);
 for(const release of releases)release(bounded.state.session);
 await new Promise(resolve=>setTimeout(resolve,0));assert.equal(effects,0,'Late callbacks cannot resume timed-out operations');
 const pending:((value:any)=>void)[]=[];let hanging=true;
 const recover=setup({validateSession:()=>hanging?new Promise(resolve=>pending.push(resolve)):Promise.resolve(recover.state.session)},{approvalMaxAgeMs:2,maxAuditRecords:1000});
 for(let index=0;index<63;index++)await assert.rejects(recover.access.run(request(),()=>effects++),/session-invalid/);
 pending[0](recover.state.session);await new Promise(resolve=>setTimeout(resolve,0));
 await assert.rejects(recover.access.run(request(),()=>effects++),/session-invalid/);
 assert.equal(pending.length,64,'Settled underlying work releases exactly one callback slot');
 hanging=false;for(const release of pending)release(recover.state.session);await new Promise(resolve=>setTimeout(resolve,0));
 assert.equal(await recover.access.run(request(),()=>++effects),1);
});
