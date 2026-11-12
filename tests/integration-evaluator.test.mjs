import {listCatalog} from '../evaluation/integration-unseen/catalog.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessNegative,traceNativeDriver,validateProjectReports} from '../evaluation/integration-unseen/evidence.mjs';
const unchanged={items:['original']},negative={id:'empty-name',operation:'create',inputPatch:{name:''},expected:'refused-without-domain-effect'};
const descriptor={instanceId:'field',path:['name'],value:'',validation:{fields:[{instanceId:'field',path:['name'],status:'INVALID',errors:[{code:'required'}]}],groups:[]}};
const inputEvidence=[{key:'name',description:descriptor,model:{complete:true,value:''}}];
const submit={name:'angular_submit',args:{target:{instanceId:'form'},values:[{target:{instanceId:'field'},value:''}]},result:{isError:true,structuredContent:{operation:'submit',status:'partial',changed:['field'],target:{instanceId:'form'},validation:{status:'invalid'},reason:'The application made this target unavailable, disabled, or readonly'}}};
const base={mode:'mcp',negative,before:unchanged,after:structuredClone(unchanged),oracle:{unchanged:true}};
test('unknown chooser error cannot become a validator pass from unchanged data and preexisting invalid UI',()=>{
 const evidence=assessNegative({...base,calls:[{name:'angular_read_view',result:{structuredContent:{view:{}}}}],actionError:'No visible registered ARIA options in the open chooser',inputEvidence:[]});assert.equal(evidence.covered,false);
});
test('a patched-invalid control still cannot hide a failure before actual submit',()=>{assert.equal(assessNegative({...base,calls:[{name:'angular_fill',result:{structuredContent:{status:'ui-dispatched'}}}],actionError:'UI option label missing',inputEvidence}).covered,false);});
test('actual requested field and exact disabled-submit refusal establish validation coverage',()=>{assert.equal(assessNegative({...base,calls:[submit],actionError:'disabled',inputEvidence,submitRefusal:{formInstanceId:'form',visibleSubmitters:1,disabledSubmitters:1}}).covered,true);});
test('an unrelated invalid field or wrong requested value cannot establish coverage',()=>{assert.equal(assessNegative({...base,calls:[submit],inputEvidence:[{key:'name',description:{...descriptor,value:'wrong'},model:{complete:true,value:'wrong'}}]}).covered,false);});
test('unknown transport failures cannot reuse stale app rejection feedback',()=>{assert.equal(assessNegative({...base,calls:[{name:'angular_upload_file',result:{structuredContent:{status:'ui-dispatched'}}}],actionError:'mapper crashed',oracle:{unchanged:true,rejectionKind:'source-app',feedback:'Invalid CSV'}}).covered,false);});
test('actual group-validator errors cover reached fields whose own controls remain valid',()=>{
 const grouped=[{key:'name',description:{...descriptor,validation:{fields:[{instanceId:'field',status:'VALID',errors:[]}],groups:[{status:'INVALID',errors:[{code:'duplicateName'}]}]}},model:{complete:true,value:''}}];
 assert.equal(assessNegative({...base,calls:[{...submit,result:{structuredContent:{operation:'submit',status:'ui-dispatched'}}}],inputEvidence:grouped}).covered,true);
});
function boundaryCase(id,operation,phase){const test={id,operation,kind:'negative',frozenInput:{},inputPatch:{},businessInput:{},before:[],after:[]};if(phase==='reference')return {...test,status:'protocol-boundary-not-applicable'};const calls=[{name:'angular_list_nodes',result:{structuredContent:{nodes:[{sourceId:'shared',instanceId:'one'},{sourceId:'shared',instanceId:'two'}]}}},{name:'angular_activate',args:{target:{sourceId:'shared'}},result:{isError:true,content:[{type:'text',text:'Source target is repeated; use an exact instance'}]}}];return {...test,status:'passed',calls,actionError:'Source target is repeated',oracle:{protocolBoundary:true},negativeExercised:true,negativeEvidence:{covered:true,kind:'source-id-ambiguity'}};}
function reportsFor(project='todo'){
 const id=project==='todo'?'ambiguous-source-id':'repeated-row-ambiguous',gold={operations:[{id:'create',validInput:{}}],negativeCases:[{id,operation:'create',inputPatch:{},expected:'ambiguous-target-refused'}]},reports={};
 for(const phase of ['reference','raw','ui'])reports[phase]={mode:phase==='reference'?'reference':'mcp',projects:[{id:project,cases:[{id:'create',operation:'create',kind:'positive',status:'passed',frozenInput:{},businessInput:{},before:{domain:{users:[],lists:[],archived:[],confirmations:[]}},after:{domain:{users:[],lists:[],archived:[],confirmations:[]}},oracle:{businessEffect:true,payloadVerified:true},calls:[{name:phase==='reference'?'native_activate':'angular_activate',result:{structuredContent:{status:'ui-dispatched'}}}]},boundaryCase(id,'create',phase)]}]};
 return {gold,reports,id};
}
for(const project of ['todo','shopping'])test(project+' MCP-only boundary must pass in both raw and UI matrices',()=>{
 for(const phase of ['raw','ui']){const {gold,reports,id}=reportsFor(project);reports[phase].projects[0].cases.find(test=>test.id===id).status='integration-failed';assert.throws(()=>validateProjectReports({id:project},gold,reports,{requireParity:true}),/MCP-only ambiguity boundary must pass/);}
});
test('strict native quality cannot become vacuous after source reference failures',()=>{const {gold,reports}=reportsFor();reports.reference.projects[0].cases[0].status='reference-failed';assert.throws(()=>validateProjectReports({id:'todo'},gold,reports,{requireParity:true}),/Native quality failed/);});
test('effective business input is checked alongside frozenInput',()=>{const {gold,reports}=reportsFor();reports.ui.projects[0].cases[0].businessInput={silentlyRewritten:true};assert.throws(()=>validateProjectReports({id:'todo'},gold,reports),/Effective business input changed/);});
test('valid repeated-source refusal and native quality pass strict validation',()=>{const {gold,reports}=reportsFor();assert.deepEqual(validateProjectReports({id:'todo'},gold,reports,{requireParity:true}),{gaps:[],nativePositivePassed:1,nativeNegativePassed:0,nativeProtocolNotApplicable:1});});
test('native tracing includes nested real driver calls and remains JSON serializable',async()=>{
 const locator={evaluate:async()=>({tag:'input',type:'text',key:'name',invalid:true})};locator.circular=locator;const calls=[];const driver=traceNativeDriver({async fill(){},async activate(){},async submit(form,values){for(const {locator,value}of values)await this.fill(locator,value);await this.activate(form);}},calls);await driver.submit(locator,[{locator,value:''}]);assert.deepEqual(calls.map(call=>call.name),['native_submit','native_fill','native_activate']);assert.doesNotThrow(()=>JSON.stringify(calls));
});

