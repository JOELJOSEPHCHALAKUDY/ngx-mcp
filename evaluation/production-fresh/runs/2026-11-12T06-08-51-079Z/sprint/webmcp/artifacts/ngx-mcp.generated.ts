
import {Directive,ElementRef,Input,Inject,Optional,Self,NgModule,OnDestroy,NgZone} from '@angular/core';
import {EventManager} from '@angular/platform-browser';
import {NgControl,NgForm,FormGroupDirective,DefaultValueAccessor,CheckboxControlValueAccessor,NumberValueAccessor,RangeValueAccessor,SelectControlValueAccessor,SelectMultipleControlValueAccessor,RadioControlValueAccessor} from '@angular/forms';


type Target={sourceId?:string;instanceId?:string};
type RecordEntry={sourceId:string;instanceId:string;node:HTMLElement;events:string[];ngControl:any;ngForm:any;group:any;signal?:any;signalRoot?:any;zone?:NgZone|undefined};
function angularMcpHtmlElement<K extends keyof HTMLElementTagNameMap>(node:any,tag:K):node is HTMLElementTagNameMap[K]{return !!node&&node.nodeType===1&&node.namespaceURI==='http://www.w3.org/1999/xhtml'&&node.localName===tag;}
// Observe Angular's public listener registration without inspecting callbacks or component internals.
const angularMcpObservedEvents:(element:Element)=>string[]=(()=>{
 if(typeof window==='undefined')return ()=>[];
 const prototype:any=EventManager.prototype,key=Symbol.for('ngx-mcp.angular-event-observer.v1');
 if(prototype[key])return prototype[key];
 const events=new WeakMap<Element,Map<string,number>>(),original=prototype.addEventListener;
 const supported=/^(click|dblclick|mousedown|mouseup|pointerdown|pointerup|blur|keydown(?:\.[a-z0-9]+)*|keyup(?:\.[a-z0-9]+)*)$/i;
 const read=(element:Element)=>Array.from(events.get(element)?.keys()||[]);
 prototype.addEventListener=function(element:any,name:string,handler:any,...options:any[]){
  const remove=original.call(this,element,name,handler,...options);
  if(!element||element.nodeType!==1||!supported.test(name))return remove;
  let names=events.get(element);if(!names){names=new Map();events.set(element,names);}names.set(name,(names.get(name)||0)+1);element.setAttribute('data-angular-mcp-listeners','');
  let active=true;return ()=>{try{return remove();}finally{if(active){active=false;const count=names!.get(name)||0;if(count>1)names!.set(name,count-1);else names!.delete(name);if(!names!.size)element.removeAttribute('data-angular-mcp-listeners');}}};
 };
 Object.defineProperty(prototype,key,{value:read});return read;
})();
function createBridge(){
 const records=new Map<string,RecordEntry>(),nonce=Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(36)).join('-');let sequence=0,busy=false;let angularZone:NgZone|undefined;const fileOffers=new WeakMap<HTMLInputElement,{trigger:HTMLElement;until:number}>();
 const listeners=new Set<()=>void>();let notificationPending=false;
 const notify=()=>{if(notificationPending)return;notificationPending=true;queueMicrotask(()=>{notificationPending=false;for(const listener of Array.from(listeners))try{listener();}catch{/* A subscriber must not interfere with the app. */}});};
 const h={
  run<T>(_record:RecordEntry,effect:()=>T):T{return effect();},
  dispatch(record:RecordEntry,node:EventTarget,event:Event){return h.run(record,()=>node.dispatchEvent(event));},
  focus(record:RecordEntry,node:HTMLElement){h.run(record,()=>node.focus());},
  blur(record:RecordEntry,node:HTMLElement){h.run(record,()=>node.blur());},
  click(record:RecordEntry,node:HTMLElement){h.run(record,()=>{if(typeof node.click==='function')node.click();else node.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,view:node.ownerDocument.defaultView}));});},
  frames(node:HTMLElement):HTMLElement[]|undefined{const frames:HTMLElement[]=[];let owner=node.ownerDocument;try{while(owner!==document&&frames.length<8){const frame=owner.defaultView?.frameElement as HTMLIFrameElement|null;if(!frame||!frame.isConnected||frame.contentDocument!==owner)return undefined;frames.push(frame);owner=frame.ownerDocument;}return owner===document?frames:undefined;}catch{return undefined;}},
  live(record:RecordEntry){return record.node.isConnected&&!!h.frames(record.node);},
  uncovered(node:HTMLElement,point:{x:number;y:number}){let owner=node.ownerDocument,top=owner.elementFromPoint(point.x,point.y);if(!top||!node.contains(top))return false;const frames=h.frames(node);if(!frames)return false;for(const frame of frames){for(let element:HTMLElement|null=frame;element;element=element.parentElement){const style=element.ownerDocument.defaultView!.getComputedStyle(element);if(style.perspective!=='none')return false;if(style.transform!=='none'){try{const matrix=new DOMMatrixReadOnly(style.transform);if(['m12','m13','m14','m21','m23','m24','m31','m32','m34'].some(key=>Math.abs((matrix as any)[key])>0.000001)||matrix.m11<=0||matrix.m22<=0||matrix.m44!==1)return false;}catch{return false;}}}const rect=frame.getBoundingClientRect(),x=rect.width/frame.offsetWidth,y=rect.height/frame.offsetHeight;if(!Number.isFinite(x)||!Number.isFinite(y)||x<=0||y<=0)return false;point={x:rect.left+(frame.clientLeft+point.x)*x,y:rect.top+(frame.clientTop+point.y)*y};owner=frame.ownerDocument;top=owner.elementFromPoint(point.x,point.y);if(top!==frame)return false;}return true;},
  all(){return Array.from(records.values()).filter(record=>h.live(record));},
  resolve(target:Target):RecordEntry{
   if(!target||typeof target!=='object')throw new Error('A sourceId or instanceId target is required');
   if(target.instanceId){const record=records.get(target.instanceId);if(!record||!h.live(record)||target.sourceId&&target.sourceId!==record.sourceId)throw new Error('The runtime instance is missing, stale, or belongs to another source');return record;}
   if(!target.sourceId)throw new Error('A sourceId or instanceId target is required');
   const matches=h.all().filter(record=>record.sourceId===target.sourceId);if(matches.length!==1)throw new Error('Source target is missing or repeated; use an exact current instanceId');return matches[0]!;
  },
  control(record:RecordEntry){try{return record.ngControl&&record.ngControl.control;}catch{return undefined;}},
  formControl(record:RecordEntry){try{return record.group&&record.group.control||record.ngForm&&record.ngForm.control;}catch{return undefined;}},
  signalState(record:RecordEntry){try{return record.signal&&record.signal.state();}catch{return undefined;}},
  signalRootState(record:RecordEntry){try{return record.signalRoot&&record.signalRoot.fieldTree()();}catch{return undefined;}},
  signalStatus(state:any){return state.disabled()?'DISABLED':state.pending()?'PENDING':state.invalid()?'INVALID':state.valid()?'VALID':'UNKNOWN';},
  signalErrors(state:any){try{return (state.errors()||[]).map((error:any)=>({code:String(error.kind||'invalid')}));}catch{return [];}},
  isForm(record:RecordEntry){return angularMcpHtmlElement(record.node,'form');},
  isControl(record:RecordEntry){return !!record.ngControl||angularMcpHtmlElement(record.node,'input')&&!['submit','button','reset','image'].includes(record.node.type)||angularMcpHtmlElement(record.node,'textarea')||angularMcpHtmlElement(record.node,'select')||h.editable(record.node);},
  clickable(node:HTMLElement){return angularMcpHtmlElement(node,'button')||angularMcpHtmlElement(node,'a')||angularMcpHtmlElement(node,'label')||angularMcpHtmlElement(node,'input')&&['button','submit','reset','image','radio','checkbox'].includes(node.type)||['button','menuitem','menuitemcheckbox','menuitemradio','option','combobox','listbox','radio','checkbox','switch'].includes((node.getAttribute('role')||'').trim().split(/\s+/)[0]||'');},
  keyboardTarget(node:HTMLElement){return angularMcpHtmlElement(node,'input')&&!['file','hidden'].includes(node.type)||angularMcpHtmlElement(node,'textarea')||angularMcpHtmlElement(node,'select')||h.editable(node)||node.getAttribute('role')==='dialog'&&node.tabIndex>=0;},
  customAccessor(record:RecordEntry){const accessor=record.ngControl&&record.ngControl.valueAccessor;return !!accessor&&![DefaultValueAccessor,CheckboxControlValueAccessor,NumberValueAccessor,RangeValueAccessor,SelectControlValueAccessor,SelectMultipleControlValueAccessor,RadioControlValueAccessor].some(type=>accessor instanceof type);},
  editable(node:HTMLElement){return node.isContentEditable&&['true','plaintext-only',''].includes(node.getAttribute('contenteditable')??'missing');},
  native(record:RecordEntry):any{const node=record.node;if(angularMcpHtmlElement(node,'input')||angularMcpHtmlElement(node,'textarea')||angularMcpHtmlElement(node,'select')||h.editable(node))return node;if(!record.ngControl&&!h.signalState(record))return undefined;const inner=Array.from(node.querySelectorAll<HTMLElement>('input,textarea,select,[contenteditable]')).filter(node=>angularMcpHtmlElement(node,'input')||angularMcpHtmlElement(node,'textarea')||angularMcpHtmlElement(node,'select')||h.editable(node));return inner.length===1?inner[0]:undefined;},
  filePointer(node:HTMLInputElement){const offer=fileOffers.get(node);if(offer&&offer.until>=Date.now()&&offer.trigger.isConnected&&h.visible(offer.trigger)&&!h.disabled(offer.trigger))return offer.trigger;const rect=node.getBoundingClientRect(),labels=Array.from(node.labels||[]).filter(label=>h.visible(label)),top=node.ownerDocument.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);if(h.visible(node)&&getComputedStyle(node).opacity!=='0'&&rect.width>=2&&rect.height>=2&&(top&&node.contains(top)||!labels.length))return node;if(labels.length!==1)throw new Error('A hidden file input needs one visible associated label or a recent exact UI upload trigger');return labels[0]!;},
  offered(node:HTMLElement){if(angularMcpHtmlElement(node,'input')&&node.type==='file')try{return h.visible(h.filePointer(node));}catch{return false;}return h.visible(node);},
  visible(node:HTMLElement){const exposed=(element:HTMLElement)=>{const hidden=element.closest('[aria-hidden="true"]'),authored=hidden===element&&Array.from(records.values()).some(record=>record.node===element&&record.events.includes('click'));return !!element.getClientRects().length&&element.ownerDocument.defaultView?.getComputedStyle(element).visibility!=='hidden'&&!element.closest('[hidden],[inert]')&&(!hidden||authored);};const frames=h.frames(node);return !!frames&&exposed(node)&&frames.every(frame=>exposed(frame));},
  disabled(node:HTMLElement){return node.matches(':disabled')||node.getAttribute('aria-disabled')==='true'||!!node.closest('[inert]');},
  readonly(node:HTMLElement){return 'readOnly' in node&&!!(node as HTMLInputElement).readOnly||node.getAttribute('aria-readonly')==='true';},
  errors(errors:any){const result:any[]=[];for(const code of Object.keys(errors||{})){const details:any={};const data=errors[code];if(data&&typeof data==='object')for(const key of ['requiredLength','min','max','requiredPattern'])if(['string','number','boolean'].includes(typeof data[key]))details[key]=data[key];result.push(Object.keys(details).length?{code,details}:{code});}return result;},
  nativeErrors(node:HTMLElement){if(!('validity' in node)||!(node as HTMLInputElement).willValidate)return [];const validity=(node as HTMLInputElement).validity;return ['badInput','customError','patternMismatch','rangeOverflow','rangeUnderflow','stepMismatch','tooLong','tooShort','typeMismatch','valueMissing'].filter(key=>(validity as any)[key]);},
  fields(form:RecordEntry,includeAliases=false){const root=h.formControl(form),fields=h.all().filter(record=>{if(record===form||!h.isControl(record))return false;const node=record.node as any;if(node.form)return node.form===form.node;const control=h.control(record);return !!root&&control&&control.root===root||form.node.contains(node);});if(includeAliases)return fields;return fields.filter(record=>{const native=h.native(record);return !native||!fields.some(parent=>parent!==record&&parent.node.contains(record.node)&&h.native(parent)===native);});},
  path(record:RecordEntry,root?:any):string[]|undefined{
   const control=h.control(record);if(!control)return undefined;
   if(!root){try{const path=record.ngControl.path;if(Array.isArray(path)&&path.length)return path.map(String);}catch{}root=control.root;}
   const seen=new Set<any>();let visits=0;
   function walk(current:any,path:string[]):string[]|undefined{if(current===control)return path;if(!current||seen.has(current)||visits++>10000)return undefined;seen.add(current);for(const key of Object.keys(current.controls||{})){const found=walk(current.controls[key],path.concat(String(key)));if(found)return found;}return undefined;}
   return walk(root,[]);
  },
  validation(record:RecordEntry){
   const fields=h.isForm(record)?h.fields(record,true):h.isControl(record)?[record]:[];
   const states:any[]=[],groups:any[]=[],seen=new Set<any>(),unobserved:string[]=[];let invalid=false,pending=false,known=false;
   const roots:any[]=[];const form=h.formControl(record);if(form)roots.push(form);
   const signalRoot=h.signalRootState(record);if(signalRoot){const status=h.signalStatus(signalRoot);known=true;if(status==='INVALID')invalid=true;if(status==='PENDING')pending=true;groups.push({path:[],status,errors:h.signalErrors(signalRoot)});}
   for(const field of fields){const control=h.control(field),signal=h.signalState(field),nativeErrors=h.nativeErrors(field.node);let status=signal?h.signalStatus(signal):control?String(control.status):nativeErrors.length?'INVALID':'UNKNOWN';if(control||signal)known=true;else unobserved.push(field.instanceId);if(control&&!signal&&!control.root)unobserved.push(field.instanceId);if(status==='INVALID'||nativeErrors.length)invalid=true;if(status==='PENDING')pending=true;
    const path=h.path(field,form);states.push({sourceId:field.sourceId,instanceId:field.instanceId,...path?{path}:{},status,...control?{updateOn:control.updateOn,errors:h.errors(control.errors)}:{errors:[]},...nativeErrors.length?{nativeErrors}:{}});
    if(signal)states[states.length-1].errors=h.signalErrors(signal);
    if(control)for(let parent=control.parent;parent;parent=parent.parent)roots.push(parent);
   }
   for(const group of roots){if(seen.has(group))continue;seen.add(group);known=true;const status=String(group.status);if(status==='INVALID')invalid=true;if(status==='PENDING')pending=true;groups.push({path:[],status,errors:h.errors(group.errors)});}
   return {status:pending?'pending':invalid?'invalid':known&&!unobserved.length?'valid':'unknown',fields:states,groups,...unobserved.length?{unobservedFields:unobserved}:{}};
  },
  supported(record:RecordEntry){const node=h.native(record);if(!node||node!==record.node&&h.readonly(node))return false;if(angularMcpHtmlElement(node,'input')){if(['hidden','button','submit','reset','image','radio'].includes(node.type))return false;return true;}return angularMcpHtmlElement(node,'textarea')||angularMcpHtmlElement(node,'select')||h.editable(node);},
  options(node:HTMLSelectElement){return Array.from(node.options).map(option=>({value:option.value,label:option.label,disabled:option.disabled||!!option.closest('optgroup[disabled]'),selected:option.selected}));},
  schema(record:RecordEntry):any{const node=h.native(record);if(!h.supported(record))return false;if(angularMcpHtmlElement(node,'input')&&node.type==='file')return {type:'object',properties:{files:{type:'array',maxItems:node.multiple?16:1,items:{type:'object',properties:{name:{type:'string',minLength:1,maxLength:255},mimeType:{type:'string',maxLength:128},base64:{type:'string',maxLength:699052}},required:['name','mimeType','base64'],additionalProperties:false}}},required:['files'],additionalProperties:false};if(h.editable(node))return {type:'string',description:'Plain text inserted through the original editing surface. HTML markup is treated as text.'};if(angularMcpHtmlElement(node,'input')&&node.type==='checkbox')return {type:'boolean'};if(angularMcpHtmlElement(node,'input')&&['number','range'].includes(node.type))return {type:['number','null']};if(angularMcpHtmlElement(node,'select')&&node.multiple)return {type:'array',items:{type:'string'}};return {type:'string',...angularMcpHtmlElement(node,'input')&&node.type==='password'?{writeOnly:true}:{}};},
  value(record:RecordEntry):any{const node=h.native(record);if(angularMcpHtmlElement(node,'input')){if(node.type==='password'||node.type==='file'||node.type==='hidden')return undefined;if(node.type==='checkbox'||node.type==='radio')return node.checked;if(['number','range'].includes(node.type))return node.value===''?null:node.valueAsNumber;return node.value;}if(angularMcpHtmlElement(node,'select')&&node.multiple)return Array.from(node.selectedOptions).map(option=>option.value);if(angularMcpHtmlElement(node,'select')||angularMcpHtmlElement(node,'textarea'))return node.value;if(node&&h.editable(node))return node.innerText;return undefined;},
  sensitive(record:RecordEntry){const node=record.node;return node.matches('input[type="password"],input[type="hidden"],input[type="file"]')||!!node.querySelector('input[type="password"],input[type="hidden"],input[type="file"]');},
  modelKind(value:any){return value===null?'null':Array.isArray(value)?'array':['string','number','boolean','object','undefined'].includes(typeof value)?typeof value:'unknown';},
  model(record:RecordEntry):any{const control=h.control(record);if(!control||h.sensitive(record))return {};const value=control.value,primitive=(value:any)=>value===null||typeof value==='string'&&value.length<=8192||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value);if(Array.isArray(value)){const size=Object.getOwnPropertyDescriptor(value,'length')?.value,result:any={modelKind:'array',modelSize:size};if(typeof size!=='number'||size>1000)return result;const descriptors=Object.getOwnPropertyDescriptors(value),snapshot:any[]=[];for(let index=0;index<size;index++){const entry=descriptors[String(index)];if(!entry||!('value'in entry)||!primitive(entry.value))return result;snapshot.push(entry.value);}return {...result,modelValue:snapshot};}return {modelKind:h.modelKind(value),...primitive(value)?{modelValue:value}:{}};},
  readModel(record:RecordEntry):any{
   if(h.sensitive(record))return {kind:'unknown',complete:false,reason:'Sensitive native controls do not expose model snapshots'};
   const control=h.control(record),signal=h.signalState(record);if(!control&&!signal)return {kind:'unknown',complete:false,reason:'This target has no registered public Angular control model'};
   let value:any;try{value=control?control.value:signal.value();}catch{return {kind:'unknown',complete:false,reason:'The public Angular model value could not be read'};}
   const kind=h.modelKind(value),active=new Set<any>();let nodes=0,characters=0;
   const inspect=(current:any,depth:number):any=>{
    if(depth>8||++nodes>1000)throw new Error('The model snapshot exceeds the depth or node budget');
    if(current===null||typeof current==='boolean')return current;
    if(typeof current==='number'){if(!Number.isFinite(current))throw new Error('Non-finite numbers are not JSON data');return current;}
    if(typeof current==='string'){characters+=current.length;if(characters>8192)throw new Error('The model snapshot exceeds the string budget');return current;}
    if(typeof current!=='object')throw new Error('The model contains a non-JSON value');
    if(active.has(current))throw new Error('The model contains a cycle');active.add(current);
    try{
     const array=Array.isArray(current),prototype=Object.getPrototypeOf(current);if(!array&&prototype!==Object.prototype&&prototype!==null)throw new Error('Only plain JSON data objects can be observed');
     if(array){const size=Object.getOwnPropertyDescriptor(current,'length')?.value;if(typeof size!=='number'||size>1000-nodes)throw new Error('The model snapshot exceeds the node budget');}
     const keys=Reflect.ownKeys(current);if(keys.length>1001)throw new Error('The model snapshot exceeds the property budget');
     const descriptors=Object.getOwnPropertyDescriptors(current);
     if(array){const result:any[]=[],size=descriptors['length']!.value;for(const key of keys){if(key==='length')continue;if(typeof key!=='string'||!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=size)throw new Error('The array contains non-JSON properties');}for(let index=0;index<size;index++){const entry=descriptors[String(index)];if(!entry||!('value'in entry))throw new Error('Sparse arrays and accessor properties have no complete JSON snapshot');result.push(inspect(entry.value,depth+1));}return result;}
     const result:any=Object.create(null);for(const key of keys){if(typeof key!=='string')continue;const entry=descriptors[key];if(!entry||!entry.enumerable)continue;if(!('value'in entry))throw new Error('Accessor properties have no complete JSON snapshot');characters+=key.length;if(characters>8192)throw new Error('The model snapshot exceeds the string budget');Object.defineProperty(result,key,{value:inspect(entry.value,depth+1),enumerable:true,writable:true,configurable:true});}return result;
    }finally{active.delete(current);}
   };
   try{return {kind,value:inspect(value,0),complete:true};}catch(error){return {kind,complete:false,reason:error instanceof Error?error.message:String(error)};}
  },
  labelInfo(node:HTMLElement){const text=(value:any)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,240),references=(node.getAttribute('aria-labelledby')||'').trim().split(/\s+/).slice(0,16).map(id=>node.ownerDocument.getElementById(id)?.textContent||'').join(' '),labels='labels' in node?Array.from((node as HTMLInputElement).labels||[]).map(label=>label.textContent||'').join(' '):'';
   for(const [source,value]of [['aria-label',node.getAttribute('aria-label')],['aria-labelledby',references],['label',labels],['title',node.getAttribute('title')],['placeholder',node.getAttribute('placeholder')]] as const)if(text(value))return{label:text(value),labelSource:source};
   if(angularMcpHtmlElement(node,'input')||angularMcpHtmlElement(node,'textarea')||angularMcpHtmlElement(node,'select'))for(let parent=node.parentElement,depth=0;parent&&parent.localName!=='form'&&depth<3;parent=parent.parentElement,depth++){const controls=parent.querySelectorAll('input,textarea,select,[contenteditable="true"]'),nearby=Array.from(parent.querySelectorAll('label')).filter(label=>!label.htmlFor&&!label.control&&h.visible(label));if(controls.length===1&&controls[0]===node&&nearby.length===1&&text(nearby[0]!.textContent))return{label:text(nearby[0]!.textContent),labelSource:'single-control-context'};if(controls.length>1)break;}
   return{label:text(node.textContent||node.getAttribute('name')),labelSource:'content'};
  },
  label(node:HTMLElement){return h.labelInfo(node).label;},
  describe(record:RecordEntry,includeFields=true):any{
   const form=h.isForm(record),control=h.isControl(record),node=record.node,native=h.native(record);
   const action=h.clickable(node)||h.keyboardTarget(node)||!!native&&h.editable(native)||record.events.some(event=>['click','dblclick','mousedown','mouseup','pointerdown','pointerup','blur','keyup','keydown'].includes(event)||event.indexOf('keyup.')===0||event.indexOf('keydown.')===0);
   const operations:string[]=[];if(h.supported(record))operations.push('fill');if(action)operations.push('activate','drag');if(form)operations.push('submit');
   const path=h.path(record),value=h.value(record),schema=control?h.schema(record):undefined;
   const role=node.getAttribute('role'),aria:any={};for(const key of ['expanded','selected','checked','pressed','controls','disabled']){const value=node.getAttribute('aria-'+key);if(value!==null)aria[key]=value;}
   const result:any={sourceId:record.sourceId,instanceId:record.instanceId,kind:form?'form':control?'control':action?'action':'element',tagName:node.tagName.toLowerCase(),...role?{role}:{},...Object.keys(aria).length?{aria}:{},...record.events.includes('click')?{clickOrigin:'authored'}:h.clickable(node)?{clickOrigin:'native-ui'}:{},tabIndex:node.tabIndex,keyboardFocusable:node.tabIndex>=0||!!native&&native.tabIndex>=0,events:record.events.slice(),...h.labelInfo(node),visible:h.offered(node),disabled:h.disabled(node)||!!native&&h.disabled(native)||!!h.control(record)&&h.control(record).disabled,readonly:h.readonly(node)||!!native&&h.readonly(native),operations,validation:h.validation(record),...schema!==undefined?{schema}:{},...value!==undefined?{value}:{},...h.model(record),...path?{path}:{}};
   const owner=(node as any).form||node.closest('form'),context=node.closest('tr,li,[role="row"],[role="listitem"],[role="dialog"]');for(const [key,element]of [['formTarget',owner],['contextTarget',context]] as const){if(element&&element!==node){const parent=h.all().find(candidate=>candidate.node===element);if(parent)result[key]={sourceId:parent.sourceId,instanceId:parent.instanceId};}}
   const frame=h.frames(node)?.[0],frameRecord=frame&&h.all().find(candidate=>candidate.node===frame);if(frameRecord)result.frameTarget={sourceId:frameRecord.sourceId,instanceId:frameRecord.instanceId};
   if(control&&!h.supported(record))result.unsupportedReason=node.tagName.indexOf('-')>=0?'Custom value accessor needs a UI adapter; no model setter is used':'This native control has no supported JSON fill operation';
   if(control){result.transport='native-ui';result.customAccessor=h.customAccessor(record);if(h.supported(record))result.fillModes=native&&h.editable(native)||angularMcpHtmlElement(native,'textarea')||angularMcpHtmlElement(native,'input')&&!['checkbox','number','range','file'].includes(native.type)?['paste','input']:['input'];}
   if(angularMcpHtmlElement(native,'select'))result.options=h.options(native);
   if(form)result.submitterCount=Array.from((node as HTMLFormElement).elements).filter(element=>(angularMcpHtmlElement(element,'button')||angularMcpHtmlElement(element,'input'))&&element.type==='submit'&&element.form===node&&h.visible(element)).length;
   if(form&&includeFields)result.fields=h.fields(record).map(field=>h.describe(field,false));return result;
  },
  async ready(node:HTMLElement,allowReadonly=false){if(!node.isConnected||!h.visible(node)||h.disabled(node)||!allowReadonly&&h.readonly(node))throw new Error('The application made this target unavailable, disabled, or readonly');node.scrollIntoView({block:'center',behavior:'auto'});for(let attempt=0;attempt<200;attempt++){if(!node.isConnected||!h.visible(node)||h.disabled(node)||!allowReadonly&&h.readonly(node))throw new Error('The application changed this target while it was being prepared');const rect=node.getBoundingClientRect();for(const x of [0.5,0.2,0.8])for(const y of [0.5,0.2,0.8]){const point={x:rect.left+rect.width*x,y:rect.top+rect.height*y},exposed=h.uncovered(node,point);if(exposed)return point;}await new Promise<void>(done=>setTimeout(done,25));}throw new Error('Another UI element is covering the target');},
  choicePointer(node:HTMLInputElement,record?:RecordEntry):HTMLElement{node.scrollIntoView({block:'center',behavior:'auto'});const rect=node.getBoundingClientRect(),top=node.ownerDocument.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);if(!h.visible(node)||getComputedStyle(node).opacity==='0'||rect.width<2||rect.height<2||!top||!node.contains(top)){const associated=Array.from(node.labels||[]),labels=associated.filter(label=>h.visible(label));if(labels.length===1)return labels[0]!;if(!associated.length&&node.type==='checkbox'&&record&&record.ngControl&&record.node!==node&&h.native(record)===node){const roles=Array.from(record.node.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(role=>h.visible(role));if(roles.length===1)return roles[0]!;}throw new Error('The hidden checkbox or radio needs one visible associated label or an exact control-owned checkbox affordance');}return node;},
  async pending(record:RecordEntry,timeout:number){const until=Date.now()+timeout;while(h.validation(record).status==='pending'){if(Date.now()>=until)return false;await new Promise<void>(done=>setTimeout(done,20));}return true;},
  async render(){await new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())));const animations=typeof document.getAnimations==='function'?document.getAnimations().filter(animation=>{const end=animation.effect?.getComputedTiming().endTime;return animation.playState==='running'&&typeof end==='number'&&Number.isFinite(end)&&end<=1000;}):[];if(animations.length)await Promise.race([Promise.allSettled(animations.map(animation=>animation.finished)),new Promise<void>(done=>setTimeout(done,1000))]);},
  async fill(record:RecordEntry,value:any,changed:string[],mode?:string){
   if(!h.supported(record))throw new Error('Unsupported native control or custom value accessor; a UI adapter is required');
   if(mode!==undefined&&!['paste','input'].includes(mode))throw new Error('Fill mode must be paste or input');
   const node=h.native(record)!,realm:any=node.ownerDocument.defaultView||window;if(h.disabled(record.node)||h.readonly(record.node)||h.disabled(node)||h.readonly(node)||h.control(record)&&h.control(record).disabled)throw new Error('The application disabled or made this control readonly');
   if(angularMcpHtmlElement(node,'input')&&node.type==='file'){
    if(!value||typeof value!=='object'||!Array.isArray(value.files)||Object.keys(value).some(key=>key!=='files')||value.files.length>(node.multiple?16:1))throw new Error('File input requires a bounded files array');
    const transfer=new realm.DataTransfer();let total=0;
    for(const file of value.files){
     if(!file||Object.keys(file).some(key=>!['name','mimeType','base64'].includes(key))||typeof file.name!=='string'||!file.name||file.name.length>255||/[\\/\x00-\x1f]/.test(file.name)||typeof file.mimeType!=='string'||file.mimeType.length>128||file.mimeType&&!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.mimeType)||typeof file.base64!=='string'||file.base64.length>699052||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64))throw new Error('Invalid file name, media type, or base64 data');
     const binary=atob(file.base64);if(btoa(binary)!==file.base64||(total+=binary.length)>524288)throw new Error('Files exceed the 512 KiB input budget or use noncanonical base64');
     const accepts=node.accept.split(',').map((item:string)=>item.trim().toLowerCase()).filter(Boolean),name=file.name.toLowerCase(),mime=file.mimeType.toLowerCase();if(accepts.length&&!accepts.some((item:string)=>item.startsWith('.')?name.endsWith(item):item.endsWith('/*')?mime.startsWith(item.slice(0,-1)):mime===item))throw new Error('The file does not match the current input accept types');
     transfer.items.add(new realm.File([Uint8Array.from(binary,character=>character.charCodeAt(0))],file.name,{type:file.mimeType}));
    }
    await h.ready(h.filePointer(node));node.files=transfer.files;fileOffers.delete(node);changed.push(record.instanceId);h.dispatch(record,node,new realm.Event('input',{bubbles:true}));h.dispatch(record,node,new realm.Event('change',{bubbles:true}));await h.render();return false;
   }
   if(h.editable(node)){
    if(typeof value!=='string')throw new Error('An editing surface requires plain text');await h.ready(node);h.focus(record,node);
    const selection=node.ownerDocument.defaultView?.getSelection();if(!selection)throw new Error('The browser editing selection is unavailable');const range=node.ownerDocument.createRange();range.selectNodeContents(node);selection.removeAllRanges();selection.addRange(range);await h.render();if(!h.live(record)||h.native(record)!==node)throw new Error('The editing surface changed while its selection was prepared');
    if((mode||'paste')==='paste'){const clipboard=new realm.DataTransfer();clipboard.setData('text/plain',value);changed.push(record.instanceId);if(!h.dispatch(record,node,new realm.ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}))){h.blur(record,node);await h.render();return false;}}
    if(!h.dispatch(record,node,new realm.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertReplacementText',data:value})))throw new Error('The application refused the edit before input');
    if(!node.ownerDocument.execCommand('insertText',false,value))throw new Error('The browser editing command refused this surface');if(!changed.includes(record.instanceId))changed.push(record.instanceId);h.blur(record,node);await h.render();if(!node.isConnected)return true;return false;
   }
   let pointer:HTMLElement=node;
   if(angularMcpHtmlElement(node,'input')&&node.type==='checkbox')pointer=h.choicePointer(node,record);
   await h.ready(pointer);
   if(angularMcpHtmlElement(node,'input')&&node.type==='checkbox'){if(typeof value!=='boolean')throw new Error('A checkbox value must be boolean');}
   else if(angularMcpHtmlElement(node,'input')&&['number','range'].includes(node.type)){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)))throw new Error('A numeric input value must be a finite number or null');}
   else if(angularMcpHtmlElement(node,'select')&&node.multiple){if(!Array.isArray(value)||value.some(item=>typeof item!=='string')||new Set(value).size!==value.length)throw new Error('A multiple select value must be distinct option strings');}
   else if(typeof value!=='string')throw new Error('This input requires a string');
   if(angularMcpHtmlElement(node,'select')){const wanted=Array.isArray(value)?value:[value],options=h.options(node);for(const key of wanted){const matches=options.filter(option=>option.value===key);if(matches.length!==1||matches[0]!.disabled)throw new Error('A select option is unavailable, disabled, or ambiguous');}}
   if((angularMcpHtmlElement(node,'input')||angularMcpHtmlElement(node,'textarea'))&&typeof value==='string'&&node.maxLength>=0&&value.length>node.maxLength)throw new Error('The current input maxlength refuses this value');
   h.focus(record,node);let pasted=false;
   if(angularMcpHtmlElement(node,'input')&&node.type==='checkbox'){
    if(node.checked!==value){if(!changed.includes(record.instanceId))changed.push(record.instanceId);h.click(record,pointer);}
    h.blur(record,node);await h.render();if(node.checked!==value)throw new Error('The application did not retain the requested checkbox state');return false;
   }
   if((angularMcpHtmlElement(node,'textarea')||angularMcpHtmlElement(node,'input')&&!['number','range'].includes(node.type))&&(mode||'paste')==='paste'){
    try{node.select();}catch{}const clipboard=new realm.DataTransfer();clipboard.setData('text/plain',value);
    if(!changed.includes(record.instanceId))changed.push(record.instanceId);
    const unhandled=h.dispatch(record,node,new realm.ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
    if(!unhandled){h.blur(record,node);await h.render();return false;}
    if(!h.dispatch(record,node,new realm.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertFromPaste',data:value})))throw new Error('The application refused the paste before input');
    pasted=true;
   }
   if(angularMcpHtmlElement(node,'select')&&node.multiple){for(const option of Array.from(node.options))option.selected=value.indexOf(option.value)>=0;}
   else{const prototype=angularMcpHtmlElement(node,'textarea')?HTMLTextAreaElement.prototype:angularMcpHtmlElement(node,'select')?HTMLSelectElement.prototype:HTMLInputElement.prototype;const key=angularMcpHtmlElement(node,'input')&&node.type==='checkbox'?'checked':'value',setter=Object.getOwnPropertyDescriptor(prototype,key)&&Object.getOwnPropertyDescriptor(prototype,key)!.set;if(!setter)throw new Error('No native input setter is available');setter.call(node,value===null?'':value);}
   if(!changed.includes(record.instanceId))changed.push(record.instanceId);
   const accepted=h.value(record);if(angularMcpHtmlElement(node,'input')&&node.type==='password'){if(node.value!==value)throw new Error('The browser did not accept the requested value');}
   else if(angularMcpHtmlElement(node,'select')&&node.multiple){if(JSON.stringify((accepted as string[]).slice().sort())!==JSON.stringify(value.slice().sort()))throw new Error('The browser did not accept the requested options');}
   else if(JSON.stringify(accepted)!==JSON.stringify(value))throw new Error('The browser did not accept the requested input value');
   h.dispatch(record,node,new realm.InputEvent('input',{bubbles:true,inputType:pasted?'insertFromPaste':'insertReplacementText',data:typeof value==='string'?value:null}));h.dispatch(record,node,new realm.Event('change',{bubbles:true}));h.blur(record,node);
   await h.render();
   if(!node.isConnected)return true;return false;
  },
  async keyboard(record:RecordEntry,key?:string){
   if(typeof key!=='string'||!key||key.length>100)throw new Error('A bounded keyboard key is required');
   const native=h.native(record),node=(native&&native.tabIndex>=0?native:record.node) as HTMLElement;
   if(!h.live(record)||!node.isConnected||!h.visible(record.node)||!h.visible(node)||h.disabled(record.node)||h.disabled(node)||h.control(record)&&h.control(record).disabled||node.tabIndex<0&&!h.editable(node)||typeof node.focus!=='function'||angularMcpHtmlElement(node,'input')&&['hidden','file'].includes(node.type))throw new Error('The exact keyboard target is unavailable or not focusable');
   const frames=h.frames(node);if(!frames)throw new Error('The keyboard document is stale');
   for(const subject of [node,...frames]){const owner=subject.ownerDocument;for(const modal of Array.from(owner.querySelectorAll<HTMLElement>('dialog:modal,[role="dialog"][aria-modal="true"],[role="alertdialog"][aria-modal="true"]')))if(h.visible(modal)&&!modal.contains(subject))throw new Error('A modal is blocking this keyboard target');}
   h.focus(record,node);await h.render();if(node.ownerDocument.activeElement!==node||frames.some(frame=>frame.ownerDocument.activeElement!==frame))throw new Error('The application does not permit focus on this exact keyboard target');
   const aliases:any={Space:' ',Spacebar:' ',NumpadEnter:'Enter',Esc:'Escape'},actual=aliases[key]||key,codes:any={Enter:13,' ':32,Escape:27,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Home:36,End:35,PageUp:33,PageDown:34,Backspace:8,Delete:46,Tab:9};
   const code=key==='NumpadEnter'?'NumpadEnter':actual===' '?'Space':/^[a-z]$/i.test(actual)?'Key'+actual.toUpperCase():/^[0-9]$/.test(actual)?'Digit'+actual:actual,keyCode=codes[actual]||(/^[a-z0-9]$/i.test(actual)?actual.toUpperCase().charCodeAt(0):0),realm:any=node.ownerDocument.defaultView;
   const event=(type:string)=>h.dispatch(record,node,new realm.KeyboardEvent(type,{key:actual,code,keyCode,which:keyCode,bubbles:true,cancelable:true}));
   const activates=angularMcpHtmlElement(node,'button')||angularMcpHtmlElement(node,'input')&&['button','submit','reset','image'].includes(node.type)||actual==='Enter'&&angularMcpHtmlElement(node,'a')||actual===' '&&angularMcpHtmlElement(node,'input')&&['checkbox','radio'].includes(node.type);
   const accepted=event('keydown');if(accepted&&actual==='Enter'&&activates)h.click(record,node);const released=event('keyup');if(accepted&&released&&actual===' '&&activates)h.click(record,node);
  },
  async activate(record:RecordEntry,event?:string,key?:string){if(event==='keyboard'){await h.keyboard(record,key);return;}const node=record.node;if(h.disabled(node)||h.control(record)&&h.control(record).disabled)throw new Error('The application disabled this target');const selected=event||'click',pointer=selected==='click'&&angularMcpHtmlElement(node,'input')&&['checkbox','radio'].includes(node.type)?h.choicePointer(node):node;await h.ready(pointer,true);
   if(selected==='select-all'){const field=h.native(record)||node,plain=angularMcpHtmlElement(field,'textarea')||angularMcpHtmlElement(field,'input')&&typeof field.selectionStart==='number';if(!plain&&!h.editable(field))throw new Error('Select-all requires an exact text input or editing surface');await h.ready(field,true);h.focus(record,field);if(plain)(field as HTMLInputElement|HTMLTextAreaElement).select();else{const selection=field.ownerDocument.defaultView?.getSelection();if(!selection)throw new Error('The browser editing selection is unavailable');const range=field.ownerDocument.createRange();range.selectNodeContents(field);selection.removeAllRanges();selection.addRange(range);}await h.render();return;}
   if(selected==='click'){if(!h.clickable(node)&&!h.keyboardTarget(node)&&!record.events.includes('click'))throw new Error('The source does not expose a click action on this target');h.click(record,pointer);return;}
   if(!record.events.includes(selected)&&!(selected==='keydown'&&key==='Escape'&&h.keyboardTarget(node)))throw new Error('This event is not an authored action or supported native Escape dismissal on this target');
   if(['dblclick','mousedown','mouseup','pointerdown','pointerup'].includes(selected)){h.dispatch(record,node,new (node.ownerDocument.defaultView!.MouseEvent)(selected,{bubbles:true,cancelable:true,view:node.ownerDocument.defaultView,button:0,buttons:selected.endsWith('down')?1:0,detail:1}));return;}
   const keyboard=/^(keyup|keydown)(?:\.(enter|escape|tab|space))?$/i.exec(selected);if(keyboard){const names:any={enter:'Enter',escape:'Escape',tab:'Tab',space:' '};if(key!==undefined&&(typeof key!=='string'||key.length>100))throw new Error('A keyboard key must be a bounded string');const actual=keyboard[2]?names[keyboard[2].toLowerCase()]:key||'Unidentified';const code=actual===' '?'Space':/^[a-z]$/i.test(actual)?'Key'+actual.toUpperCase():/^[0-9]$/.test(actual)?'Digit'+actual:actual;h.focus(record,node);h.dispatch(record,node,new KeyboardEvent(keyboard[1]!,{key:actual,code,bubbles:true,cancelable:true}));return;}
   if(selected==='blur'){h.focus(record,node);h.blur(record,node);return;}throw new Error('This authored event needs an explicit UI adapter');
  },
  async drag(record:RecordEntry,destination:RecordEntry,position?:string){
   if(record.node.ownerDocument!==destination.node.ownerDocument)throw new Error('A pointer drag requires source and destination in the same document');
   if(position!==undefined&&!['before','after'].includes(position))throw new Error('Drag position must be before or after');
   if(record===destination)throw new Error('Drag requires distinct exact source and destination instances');
   if(!h.describe(record,false).operations.includes('drag'))throw new Error('The source has no pointer action affordance');
   await h.ready(record.node,true);await h.ready(destination.node,true);
   const source=record.node,start=await h.ready(source,true);
   let point=start,down=false;const owner=source.ownerDocument;
   const send=(type:string,where:HTMLElement|Document,x:number,y:number,buttons:number)=>{h.dispatch(record,where,new MouseEvent(type,{bubbles:true,cancelable:true,view:owner.defaultView,button:0,buttons,detail:1,clientX:x,clientY:y}));};
   try{
    h.focus(record,source);send('mousedown',source,start.x,start.y,1);down=true;
    send('mousemove',owner,start.x,start.y+8,1);await new Promise<void>(done=>requestAnimationFrame(()=>done()));
    const target=destination.node;if(!target.isConnected||h.disabled(target)||!h.visible(target))throw new Error('The drop destination changed during the drag');
    target.scrollIntoView({block:'nearest',behavior:'auto'});await new Promise<void>(done=>requestAnimationFrame(()=>done()));const end=target.getBoundingClientRect(),finish={x:end.left+end.width/2,y:end.top+end.height*(position==='before'?0.25:0.75)};
    for(let step=1;step<=16;step++){point={x:start.x+(finish.x-start.x)*step/16,y:start.y+(finish.y-start.y)*step/16};send('mousemove',owner,point.x,point.y,1);await new Promise<void>(done=>requestAnimationFrame(()=>done()));}
    send('mouseup',owner,point.x,point.y,0);down=false;await h.render();
   }finally{if(down)send('mouseup',owner,point.x,point.y,0);}
  },
  async submit(record:RecordEntry,submitter?:Target){const form=record.node;if(!(angularMcpHtmlElement(form,'form')))throw new Error('Submit needs a form target');
   const buttons=Array.from(form.elements).filter(element=>(angularMcpHtmlElement(element,'button')||angularMcpHtmlElement(element,'input'))&&element.type==='submit'&&element.form===form) as (HTMLButtonElement|HTMLInputElement)[];
   let button:HTMLButtonElement|HTMLInputElement|undefined;
   if(submitter){const selected=h.resolve(submitter).node;if(!(angularMcpHtmlElement(selected,'button')||angularMcpHtmlElement(selected,'input'))||selected.type!=='submit'||selected.form!==form)throw new Error('The submitter does not belong to this exact form');button=selected;}
   else{const visible=buttons.filter(button=>h.visible(button));if(visible.length!==1)throw new Error('The form needs one visible submit button or an explicit submitter target');button=visible[0]!;}
   await h.ready(button);let dispatched=false;const observed=(event:Event)=>{if(event.target===form)dispatched=true;};form.addEventListener('submit',observed,true);
   // The original submitter's click handlers are part of the UI workflow too. Its native default action submits once.
   try{h.click(record,button);}finally{form.removeEventListener('submit',observed,true);}return dispatched;
  }
 };
 const api:any={version:1,profile:'development',mode:"webmcp",
  subscribe(listener:()=>void){if(typeof listener!=='function')throw new Error('A registry listener must be a function');listeners.add(listener);return ()=>{listeners.delete(listener);};},
  notifyChanged(){notify();},
  list(){return h.all().map(record=>h.describe(record));},
  describe(target:Target){return h.describe(h.resolve(target));},
  readModel(target:Target){return h.readModel(h.resolve(target));},
  element(target:Target):HTMLElement{return h.resolve(target).node;},
  execute:async function execute(request:any,scheduled=false):Promise<any>{
   if(!scheduled&&request&&['fill','activate','submit','drag'].includes(request.operation)){const zone=h.resolve(request.target).zone??angularZone;if(zone){zone.run(()=>{});return new Promise((resolve,reject)=>{const schedule=()=>setTimeout(()=>{execute(request,true).then(resolve,reject);},0);if(typeof zone.runOutsideAngular==='function')zone.runOutsideAngular(schedule);else schedule();});}}
   if(busy)throw new Error('Another bridge operation is in progress');if(!request||!['fill','activate','submit','drag'].includes(request.operation))throw new Error('Unknown bridge operation');
   const record=h.resolve(request.target),changed:string[]=[],timeout=request.timeoutMs===undefined?5000:request.timeoutMs;if(!Number.isSafeInteger(timeout)||timeout<0||timeout>30000)throw new Error('timeoutMs must be an integer from zero through 30000');
   const result=(status:string,reason?:string)=>({status,operation:request.operation,target:{sourceId:record.sourceId,instanceId:record.instanceId},changed:changed.slice(),values:changed.map(id=>records.get(id)).filter((field):field is RecordEntry=>!!field&&h.live(field)).map(field=>{const value=h.value(field);return {sourceId:field.sourceId,instanceId:field.instanceId,...value!==undefined?{value}:{}};}),validation:h.validation(record),url:location.href,businessStatus:'unknown',...reason?{reason}:{}});
   const offerFile=(event:Event)=>{const node=event.target;if(request.operation==='activate'&&angularMcpHtmlElement(node,'input')&&node.type==='file'&&node.isConnected&&!h.disabled(node)){fileOffers.set(node,{trigger:record.node,until:Date.now()+30000});notify();}};const eventDocument=record.node.ownerDocument;eventDocument.addEventListener('click',offerFile,true);
   busy=true;let dispatched=false;
   try{
    const values=request.values||[];if(!Array.isArray(values)||values.length>1000)throw new Error('Form values must be a bounded array of target/value pairs');
    if(values.length&&request.operation!=='submit')throw new Error('Only a form submit can include multiple field values');
    const fields=values.map((entry:any)=>({record:h.resolve(entry.target),value:entry.value,mode:entry.mode||request.mode}));if(new Set(fields.map((entry:any)=>h.native(entry.record)||entry.record.node)).size!==fields.length)throw new Error('A field or its delegated native input was supplied more than once');
    if(fields.length){const allowed=new Set(h.fields(record).map(field=>field.instanceId));for(const field of fields)if(!allowed.has(field.record.instanceId))throw new Error('A supplied field does not belong to this exact form');}
    for(const field of fields)if(await h.fill(field.record,field.value,changed,field.mode)===true)return result('partial','A field was replaced after its UI edit. Discover the current form before continuing.');
    if(request.operation==='fill'){const replaced=await h.fill(record,request.value,changed,request.mode);dispatched=true;if(replaced===true)return result('ui-dispatched','The UI edit was dispatched and its view was replaced. Discover current instances before continuing.');}
    else if(request.operation==='drag'){await h.drag(record,h.resolve(request.destination),request.position);dispatched=true;}
    else{
     if(!await h.pending(record,timeout))return result(changed.length?'partial':'not-dispatched','Angular validation is still pending; the action was not dispatched');
     await h.render();
     if(request.operation==='submit')dispatched=await h.submit(record,request.submitter);else{await h.activate(record,request.event,request.key);dispatched=true;}
    }
    if(dispatched)await h.render();const settled=await h.pending(record,timeout);return result(dispatched?'ui-dispatched':changed.length?'partial':'not-dispatched',!dispatched?'The original UI action did not submit the form; validation or an authored handler prevented it':!settled?'Action dispatched; Angular validation is still pending':undefined);
   }catch(error){return result(changed.length||dispatched?'partial':'not-dispatched',error instanceof Error?error.message:String(error));}finally{eventDocument.removeEventListener('click',offerFile,true);busy=false;notify();}
  },
  register(sourceId:string,node:HTMLElement,ngControl:any,ngForm:any,group:any,signal?:any,signalRoot?:any,zone?:NgZone){if(zone&&!angularZone)angularZone=zone;const record:RecordEntry={sourceId,instanceId:sourceId+'@'+nonce+':'+(++sequence),node,events:[],ngControl,ngForm,group,signal,signalRoot,zone:zone??angularZone};records.set(record.instanceId,record);node.setAttribute('data-angular-mcp-instance',record.instanceId);notify();return record;},
  remove(record:RecordEntry){records.delete(record.instanceId);if(record.node.getAttribute('data-angular-mcp-instance')===record.instanceId)record.node.removeAttribute('data-angular-mcp-instance');notify();}
 };return api;
}
function bridge():any{if(typeof window==='undefined')return undefined;const w=window as any;if(w.__angularMcpBridge&&w.__angularMcpBridge.version!==1)throw new Error('An incompatible Angular MCP bridge is already installed');return w.__angularMcpBridge||(w.__angularMcpBridge=createBridge());}
@Directive({selector:'[angularMcpSource]',standalone:true})
export class AngularMcpSourceDirective implements OnDestroy{
 private entry:any;private events='';
 constructor(@Inject(ElementRef) private element:ElementRef<HTMLElement>,@Optional() @Self() @Inject(NgControl) private control:NgControl,@Optional() @Self() @Inject(NgForm) private form:NgForm,@Optional() @Self() @Inject(FormGroupDirective) private group:FormGroupDirective,@Optional() @Inject(NgZone) private zone:NgZone){}
 @Input('angularMcpSource')set source(value:string){if(this.entry)bridge().remove(this.entry);if(typeof value!=='string'||!value)throw new Error('angularMcpSource needs a stable source ID');const api=bridge(),node=this.element.nativeElement;if(api&&node&&node.nodeType===1){this.entry=api.register(value,node,this.control,this.form,this.group,undefined,undefined,this.zone);this.entry.events=this.events.split(',').map(event=>event.trim()).filter(Boolean);}}
 @Input('angularMcpEvents')set eventNames(value:string){this.events=value||'';if(this.entry){this.entry.events=this.events.split(',').map(event=>event.trim()).filter(Boolean);bridge().notifyChanged();}}
 ngOnDestroy(){if(this.entry)bridge().remove(this.entry);}
}
@NgModule({imports:[AngularMcpSourceDirective],exports:[AngularMcpSourceDirective]})
export class AngularMcpBridgeModule{}


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

