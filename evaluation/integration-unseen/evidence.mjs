import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {assertPayloadState} from './oracles.mjs';

const mutatingNames=new Set(['angular_fill','angular_activate','angular_submit','angular_upload_file','angular_press_key','angular_navigate']);
const successful=call=>call.result&&!call.result.isError&&call.result.structuredContent?.status==='ui-dispatched';
const isMutation=call=>mutatingNames.has(call.name)||call.name?.startsWith('angular_form_');
const sameValue=(actual,expected)=>isDeepStrictEqual(actual,expected)||(typeof expected==='number'&&typeof actual==='string'&&actual===String(expected));
const invalidField=field=>field.status==='INVALID'&&((field.errors?.length??0)>0||(field.nativeErrors?.length??0)>0);

/** Read DOM data only. No Angular debug objects, setters, application methods or form-model writes. */
export async function nativeControlSnapshot(locator){
 try{return await locator.evaluate(element=>{const owner=element.closest('[formControlName]')??element,control=element.matches('input,textarea,select')?element:element.querySelector('input,textarea,select');return {connected:element.isConnected,tag:element.tagName.toLowerCase(),type:element.getAttribute('type'),key:owner.getAttribute('formControlName'),value:control?.type==='checkbox'?control.checked:control?.value,invalid:owner.classList.contains('ng-invalid')||element.classList.contains('ng-invalid')||element.getAttribute('aria-invalid')==='true'||!!control?.validity&&!control.validity.valid,disabled:element.matches(':disabled')||element.getAttribute('aria-disabled')==='true',text:element.textContent?.replace(/\s+/g,' ').trim().slice(0,240)};});}catch{return undefined;}
}
/** Trace the independent reference path, including nested submit->fill/click attempts. */
export function traceNativeDriver(driver,calls){
 const fields=[];let proxy;
 proxy=new Proxy(driver,{get(target,key){
  if(key==='inspectValidation')return async patch=>{const settled=[];for(const name of Object.keys(patch)){const field=fields.filter(item=>item.key===name).at(-1);settled.push({key:name,requested:field?.requested,...await nativeControlSnapshot(field?.handle)});}return nativeValidationEvidence(patch,calls,settled);};
  if(key==='close')return async()=>{await Promise.allSettled(fields.map(field=>field.handle.dispose()));await target.close?.();};
  const method=target[key];if(typeof method!=='function')return method;
  return async(...args)=>{
   const entry={name:'native_'+String(key),requested:key==='submit'?args[1]?.map(({value})=>({value})):args[1],before:await nativeControlSnapshot(args[0])};calls.push(entry);
   let owner;if(['fill','custom','choice','radio'].includes(String(key))&&entry.before?.key){try{owner=await args[0].evaluateHandle(element=>element.closest('[formControlName]')??element);}catch{}}
   try{const result=await Reflect.apply(method,proxy,args);entry.ok=true;if(owner){fields.push({key:entry.before.key,requested:entry.requested,handle:owner});owner=undefined;}return result;}catch(error){entry.ok=false;entry.error=String(error);throw error;}finally{entry.after=await nativeControlSnapshot(args[0]);await owner?.dispose();}
  };
 }});return proxy;
}
export function nativeValidationEvidence(patch,calls,settledFields=[]){return Object.entries(patch).map(([key,expected])=>{const attempts=calls.filter(call=>['native_fill','native_custom','native_choice','native_radio'].includes(call.name)&&call.before?.key===key),last=attempts.at(-1),settled=settledFields.find(field=>field.key===key),reached=last?.ok&&sameValue(last.requested,expected)&&sameValue(settled?.requested,expected)&&settled?.key===key&&settled.connected===true;return {key,expected,reached:!!reached,invalid:!!reached&&settled.invalid===true,settled,attempts:attempts.map(call=>({name:call.name,requested:call.requested,before:call.before,after:call.after,ok:call.ok}))};});}
export async function observeSubmitRefusal(page,calls){const action=calls.filter(isMutation).at(-1),live=action?.result?.structuredContent;if(live?.operation!=='submit'||!live.target?.instanceId)return undefined;return page.evaluate(instanceId=>{const forms=[...document.querySelectorAll('[data-angular-mcp-instance]')].filter(node=>node.getAttribute('data-angular-mcp-instance')===instanceId&&node instanceof HTMLFormElement);if(forms.length!==1)return undefined;const buttons=[...forms[0].querySelectorAll('button[type=submit],input[type=submit]')].filter(node=>node.getClientRects().length);return {formInstanceId:instanceId,visibleSubmitters:buttons.length,disabledSubmitters:buttons.filter(node=>node.matches(':disabled')||node.getAttribute('aria-disabled')==='true').length};},live.target.instanceId);}