test('gate recomputes exact business payload instead of trusting passed/payloadVerified booleans',()=>{
 const args={username:'edited',name:'Edited Name',email:'edited@example.test',roles:[2]},before={domain:{users:[{id:1,name:'Neighbor'},{id:2,username:'member',name:'Original',email:'member@example.test',roles:[{id:2}]}],lists:[],archived:[],confirmations:[]}},after=structuredClone(before);Object.assign(after.domain.users[1],{...args,roles:[{id:2}]});
 const gold={operations:[{id:'admin-user-save',validInput:args}],negativeCases:[]},reports={};for(const phase of ['reference','raw','ui'])reports[phase]={mode:phase==='reference'?'reference':'mcp',projects:[{id:'shopping',cases:[{id:'admin-user-save',operation:'admin-user-save',kind:'positive',status:'passed',frozenInput:args,businessInput:args,before,after:structuredClone(after),oracle:{businessEffect:true,payloadVerified:true},calls:[{name:phase==='reference'?'native_activate':'angular_activate'}]}]}]};reports.ui.projects[0].cases[0].after.domain.users[1].name='WRONG';assert.throws(()=>validateProjectReports({id:'shopping'},gold,reports,{requireParity:true}),/name/);
});

test('a mid-fill unsupported mapper error cannot masquerade as disabled-submit validation',()=>{
 const failed={...submit,result:{...submit.result,structuredContent:{...submit.result.structuredContent,reason:'Unsupported native control or custom value accessor; a UI adapter is required'}}};assert.equal(assessNegative({...base,calls:[failed],actionError:'Unsupported mapper',inputEvidence,submitRefusal:{formInstanceId:'form',visibleSubmitters:1,disabledSubmitters:1}}).covered,false);
});
test('disabled readiness while filling a different field cannot masquerade as submit readiness',()=>{
 const failed={...submit,args:{...submit.args,values:[...submit.args.values,{target:{instanceId:'unfilled-other'},value:'valid'}]}};assert.equal(assessNegative({...base,calls:[failed],actionError:'disabled during fill',inputEvidence,submitRefusal:{formInstanceId:'form',visibleSubmitters:1,disabledSubmitters:1}}).covered,false);
});