import {connectNgxMcpAccess as __ngxMcpConnectAccess} from "./ngx-mcp.access-bootstrap";
bridge();

/** Automation consent is an additional boundary; backend authorization stays authoritative. */
function createIntegrationAccess(inputPolicy:any,environment:any):any{
 const cryptoApi:Crypto=environment&&environment.crypto||globalThis.crypto;
 if(!cryptoApi||typeof cryptoApi.getRandomValues!=='function'||!cryptoApi.subtle)throw new Error('Access controls require secure browser cryptography');
 const now=()=>environment&&typeof environment.now==='function'?environment.now():Date.now();
 const mutating=new Set(['fill','activate','submit','drag','press-key','upload-file','navigate']);
 const operations=new Set(['describe','read-value','read-model','fill','activate','submit','drag','press-key','upload-file','read-view','navigate']);
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
  for(const key of ['formTarget','contextTarget','frameTarget'])if(result[key]&&!access?.allows('describe',result[key].sourceId))delete result[key];
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
  const submits=operation==='activate'&&(nativeSubmit||input.event==='keyboard'&&['Enter','NumpadEnter'].includes(key||''))||operation==='press-key'&&(['Enter','NumpadEnter'].includes(key||'')||nativeSubmit&&['Space','Spacebar',' '].includes(key||''));
  if(submits){const form=formFor(node);if(form&&(!access.allows('submit',form.sourceId)||!access.allows('describe',form.sourceId)))throw new Error('Production policy does not allow this form submission');}
  if(operation==='drag'){const drop=descriptor(input.destination);if(!access.allows('describe',drop.sourceId)||!access.allows('drag',drop.sourceId))throw new Error('Production policy does not allow this drop destination');}
  if(selected&&selected.kind==='form'&&operation==='submit')submitFields(input,selected);
 }
 function redactResult(result:any):any{
  if(!result||typeof result!=='object')return result;const value=copy(result);
  for(const name of ['url','value','modelValue','modelSize','options','label','title','path','aria','reason','error','message'])delete value[name];
  if(Array.isArray(value.values))value.values=value.values.filter((field:any)=>access.allows('describe',field.sourceId)).map((field:any)=>{for(const name of ['value','modelValue','modelSize','options','label','path','aria'])delete field[name];return field;});
  if(Array.isArray(value.changed))value.changed=value.changed.filter((id:string)=>{try{return access.allows('describe',descriptor({instanceId:id}).sourceId);}catch{return false;}});
  if(value.validation&&Array.isArray(value.validation.fields))value.validation.fields=value.validation.fields.filter((field:any)=>access.allows('describe',field.sourceId)&&(!value.target||access.allowsField(value.target.sourceId,field.sourceId,'describe')));
  if(value.validation)for(const list of [value.validation.fields,value.validation.groups])if(Array.isArray(list))for(const entry of list)delete entry.path;
  return value;
 }
 api.list=()=>filteredList();
 api.inspect=(target:any)=>{ready();const node=descriptor(target),result=access.redactDescriptor(node.sourceId,node);if(!result)throw new Error('Production policy does not expose this target');return metadata(result);};
 api.catalog=async()=>guarded({operation:'catalog',sourceId:'@page',args:{}},()=>filteredList());
 api.describe=async(target:any)=>{const node=descriptor(target);return guarded({operation:'describe',sourceId:node.sourceId,instanceId:node.instanceId,args:{target:copy(target)}},()=>readable(node.sourceId,node));};
 api.readModel=async(target:any)=>{const node=descriptor(target);return guarded({operation:'read-model',sourceId:node.sourceId,instanceId:node.instanceId,args:{target:copy(target)}},()=>access.projectModel(node.sourceId,original.readModel(target)));};
 api.element=(target:any)=>{api.inspect(target);return original.element(target);};
 api.execute=async(input:any)=>{
  ready();const request=copy(input);if(!['fill','activate','submit','drag'].includes(request.operation))throw new Error('Unsupported production UI operation');
  const node=descriptor(request.target);
  const stateHash=await fingerprint(request.target)+(request.operation==='drag'?'|'+await fingerprint(request.destination):'');
  return guarded({operation:request.operation,sourceId:node.sourceId,instanceId:node.instanceId,args:{input:request,stateHash}},async(approved:any)=>{
   if(await fingerprint(approved.input.target)+(approved.input.operation==='drag'?'|'+await fingerprint(approved.input.destination):'')!==approved.stateHash)throw new Error('Production UI state changed after approval');
   const current=descriptor(approved.input.target);aliasCheck(approved.input.operation,approved.input,current);
   return redactResult(await original.execute(approved.input));
  });
 };
 api.toolAllowed=(name:string)=>{
  if(locked||!access||!access.state().live)return false;
  const operation=({angular_list_nodes:'catalog',angular_describe_node:'describe',angular_read_model:'read-model',angular_fill:'fill',angular_activate:'activate',angular_submit:'submit',angular_drag:'drag',angular_press_key:'press-key',angular_upload_file:'upload-file',angular_read_view:'read-view'} as any)[name];
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
   if(await fingerprint(approved.input.target)+(approved.input.operation==='drag'?'|'+await fingerprint(approved.input.destination):'')!==approved.stateHash)throw new Error('Production UI state changed after approval');
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
   if(request.args&&request.args.input&&['fill','activate','submit','drag','press-key','upload-file'].includes(request.operation)){
    const input=request.args.input,selected=input.target&&descriptor(input.target);aliasCheck(request.operation,input,selected);
   }
   return ownerAuthorize?await ownerAuthorize(request,session,options)===true:true;
  }};
  access=createIntegrationAccess(policy,secured);identity={id:environment.session.id,subject:environment.session.subject};
  await access.run({operation:'catalog',sourceId:'@page',args:{}},()=>true);locked=false;errorCode='';notify();
 }).catch(()=>{locked=true;errorCode='production-bootstrap-failed';notify();});
 return api;
}