/** Fail closed: unchanged domain data and a preexisting invalid form are insufficient. */
export function assessNegative({mode,negative,calls,actionError,inputEvidence=[],submitRefusal,oracle,before,after}){
 const no=reason=>({covered:false,reason});if(!isDeepStrictEqual(before,after))return no('Negative attempt changed domain state');
 const actions=calls.filter(mode==='reference'?call=>call.name?.startsWith('native_'):isMutation);
 if(negative.expected==='ambiguous-target-refused'){
  if(mode==='reference')return no('Protocol ambiguity has no native reference');
  const last=actions.at(-1),sourceId=last?.args?.target?.sourceId,instances=calls.filter(call=>call.name==='angular_list_nodes').map(call=>(call.result?.structuredContent?.nodes??[]).filter(node=>node.sourceId===sourceId)).find(nodes=>new Set(nodes.map(node=>node.instanceId)).size>1)??[];
  const reason=last?.result?.structuredContent?.reason??last?.result?.content?.filter(item=>item.type==='text').map(item=>item.text).join(' ');
  if(last?.name!=='angular_activate'||!sourceId||last.args.target.instanceId||!last.result?.isError||!/repeated|ambiguous/i.test(reason??'')||new Set(instances.map(node=>node.instanceId)).size<2)return no('An actual repeated-source MCP activation was not refused');
  return {covered:true,kind:'source-id-ambiguity',sourceId,liveInstances:new Set(instances.map(node=>node.instanceId)).size};
 }
 if(negative.decision==='reject'){
  if(actionError)return no('Cancellation had a transport/action failure');
  const last=actions.at(-1),activations=actions.filter(call=>mode==='reference'?call.name==='native_activate'&&call.ok:call.name==='angular_activate'&&successful(call));if((mode==='reference'?last?.name!=='native_activate'||!last.ok:last?.name!=='angular_activate'||!successful(last))||activations.length<2)return no('Both original delete and cancellation buttons were not reached');
  return {covered:true,kind:'explicit-cancel'};
 }
 if(oracle?.rejectionKind==='source-app'&&typeof oracle.feedback==='string'&&oracle.feedback.trim()){
  if(actionError)return no('Application rejection was not reached because transport failed');
  const expected=negative.id==='malformed-import'?'file':'activate';
  const file=negative.inputPatch?.file;const reached=mode==='reference'?actions.some(call=>call.ok&&call.name==='native_'+expected&&(expected!=='file'||isDeepStrictEqual(call.requested,file))):actions.some(call=>successful(call)&&(expected==='file'?call.name==='angular_upload_file'&&call.args?.files?.length===1&&call.args.files[0].name===file?.name&&call.args.files[0].mimeType===file?.mimeType&&call.args.files[0].base64===(file?.base64??Buffer.from(file?.text??'','utf8').toString('base64')):call.name==='angular_activate'));
  if(!reached)return no('Source rejection feedback lacks an actual input/action call');
  return {covered:true,kind:'source-app-rejection',feedback:oracle.feedback};
 }
 const keys=Object.keys(negative.inputPatch??{});if(!keys.length)return no('Negative has neither patched fields nor explicit source rejection');
 const fields=keys.map(key=>{const evidence=inputEvidence.find(item=>item.key===key);if(mode==='reference'){const attempt=evidence?.attempts?.at(-1),settled=evidence?.settled,expected=negative.inputPatch[key],reached=attempt?.ok&&attempt.before?.key===key&&sameValue(attempt.requested,expected)&&settled?.connected===true&&settled.key===key&&sameValue(settled.requested,expected);return reached?{key,reached:true,invalid:settled.invalid===true}:undefined;}const d=evidence?.description,model=evidence?.model;if(!d||evidence.ambiguous||d.path?.at(-1)!==key)return undefined;const expected=negative.inputPatch[key],reached=model?.complete&&sameValue(model.value,expected)||sameValue(d.value,expected);return {key,reached:!!reached,invalid:(d.validation?.fields??[]).some(field=>field.instanceId===d.instanceId&&invalidField(field))};});
 const groupInvalid=mode==='reference'?oracle?.rejectionKind==='source-group-validator'&&typeof oracle.feedback==='string'&&!!oracle.feedback.trim():inputEvidence.some(item=>(item.description?.validation?.groups??[]).some(group=>group.status==='INVALID'&&(group.errors?.length??0)>0));
 if(fields.some(field=>!field?.reached)||(!fields.some(field=>field.invalid)&&!groupInvalid))return no('Exact patched fields and their actual invalid state were not observed');
 if(mode==='reference'){
  const submit=actions.find(call=>call.name==='native_submit'),button=actions.filter(call=>call.name==='native_activate'&&call.before?.type==='submit').at(-1);
  if(!submit||!button)return no('The original submit button was not attempted');
  if(actionError&&!(button.ok===false&&button.before?.disabled===true))return no('Unknown native mapper/transport failure');
 }else{
  const last=actions.at(-1),live=last?.result?.structuredContent;
  if(live?.operation!=='submit'||!['ui-dispatched','partial','not-dispatched'].includes(live.status))return no('The intended MCP form submit was not reached');
  if(actionError){
   const supplied=last.name==='angular_submit'?(last.args?.values??[]).map(value=>value.target?.instanceId):Object.keys(last.args??{}).map(key=>{const matches=(live.validation?.fields??[]).filter(field=>field.path?.join('.')===key);return matches.length===1?matches[0].instanceId:undefined;});
   const fillPhaseCompleted=supplied.every(instanceId=>instanceId&&(live.changed??[]).includes(instanceId));
   const disabled=submitRefusal?.formInstanceId===live.target?.instanceId&&submitRefusal.visibleSubmitters===1&&submitRefusal.disabledSubmitters===1&&live.reason==='The application made this target unavailable, disabled, or readonly';
   const nativeRefusal=live.reason==='The original UI action did not submit the form; validation or an authored handler prevented it';
   if(!last.result?.isError||live.validation?.status!=='invalid'||!fillPhaseCompleted||(!disabled&&!nativeRefusal))return no('Unknown MCP mapper/transport failure or incomplete form fill');
  }
 }
 return {covered:true,kind:'patched-field-validator',fields,...groupInvalid?{groupValidator:true}:{}};
}

