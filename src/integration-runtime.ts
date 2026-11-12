export type IntegrationMode = 'mcp' | 'webmcp' | 'both';
export interface IntegrationTarget { sourceId?: string; instanceId?: string }
export interface IntegrationValue { target: IntegrationTarget; value: unknown; mode?: 'paste' | 'input' }
export interface IntegrationRequest { operation: 'fill' | 'activate' | 'submit' | 'drag'; destination?: IntegrationTarget; position?: 'before' | 'after'; target: IntegrationTarget; value?: unknown; values?: IntegrationValue[]; submitter?: IntegrationTarget; event?: string; key?: string; mode?: 'paste' | 'input'; timeoutMs?: number }
export interface IntegrationError { code: string; details?: Record<string, string | number | boolean> }
export interface IntegrationFieldValidation { sourceId: string; instanceId: string; path?: string[]; status: string; updateOn?: string; errors: IntegrationError[]; nativeErrors?: string[] }
export interface IntegrationValidation { status: 'valid' | 'invalid' | 'pending' | 'unknown'; fields: IntegrationFieldValidation[]; groups: { path: string[]; status: string; errors: IntegrationError[] }[]; unobservedFields?: string[] }
export interface IntegrationDescriptor { submitterCount?:number; frameTarget?: {sourceId:string;instanceId:string}; formTarget?: {sourceId:string;instanceId:string}; contextTarget?: {sourceId:string;instanceId:string}; sourceId: string; instanceId: string; provenance?: 'compiler' | 'runtime-dom'; kind: 'form' | 'control' | 'action' | 'element'; tagName: string; labelSource?: string; role?: string; aria?: Partial<Record<'expanded' | 'selected' | 'checked' | 'pressed' | 'controls' | 'disabled', string>>; clickOrigin?: 'authored' | 'native-ui'; tabIndex?: number; keyboardFocusable?: boolean; events: string[]; label: string; visible: boolean; disabled: boolean; readonly: boolean; operations: ('fill' | 'activate' | 'submit' | 'drag')[]; transport?: 'native-ui'; customAccessor?: boolean; fillModes?: ('paste' | 'input')[]; schema?: Record<string, unknown> | false; value?: unknown; modelKind?: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'undefined' | 'unknown'; modelSize?: number; modelValue?: string | number | boolean | null | (string | number | boolean | null)[]; options?: { value: string; label: string; disabled: boolean; selected: boolean }[]; path?: string[]; unsupportedReason?: string; fields?: IntegrationDescriptor[]; validation: IntegrationValidation }
export interface IntegrationResult { status: 'ui-dispatched' | 'not-dispatched' | 'partial'; operation: IntegrationRequest['operation']; target: { sourceId: string; instanceId: string }; changed: string[]; values?: { sourceId: string; instanceId: string; value?: unknown }[]; validation: IntegrationValidation; url?: string; businessStatus: 'unknown'; reason?: string }
export interface IntegrationModelSnapshot { kind: string; value?: unknown; complete: boolean; reason?: string }
export interface IntegrationBridge { version: 1; profile?: 'development' | 'production'; mode: IntegrationMode; subscribe(listener: () => void): () => void; list(): IntegrationDescriptor[]; inspect?(target: IntegrationTarget): IntegrationDescriptor; catalog?(): Promise<IntegrationDescriptor[]>; describe(target: IntegrationTarget): IntegrationDescriptor | Promise<IntegrationDescriptor>; readModel(target: IntegrationTarget): IntegrationModelSnapshot | Promise<IntegrationModelSnapshot>; element(target: IntegrationTarget): HTMLElement; execute(request: IntegrationRequest): Promise<IntegrationResult> }

/** Angular source compiled with the application's own core/forms versions, never this package's Angular instance. */
export function integrationRuntimeSource(options: { signalForms?: boolean; mode?: IntegrationMode } = {}): string {
  const mode = options.mode ?? 'mcp';
  if (!['mcp', 'webmcp', 'both'].includes(mode)) throw new Error('Integration mode must be mcp, webmcp, or both.');
  return ANGULAR_RUNTIME.replace('/* INTEGRATION_MODE */', JSON.stringify(mode)).replace('/* SIGNAL_IMPORT */', options.signalForms ? "import {FormField,FormRoot} from '@angular/forms/signals';" : '')
    .replace('/* SIGNAL_INJECTION */', options.signalForms ? ',@Optional() @Self() @Inject(FormField) private signalField:FormField<unknown>,@Optional() @Self() @Inject(FormRoot) private signalRoot:FormRoot<unknown>' : '')
    .replace('/* SIGNAL_REGISTER */', options.signalForms ? ',this.signalField,this.signalRoot' : ',undefined,undefined');
}

const ANGULAR_RUNTIME = String.raw`
import {Directive,ElementRef,Input,Inject,Optional,Self,NgModule,OnDestroy,NgZone} from '@angular/core';
import {EventManager} from '@angular/platform-browser';
import {NgControl,NgForm,FormGroupDirective,DefaultValueAccessor,CheckboxControlValueAccessor,NumberValueAccessor,RangeValueAccessor,SelectControlValueAccessor,SelectMultipleControlValueAccessor,RadioControlValueAccessor} from '@angular/forms';
/* SIGNAL_IMPORT */

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
 const api:any={version:1,profile:'development',mode:/* INTEGRATION_MODE */,
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
 constructor(@Inject(ElementRef) private element:ElementRef<HTMLElement>,@Optional() @Self() @Inject(NgControl) private control:NgControl,@Optional() @Self() @Inject(NgForm) private form:NgForm,@Optional() @Self() @Inject(FormGroupDirective) private group:FormGroupDirective,@Optional() @Inject(NgZone) private zone:NgZone/* SIGNAL_INJECTION */){}
 @Input('angularMcpSource')set source(value:string){if(this.entry)bridge().remove(this.entry);if(typeof value!=='string'||!value)throw new Error('angularMcpSource needs a stable source ID');const api=bridge(),node=this.element.nativeElement;if(api&&node&&node.nodeType===1){this.entry=api.register(value,node,this.control,this.form,this.group/* SIGNAL_REGISTER */,this.zone);this.entry.events=this.events.split(',').map(event=>event.trim()).filter(Boolean);}}
 @Input('angularMcpEvents')set eventNames(value:string){this.events=value||'';if(this.entry){this.entry.events=this.events.split(',').map(event=>event.trim()).filter(Boolean);bridge().notifyChanged();}}
 ngOnDestroy(){if(this.entry)bridge().remove(this.entry);}
}
@NgModule({imports:[AngularMcpSourceDirective],exports:[AngularMcpSourceDirective]})
export class AngularMcpBridgeModule{}
`;