installIntegrationProduction({"version":1,"allowedOrigins":["http://127.0.0.1:55972"],"rules":[{"sourceId":"ngmcp_07a613ae3b7cbdea7ee076ad","label":"button — src/app/components/dashboard/dashboard.component.ts:27","operations":["describe","activate"]},{"sourceId":"ngmcp_14c6f2e47d28559ac41b1ae2","label":"button — src/app/components/kanban/kanban.component.ts:75","operations":["describe","activate"]},{"sourceId":"ngmcp_14f4b3b54cda3d069d6b72fa","label":"button — src/app/components/kanban/kanban.component.ts:38","operations":["describe","activate"]},{"sourceId":"ngmcp_1c2a5db927f225fbd232364f","label":"mat-option — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:44","operations":["describe","activate"]},{"sourceId":"ngmcp_269d7015d750178c589db050","label":"input password — src/app/components/auth/login/login.component.ts:40","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_2a7e9b25e386d54a09784d68","label":"input username — src/app/components/auth/login/login.component.ts:35","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_3689ab2dbc10cdb2b1fe48b3","label":"input password — src/app/components/auth/register/register.component.ts:45","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_3f427051d54ea47294f1e3f5","label":"button — src/app/components/auth/login/login.component.ts:43","operations":["describe","activate"]},{"sourceId":"ngmcp_485f38c18ad43d90fec9527c","label":"form — src/app/components/auth/register/register.component.ts:32","operations":["describe","submit"],"writeFields":["ngmcp_3689ab2dbc10cdb2b1fe48b3","ngmcp_50c11cc7894b33e3c489e30e","ngmcp_d5767ca489688b254c9c3270"]},{"sourceId":"ngmcp_507c2f733c88fa44ef3666d8","label":"button — src/app/components/dashboard/dashboard.component.ts:47","operations":["describe","activate"]},{"sourceId":"ngmcp_50c11cc7894b33e3c489e30e","label":"input username — src/app/components/auth/register/register.component.ts:35","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_51903f51076ea2d972bf08d8","label":"button — src/app/components/kanban/kanban.component.ts:151","operations":["describe","activate"]},{"sourceId":"ngmcp_5b21ba19ec651c0375f057ca","label":"button — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:59","operations":["describe","activate"]},{"sourceId":"ngmcp_5d2f57b5772e13223215dd5b","label":"form — src/app/components/auth/login/login.component.ts:32","operations":["describe","submit"],"writeFields":["ngmcp_269d7015d750178c589db050","ngmcp_2a7e9b25e386d54a09784d68"]},{"sourceId":"ngmcp_6578ff961f1ceff5fe9cd59a","label":"input dueDate — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:52","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_66fc1f622ec7d39e8d4a4013","label":"button — src/app/components/dialogs/create-project-dialog/create-project-dialog.component.ts:36","operations":["describe","activate"]},{"sourceId":"ngmcp_789a222a52c57b7495e8c00b","label":"form — src/app/components/dialogs/create-project-dialog/create-project-dialog.component.ts:23","operations":["describe","submit"],"writeFields":["ngmcp_82fef9d9fab7a2124329753a","ngmcp_947f06861dc7434d5f730549"]},{"sourceId":"ngmcp_82fef9d9fab7a2124329753a","label":"input name — src/app/components/dialogs/create-project-dialog/create-project-dialog.component.ts:26","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_8b499b3c1b31c7582047456a","label":"form — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:30","operations":["describe","submit"],"writeFields":["ngmcp_6578ff961f1ceff5fe9cd59a","ngmcp_c1972f251f59bbee501e6e89","ngmcp_d7393f3107e9de233af3681d"]},{"sourceId":"ngmcp_947f06861dc7434d5f730549","label":"textarea description — src/app/components/dialogs/create-project-dialog/create-project-dialog.component.ts:31","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_a9c18e09100ece75e048186f","label":"button — src/app/components/auth/register/register.component.ts:48","operations":["describe","activate"]},{"sourceId":"ngmcp_b7ffe79e3201ca072a1b5011","label":"button — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:60","operations":["describe","activate"]},{"sourceId":"ngmcp_c1972f251f59bbee501e6e89","label":"textarea description — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:38","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_c4048490b17e679fb3e9bef6","label":"mat-option — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:46","operations":["describe","activate"]},{"sourceId":"ngmcp_c776685f67453c7bfd0b9c07","label":"button — src/app/components/kanban/kanban.component.ts:34","operations":["describe","activate"]},{"sourceId":"ngmcp_c7a83416ed429a914843d893","label":"button — src/app/components/kanban/kanban.component.ts:113","operations":["describe","activate"]},{"sourceId":"ngmcp_c90087235ecb54757de10a45","label":"mat-select status — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:43","operations":["describe","activate"]},{"sourceId":"ngmcp_d5767ca489688b254c9c3270","label":"input email — src/app/components/auth/register/register.component.ts:40","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_d62a8c923a45a3fc2b623be3","label":"button — src/app/components/dashboard/dashboard.component.ts:43","operations":["describe","activate"]},{"sourceId":"ngmcp_d7393f3107e9de233af3681d","label":"input title — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:33","operations":["describe","fill","activate"]},{"sourceId":"ngmcp_dd62c3222903c68984b6a253","label":"mat-option — src/app/components/dialogs/create-task-dialog/create-task-dialog.component.ts:45","operations":["describe","activate"]},{"sourceId":"ngmcp_eac740a9a710c232ff2584d0","label":"button — src/app/components/dialogs/create-project-dialog/create-project-dialog.component.ts:37","operations":["describe","activate"]}],"sessionMaxAgeMs":3600000,"approvalMaxAgeMs":60000,"maxAuditRecords":100000},"067a1fd7d735add756d2450c73892609ee232ea137775d3c1111a78b7f227135",__ngxMcpConnectAccess);

