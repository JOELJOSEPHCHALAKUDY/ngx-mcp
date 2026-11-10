import {integrationValidateInput} from './integration-catalog.js';

export type IntegrationAccessOperation = 'describe' | 'read-value' | 'read-model' | 'fill' | 'activate' | 'submit' | 'press-key' | 'upload-file' | 'read-view' | 'navigate';
export interface IntegrationAccessRule {
  sourceId: string;
  /** Reviewed static metadata label; dynamic UI text is a data read. */
  label?: string;
  operations: IntegrationAccessOperation[];
  readFields?: string[];
  writeFields?: string[];
  /** RFC 6901 JSON pointers. An empty pointer explicitly permits the whole model. */
  modelPaths?: string[];
}
export interface IntegrationAccessPolicy {
  version: 1;
  allowedOrigins: string[];
  routePrefixes?: string[];
  rules: IntegrationAccessRule[];
  sessionMaxAgeMs?: number;
  approvalMaxAgeMs?: number;
  maxInputBytes?: number;
  maxAuditRecords?: number;
}
export interface IntegrationAccessSession { id: string; subject: string; expiresAt: number }
export interface IntegrationAccessRequest {
  operation: IntegrationAccessOperation | 'catalog';
  sourceId: string;
  instanceId?: string;
  args: unknown;
}
export interface IntegrationAccessChallenge {
  id: string;
  operation: IntegrationAccessOperation;
  sourceId: string;
  instanceId?: string;
  args: unknown;
  requestHash: string;
  expiresAt: number;
}
export interface IntegrationAccessAuditEvent {
  sequence: number;
  time: number;
  event: 'allowed' | 'denied' | 'completed' | 'failed' | 'revoked';
  operation?: string;
  sourceId?: string;
  requestHash?: string;
  code: string;
}
export interface IntegrationAccessEnvironment {
  session: IntegrationAccessSession;
  validateSession(options?: {signal: AbortSignal}): Promise<IntegrationAccessSession | null>;
  authorize?(request: Readonly<IntegrationAccessRequest>, session: Readonly<IntegrationAccessSession>, options?: {signal: AbortSignal}): Promise<boolean>;
  approve?(challenge: Readonly<IntegrationAccessChallenge>, options?: {signal: AbortSignal}): Promise<boolean>;
  audit(event: Readonly<IntegrationAccessAuditEvent>, options?: {signal: AbortSignal}): void | Promise<void>;
  origin(): string;
  route?(): string;
  now?(): number;
  crypto?: Crypto;
}

