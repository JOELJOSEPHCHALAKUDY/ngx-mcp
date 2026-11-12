/** Append to integrationRuntimeSource() in the app-owned generated module. No framework package or app names are inspected. */
export function integrationUiSource(): string { return UI_RUNTIME; }

const UI_RUNTIME=String.raw`
/** Live DOM affordances are a separate provenance tier; they do not assert compiler-resolved business bindings. */
export function installAngularMcpUiAdjunct():()=>void{
 if(typeof window==='undefined')return ()=>{};
 const api:any=bridge();if(!api||typeof api.register!=='function'||typeof api.remove!=='function')throw new Error('The Angular MCP runtime registry is required');
 if(api.__angularMcpUiAdjunct)return api.__angularMcpUiAdjunct.dispose;
 const original={register:api.register,remove:api.remove,list:api.list,describe:api.describe,execute:api.execute};
 const compiler=new Map<Element,any>(),dom=new Map<HTMLElement,any>(),domIds=new Set<string>();
 const token=Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(36)).join('-');
 let sequence=0,collecting=false,active=true,scheduled=false;const documents=new Set<Document>();
 const roles=new Set(['button','menuitem','menuitemcheckbox','menuitemradio','option','combobox','listbox','radio','checkbox','switch']);
 const selector='button,a,label,form,iframe,input,textarea,select,[contenteditable],[role],[tabindex],[data-angular-mcp-listeners]';
 const ui={
  events(node:HTMLElement){const native=angularMcpHtmlElement(node,'button')||angularMcpHtmlElement(node,'a')||angularMcpHtmlElement(node,'label')||angularMcpHtmlElement(node,'input')&&['button','submit','reset','image','radio','checkbox'].includes(node.type)||roles.has((node.getAttribute('role')||'').trim().split(/\s+/)[0]||'')?['click']:[];return Array.from(new Set([...native,...angularMcpObservedEvents(node)]));},
  candidate(node:HTMLElement){return angularMcpHtmlElement(node,'form')||angularMcpHtmlElement(node,'iframe')||ui.events(node).length>0||['dialog','row','listitem'].includes(node.getAttribute('role')||'')||angularMcpHtmlElement(node,'input')||angularMcpHtmlElement(node,'textarea')||angularMcpHtmlElement(node,'select')||node.isContentEditable&&node.hasAttribute('contenteditable')||node.hasAttribute('tabindex')&&node.tabIndex>=0;},
  transparentOwner(node:HTMLElement){
   for(let parent=node.parentElement;parent;parent=parent.parentElement){
    const source=compiler.get(parent);if(!source)continue;
    const ownsControl=!!source.ngControl||!!source.signal||source.kind==='control'&&source.operations&&source.operations.indexOf('fill')>=0;
    if(!ownsControl)continue;
    const native=Array.from(parent.querySelectorAll('input,textarea,select,[contenteditable]'));
    if(native.length!==1)continue;const control=native[0]!;
    if(angularMcpHtmlElement(control,'input')&&['file','hidden','button','submit','reset','image','radio'].includes(control.type))continue;
    if('readOnly' in control&&(control as HTMLInputElement).readOnly||control.getAttribute('aria-readonly')==='true')continue;
    if(node===control||node.contains(control)||control.contains(node))return true;
   }
   return false;
  },
  roots(){const roots:Document[]=[];const visit=(owner:Document,depth:number)=>{if(depth>8||roots.includes(owner))return;roots.push(owner);for(const frame of Array.from(owner.querySelectorAll('iframe')))try{const child=frame.contentDocument;if(child?.documentElement)visit(child,depth+1);}catch{/* Foreign documents stay outside the registry. */}};visit(document,0);return roots;},
  forget(node:HTMLElement,record:any){dom.delete(node);domIds.delete(record.instanceId);original.remove.call(api,record);},
  collect(){
   if(!active||collecting)return;collecting=true;
   try{
    const roots=ui.roots();observer.disconnect();for(const owner of documents)if(!roots.includes(owner)){owner.removeEventListener('load',ui.schedule,true);documents.delete(owner);}for(const owner of roots)if(!documents.has(owner)){documents.add(owner);owner.addEventListener('load',ui.schedule,true);}
    for(const [node]of compiler)if(!node.isConnected)compiler.delete(node);
    for(const [node,record]of dom)if(!node.isConnected||!documents.has(node.ownerDocument)||compiler.has(node)||!ui.candidate(node)||ui.transparentOwner(node))ui.forget(node,record);else record.events=ui.events(node);
    for(const owner of roots)for(const node of Array.from(owner.querySelectorAll<HTMLElement>(selector))){
     if(!node.isConnected||!documents.has(node.ownerDocument)||compiler.has(node)||dom.has(node)||node.hasAttribute('angularMcpSource')||!ui.candidate(node)||ui.transparentOwner(node))continue;
     const record=original.register.call(api,'runtime-dom:'+token+':'+(++sequence),node,null,null,null);record.events=ui.events(node);dom.set(node,record);domIds.add(record.instanceId);
    }
    for(const owner of roots)if(owner.documentElement)observer.observe(owner.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['role','type','tabindex','href','disabled','aria-disabled','aria-hidden','contenteditable','angularMcpSource','data-angular-mcp-instance','data-angular-mcp-listeners']});
   }finally{collecting=false;}
  },
  descriptor(value:any):any{const runtime=domIds.has(value.instanceId),result={...value,provenance:runtime?'runtime-dom':'compiler',...runtime&&value.operations&&value.operations.indexOf('activate')>=0?{clickOrigin:'native-ui'}:{}};if(value.fields)result.fields=value.fields.map((field:any)=>ui.descriptor(field));return result;},
  schedule(){if(!active||scheduled)return;scheduled=true;Promise.resolve().then(()=>{scheduled=false;ui.collect();});}
 };
 // A late explicit installation can recover exact existing registrations from the unique emitted instance attribute.
 for(const descriptor of original.list.call(api)){
  const nodes=Array.from(document.querySelectorAll<HTMLElement>('[data-angular-mcp-instance]')).filter(node=>node.getAttribute('data-angular-mcp-instance')===descriptor.instanceId);
  if(nodes.length===1)compiler.set(nodes[0]!,{...descriptor,node:nodes[0]!});
 }
 const wrappedRegister=function(...args:any[]){const node=args[1] as HTMLElement,prior=dom.get(node);if(prior)ui.forget(node,prior);const record=original.register.apply(api,args);compiler.set(node,record);return record;};
 const wrappedRemove=function(record:any){if(compiler.get(record.node)&&compiler.get(record.node).instanceId===record.instanceId)compiler.delete(record.node);if(dom.get(record.node)===record){dom.delete(record.node);domIds.delete(record.instanceId);}return original.remove.call(api,record);};
 const wrappedList=function(){ui.collect();return original.list.call(api).map((descriptor:any)=>ui.descriptor(descriptor));};
 const wrappedDescribe=function(target:any){ui.collect();return ui.descriptor(original.describe.call(api,target));};
 const wrappedExecute=async function(request:any){ui.collect();try{return await original.execute.call(api,request);}finally{ui.collect();}};
 api.register=wrappedRegister;api.remove=wrappedRemove;api.list=wrappedList;api.describe=wrappedDescribe;api.execute=wrappedExecute;
 const observer=new MutationObserver(()=>ui.schedule());observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['role','type','tabindex','href','disabled','aria-disabled','aria-hidden','angularMcpSource','data-angular-mcp-instance','contenteditable','data-angular-mcp-listeners']});
 const dispose=()=>{if(!active)return;active=false;observer.disconnect();for(const owner of documents)owner.removeEventListener('load',ui.schedule,true);documents.clear();for(const [node,record]of dom)ui.forget(node,record);compiler.clear();
  if(api.register===wrappedRegister)api.register=original.register;if(api.remove===wrappedRemove)api.remove=original.remove;if(api.list===wrappedList)api.list=original.list;if(api.describe===wrappedDescribe)api.describe=original.describe;if(api.execute===wrappedExecute)api.execute=original.execute;delete api.__angularMcpUiAdjunct;
 };
 api.__angularMcpUiAdjunct={dispose};ui.collect();return dispose;
}
if(typeof window!=='undefined')installAngularMcpUiAdjunct();
`;