const integrationListNodes: (nodes: any[], query?: any) => any = function integrationListNodes(nodes,query={}){const limit=query.limit??100,offset=query.offset??0;if(!Number.isInteger(limit)||limit<1||limit>500||!Number.isInteger(offset)||offset<0||offset>1e5)throw new Error("Invalid node discovery page bounds");const matches=nodes.filter(node=>(query.kind===void 0||node.kind===query.kind)&&(query.visible===void 0||node.visible===query.visible)&&(query.operation===void 0||node.operations.includes(query.operation)));const selected=matches.slice(offset,offset+limit).map(node=>{if(query.includeFields!==false)return node;const compact={...node};delete compact.fields;compact.validation={status:node.validation.status,fields:[],groups:[]};return compact});return{nodes:selected,total:matches.length,offset,nextOffset:offset+selected.length<matches.length?offset+selected.length:null}};
const integrationFormTools: (nodes: any[], nameForInstance: (instanceId: string) => string) => any[] = function integrationFormTools(nodes,nameForInstance){const result=[];for(const node of nodes){if(!node.visible||node.disabled||node.kind!=="form"||node.submitterCount!==void 0&&node.submitterCount!==1)continue;const keys=new Set,bindings=Object.create(null),properties=Object.fromEntries([]);let supported=true;for(const field of node.fields??[]){if(!field.visible||field.disabled||field.readonly)continue;if(!field.operations.includes("fill")||field.schema===false){supported=false;break}const key=field.path?.length?field.path.join("."):field.instanceId;if(keys.has(key)){supported=false;break}keys.add(key);bindings[key]=field;Object.defineProperty(properties,key,{value:{...field.schema,title:field.label||key},enumerable:true,writable:true,configurable:true})}if(!supported)continue;result.push({name:nameForInstance(node.instanceId),title:node.label.slice(0,80)||"Submit live Angular form",description:"Submit this exact live Angular form through its original UI. Omitted fields retain current values. Angular evaluates dynamic and cross-field validation at runtime. Business success requires observing the app outcome.",inputSchema:{type:"object",properties,additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true},_meta:{angularMcpTarget:{sourceId:node.sourceId,instanceId:node.instanceId}},node,bindings})}return result};
const integrationValidateInput: (schema: any, value: any) => void = function integrationValidateInput(schema,value){const json=[value],seen=new Set;let count=0,characters=0;while(json.length){const current=json.pop();if(++count>1e4)throw new Error("Tool input exceeds the JSON node budget");if(current===null||typeof current==="boolean")continue;if(typeof current==="number"){if(!Number.isFinite(current))throw new Error("Tool input must contain finite JSON numbers");continue}if(typeof current==="string"){characters+=current.length;if(characters>1048576)throw new Error("Tool input exceeds the JSON string budget");continue}if(typeof current!=="object")throw new Error("Tool input must contain JSON data only");if(seen.has(current))throw new Error("Tool input contains repeated or cyclic object references");seen.add(current);const array=Array.isArray(current),prototype=Object.getPrototypeOf(current);if(!array&&prototype!==Object.prototype&&prototype!==null)throw new Error("Tool input must contain plain JSON objects");const descriptors=Object.getOwnPropertyDescriptors(current);for(const key of Reflect.ownKeys(current)){if(array&&key==="length")continue;if(typeof key!=="string")throw new Error("Tool input contains a non-JSON property");if(array&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=current.length))throw new Error("Tool input arrays cannot contain extra properties");const property=descriptors[key];if(!property||!("value"in property)||!property.enumerable)throw new Error("Tool input cannot contain accessors or hidden properties");characters+=key.length;if(characters>1048576)throw new Error("Tool input exceeds the JSON string budget");json.push(property.value)}if(array&&Object.keys(current).length!==current.length)throw new Error("Tool input arrays cannot be sparse")}const schemas=[schema];let schemaCount=0;while(schemas.length){const current=schemas.pop();if(++schemaCount>1e3)throw new Error("Tool schema exceeds the validation budget");if(typeof current==="boolean")continue;if(!current||typeof current!=="object"||Array.isArray(current))throw new Error("Invalid tool input schema");for(const key of Object.keys(current)){if(!["type","properties","required","additionalProperties","items","anyOf","enum","const","minimum","maximum","exclusiveMinimum","exclusiveMaximum","minItems","maxItems","minLength","maxLength","title","description","default","examples","readOnly","writeOnly","deprecated","$schema","$id"].includes(key))throw new Error("Unsupported browser input schema keyword: "+key)}if(current.type!==void 0){const types=Array.isArray(current.type)?current.type:[current.type];if(!types.length)throw new Error("Invalid tool schema type");for(const type of types)if(!["object","array","string","number","integer","boolean","null"].includes(type))throw new Error("Unsupported browser input schema type")}if(current.required!==void 0){if(!Array.isArray(current.required))throw new Error("Invalid required schema");for(const key of current.required)if(typeof key!=="string")throw new Error("Invalid required property")}if(current.properties!==void 0){if(!current.properties||typeof current.properties!=="object"||Array.isArray(current.properties))throw new Error("Invalid properties schema");for(const key of Object.keys(current.properties))schemas.push(current.properties[key])}if(current.additionalProperties!==void 0)schemas.push(current.additionalProperties);if(current.items!==void 0)schemas.push(current.items);if(current.anyOf!==void 0){if(!Array.isArray(current.anyOf)||!current.anyOf.length)throw new Error("Invalid anyOf schema");for(const branch of current.anyOf)schemas.push(branch)}if(current.enum!==void 0){if(!Array.isArray(current.enum)||!current.enum.length)throw new Error("Invalid enum schema");for(const item of current.enum)if(item!==null&&!["string","number","boolean"].includes(typeof item))throw new Error("Browser input enum supports JSON primitives only")}if(Object.hasOwn(current,"const")&&current.const!==null&&!["string","number","boolean"].includes(typeof current.const))throw new Error("Browser input const supports JSON primitives only");for(const key of["minimum","maximum","exclusiveMinimum","exclusiveMaximum"])if(current[key]!==void 0&&(typeof current[key]!=="number"||!Number.isFinite(current[key])))throw new Error("Invalid numeric schema bound");for(const key of["minItems","maxItems","minLength","maxLength"])if(current[key]!==void 0&&(!Number.isSafeInteger(current[key])||current[key]<0))throw new Error("Invalid size schema bound")}const pending=[{schema,value}];while(pending.length){const entry=pending.pop();if(!entry)break;const rule=entry.schema,data=entry.value;if(rule===true)continue;if(rule===false)throw new Error("Tool input does not match its schema");if(rule.type!==void 0){let matches=false;const types=Array.isArray(rule.type)?rule.type:[rule.type];for(const type of types){if(type==="null"?data===null:type==="array"?Array.isArray(data):type==="object"?data!==null&&typeof data==="object"&&!Array.isArray(data):type==="integer"?typeof data==="number"&&Number.isInteger(data):typeof data===type)matches=true}if(!matches)throw new Error("Tool input has an invalid type")}if(rule.enum!==void 0){let matches=false;for(const item of rule.enum)if(item===data)matches=true;if(!matches)throw new Error("Tool input is not an allowed option")}if(Object.hasOwn(rule,"const")&&data!==rule.const)throw new Error("Tool input does not match its constant");if(rule.anyOf!==void 0){let matches=false;for(const branch of rule.anyOf){try{integrationValidateInput(branch,data);matches=true;break}catch{}}if(!matches)throw new Error("Tool input does not match any allowed schema")}if(typeof data==="number"&&(rule.minimum!==void 0&&data<rule.minimum||rule.maximum!==void 0&&data>rule.maximum||rule.exclusiveMinimum!==void 0&&data<=rule.exclusiveMinimum||rule.exclusiveMaximum!==void 0&&data>=rule.exclusiveMaximum))throw new Error("Tool input is outside its numeric bounds");if(typeof data==="string"){const size=Array.from(data).length;if(rule.minLength!==void 0&&size<rule.minLength||rule.maxLength!==void 0&&size>rule.maxLength)throw new Error("Tool input is outside its string bounds")}if(Array.isArray(data)){if(rule.minItems!==void 0&&data.length<rule.minItems||rule.maxItems!==void 0&&data.length>rule.maxItems)throw new Error("Tool input is outside its array bounds");if(rule.items!==void 0)for(const item of data)pending.push({schema:rule.items,value:item})}else if(data!==null&&typeof data==="object"){for(const key of rule.required??[])if(!Object.hasOwn(data,key))throw new Error("Missing required tool input: "+key);for(const key of Object.keys(data)){if(rule.properties&&Object.hasOwn(rule.properties,key))pending.push({schema:rule.properties[key],value:data[key]});else if(rule.additionalProperties===false)throw new Error("Unexpected tool input: "+key);else if(rule.additionalProperties&&typeof rule.additionalProperties==="object")pending.push({schema:rule.additionalProperties,value:data[key]})}}}};


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