/** Reject unknown/private configuration before it can be serialized into a browser bundle. */
export function validateIntegrationAccessPolicy(policy:unknown):asserts policy is IntegrationAccessPolicy {
  const stringList={type:'array',items:{type:'string',minLength:1,maxLength:1024}};
  integrationValidateInput({type:'object',properties:{version:{const:1},allowedOrigins:{...stringList,minItems:1},routePrefixes:stringList,rules:{type:'array',items:{type:'object',properties:{sourceId:{type:'string',minLength:1,maxLength:1024},label:{type:'string',minLength:1,maxLength:240},operations:{type:'array',items:{enum:['describe','read-value','read-model','fill','activate','submit','press-key','upload-file','read-view','navigate']}},readFields:stringList,writeFields:stringList,modelPaths:{type:'array',items:{type:'string',maxLength:1024}}},required:['sourceId','operations'],additionalProperties:false}},sessionMaxAgeMs:{type:'integer',minimum:1,maximum:86400000},approvalMaxAgeMs:{type:'integer',minimum:1,maximum:300000},maxInputBytes:{type:'integer',minimum:1,maximum:16777216},maxAuditRecords:{type:'integer',minimum:1,maximum:100000}},required:['version','allowedOrigins','rules'],additionalProperties:false},policy);
  const config=policy as IntegrationAccessPolicy;
  if(new Set(config.allowedOrigins).size!==config.allowedOrigins.length)throw new Error('Duplicate access policy origins');
  for(const origin of config.allowedOrigins){const url=new URL(origin);if(origin.includes('*')||url.origin!==origin||url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Access policy origins must be exact HTTPS origins or local HTTP origins');}
  const sources=new Set<string>();
  for(const rule of config.rules){if(rule.sourceId.includes('*')||sources.has(rule.sourceId))throw new Error('Access rules require unique exact source IDs');sources.add(rule.sourceId);if(new Set(rule.operations).size!==rule.operations.length)throw new Error('Duplicate access rule operation');for(const fields of [rule.readFields,rule.writeFields])if(fields&&new Set(fields).size!==fields.length)throw new Error('Duplicate access field scope');if(rule.modelPaths){if(new Set(rule.modelPaths).size!==rule.modelPaths.length)throw new Error('Duplicate model path');for(const path of rule.modelPaths)if(path!==''&&!path.startsWith('/')||/~(?![01])/.test(path))throw new Error('Invalid access policy JSON pointer');}}
  if(config.routePrefixes){if(new Set(config.routePrefixes).size!==config.routePrefixes.length)throw new Error('Duplicate access route');for(const route of config.routePrefixes)if(!route.startsWith('/')||route.startsWith('//')||/[?#\\]/.test(route)||route.includes('*')||route!=='/'&&route.endsWith('/'))throw new Error('Access policy routes must be explicit path prefixes');}
}

/** Shared browser evaluator; this code contains no credentials or Node dependencies. */
export function integrationAccessSource(): string { return ACCESS_RUNTIME; }

const ACCESS_RUNTIME = String.raw`
/** Automation consent is an additional boundary; backend authorization stays authoritative. */
function createIntegrationAccess(inputPolicy:any,environment:any):any{
 const cryptoApi:Crypto=environment&&environment.crypto||globalThis.crypto;
 if(!cryptoApi||typeof cryptoApi.getRandomValues!=='function'||!cryptoApi.subtle)throw new Error('Access controls require secure browser cryptography');
 const now=()=>environment&&typeof environment.now==='function'?environment.now():Date.now();
 const mutating=new Set(['fill','activate','submit','press-key','upload-file','navigate']);
 const operations=new Set(['describe','read-value','read-model','fill','activate','submit','press-key','upload-file','read-view','navigate']);
 const records:any[]=[],permits=new Map<object,any>();let sequence=0,revoked=false,auditBroken=false,epoch=0,authorizations=0;
 const controllers=new Set<AbortController>();
 const salt=Array.from(cryptoApi.getRandomValues(new Uint32Array(8)),value=>value.toString(16).padStart(8,'0')).join('');
 function freeze(value:any):any{if(value&&typeof value==='object'){for(const key of Object.keys(value))freeze(value[key]);Object.freeze(value);}return value;}
 function canonical(value:any,budget=16777216):string{
  const seen=new Set<object>();let nodes=0,characters=0;
  function visit(current:any,depth:number):string{
   if(++nodes>10000||depth>32)throw new Error('Access input exceeds the JSON complexity budget');
   if(current===null)return 'null';if(typeof current==='boolean')return current?'true':'false';
   if(typeof current==='number'){if(!Number.isFinite(current))throw new Error('Access input must contain finite JSON numbers');return JSON.stringify(current);}
   if(typeof current==='string'){characters+=current.length;if(characters>budget)throw new Error('Access input exceeds the JSON byte budget');return JSON.stringify(current);}
   if(!current||typeof current!=='object')throw new Error('Access input must contain plain JSON data');
   const array=Array.isArray(current),prototype=Object.getPrototypeOf(current);
   if(!array&&prototype!==Object.prototype&&prototype!==null)throw new Error('Access input must contain plain JSON objects');
   if(seen.has(current))throw new Error('Access input cannot contain repeated or cyclic objects');seen.add(current);
   const descriptors=Object.getOwnPropertyDescriptors(current),keys=Reflect.ownKeys(current),parts:string[]=[];
   if(keys.length>10001)throw new Error('Access input exceeds the JSON property budget');
   if(array){
    const size=descriptors['length']&&descriptors['length'].value;
    if(!Number.isSafeInteger(size)||size>10000)throw new Error('Access input exceeds the JSON array budget');
    for(const key of keys){if(key==='length')continue;if(typeof key!=='string'||!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=size)throw new Error('Access input array contains non-JSON properties');}
    for(let index=0;index<size;index++){const descriptor=descriptors[String(index)];if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)throw new Error('Access input cannot contain sparse arrays or accessors');parts.push(visit(descriptor.value,depth+1));}
    return '['+parts.join(',')+']';
   }
   const names:string[]=[];for(const key of keys){if(typeof key!=='string')throw new Error('Access input contains a symbol property');const descriptor=descriptors[key];if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)throw new Error('Access input cannot contain accessors or hidden properties');names.push(key);}
   names.sort();for(const key of names){characters+=key.length;if(characters>budget)throw new Error('Access input exceeds the JSON byte budget');parts.push(JSON.stringify(key)+':'+visit(descriptors[key]!.value,depth+1));}
   return '{'+parts.join(',')+'}';
  }
  const result=visit(value,0);if(new TextEncoder().encode(result).byteLength>budget)throw new Error('Access input exceeds the JSON byte budget');return result;
 }
 function clone(value:any,budget?:number):any{return JSON.parse(canonical(value,budget));}
 function strings(value:any,label:string):string[]{if(!Array.isArray(value))throw new Error('Access policy '+label+' must be an array');const result:string[]=[];for(const item of value){if(typeof item!=='string'||!item||item.length>1024||result.includes(item))throw new Error('Access policy '+label+' must contain unique nonempty strings');result.push(item);}return result;}
 function bounded(value:any,fallback:number,maximum:number,label:string):number{if(value===undefined)return fallback;if(!Number.isSafeInteger(value)||value<1||value>maximum)throw new Error('Access policy '+label+' is invalid');return value;}
 const policy=clone(inputPolicy,1048576);
 if(!policy||policy.version!==1||!Array.isArray(policy.rules))throw new Error('A version 1 access policy with explicit rules is required');
 for(const key of Object.keys(policy))if(!['version','allowedOrigins','routePrefixes','rules','sessionMaxAgeMs','approvalMaxAgeMs','maxInputBytes','maxAuditRecords'].includes(key))throw new Error('Unknown access policy property: '+key);
 const origins=strings(policy.allowedOrigins,'allowedOrigins');if(!origins.length)throw new Error('Access policy must allow at least one exact origin');
 for(const origin of origins){const url=new URL(origin);if(origin.includes('*')||url.origin!==origin||url.username||url.password||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Access policy origins must be exact HTTPS origins or local HTTP origins');}
 const routes=policy.routePrefixes===undefined?undefined:strings(policy.routePrefixes,'routePrefixes');
 if(routes)for(const route of routes)if(!route.startsWith('/')||route.startsWith('//')||/[?#\\]/.test(route)||route.includes('*')||route!=='/'&&route.endsWith('/'))throw new Error('Access policy routes must be explicit path prefixes');
 const ruleMap=new Map<string,any>();
 for(const rule of policy.rules){
  if(!rule||typeof rule!=='object'||Array.isArray(rule))throw new Error('Invalid access policy rule');
  for(const key of Object.keys(rule))if(!['sourceId','label','operations','readFields','writeFields','modelPaths'].includes(key))throw new Error('Unknown access policy rule property: '+key);
  if(typeof rule.sourceId!=='string'||!rule.sourceId||rule.sourceId.length>1024||rule.sourceId.includes('*')||ruleMap.has(rule.sourceId))throw new Error('Access rules require unique exact source IDs');
  if(rule.label!==undefined&&(typeof rule.label!=='string'||!rule.label||rule.label.length>240))throw new Error('Access policy labels must be reviewed nonempty strings');
  rule.operations=strings(rule.operations,'operations');for(const operation of rule.operations)if(!operations.has(operation))throw new Error('Unknown access operation: '+operation);
  for(const name of ['readFields','writeFields'])if(rule[name]!==undefined)rule[name]=strings(rule[name],name);
  if(rule.modelPaths!==undefined){if(!Array.isArray(rule.modelPaths))throw new Error('Access policy modelPaths must be JSON pointers');const seen=new Set<string>();for(const path of rule.modelPaths){if(typeof path!=='string'||path.length>1024||path!==''&&!path.startsWith('/')||/~(?![01])/.test(path)||seen.has(path))throw new Error('Access policy modelPaths must contain unique JSON pointers');seen.add(path);}}
  ruleMap.set(rule.sourceId,rule);
 }
 freeze(policy);
 const sessionMaxAge=bounded(policy.sessionMaxAgeMs,900000,86400000,'sessionMaxAgeMs'),approvalMaxAge=bounded(policy.approvalMaxAgeMs,60000,300000,'approvalMaxAgeMs'),inputBudget=bounded(policy.maxInputBytes,1048576,16777216,'maxInputBytes'),auditBudget=bounded(policy.maxAuditRecords,10000,100000,'maxAuditRecords');
 if(!environment||typeof environment.validateSession!=='function'||typeof environment.audit!=='function'||typeof environment.origin!=='function')throw new Error('Production access requires trusted session validation, origin, and audit hooks');
 const validateHook=environment.validateSession.bind(environment),auditHook=environment.audit.bind(environment),originHook=environment.origin.bind(environment),routeHook=typeof environment.route==='function'?environment.route.bind(environment):()=>'/';
 const approveHook=typeof environment.approve==='function'?environment.approve.bind(environment):undefined,authorizeHook=typeof environment.authorize==='function'?environment.authorize.bind(environment):undefined;
 const initialSession=clone(environment.session,8192),createdAt=now();
 if(!validSession(initialSession)||initialSession.expiresAt<=createdAt)throw new Error('A live trusted access session is required');
 let sessionExpiry=Math.min(initialSession.expiresAt,createdAt+sessionMaxAge);
 function boundedHook(hook:any,args:any[],milliseconds:number,code:string):Promise<any>{
  if(controllers.size>=64)return Promise.reject(new Error('access-busy'));
  const controller=new AbortController();controllers.add(controller);
  return new Promise((resolve,reject)=>{
   let settled=false;
   // A timeout rejects this operation immediately, but its trusted callback may
   // ignore AbortSignal. Keep its capacity reservation until the work settles.
   const finish=(ok:boolean,value:any)=>{if(settled)return;settled=true;clearTimeout(timer);controller.signal.removeEventListener('abort',aborted);if(ok)resolve(value);else reject(value);};
   const aborted=()=>finish(false,new Error('access-revoked'));
   const timer=setTimeout(()=>{finish(false,new Error(code));controller.abort();},Math.max(1,milliseconds));
   controller.signal.addEventListener('abort',aborted,{once:true});
   Promise.resolve().then(()=>hook(...args,{signal:controller.signal})).then(value=>finish(true,value),()=>finish(false,new Error(code))).finally(()=>{controllers.delete(controller);});
  });
 }
 function validSession(session:any):boolean{return !!session&&typeof session==='object'&&typeof session.id==='string'&&session.id.length>0&&session.id.length<=1024&&typeof session.subject==='string'&&session.subject.length>0&&session.subject.length<=1024&&Number.isSafeInteger(session.expiresAt);}
 function boundary(){
  if(revoked)throw new Error('access-revoked');if(auditBroken)throw new Error('audit-unavailable');
  const time=now();if(!Number.isSafeInteger(time)||time<createdAt||time>=sessionExpiry)throw new Error('session-expired');
  const origin=originHook();if(!origins.includes(origin))throw new Error('origin-denied');
  const route=routeHook();
  if(typeof route!=='string'||!route.startsWith('/')||route.startsWith('//')||routes&&!routes.some(prefix=>prefix==='/'||route===prefix||route.startsWith(prefix+'/')))throw new Error('route-denied');
 }
 function allows(operation:string,sourceId:string):boolean{try{boundary();const rule=ruleMap.get(sourceId);return !!rule&&rule.operations.includes(operation);}catch{return false;}}
 async function validateSession(){
  boundary();let session:any;try{session=await boundedHook(validateHook,[],Math.min(5000,approvalMaxAge),'session-invalid');}catch{throw new Error('session-invalid');}boundary();
  if(!validSession(session)||session.id!==initialSession.id||session.subject!==initialSession.subject||session.expiresAt<=now())throw new Error('session-invalid');
  sessionExpiry=Math.min(sessionExpiry,session.expiresAt);boundary();return freeze({id:initialSession.id,subject:initialSession.subject,expiresAt:sessionExpiry});
 }
 async function fingerprint(value:string):Promise<string>{const buffer=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode(salt+'\n'+value));return Array.from(new Uint8Array(buffer),byte=>byte.toString(16).padStart(2,'0')).join('');}
 function id():string{return Array.from(cryptoApi.getRandomValues(new Uint32Array(4)),value=>value.toString(16).padStart(8,'0')).join('');}
 async function audit(event:string,request:any,requestHash:string|undefined,code:string){
  if(records.length>=auditBudget){auditBroken=true;throw new Error('audit-unavailable');}
  const knownSource=request&&(request.sourceId==='@page'||ruleMap.has(request.sourceId));
  const record=freeze({sequence:++sequence,time:now(),event,...request?{operation:request.operation,...knownSource?{sourceId:request.sourceId}:{}}:{},...requestHash?{requestHash}:{},code});
  records.push(record);
  try{await boundedHook(auditHook,[record],Math.min(5000,approvalMaxAge),'audit-unavailable');}catch{auditBroken=true;throw new Error('audit-unavailable');}
 }
 function normalized(request:any):any{
  const result=clone(request,inputBudget);
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('invalid-request');
  for(const key of Object.keys(result))if(!['operation','sourceId','instanceId','args'].includes(key))throw new Error('invalid-request');
  if(typeof result.operation!=='string'||!operations.has(result.operation)&&result.operation!=='catalog'||typeof result.sourceId!=='string'||!result.sourceId||result.sourceId.length>1024||result.instanceId!==undefined&&(typeof result.instanceId!=='string'||!result.instanceId||result.instanceId.length>2048)||!Object.hasOwn(result,'args'))throw new Error('invalid-request');
  if(result.operation==='catalog'&&result.sourceId!=='@page')throw new Error('invalid-request');
  return freeze(result);
 }
 function permitted(request:any){if(request.operation==='catalog'&&request.sourceId==='@page')return;if(!allows(request.operation,request.sourceId))throw new Error('operation-denied');}
 async function permittedFresh(request:any,session:any){permitted(request);if(authorizeHook&&await boundedHook(authorizeHook,[request,session],Math.min(5000,approvalMaxAge),'operation-denied')!==true)throw new Error('operation-denied');boundary();permitted(request);}
 function safeCode(error:any):string{const code=error instanceof Error?error.message:'';return ['access-revoked','audit-unavailable','session-expired','session-invalid','origin-denied','route-denied','invalid-request','operation-denied','approval-unavailable','approval-denied','approval-expired','approval-stale','permit-invalid','permit-used','request-changed','access-busy'].includes(code)?code:'invalid-request';}
 async function authorize(input:any):Promise<object>{
  if(authorizations>=16)throw new Error('access-busy');
  authorizations++;
  let request:any,requestHash:string|undefined;
  try{
   request=normalized(input);await permittedFresh(request,await validateSession());
   const canonicalRequest=canonical(request,inputBudget);requestHash=await fingerprint(canonicalRequest);const approvedEpoch=epoch;
   let expiresAt=Math.min(sessionExpiry,now()+approvalMaxAge);
   if(mutating.has(request.operation)){
    if(!approveHook)throw new Error('approval-unavailable');
    const challenge=freeze({id:id(),operation:request.operation,sourceId:request.sourceId,...request.instanceId?{instanceId:request.instanceId}:{},args:request.args,requestHash,expiresAt});
    if(await boundedHook(approveHook,[challenge],Math.min(approvalMaxAge,expiresAt-now()),'approval-expired')!==true)throw new Error('approval-denied');
    if(now()>=expiresAt)throw new Error('approval-expired');if(epoch!==approvedEpoch)throw new Error('approval-stale');
    await permittedFresh(request,await validateSession());expiresAt=Math.min(expiresAt,sessionExpiry);
   }
   await audit('allowed',request,requestHash,'authorized');boundary();
   if(epoch!==approvedEpoch||now()>=expiresAt)throw new Error('approval-stale');
   for(const [ticket,entry]of permits)if(now()>=entry.expiresAt)permits.delete(ticket);if(permits.size>=64)throw new Error('access-busy');
   const permit=freeze({id:id()});permits.set(permit,{request,canonicalRequest,requestHash,expiresAt,epoch:approvedEpoch});return permit;
  }catch(error){
   if(!auditBroken)await audit('denied',request,requestHash,safeCode(error));
   throw new Error(safeCode(error));
  }finally{authorizations--;}
 }
 async function consume(permit:object,input:any):Promise<any>{
  const entry=permits.get(permit);if(!entry)throw new Error('permit-invalid');permits.delete(permit);
  try{
   const request=normalized(input);if(canonical(request,inputBudget)!==entry.canonicalRequest)throw new Error('request-changed');
   if(epoch!==entry.epoch)throw new Error('approval-stale');if(now()>=entry.expiresAt)throw new Error('approval-expired');
   await permittedFresh(request,await validateSession());
   if(epoch!==entry.epoch||now()>=entry.expiresAt)throw new Error('approval-stale');return entry.request.args;
  }catch(error){if(!auditBroken)await audit('denied',entry.request,entry.requestHash,safeCode(error));throw new Error(safeCode(error));}
 }
 async function run(request:any,effect:(args:any)=>any):Promise<any>{
  const permit=await authorize(request),entry=permits.get(permit),args=await consume(permit,request);
  let result:any;
  try{result=await effect(args);}catch(error){if(!auditBroken)await audit('failed',entry.request,entry.requestHash,'execution-failed');throw error;}
  try{await audit('completed',entry.request,entry.requestHash,'executed');}catch{const error:any=new Error('audit-unavailable-after-execution');error.executionStarted=true;throw error;}
  return result;
 }
 async function revoke():Promise<void>{revoked=true;epoch++;permits.clear();for(const controller of controllers)controller.abort();if(!auditBroken)await audit('revoked',undefined,undefined,'session-revoked');}
 function redactSchemaValues(schema:any):void{
  if(!schema||typeof schema!=='object')return;
  for(const key of Object.keys(schema)){
   if(['enum','const','default','examples'].includes(key)){delete schema[key];continue;}
   const value=schema[key];
   if(['properties','patternProperties','$defs','definitions','dependentSchemas'].includes(key)){if(value&&typeof value==='object')for(const entry of Object.values(value))redactSchemaValues(entry);}
   else if(Array.isArray(value))for(const entry of value)redactSchemaValues(entry);
   else redactSchemaValues(value);
  }
 }
 function redactDescriptor(sourceId:string,input:any,authorizedValues=false):any{
  if(!allows('describe',sourceId))return undefined;
  const descriptor=clone(input,1048576),rule=ruleMap.get(sourceId),readValues=authorizedValues&&allows('read-value',sourceId);
  if(!readValues){
   for(const name of ['value','modelValue','modelSize','options','aria','path'])delete descriptor[name];
   if(descriptor.validation)for(const list of [descriptor.validation.fields,descriptor.validation.groups])if(Array.isArray(list))for(const entry of list)delete entry.path;
   redactSchemaValues(descriptor.schema);
   descriptor.label=rule.label||String(descriptor.tagName||'control')+' '+sourceId;
  }else if(rule.label)descriptor.label=rule.label;
  if(Array.isArray(descriptor.fields))descriptor.fields=descriptor.fields.filter((field:any)=>typeof field.sourceId==='string'&&(!rule.readFields||rule.readFields.includes(field.sourceId))).map((field:any)=>redactDescriptor(field.sourceId,field)).filter((field:any)=>field!==undefined);
  if(Array.isArray(descriptor.operations))descriptor.operations=descriptor.operations.filter((operation:string)=>allows(operation,sourceId));
  return descriptor;
 }
 function allowsField(formSourceId:string,fieldSourceId:string,operation:string):boolean{
  const rule=ruleMap.get(formSourceId);if(!rule)return false;
  const fields=operation==='fill'?rule.writeFields:rule.readFields;
  return (!fields||fields.includes(fieldSourceId))&&allows(operation,fieldSourceId);
 }
 function projectModel(sourceId:string,input:any):any{
  if(!allows('read-model',sourceId))return {kind:'unknown',complete:false,reason:'The access policy does not expose this model'};
  const snapshot=clone(input,1048576);if(!Object.hasOwn(snapshot,'value'))return snapshot;
  const value=snapshot.value,paths=ruleMap.get(sourceId).modelPaths;
  if(value===null||typeof value!=='object')return paths&&!paths.includes('')?{kind:snapshot.kind,complete:false,reason:'The configured model paths do not expose this primitive'}:snapshot;
  if(!paths||!paths.length)return {kind:snapshot.kind,complete:false,reason:'The access policy requires explicit model paths'};
  if(paths.includes(''))return snapshot;
  const projection:any=Object.create(null);
  for(const path of paths){
   const parts=path.slice(1).split('/').map((part:string)=>part.replace(/~1/g,'/').replace(/~0/g,'~'));let current=value,found=true;
   for(const part of parts){if(!current||typeof current!=='object'||!Object.hasOwn(current,part)){found=false;break;}current=current[part];}
   if(found)Object.defineProperty(projection,path,{value:current,enumerable:true,writable:true,configurable:true});
  }
  return {kind:snapshot.kind,value:projection,complete:false,projected:true,reason:'Model values are keyed by the permitted JSON pointers'};
 }
 return {allows,allowsField,authorize,consume,run,revoke,redactDescriptor,projectModel,auditRecords:()=>records.slice(),state:()=>{let live=false;try{boundary();live=true;}catch{}return {revoked,auditAvailable:!auditBroken,expiresAt:sessionExpiry,live};}};
}
`;