/** The native denominator is fixed independently of what happened to pass in one run. */
export function validateProjectReports(project,gold,reports,{requireParity=false}={}){
 const operations=new Map(gold.operations.map(op=>[op.id,op])),negatives=new Map(gold.negativeCases.map(test=>[test.id,test])),ids=[...operations.keys(),...negatives.keys()].sort(),gaps=[];
 assert.equal(new Set(ids).size,ids.length,'Frozen duplicate case ID');
 for(const phase of ['reference','raw','ui']){
  const report=reports[phase];assert.equal(report.projects.length,1);assert.equal(report.projects[0].id,project.id);assert.equal(report.mode,phase==='reference'?'reference':'mcp');
  const cases=report.projects[0].cases;assert.deepEqual(cases.map(test=>test.id).sort(),ids,'Missing/duplicate frozen cases');
  for(const test of cases){
   const negative=negatives.get(test.id),operation=operations.get(negative?.operation??test.id);assert.equal(test.operation,operation.id);assert.equal(test.kind,negative?'negative':'positive');assert.deepEqual(test.frozenInput,operation.validInput,'Frozen business input changed');assert.deepEqual(test.inputPatch,negative?.inputPatch,'Frozen negative patch changed');assert.deepEqual(test.businessInput,{...operation.validInput,...negative?.inputPatch},'Effective business input changed');
   assert(['passed','reference-failed','integration-failed','blocked-before-validation','protocol-boundary-not-applicable'].includes(test.status));
   if(test.status==='protocol-boundary-not-applicable')assert(phase==='reference'&&negative?.expected==='ambiguous-target-refused','Only native ambiguity cases can be not applicable');
   if(test.status==='passed'){
    assert(test.oracle,'Passed case lacks a business oracle');
    if(!negative){assert.equal(test.oracle.businessEffect,true);assert.equal(test.oracle.payloadVerified,true);assertPayloadState(project.id,operation.id,test.businessInput,test.before,test.after,test.setup?.meta);if(project.id==='finance'&&operation.id==='transactions-export'){assert.equal(typeof test.oracle.csvExport?.text,'string','Export needs independently replayable CSV evidence');const rows=test.before.transactions.slice().sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt)),expected=['date,description,amount,type,category,notes',...rows.map(row=>[row.date,row.description,(row.amountCents/100).toFixed(2),row.type,test.before.categories.find(category=>category.id===row.categoryId).name,row.notes??''].join(','))].join('\r\n').trim();assert.equal(test.oracle.csvExport.text.replace(/^\uFEFF/,'').trim(),expected,'Export bytes differ from exact business state');}}else{assert.equal(test.negativeExercised,true);const evidence=assessNegative({mode:phase==='reference'?'reference':'mcp',negative,calls:test.calls,actionError:test.actionError,inputEvidence:test.inputEvidence,submitRefusal:test.submitRefusal,oracle:test.oracle,before:test.before,after:test.after});assert.equal(evidence.covered,true,'Passed negative lacks reached-input/refusal evidence: '+project.id+'/'+test.id+' '+evidence.reason);assert.equal(test.negativeEvidence?.kind,evidence.kind);}
    if(phase!=='reference'){assert(test.calls.some(isMutation),'Passed case lacks actual SDK MCP mutation');assert(!test.calls.some(call=>call.name?.startsWith('native_')),'MCP action used native fallback');}
   }
   if(phase!=='reference'&&negative?.expected==='ambiguous-target-refused')assert.equal(test.status,'passed','MCP-only ambiguity boundary must pass: '+project.id+'/'+test.id+'/'+phase);
  }
 }
 const native=reports.reference.projects[0].cases;for(const test of native){const negative=negatives.get(test.id);if(negative?.expected==='ambiguous-target-refused'){assert.equal(test.status,'protocol-boundary-not-applicable');continue;}if(project.id==='shopping'&&test.id==='profile-avatar'){assert.equal(test.status,'reference-failed','The sole adjudicated source-blocked fixture must remain visible');continue;}assert.equal(test.status,'passed','Native quality failed outside the adjudicated avatar: '+project.id+'/'+test.id);const actual=reports.ui.projects[0].cases.find(item=>item.id===test.id);if(actual.status!=='passed')gaps.push({project:project.id,id:test.id,status:actual.status});}
 if(requireParity)assert.equal(gaps.length,0,'Native-passing cases failed through MCP');
 return {gaps,nativePositivePassed:native.filter(test=>test.kind==='positive'&&test.status==='passed').length,nativeNegativePassed:native.filter(test=>test.kind==='negative'&&test.status==='passed').length,nativeProtocolNotApplicable:native.filter(test=>test.status==='protocol-boundary-not-applicable').length};
}
