import {integrationToolCatalogSource} from './integration-catalog.js';

/** Browser-only publication. The emitted module uses the target app's live registry, never Node or Playwright. */
export function integrationWebMcpSource():string {
  return integrationToolCatalogSource()+'\n'+WEBMCP_RUNTIME;
}

const WEBMCP_RUNTIME=String.raw`
/** The registry and input schema describe UI interactions, not an inferred backend API. */
export function installAngularMcpWebMcp():any{
 const empty=(reason:string)=>({status:'unavailable',reason,registered:[] as string[],errors:[] as string[],refresh:async()=>{},dispose:()=>{}});
 if(typeof window==='undefined'||typeof document==='undefined')return empty('WebMCP requires a browser document');
 const api:any=bridge();
 if(!api||api.version!==1)return empty('A compatible generated Angular registry is required');
 if(!['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&api.profile!=='production'){const disabled=empty('A deployed app requires a production build with reviewed access controls');api.__angularMcpWebMcp=disabled;return disabled;}
 if(api.mode==='mcp'){const disabled=empty('This build enables the Node MCP adapter only');api.__angularMcpWebMcp=disabled;return disabled;}
 const previous=api.__angularMcpWebMcp;
 if(previous&&previous.status!=='disposed'&&previous.status!=='unavailable')return previous;
 let context:any,contextApi='';
 try{
  const current=(document as any).modelContext;
  if(current&&typeof current.registerTool==='function'){context=current;contextApi='document.modelContext';}
  else{const legacy=(navigator as any).modelContext;if(legacy&&typeof legacy.registerTool==='function'){context=legacy;contextApi='navigator.modelContext';}}
 }catch{/* Browser or document policy can make the native API unavailable. */}
 if(!context){const unavailable=empty('This browser does not expose a supported WebMCP API');api.__angularMcpWebMcp=unavailable;return unavailable;}
 type Entry={definition:any;signature:string;controller:AbortController;active:boolean;registered:boolean};
 const registered=new Map<string,Entry>(),origin=location.origin,ownerDocument=document;
 let active=true,scheduled=false,refreshNeeded=true,executions=0,mutation=false,queue:Promise<void>=Promise.resolve();
 const handle:any={status:'active',api:contextApi,registered:[] as string[],errors:[] as string[],refresh,dispose};
 api.__angularMcpWebMcp=handle;
 const target={type:'object',properties:{sourceId:{type:'string'},instanceId:{type:'string'}},anyOf:[{required:['sourceId']},{required:['instanceId']}],additionalProperties:false};
 const mode={type:'string',enum:['paste','input']};
 const fieldValue={type:'object',properties:{target,value:{},mode},required:['target','value'],additionalProperties:false};
 const emptyInput={type:'object',properties:{kind:{type:'string',enum:['form','control','action','element']},visible:{type:'boolean'},operation:{type:'string',enum:['fill','activate','submit','drag']},limit:{type:'integer',minimum:1,maximum:500},offset:{type:'integer',minimum:0,maximum:100000},includeFields:{type:'boolean'}},additionalProperties:false};
 const definitions:any[]=[
  {name:'angular_list_nodes',description:'Discover exact current nodes with optional kind, operation and visibility filters. Pages default to 100 nodes; follow nextOffset. Set includeFields=false for compact summaries, and restart pagination after UI changes.',inputSchema:emptyInput,annotations:{readOnlyHint:true}},
  {name:'angular_describe_node',description:'Describe an exact currently registered Angular node, its input shape and runtime validation.',inputSchema:{type:'object',properties:{target},required:['target'],additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'angular_read_model',description:'Explicitly read a bounded JSON model snapshot from a registered Angular control. Sensitive native controls and getters are excluded; other business data can still be sensitive.',inputSchema:{type:'object',properties:{target},required:['target'],additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'angular_fill',description:'Fill an exact live registered control through its original UI. This can trigger application input and change handlers.',inputSchema:{type:'object',properties:{target,value:{},mode},required:['target','value'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_activate',description:'Activate an exact live registered control using a supported UI event. Native inputs and editing surfaces also support event="keydown", key="Escape" to dismiss their dialog. Use event="keyboard" with a key on exact focusable controls to dispatch key handlers and native Enter/Space activation. This does not provide browser shortcuts, text typing or Tab traversal. Use event="select-all" on exact text inputs or editing surfaces before applying an original formatting command. UI dispatch does not establish business success.',inputSchema:{type:'object',properties:{target,event:{type:'string'},key:{type:'string'}},required:['target'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_drag',description:'Drag an exact registered pointer action before or after an exact visible destination using original mouse interactions. Only UI dispatch is reported; inspect the resulting app order.',inputSchema:{type:'object',properties:{target,destination:target,position:{type:'string',enum:['before','after']}},required:['target','destination'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_submit',description:'Fill exact form fields and submit through the original Angular form. Angular owns business validation; omitted values remain unchanged.',inputSchema:{type:'object',properties:{target,values:{type:'array',maxItems:1000,items:fieldValue},submitter:target,timeoutMs:{type:'integer',minimum:0,maximum:30000}},required:['target'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
 ];
 function current(){if(!active||document!==ownerDocument||location.origin!==origin||(window as any).__angularMcpBridge!==api)throw new Error('This WebMCP registration is disposed or belongs to another document');}
 function errorMessage(error:any){return (error instanceof Error?error.message:String(error)).slice(0,1000);}
 function output(value:any){const status=value&&value.status;return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:Array.isArray(value)?{nodes:value}:value,...status==='not-dispatched'||status==='partial'?{isError:true}:{}};}
 function failure(error:any){return {isError:true,content:[{type:'text',text:errorMessage(error)}]};}
 function available(node:any,operation:string){if(!node||!node.visible||node.disabled||operation==='fill'&&node.readonly||!Array.isArray(node.operations)||node.operations.indexOf(operation)<0)throw new Error('The exact current target does not support this available UI operation');}
 function preflight(request:any){
  const selected=(api.inspect??api.describe).call(api,request.target);if(request.operation==='activate'&&request.event==='keyboard'){if(!selected?.visible||selected.disabled||!selected.keyboardFocusable)throw new Error('The exact keyboard target is unavailable');}else available(selected,request.operation);
  if(request.operation==='drag'){const drop=(api.inspect??api.describe).call(api,request.destination);if(!drop||!drop.visible||drop.disabled)throw new Error('The drop destination is unavailable');}
  if(request.operation==='fill'){
   if(!selected.schema)throw new Error('This control has no supported browser input schema');
   integrationValidateInput(selected.schema,request.value);
  }
  if(request.operation==='submit'){
   const fields=new Set((selected.fields||[]).map((field:any)=>field.instanceId));
   for(const value of request.values||[]){
    const field=(api.inspect??api.describe).call(api,value.target);if(!fields.has(field.instanceId))throw new Error('A supplied field does not belong to this exact current form');
    available(field,'fill');if(!field.schema)throw new Error('A supplied control has no supported browser input schema');integrationValidateInput(field.schema,value.value);
   }
  }
 }
 function remove(name:string,entry:Entry){
  entry.active=false;entry.controller.abort();
  if(entry.registered&&typeof context.unregisterTool==='function')try{context.unregisterTool(name);}catch{/* Already removed by the abort signal. */}
  if(registered.get(name)===entry)registered.delete(name);
 }
 async function reconcile(){
  current();handle.errors=[];
  const nodes:any[]=await(typeof api.catalog==='function'?api.catalog():api.list()),names=new Map<string,string>();
  await Promise.all(nodes.filter(node=>node.kind==='form'&&node.visible&&!node.disabled).map(async node=>{
   const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(node.instanceId));
   names.set(node.instanceId,'angular_form_'+Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('').slice(0,16));
  }));
  if(!active)return;
  const forms=integrationFormTools(nodes,(instanceId:string)=>{const name=names.get(instanceId);if(!name)throw new Error('A current form has no stable WebMCP identity');return name;});
  const desired=new Map<string,{definition:any;signature:string}>();
  for(const definition of definitions.filter(definition=>typeof api.toolAllowed!=='function'||api.toolAllowed(definition.name)).concat(forms)){
   const bindingIds=definition.bindings?Object.fromEntries(Object.entries(definition.bindings).map(([key,value]:[string,any])=>[key,value.instanceId])):undefined;
   const signature=JSON.stringify({title:definition.title,description:definition.description,inputSchema:definition.inputSchema,annotations:definition.annotations,target:definition._meta&&definition._meta.angularMcpTarget,bindingIds});
   desired.set(definition.name,{definition,signature});
  }
  for(const [name,entry]of registered){const next=desired.get(name);if(!next||next.signature!==entry.signature)remove(name,entry);}
  for(const [name,value]of desired){
   if(!active)break;if(registered.has(name))continue;
   const entry:Entry={...value,controller:new AbortController(),active:true,registered:false};registered.set(name,entry);
   const definition=entry.definition;
   try{
    await context.registerTool({name,...definition.title?{title:definition.title}:{},description:definition.description,inputSchema:definition.inputSchema,annotations:definition.annotations,execute:async(args:any,options?:any)=>{
     let ownsMutation=false,counted=false;
     try{
      if(options&&options.signal&&options.signal.aborted)throw new Error('The WebMCP tool call was cancelled before execution');
      await refresh();current();
      if(options&&options.signal&&options.signal.aborted)throw new Error('The WebMCP tool call was cancelled before execution');
      if(!entry.active||registered.get(name)!==entry)throw new Error('This WebMCP tool is stale; discover the current tools again');
      integrationValidateInput(definition.inputSchema,args);
      if(!definition.annotations.readOnlyHint){if(mutation)throw new Error('Another application interaction is in progress');mutation=true;ownsMutation=true;}
      executions++;counted=true;
      let result:any;
      if(typeof api.toolAllowed==='function'&&!api.toolAllowed(definition.name))throw new Error('This tool is not exposed by the application access policy');
      if(definition.node){
       const request={operation:'submit',target:{instanceId:definition.node.instanceId},values:Object.entries(args).map(([key,value])=>({target:{instanceId:definition.bindings[key].instanceId},value}))};
       preflight(request);result=await api.execute(request);
      }else if(name==='angular_list_nodes')result=integrationListNodes(await(typeof api.catalog==='function'?api.catalog():api.list()),args);
      else if(name==='angular_describe_node')result=await api.describe(args.target);
      else if(name==='angular_read_model')result=await api.readModel(args.target);
      else{
       const operation=({angular_fill:'fill',angular_activate:'activate',angular_submit:'submit',angular_drag:'drag'} as any)[name];
       if(!operation)throw new Error('Unsupported browser WebMCP operation');
       const request={...args,operation};preflight(request);result=await api.execute(request);
      }
      return output(result);
     }catch(error){return failure(error);}finally{if(counted)executions--;if(ownsMutation)mutation=false;schedule();}
    }},{signal:entry.controller.signal});
    entry.registered=true;if(!active||!entry.active)remove(name,entry);
   }catch(error){entry.active=false;entry.controller.abort();if(registered.get(name)===entry)registered.delete(name);if(active)handle.errors.push(name+': '+errorMessage(error));}
  }
  if(active){handle.registered=Array.from(registered).filter(([,entry])=>entry.active&&entry.registered).map(([name])=>name);handle.status=handle.errors.length?'error':'active';}
 }
 function refresh():Promise<void>{
  if(!active)return Promise.resolve();refreshNeeded=true;
  if(executions)return Promise.resolve();
  queue=queue.then(async()=>{if(!active||executions||!refreshNeeded)return;refreshNeeded=false;await reconcile();}).catch(error=>{if(active){if(api.profile==='production'){for(const [name,entry]of registered)remove(name,entry);handle.registered=[];}handle.status='error';handle.errors=[errorMessage(error)];}});
  return queue;
 }
 function schedule(){if(!active||scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;void refresh();});}
 const unsubscribe=typeof api.subscribe==='function'?api.subscribe(schedule):()=>{};
 const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true});
 const events=['input','change','focusin','popstate','hashchange'];
 for(const name of events)window.addEventListener(name,schedule,true);
 // A BFCache restore resumes this document without evaluating its modules again.
 // Keep one document-owned bootstrap; only pagehide-persisted disposal may resume.
 let lifecycle:any=api.__angularMcpWebMcpLifecycle;
 if(!lifecycle||lifecycle.ownerDocument!==ownerDocument){
  if(lifecycle&&typeof lifecycle.listener==='function')window.removeEventListener('pageshow',lifecycle.listener);
  lifecycle={ownerDocument,pendingHandle:undefined};
  lifecycle.listener=(event:PageTransitionEvent)=>{
   if(document!==ownerDocument||(window as any).__angularMcpBridge!==api)return;
   const currentHandle=api.__angularMcpWebMcp;
   if(event.persisted&&lifecycle.pendingHandle===currentHandle&&currentHandle&&currentHandle.status==='disposed'){
    lifecycle.pendingHandle=undefined;installAngularMcpWebMcp();
   }else if(currentHandle&&currentHandle.status!=='disposed'&&typeof currentHandle.refresh==='function')void currentHandle.refresh();
  };
  api.__angularMcpWebMcpLifecycle=lifecycle;window.addEventListener('pageshow',lifecycle.listener);
 }
 lifecycle.pendingHandle=undefined;
 window.addEventListener('pagehide',hide);
 function hide(event:PageTransitionEvent){
  if(!active)return;
  lifecycle.pendingHandle=event.persisted&&api.__angularMcpWebMcp===handle?handle:undefined;
  cleanup();
 }
 function dispose(){
  if(lifecycle.pendingHandle===handle)lifecycle.pendingHandle=undefined;
  cleanup();
 }
 function cleanup(){
  if(!active)return;active=false;observer.disconnect();unsubscribe();
  for(const name of events)window.removeEventListener(name,schedule,true);
  window.removeEventListener('pagehide',hide);
  for(const [name,entry]of registered)remove(name,entry);
  handle.registered=[];handle.status='disposed';
 }
 schedule();return handle;
}
if(typeof window!=='undefined')installAngularMcpWebMcp();
`;
