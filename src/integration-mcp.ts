import {createHash} from 'node:crypto';
import {Ajv} from 'ajv';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {CallToolRequestSchema,ListToolsRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import type {Page} from 'playwright';
import type {IntegrationRequest,IntegrationDescriptor} from './integration-runtime.js';
import {integrationListNodes,integrationFormTools} from './integration-catalog.js';

const target={type:'object',properties:{sourceId:{type:'string'},instanceId:{type:'string'}},anyOf:[{required:['sourceId']},{required:['instanceId']}],additionalProperties:false};
const mode={type:'string',enum:['paste','input']};
const value={type:'object',properties:{target,value:{},mode},required:['target','value'],additionalProperties:false};
const tools=[
  {name:'angular_list_nodes',description:'Discover current nodes with exact IDs. Filter kind/operation/visible on large pages; includeFields=false returns summaries. Pages default to 100 nodes. Follow nextOffset, and restart at offset 0 after UI changes.',inputSchema:{type:'object',properties:{kind:{type:'string',enum:['form','control','action','element']},visible:{type:'boolean'},operation:{type:'string',enum:['fill','activate','submit','drag']},limit:{type:'integer',minimum:1,maximum:500},offset:{type:'integer',minimum:0,maximum:100000},includeFields:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'angular_read_model',description:'Read one registered control model from its actual public Angular control as bounded JSON data. Use this to inspect selected objects without trial mutations. Password/hidden/file values and getters are excluded; complete=false means the value is unavailable.',inputSchema:{type:'object',properties:{target},required:['target'],additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'angular_read_view',description:'Read the current visible UI hierarchy, including exact live registry IDs and nearby row text. Use it to distinguish repeated actions without guessing selectors or business ownership.',inputSchema:{type:'object',properties:{maxNodes:{type:'integer',minimum:1,maximum:5000}},additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'angular_describe_node',description:'Read a live registered Angular node. A source ID shared by repeated instances requires an exact instance ID.',inputSchema:{type:'object',properties:{target},required:['target'],additionalProperties:false},annotations:{readOnlyHint:true}},
  {name:'angular_fill',description:'Fill an exact live control using its original DOM interaction path. Angular owns validation. This may trigger application input/change effects.',inputSchema:{type:'object',properties:{target,value:{},mode},required:['target','value'],additionalProperties:false},annotations:{readOnlyHint:false}},
  {name:'angular_activate',description:'Activate an exact live action through its original UI event. Use event="select-all" on a text input or editing surface before an original formatting command. Dispatch does not establish business success.',inputSchema:{type:'object',properties:{target,event:{type:'string'},key:{type:'string'}},required:['target'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_drag',description:'Drag an exact registered pointer action before or after an exact visible destination using original mouse interactions. Only UI dispatch is reported; inspect the resulting app order.',inputSchema:{type:'object',properties:{target,destination:target,position:{type:'string',enum:['before','after']}},required:['target','destination'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_submit',description:'Fill exact registered controls and submit their live form through the original Angular submission path. Return validation and dispatch evidence; business outcome remains unknown.',inputSchema:{type:'object',properties:{target,values:{type:'array',items:value},submitter:target,timeoutMs:{type:'integer',minimum:1,maximum:30000}},required:['target'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_press_key',description:'Focus an exact registered, enabled native or ARIA control and send a real browser key such as Space, Enter or ArrowDown. This supports keyboard-accessible readonly widgets without bypassing their original handlers.',inputSchema:{type:'object',properties:{target,key:{type:'string',minLength:1,maxLength:80}},required:['target','key'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_upload_file',description:'Choose files on an exact registered native file input through original browser file/change events. Supply explicit file bytes; application upload and validation handlers remain authoritative.',inputSchema:{type:'object',properties:{target,files:{type:'array',maxItems:20,items:{type:'object',properties:{name:{type:'string',minLength:1},mimeType:{type:'string'},base64:{type:'string',maxLength:7000000}},required:['name','mimeType','base64'],additionalProperties:false}}},required:['target','files'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true}},
  {name:'angular_navigate',description:'Open a path on the same application origin. This changes page state and rebuilds the live node registry.',inputSchema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false},annotations:{readOnlyHint:false}},
] as const;

/** The transport is generic: all ownership and control identity comes from the compiler-emitted live registry. */
export interface IntegrationMcpOptions { expectedSubject?: string; expectedSessionId?: string; requireProduction?: boolean }
export function createIntegrationMcpServer(page:Page,baseUrl:string,options:IntegrationMcpOptions={}){
  const origin=new URL(baseUrl).origin;
  const assertOrigin=()=>{if(new URL(page.url()).origin!==origin)throw new Error('The page left the configured application origin.');};
  const assertMcpMode=async()=>{
    assertOrigin();
    await page.evaluate(async({origin,subject,sessionId,requireProduction})=>{
      if(location.origin!==origin)throw new Error('The page left the configured application origin.');
      const bridge=(globalThis as any).__angularMcpBridge;
      if(bridge?.version!==1)throw new Error('This page has no compatible compiler-generated Angular MCP registry.');
      if(bridge.mode==='webmcp')throw new Error('This application enables WebMCP only. Generate with --mode mcp or --mode both to use the Node adapter.');
      if(requireProduction&&bridge.profile!=='production')throw new Error('Remote or hosted MCP requires a production access-controlled build.');
      if(bridge.profile==='production')await bridge.assertIdentity(subject,sessionId);
    },{origin,subject:options.expectedSubject,sessionId:options.expectedSessionId,requireProduction:options.requireProduction||!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)});
  };
  const ajv=new Ajv({strict:false,allErrors:true});
  const validators=new Map(tools.map(tool=>[tool.name,ajv.compile(tool.inputSchema)]));
  const server=new Server({name:'ngx-mcp',version:'0.1.0'},{capabilities:{tools:{listChanged:true}}});
  let mutationInProgress=false;
  const dynamic=async()=>{
    await assertMcpMode();
    const nodes:IntegrationDescriptor[]=await page.evaluate(expectedOrigin=>{if(location.origin!==expectedOrigin)throw new Error('The page left the configured application origin.');const bridge=(globalThis as any).__angularMcpBridge;if(bridge?.version!==1)throw new Error('This page has no compatible compiler-generated Angular MCP registry.');return typeof bridge.catalog==='function'?bridge.catalog():bridge.list();},origin);
    return integrationFormTools(nodes,instanceId=>'angular_form_'+createHash('sha256').update(instanceId).digest('hex').slice(0,16));
  };
  server.setRequestHandler(ListToolsRequestSchema,async()=>{
    const forms=await dynamic();
    const allowed:string[]|null=await page.evaluate(names=>{const api=(globalThis as any).__angularMcpBridge;return typeof api.toolAllowed==='function'?names.filter(name=>api.toolAllowed(name)):null;},tools.map(tool=>tool.name));
    return {tools:[...tools.filter(tool=>!allowed||allowed.includes(tool.name)),...forms.map(({node,bindings,...tool})=>tool)]};
  });
  server.setRequestHandler(CallToolRequestSchema,async request=>{
    let ownsMutation=false,externalId:string|undefined;
    try{
      if(request.params.name!=='angular_navigate'||new URL(page.url()).origin===origin)await assertMcpMode();
      const inputArgs=request.params.arguments??{};let args=inputArgs,result:unknown;
      const allowed=await page.evaluate(name=>{const api=(globalThis as any).__angularMcpBridge;return typeof api?.toolAllowed!=='function'||api.toolAllowed(name);},request.params.name);
      if(!allowed)throw new Error('This tool is not exposed by the application access policy.');
      const generated=request.params.name.startsWith('angular_form_')?(await dynamic()).find(tool=>tool.name===request.params.name):undefined;
      const validate=generated?ajv.compile(generated.inputSchema):validators.get(request.params.name as typeof tools[number]['name']);
      if(!validate)throw new Error('Unknown or stale integration tool: '+request.params.name);
      if(!validate(args))throw new Error(ajv.errorsText(validate.errors));
      if(!['angular_list_nodes','angular_describe_node','angular_read_view','angular_read_model'].includes(request.params.name)){if(mutationInProgress)throw new Error('Another application interaction is in progress.');mutationInProgress=true;ownsMutation=true;}
      if(['angular_press_key','angular_upload_file','angular_read_view','angular_navigate'].includes(request.params.name)){
        const prepared=await page.evaluate(async({name,args})=>{const api=(globalThis as any).__angularMcpBridge;if(api.profile!=='production')return null;const operation=({angular_press_key:'press-key',angular_upload_file:'upload-file',angular_read_view:'read-view',angular_navigate:'navigate'} as any)[name];return await api.beginExternal(operation,args);},{name:request.params.name,args});
        if(prepared){externalId=prepared.id;args=prepared.input;}
      }
      if(generated){
        const input:IntegrationRequest={operation:'submit',target:{instanceId:generated.node.instanceId},values:Object.entries(args).map(([key,value])=>({target:{instanceId:generated.bindings[key].instanceId},value}))};
        result=await page.evaluate(async({input,origin})=>{if(location.origin!==origin)throw new Error('The page left the configured application origin.');return (globalThis as any).__angularMcpBridge.execute(input);},{input,origin});
      }else if(request.params.name==='angular_press_key'){
        const selected=await page.evaluate(({target,origin})=>{if(location.origin!==origin)throw new Error('The page left the configured application origin.');const api=(globalThis as any).__angularMcpBridge;return (api.inspect??api.describe).call(api,target);},{target:args.target,origin}) as IntegrationDescriptor;
        const nativeDelegate=selected.kind==='control'&&selected.transport==='native-ui'&&!['input','textarea','select'].includes(selected.tagName);
        const handle=await page.evaluateHandle(({target,origin,nativeDelegate})=>{
          if(location.origin!==origin)throw new Error('The page left the configured application origin.');
          const api=(globalThis as any).__angularMcpBridge;if(typeof api?.element!=='function')throw new Error('Rebuild the application with the current integration.');
          const host=api.element(target);let node=host;
          if(nativeDelegate){const candidates=host.querySelectorAll('input,textarea,select');if(candidates.length!==1)throw new Error('The control has no unique native keyboard delegate.');node=candidates[0];}
          if(!node||node.nodeType!==1||typeof node.focus!=='function'||node.tabIndex<0&&!node.isContentEditable||!node.isConnected||node.matches(':disabled')||node.getAttribute('aria-disabled')==='true'||node.closest('[inert],[aria-hidden="true"],[aria-disabled="true"]'))throw new Error('The exact keyboard target is unavailable or disabled.');
          node.focus({preventScroll:true});if(node.ownerDocument.activeElement!==node)throw new Error('The application does not permit focus on this exact target.');return node;
        },{target:{instanceId:selected.instanceId},origin,nativeDelegate});
        try{
          const element=handle.asElement();if(!element)throw new Error('The keyboard target is not a native element.');
          await element.evaluate((node,{target,origin,nativeDelegate})=>{if(location.origin!==origin)throw new Error('The page left the configured application origin.');const host=(globalThis as any).__angularMcpBridge.element(target);let expected=host;if(nativeDelegate){const candidates=host.querySelectorAll('input,textarea,select');if(candidates.length!==1)throw new Error('The native keyboard delegate changed before dispatch.');expected=candidates[0];}if(expected!==node||!node.isConnected||node.ownerDocument.activeElement!==node)throw new Error('The keyboard target changed before dispatch.');},{target:{instanceId:selected.instanceId},origin,nativeDelegate});
          await element.press(args.key as string,{timeout:5000});
          result={status:'ui-dispatched',operation:'press-key',target:{sourceId:selected.sourceId,instanceId:selected.instanceId},key:args.key,url:page.url(),businessStatus:'unknown'};
        }finally{await handle.dispose();}
      }else if(request.params.name==='angular_upload_file'){
        const files=(args.files as {name:string;mimeType:string;base64:string}[]).map(file=>{
          if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))throw new Error('File data must be canonical base64.');
          if(Buffer.from(file.base64,'base64').length>5*1024*1024)throw new Error('Each file is limited to 5 MiB.');return file;
        });
        // Resolve, check and dispatch in one browser turn: a rerender cannot retarget a mutable locator to a clone.
        result=await page.evaluate(({target,files,origin})=>{
          if(location.origin!==origin)throw new Error('The page left the configured application origin.');
          const api=(globalThis as any).__angularMcpBridge;
          if(typeof api?.element!=='function')throw new Error('Rebuild the app with the current integration to expose exact native file handles.');
          const selected=(api.inspect??api.describe).call(api,target),node=api.element({instanceId:selected.instanceId});
          if(node?.localName!=='input'||node.namespaceURI!=='http://www.w3.org/1999/xhtml'||node.type!=='file'||!node.isConnected||node.matches(':disabled')||node.getAttribute('aria-disabled')==='true'||node.closest('[inert],[aria-disabled="true"]'))throw new Error('This exact registered node is not an enabled native file input.');
          if(node.webkitdirectory)throw new Error('Directory selection needs a directory adapter.');
          if(files.length>1&&!node.multiple)throw new Error('This file input accepts only one file.');
          const realm:any=node.ownerDocument.defaultView;const chosen=files.map(file=>new realm.File([Uint8Array.from(atob(file.base64),character=>character.charCodeAt(0))],file.name,{type:file.mimeType})),transfer=new realm.DataTransfer();
          for(const file of chosen)transfer.items.add(file);
          node.files=transfer.files;node.dispatchEvent(new realm.Event('input',{bubbles:true}));node.dispatchEvent(new realm.Event('change',{bubbles:true}));
          return {status:'ui-dispatched',operation:'upload-file',target:{sourceId:selected.sourceId,instanceId:selected.instanceId},files:chosen.map(file=>({name:file.name,mimeType:file.type,bytes:file.size})),url:location.href,businessStatus:'unknown'};
        },{target:args.target,files,origin});
      }else if(request.params.name==='angular_navigate'){
        if(typeof args.path!=='string')throw new Error('path must be a string');
        const url=new URL(args.path,baseUrl);if(url.origin!==origin)throw new Error('Navigation must stay on the application origin.');
        await page.goto(url.href);assertOrigin();await page.waitForFunction(()=>!!(globalThis as any).__angularMcpBridge,{},{timeout:15000});await assertMcpMode();
        result={status:'ui-dispatched',url:page.url(),businessStatus:'unknown'};
      }else if(request.params.name==='angular_list_nodes'){
        result=integrationListNodes(await page.evaluate(expectedOrigin=>{if(location.origin!==expectedOrigin)throw new Error('The page left the configured application origin.');const bridge=(globalThis as any).__angularMcpBridge;if(bridge?.version!==1)throw new Error('This page has no compatible compiler-generated Angular MCP registry.');return typeof bridge.catalog==='function'?bridge.catalog():bridge.list();},origin),args);
      }else if(request.params.name==='angular_read_model'){
        result=await page.evaluate(({target,origin})=>{if(location.origin!==origin)throw new Error('The page left the configured application origin.');const api=(globalThis as any).__angularMcpBridge;if(typeof api?.readModel!=='function')throw new Error('Rebuild the app with the current Angular model snapshot adapter.');return api.readModel(target);},{target:args.target,origin});
      }else if(request.params.name==='angular_read_view'){
        result=await page.evaluate(async({origin,maxNodes})=>{
          if(location.origin!==origin)throw new Error('The page left the configured application origin.');
          const api=(globalThis as any).__angularMcpBridge;if(api?.version!==1||typeof api.element!=='function')throw new Error('Rebuild the app with the current Angular MCP integration.');
          if(api.profile==='production'){
            const catalog=await api.catalog();
            const nodes=catalog.slice(0,maxNodes).map((node:any)=>({tag:node.tagName,target:{sourceId:node.sourceId,instanceId:node.instanceId},label:node.label,provenance:node.provenance??'compiler',kind:node.kind,path:node.path,disabled:node.disabled,visible:node.visible}));
            return {view:{tag:'allowed-registry',children:nodes},visited:nodes.length,truncated:catalog.length>maxNodes,scope:'Policy-filtered registry metadata; unregistered page text and values are omitted'};
          }
          let visited=0,characters=0,truncated=false;
          const tree={walk(element:Element,depth:number):any{
            if(visited>=maxNodes||depth>50||characters>=80000){truncated=true;return undefined;}
            if(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(element.tagName))return undefined;
            const node=element as HTMLElement,style=getComputedStyle(node);
            if(style.display==='none'||node.closest('[hidden],[inert],[aria-hidden="true"]'))return undefined;
            const visible=!!node.getClientRects().length&&style.visibility!=='hidden';
            visited++;const text=Array.from(node.childNodes).filter(child=>child.nodeType===Node.TEXT_NODE).map(child=>child.textContent??'').join(' ').replace(/\s+/g,' ').trim().slice(0,2000);characters+=text.length;
            const value:any={tag:node.tagName.toLowerCase(),visible,...(node.getAttribute('role')?{role:node.getAttribute('role')}:{}) ,...(node.getAttribute('aria-label')?{label:node.getAttribute('aria-label')}:{}) ,...text&&style.visibility!=='hidden'?{text}:{}};
            const id=node.getAttribute('data-angular-mcp-instance');
            if(id)try{if(api.element({instanceId:id})===node){const registered=(api.inspect??api.describe).call(api,{instanceId:id});value.target={sourceId:registered.sourceId,instanceId:id};value.provenance=registered.provenance??'compiler';value.label=registered.label;value.disabled=registered.disabled;if(registered.value!==undefined)value.value=registered.value;}}catch{/* A cloned/stale attribute never becomes an actionable identity. */}
            const children=Array.from(node.children).map(child=>tree.walk(child,depth+1)).filter(Boolean);if(children.length)value.children=children;return value;
          }};
          const view=tree.walk(document.body,0);return {url:location.href,title:document.title,view,visited,truncated};
        },{origin,maxNodes:typeof args.maxNodes==='number'?args.maxNodes:2000});
      }else if(request.params.name==='angular_describe_node'){
        result=await page.evaluate(({target,origin})=>{if(location.origin!==origin)throw new Error('The page left the configured application origin.');const bridge=(globalThis as any).__angularMcpBridge;if(bridge?.version!==1)throw new Error('This page has no compatible compiler-generated Angular MCP registry.');return bridge.describe(target);},{target:args.target,origin});
      }else{
        const operation=({angular_fill:'fill',angular_activate:'activate',angular_submit:'submit',angular_drag:'drag'} as const)[request.params.name as 'angular_fill'|'angular_activate'|'angular_submit'|'angular_drag'];
        if(!operation)throw new Error('Unknown integration tool: '+request.params.name);
        result=await page.evaluate(async({input,origin})=>{if(location.origin!==origin)throw new Error('The page left the configured application origin.');const bridge=(globalThis as any).__angularMcpBridge;if(bridge?.version!==1)throw new Error('This page has no compatible compiler-generated Angular MCP registry.');return bridge.execute(input);},{input:{...args,operation} as unknown as IntegrationRequest,origin});
      }
      if(externalId){const completed=externalId;externalId=undefined;result=await page.evaluate(async({id,result})=>(globalThis as any).__angularMcpBridge.finishExternal(id,{ok:true,result}),{id:completed,result});}
      if(!['angular_list_nodes','angular_describe_node','angular_read_view','angular_read_model'].includes(request.params.name))await server.sendToolListChanged().catch(()=>{});
      const structuredContent=Array.isArray(result)?{nodes:result}:result as Record<string,unknown>;
      const status=(result as {status?:string})?.status;
      return {content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent,...((status==='not-dispatched'||status==='partial')?{isError:true}:{})};
    }catch(error){
      if(externalId)try{await page.evaluate(async id=>(globalThis as any).__angularMcpBridge.finishExternal(id,{ok:false}),externalId);}catch{/* The access audit records the failed external operation. */}
      return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:String(error)}]};
    }finally{if(ownsMutation)mutationInProgress=false;}
  });
  return server;
}
