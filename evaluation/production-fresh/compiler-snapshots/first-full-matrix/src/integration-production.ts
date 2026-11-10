import type {IntegrationAccessPolicy} from './integration-access.js';
import {integrationAccessSource,validateIntegrationAccessPolicy} from './integration-access.js';

/** The owner bootstrap is a static module import; credentials and trusted hooks are never serialized. */
export function integrationProductionSource(policy:IntegrationAccessPolicy,buildId:string):string {
  validateIntegrationAccessPolicy(policy);
  if(typeof buildId!=='string'||!buildId||buildId.length>256)throw new Error('Production integration requires an explicit build ID');
  return integrationAccessSource()+'\n'+PRODUCTION_RUNTIME+'\ninstallIntegrationProduction('+JSON.stringify(policy)+','+JSON.stringify(buildId)+',__ngxMcpConnectAccess);\n';
}

const PRODUCTION_RUNTIME=String.raw`
/** Browser tool controls supplement, but do not replace, backend permissions or same-origin trust. */
function installIntegrationProduction(policy:any,buildId:string,bootstrap:()=>Promise<any>):any{
 const api:any=(globalThis as any).__angularMcpBridge;
 if(!api||api.version!==1)throw new Error('Production integration requires a compatible live registry');
 if(api.profile==='production')throw new Error('Production access is already installed for this document');
 const original={list:api.list.bind(api),describe:api.describe.bind(api),readModel:api.readModel.bind(api),execute:api.execute.bind(api),element:api.element.bind(api)};
 const pending=new Map<string,any>(),salt=Array.from(crypto.getRandomValues(new Uint32Array(8)),value=>value.toString(16).padStart(8,'0')).join('');
 let access:any,identity:any,locked=true,errorCode='production-access-not-ready';
 api.profile='production';api.buildId=buildId;
 const notify=()=>{if(typeof api.notifyChanged==='function')api.notifyChanged();};
 function unavailable():never{throw new Error(errorCode||'production-access-unavailable');}
 function ready(){if(locked||!access||!access.state().live)unavailable();return access;}
 function copy(value:any):any{
  const seen=new Set<any>();let count=0;
  function visit(current:any):any{
   if(++count>10000)throw new Error('Production input exceeds the JSON budget');
   if(current===null||typeof current==='string'||typeof current==='boolean'||typeof current==='number'&&Number.isFinite(current))return current;
   if(!current||typeof current!=='object')throw new Error('Production input must contain JSON data');
   const array=Array.isArray(current),prototype=Object.getPrototypeOf(current);if(!array&&prototype!==Object.prototype&&prototype!==null||seen.has(current))throw new Error('Production input must contain plain acyclic JSON data');seen.add(current);
   const descriptors=Object.getOwnPropertyDescriptors(current),result:any=array?[]:Object.create(null);
   for(const key of Reflect.ownKeys(current)){
    if(array&&key==='length')continue;if(typeof key!=='string')throw new Error('Production input contains a symbol property');
    const descriptor=descriptors[key];if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)throw new Error('Production input cannot contain accessors');
    if(descriptor.value===undefined&&!array)continue;
    if(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=current.length))throw new Error('Production input array contains unsupported properties');
    Object.defineProperty(result,key,{value:visit(descriptor.value),enumerable:true,writable:true,configurable:true});
   }
   if(array&&Object.keys(result).length!==current.length)throw new Error('Production input cannot contain sparse arrays');return result;
  }
  return visit(value);
 }
 function metadata(value:any):any{
  if(!value)return value;const result=copy(value);
  for(const key of ['value','modelValue','modelSize','options'])delete result[key];
  if(Array.isArray(result.fields))result.fields=result.fields.map((field:any)=>metadata(field));
  if(result.validation&&Array.isArray(result.validation.fields))result.validation.fields=result.validation.fields.filter((field:any)=>access&&access.allows('describe',field.sourceId)&&(result.kind!=='form'||access.allowsField(result.sourceId,field.sourceId,'describe')));
  return result;
 }
 function descriptor(target:any):any{return original.describe(copy(target));}
 function filteredList():any[]{
  if(locked||!access||!access.state().live)return [];
  return original.list().map((node:any)=>access.redactDescriptor(node.sourceId,node)).filter((node:any)=>node!==undefined).map((node:any)=>metadata(node));
 }
 async function guarded(request:any,effect:(args:any)=>any):Promise<any>{
  try{return await ready().run(request,effect);}catch(error){
   const code=error instanceof Error?error.message:'';
   if(['session-invalid','session-expired','access-revoked','audit-unavailable','audit-unavailable-after-execution'].includes(code)){if(!locked){locked=true;errorCode=code;notify();}}
   throw error;
  }
 }
 async function readable(sourceId:string,node:any):Promise<any>{
  let values=false;
  if(access.allows('read-value',sourceId))try{await guarded({operation:'read-value',sourceId,instanceId:node.instanceId,args:{target:{instanceId:node.instanceId}}},()=>true);values=true;}catch{/* Metadata remains useful when optional value access is denied. */}
  const result=access.redactDescriptor(sourceId,node,values);if(!result)return undefined;
  if(Array.isArray(result.fields)){const fields:any[]=[];for(const field of result.fields){const raw=(node.fields||[]).find((candidate:any)=>candidate.instanceId===field.instanceId);const child=raw&&await readable(field.sourceId,raw);if(child)fields.push(child);}result.fields=fields;}
  if(result.validation&&Array.isArray(result.validation.fields))result.validation.fields=result.validation.fields.filter((field:any)=>access.allows('describe',field.sourceId)&&(result.kind!=='form'||access.allowsField(result.sourceId,field.sourceId,'describe')));
  return result;
 }
 function nodeState(node:Element):any{
  const element=node as any,tag=node.tagName.toLowerCase();
  const state:any={tag,id:element.id||'',name:element.name||'',type:element.type||'',disabled:!!element.disabled,readonly:!!element.readOnly,hidden:!!element.hidden,ariaDisabled:node.getAttribute('aria-disabled'),text:(node.textContent||'').slice(0,20000)};
  if(['input','textarea','select'].includes(tag)){
   if(tag==='input'&&element.type==='file')state.files=Array.from(element.files||[]).map((file:any)=>({name:file.name,size:file.size,type:file.type,lastModified:file.lastModified}));
   else state.value=element.value;
   if(tag==='input')state.checked=!!element.checked;
   if(tag==='select')state.options=Array.from(element.options).map((option:any)=>({value:option.value,selected:option.selected,disabled:option.disabled}));
  }
  return state;
 }
 async function fingerprint(target:any):Promise<string>{
  let root:HTMLElement=document.body;
  if(target){const selected=original.element(target) as HTMLElement;if(!selected||!selected.isConnected)throw new Error('Production target is stale');root=(selected.closest('form,tr,[role="row"],li,[role="listitem"]')||selected) as HTMLElement;}
  const nodes=[root,...Array.from(root.querySelectorAll('input,textarea,select,button,[angularMcpSource]'))];
  if(nodes.length>3000)throw new Error('Production state exceeds the observation budget');
  const state={url:location.href,nodes:nodes.map(node=>nodeState(node))},value=JSON.stringify(state);
  if(value.length>2097152)throw new Error('Production state exceeds the observation budget');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(salt+'\n'+value));return Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
 }
 function formFor(node:HTMLElement):any{
  const element=node as any,form=element.form||(node.closest('form') as HTMLFormElement|null);if(!form)return undefined;
  return original.list().find((record:any)=>record.kind==='form'&&original.element({instanceId:record.instanceId})===form);
 }
 function submitFields(input:any,form:any){
  const allowed=new Set((form.fields||[]).map((field:any)=>field.instanceId));
  for(const entry of input.values||[]){const field=descriptor(entry.target);if(!allowed.has(field.instanceId)||!access.allowsField(form.sourceId,field.sourceId,'fill'))throw new Error('Production policy does not allow this form field write');}
 }
 function aliasCheck(operation:string,input:any,selected:any){
  if(!input.target)return;
  const node=original.element(input.target) as any;
  const nativeSubmit=node instanceof HTMLButtonElement&&node.type==='submit'||node instanceof HTMLInputElement&&['submit','image'].includes(node.type),key=typeof input.key==='string'?input.key.split('+').at(-1):'';
  const submits=operation==='activate'&&nativeSubmit||operation==='press-key'&&(key==='Enter'||nativeSubmit&&['Space','Spacebar',' '].includes(key||''));
  if(submits){const form=formFor(node);if(form&&(!access.allows('submit',form.sourceId)||!access.allows('describe',form.sourceId)))throw new Error('Production policy does not allow this form submission');}
  if(selected&&selected.kind==='form'&&operation==='submit')submitFields(input,selected);
 }
 function redactResult(result:any):any{
  if(!result||typeof result!=='object')return result;const value=copy(result);
  for(const name of ['url','value','modelValue','modelSize','options','label','title'])delete value[name];
  if(Array.isArray(value.values))value.values=value.values.filter((field:any)=>access.allows('describe',field.sourceId)).map((field:any)=>{for(const name of ['value','modelValue','modelSize','options','label'])delete field[name];return field;});
  if(Array.isArray(value.changed))value.changed=value.changed.filter((id:string)=>{try{return access.allows('describe',descriptor({instanceId:id}).sourceId);}catch{return false;}});
  if(value.validation&&Array.isArray(value.validation.fields))value.validation.fields=value.validation.fields.filter((field:any)=>access.allows('describe',field.sourceId)&&(!value.target||access.allowsField(value.target.sourceId,field.sourceId,'describe')));
  return value;
 }
 api.list=()=>filteredList();
 api.inspect=(target:any)=>{ready();const node=descriptor(target),result=access.redactDescriptor(node.sourceId,node);if(!result)throw new Error('Production policy does not expose this target');return metadata(result);};
 api.catalog=async()=>guarded({operation:'catalog',sourceId:'@page',args:{}},()=>filteredList());
 api.describe=async(target:any)=>{const node=descriptor(target);return guarded({operation:'describe',sourceId:node.sourceId,instanceId:node.instanceId,args:{target:copy(target)}},()=>readable(node.sourceId,node));};
 api.readModel=async(target:any)=>{const node=descriptor(target);return guarded({operation:'read-model',sourceId:node.sourceId,instanceId:node.instanceId,args:{target:copy(target)}},()=>access.projectModel(node.sourceId,original.readModel(target)));};
 api.element=(target:any)=>{api.inspect(target);return original.element(target);};
 api.execute=async(input:any)=>{
  ready();const request=copy(input);if(!['fill','activate','submit'].includes(request.operation))throw new Error('Unsupported production UI operation');
  const node=descriptor(request.target);
  const stateHash=await fingerprint(request.target);
  return guarded({operation:request.operation,sourceId:node.sourceId,instanceId:node.instanceId,args:{input:request,stateHash}},async(approved:any)=>{
   if(await fingerprint(approved.input.target)!==approved.stateHash)throw new Error('Production UI state changed after approval');
   const current=descriptor(approved.input.target);aliasCheck(approved.input.operation,approved.input,current);
   return redactResult(await original.execute(approved.input));
  });
 };
 api.toolAllowed=(name:string)=>{
  if(locked||!access||!access.state().live)return false;
  const operation=({angular_list_nodes:'catalog',angular_describe_node:'describe',angular_read_model:'read-model',angular_fill:'fill',angular_activate:'activate',angular_submit:'submit',angular_press_key:'press-key',angular_upload_file:'upload-file',angular_read_view:'read-view'} as any)[name];
  if(/^angular_form_[a-f0-9]{16}$/.test(name))return original.list().some((node:any)=>node.kind==='form'&&access.allows('describe',node.sourceId)&&access.allows('submit',node.sourceId));
  if(!operation)return false;if(operation==='catalog')return true;if(operation==='read-view')return access.allows(operation,'@page');
  return original.list().some((node:any)=>access.allows('describe',node.sourceId)&&access.allows(operation,node.sourceId));
 };
 api.beginExternal=async(operation:string,input:any)=>{
  ready();if(pending.size>=16)throw new Error('Production external operation limit reached');if(operation==='navigate')throw new Error('Production navigation requires an external audit lifecycle and is not enabled');
  if(!['press-key','upload-file','read-view'].includes(operation))throw new Error('Unsupported production external operation');
  const request=copy(input),selected=operation==='read-view'?undefined:descriptor(request.target),stateHash=await fingerprint(request.target);
  let resolveReady:(value:any)=>void=()=>{},rejectReady:(error:any)=>void=()=>{};
  const started=new Promise<any>((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  const execution=guarded({operation,sourceId:selected?selected.sourceId:'@page',...selected?{instanceId:selected.instanceId}:{},args:{input:request,stateHash}},async(approved:any)=>{
   if(await fingerprint(approved.input.target)!==approved.stateHash)throw new Error('Production UI state changed after approval');
   aliasCheck(operation,approved.input,selected);
   const id=Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(16).padStart(8,'0')).join('');
   return new Promise<any>((resolve,reject)=>{
    const timer=setTimeout(()=>{if(pending.delete(id))reject(new Error('Production external operation timed out'));},30000);
    pending.set(id,{resolve,reject,timer,execution:undefined});resolveReady({id,input:approved.input});
   });
  });
  execution.catch(rejectReady);
  const result=await started,entry=pending.get(result.id);if(!entry)throw new Error('Production external operation is no longer pending');entry.execution=execution;return result;
 };
 api.finishExternal=async(id:string,outcome:any)=>{
  const entry=pending.get(id);if(!entry)throw new Error('Production external operation is missing or already completed');pending.delete(id);clearTimeout(entry.timer);
  if(outcome&&outcome.ok===true)entry.resolve(redactResult(outcome.result));else entry.reject(new Error('Production external operation failed'));
  return entry.execution;
 };
 api.assertIdentity=async(expectedSubject?:string,expectedSessionId?:string)=>guarded({operation:'catalog',sourceId:'@page',args:{}},()=>{
  if(expectedSubject!==undefined&&identity.subject!==expectedSubject||expectedSessionId!==undefined&&identity.id!==expectedSessionId)throw new Error('Production session identity does not match the authenticated caller');
  return api.accessStatus();
 });
 api.accessStatus=()=>{const state=access&&access.state();return {profile:'production',buildId,ready:!locked&&!!state&&state.live,revoked:!!state&&state.revoked,...identity?{subject:identity.subject,sessionId:identity.id,expiresAt:state.expiresAt}:{},...locked?{error:errorCode}:{}};};
 api.revokeAccess=async()=>{locked=true;errorCode='access-revoked';for(const [id,entry]of pending){pending.delete(id);clearTimeout(entry.timer);entry.reject(new Error('Production access was revoked'));}if(access)await access.revoke();notify();};
 Promise.resolve().then(()=>bootstrap()).then(async(environment:any)=>{
  const ownerAuthorize=typeof environment.authorize==='function'?environment.authorize.bind(environment):undefined;
  const secured={...environment,authorize:async(request:any,session:any,options:any)=>{
   if(request.args&&request.args.input&&['fill','activate','submit','press-key','upload-file'].includes(request.operation)){
    const input=request.args.input,selected=input.target&&descriptor(input.target);aliasCheck(request.operation,input,selected);
   }
   return ownerAuthorize?await ownerAuthorize(request,session,options)===true:true;
  }};
  access=createIntegrationAccess(policy,secured);identity={id:environment.session.id,subject:environment.session.subject};
  await access.run({operation:'catalog',sourceId:'@page',args:{}},()=>true);locked=false;errorCode='';notify();
 }).catch(()=>{locked=true;errorCode='production-bootstrap-failed';notify();});
 return api;
}
`;