test('native invalid state is refreshed after action on the exact successfully filled owner',async()=>{
 const state={connected:true,tag:'input',type:'text',key:'name',value:'',invalid:false};const handle={evaluate:async()=>structuredClone(state),dispose:async()=>{}},locator={evaluate:async()=>structuredClone(state),evaluateHandle:async()=>handle},calls=[];
 const driver=traceNativeDriver({async fill(){}},calls);await driver.fill(locator,'');assert.equal(calls[0].after.invalid,false);state.invalid=true;const evidence=await driver.inspectValidation({name:''});assert.equal(evidence[0].reached,true);assert.equal(evidence[0].invalid,true);assert.equal(evidence[0].attempts[0].after.invalid,false);await driver.close();
});
test('an unrelated invalid form never substitutes for a still-valid patched owner',async()=>{
 const state={connected:true,tag:'input',type:'text',key:'name',value:'',invalid:false},handle={evaluate:async()=>structuredClone(state),dispose:async()=>{}},locator={evaluate:async()=>structuredClone(state),evaluateHandle:async()=>handle},calls=[];
 const driver=traceNativeDriver({async fill(){},async submit(){}},calls);await driver.fill(locator,'');calls.push({name:'native_submit',ok:true,after:{invalid:true}},{name:'native_activate',ok:true,before:{type:'submit'}});const evidence=await driver.inspectValidation({name:''});assert.equal(evidence[0].invalid,false);assert.equal(assessNegative({...base,mode:'reference',calls,inputEvidence:evidence}).covered,false);await driver.close();
});
test('a replaced patched field cannot borrow a new invalid element from its locator',async()=>{
 const original={connected:true,tag:'input',type:'text',key:'name',value:'',invalid:false},replacement={...original,invalid:true},handle={evaluate:async()=>structuredClone(original),dispose:async()=>{}},locator={evaluate:async()=>structuredClone(replacement),evaluateHandle:async()=>handle},calls=[];
 const driver=traceNativeDriver({async fill(){}},calls);await driver.fill(locator,'');original.connected=false;const evidence=await driver.inspectValidation({name:''});assert.equal(evidence[0].reached,false);assert.equal(evidence[0].invalid,false);await driver.close();
});

test('catalog reader retains filters and follows pages beyond the first hundred nodes',async()=>{const seen=[];const result=await listCatalog(async(name,args)=>{seen.push({name,args});return args.offset===0?{nodes:Array.from({length:500},(_,i)=>({instanceId:'field-'+i})),total:501,offset:0,nextOffset:500}:{nodes:[{instanceId:'validation-field'}],total:501,offset:500,nextOffset:null};},{kind:'control',visible:true});assert.equal(result.nodes.length,501);assert.equal(result.nodes[500].instanceId,'validation-field');assert.equal(seen.length,2);assert(seen.every(item=>item.name==='angular_list_nodes'&&item.args.kind==='control'&&item.args.visible===true));});
test('catalog reader refuses nonadvancing, duplicate and changing snapshots',async()=>{await assert.rejects(listCatalog(async()=>({nodes:[],total:1,offset:0,nextOffset:0})),/advance/);await assert.rejects(listCatalog(async(_name,args)=>({nodes:[{instanceId:'duplicate'}],total:2,offset:args.offset,nextOffset:args.offset===0?1:null})),/Duplicate/);await assert.rejects(listCatalog(async(_name,args)=>({nodes:[{instanceId:String(args.offset)}],total:args.offset===0?2:3,offset:args.offset,nextOffset:1})),/changed/);});
