export type IntegrationMode = 'mcp' | 'webmcp' | 'both';
export interface IntegrationTarget { sourceId?: string; instanceId?: string }
export interface IntegrationValue { target: IntegrationTarget; value: unknown; mode?: 'paste' | 'input' }
export interface IntegrationRequest { operation: 'fill' | 'activate' | 'submit'; target: IntegrationTarget; value?: unknown; values?: IntegrationValue[]; submitter?: IntegrationTarget; event?: string; key?: string; mode?: 'paste' | 'input'; timeoutMs?: number }
export interface IntegrationError { code: string; details?: Record<string, string | number | boolean> }
export interface IntegrationFieldValidation { sourceId: string; instanceId: string; path?: string[]; status: string; updateOn?: string; errors: IntegrationError[]; nativeErrors?: string[] }
export interface IntegrationValidation { status: 'valid' | 'invalid' | 'pending' | 'unknown'; fields: IntegrationFieldValidation[]; groups: { path: string[]; status: string; errors: IntegrationError[] }[]; unobservedFields?: string[] }
export interface IntegrationDescriptor { sourceId: string; instanceId: string; provenance?: 'compiler' | 'runtime-dom'; kind: 'form' | 'control' | 'action' | 'element'; tagName: string; role?: string; aria?: Partial<Record<'expanded' | 'selected' | 'checked' | 'pressed' | 'controls' | 'disabled', string>>; clickOrigin?: 'authored' | 'native-ui'; tabIndex?: number; keyboardFocusable?: boolean; events: string[]; label: string; visible: boolean; disabled: boolean; readonly: boolean; operations: ('fill' | 'activate' | 'submit')[]; transport?: 'native-ui'; customAccessor?: boolean; fillModes?: ('paste' | 'input')[]; schema?: Record<string, unknown> | false; value?: unknown; modelKind?: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'undefined' | 'unknown'; modelSize?: number; modelValue?: string | number | boolean | null | (string | number | boolean | null)[]; options?: { value: string; label: string; disabled: boolean; selected: boolean }[]; path?: string[]; unsupportedReason?: string; fields?: IntegrationDescriptor[]; validation: IntegrationValidation }
export interface IntegrationResult { status: 'ui-dispatched' | 'not-dispatched' | 'partial'; operation: IntegrationRequest['operation']; target: { sourceId: string; instanceId: string }; changed: string[]; values?: { sourceId: string; instanceId: string; value?: unknown }[]; validation: IntegrationValidation; url?: string; businessStatus: 'unknown'; reason?: string }
export interface IntegrationModelSnapshot { kind: string; value?: unknown; complete: boolean; reason?: string }
export interface IntegrationBridge { version: 1; profile?: 'development' | 'production'; mode: IntegrationMode; subscribe(listener: () => void): () => void; list(): IntegrationDescriptor[]; inspect?(target: IntegrationTarget): IntegrationDescriptor; catalog?(): Promise<IntegrationDescriptor[]>; describe(target: IntegrationTarget): IntegrationDescriptor | Promise<IntegrationDescriptor>; readModel(target: IntegrationTarget): IntegrationModelSnapshot | Promise<IntegrationModelSnapshot>; element(target: IntegrationTarget): HTMLElement; execute(request: IntegrationRequest): Promise<IntegrationResult> }

/** Angular source compiled with the application's own core/forms versions, never this package's Angular instance. */
export function integrationRuntimeSource(options: { signalForms?: boolean; mode?: IntegrationMode } = {}): string {
  const mode = options.mode ?? 'mcp';
  if (!['mcp', 'webmcp', 'both'].includes(mode)) throw new Error('Integration mode must be mcp, webmcp, or both.');
  return ANGULAR_RUNTIME.replace('/* INTEGRATION_MODE */', JSON.stringify(mode)).replace('/* SIGNAL_IMPORT */', options.signalForms ? "import {FormField,FormRoot} from '@angular/forms/signals';" : '')
    .replace('/* SIGNAL_INJECTION */', options.signalForms ? ',@Optional() @Self() @Inject(FormField) private signalField:FormField<unknown>,@Optional() @Self() @Inject(FormRoot) private signalRoot:FormRoot<unknown>' : '')
    .replace('/* SIGNAL_REGISTER */', options.signalForms ? ',this.signalField,this.signalRoot' : '');
}

const ANGULAR_RUNTIME = String.raw`
import {Directive,ElementRef,Input,Inject,Optional,Self,NgModule,OnDestroy} from '@angular/core';
import {NgControl,NgForm,FormGroupDirective,DefaultValueAccessor,CheckboxControlValueAccessor,NumberValueAccessor,RangeValueAccessor,SelectControlValueAccessor,SelectMultipleControlValueAccessor,RadioControlValueAccessor} from '@angular/forms';
/* SIGNAL_IMPORT */

type Target={sourceId?:string;instanceId?:string};
type RecordEntry={sourceId:string;instanceId:string;node:HTMLElement;events:string[];ngControl:any;ngForm:any;group:any;signal?:any;signalRoot?:any};
function createBridge(){
 const records=new Map<string,RecordEntry>(),nonce=Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(36)).join('-');let sequence=0,busy=false;
 const listeners=new Set<()=>void>();let notificationPending=false;
 const notify=()=>{if(notificationPending)return;notificationPending=true;queueMicrotask(()=>{notificationPending=false;for(const listener of Array.from(listeners))try{listener();}catch{/* A subscriber must not interfere with the app. */}});};
 const h={
  live(record:RecordEntry){return record.node.isConnected;},
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
  isForm(record:RecordEntry){return record.node instanceof HTMLFormElement;},
  isControl(record:RecordEntry){return !!record.ngControl||record.node instanceof HTMLInputElement&&!['submit','button','reset','image'].includes(record.node.type)||record.node instanceof HTMLTextAreaElement||record.node instanceof HTMLSelectElement;},
  clickable(node:HTMLElement){return node instanceof HTMLButtonElement||node instanceof HTMLAnchorElement||node instanceof HTMLInputElement&&['button','submit','reset','image','radio','checkbox'].includes(node.type)||['button','menuitem','menuitemcheckbox','menuitemradio','option','combobox','listbox','radio','checkbox','switch'].includes((node.getAttribute('role')||'').trim().split(/\s+/)[0]||'');},
  customAccessor(record:RecordEntry){const accessor=record.ngControl&&record.ngControl.valueAccessor;return !!accessor&&![DefaultValueAccessor,CheckboxControlValueAccessor,NumberValueAccessor,RangeValueAccessor,SelectControlValueAccessor,SelectMultipleControlValueAccessor,RadioControlValueAccessor].some(type=>accessor instanceof type);},
  native(record:RecordEntry):HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|undefined{const node=record.node;if(node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement||node instanceof HTMLSelectElement)return node;if(!record.ngControl&&!h.signalState(record))return undefined;const inner=Array.from(node.querySelectorAll('input,textarea,select'));return inner.length===1?inner[0] as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement:undefined;},
  visible(node:HTMLElement){return !!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden'&&!node.closest('[hidden],[inert],[aria-hidden="true"]');},
  disabled(node:HTMLElement){return node.matches(':disabled')||node.getAttribute('aria-disabled')==='true'||!!node.closest('[inert]');},
  readonly(node:HTMLElement){return 'readOnly' in node&&!!(node as HTMLInputElement).readOnly||node.getAttribute('aria-readonly')==='true';},
  errors(errors:any){const result:any[]=[];for(const code of Object.keys(errors||{})){const details:any={};const data=errors[code];if(data&&typeof data==='object')for(const key of ['requiredLength','min','max','requiredPattern'])if(['string','number','boolean'].includes(typeof data[key]))details[key]=data[key];result.push(Object.keys(details).length?{code,details}:{code});}return result;},
  nativeErrors(node:HTMLElement){if(!('validity' in node)||!(node as HTMLInputElement).willValidate)return [];const validity=(node as HTMLInputElement).validity;return ['badInput','customError','patternMismatch','rangeOverflow','rangeUnderflow','stepMismatch','tooLong','tooShort','typeMismatch','valueMissing'].filter(key=>(validity as any)[key]);},
  fields(form:RecordEntry){const root=h.formControl(form);return h.all().filter(record=>{if(record===form||!h.isControl(record))return false;const node=record.node as any;if(node.form)return node.form===form.node;const control=h.control(record);return !!root&&control&&control.root===root||form.node.contains(node);});},
  path(record:RecordEntry,root?:any):string[]|undefined{
   const control=h.control(record);if(!control)return undefined;
   if(!root){try{const path=record.ngControl.path;if(Array.isArray(path)&&path.length)return path.map(String);}catch{}root=control.root;}
   const seen=new Set<any>();let visits=0;
   function walk(current:any,path:string[]):string[]|undefined{if(current===control)return path;if(!current||seen.has(current)||visits++>10000)return undefined;seen.add(current);for(const key of Object.keys(current.controls||{})){const found=walk(current.controls[key],path.concat(String(key)));if(found)return found;}return undefined;}
   return walk(root,[]);
  },
  validation(record:RecordEntry){
   const fields=h.isForm(record)?h.fields(record):h.isControl(record)?[record]:[];
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
  supported(record:RecordEntry){const node=h.native(record);if(!node||node!==record.node&&h.readonly(node))return false;if(node instanceof HTMLInputElement){if(['file','hidden','button','submit','reset','image','radio'].includes(node.type))return false;return true;}return node instanceof HTMLTextAreaElement||node instanceof HTMLSelectElement;},
  options(node:HTMLSelectElement){return Array.from(node.options).map(option=>({value:option.value,label:option.label,disabled:option.disabled||!!option.closest('optgroup[disabled]'),selected:option.selected}));},
  schema(record:RecordEntry):any{const node=h.native(record);if(!h.supported(record))return false;if(node instanceof HTMLInputElement&&node.type==='checkbox')return {type:'boolean'};if(node instanceof HTMLInputElement&&['number','range'].includes(node.type))return {type:['number','null']};if(node instanceof HTMLSelectElement&&node.multiple)return {type:'array',items:{type:'string'}};return {type:'string',...node instanceof HTMLInputElement&&node.type==='password'?{writeOnly:true}:{}};},
  value(record:RecordEntry):any{const node=h.native(record);if(node instanceof HTMLInputElement){if(node.type==='password'||node.type==='file'||node.type==='hidden')return undefined;if(node.type==='checkbox'||node.type==='radio')return node.checked;if(['number','range'].includes(node.type))return node.value===''?null:node.valueAsNumber;return node.value;}if(node instanceof HTMLSelectElement&&node.multiple)return Array.from(node.selectedOptions).map(option=>option.value);if(node instanceof HTMLSelectElement||node instanceof HTMLTextAreaElement)return node.value;return undefined;},
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
  label(node:HTMLElement){const labels='labels' in node?Array.from((node as HTMLInputElement).labels||[]).map(label=>label.textContent||'').join(' '):'';return (node.getAttribute('aria-label')||labels||node.textContent||node.getAttribute('name')||'').replace(/\s+/g,' ').trim().slice(0,240);},
  describe(record:RecordEntry,includeFields=true):any{
   const form=h.isForm(record),control=h.isControl(record),node=record.node,native=h.native(record);
   const action=h.clickable(node)||record.events.some(event=>['click','dblclick','keyup','keydown'].includes(event)||event.indexOf('keyup.')===0||event.indexOf('keydown.')===0);
   const operations:string[]=[];if(h.supported(record))operations.push('fill');if(action)operations.push('activate');if(form)operations.push('submit');
   const path=h.path(record),value=h.value(record),schema=control?h.schema(record):undefined;
   const role=node.getAttribute('role'),aria:any={};for(const key of ['expanded','selected','checked','pressed','controls','disabled']){const value=node.getAttribute('aria-'+key);if(value!==null)aria[key]=value;}
   const result:any={sourceId:record.sourceId,instanceId:record.instanceId,kind:form?'form':control?'control':action?'action':'element',tagName:node.tagName.toLowerCase(),...role?{role}:{},...Object.keys(aria).length?{aria}:{},...record.events.includes('click')?{clickOrigin:'authored'}:h.clickable(node)?{clickOrigin:'native-ui'}:{},tabIndex:node.tabIndex,keyboardFocusable:node.tabIndex>=0,events:record.events.slice(),label:h.label(node),visible:h.visible(node),disabled:h.disabled(node)||!!native&&h.disabled(native)||!!h.control(record)&&h.control(record).disabled,readonly:h.readonly(node)||!!native&&h.readonly(native),operations,validation:h.validation(record),...schema!==undefined?{schema}:{},...value!==undefined?{value}:{},...h.model(record),...path?{path}:{}};
   if(control&&!h.supported(record))result.unsupportedReason=node.tagName.indexOf('-')>=0?'Custom value accessor needs a UI adapter; no model setter is used':'This native control has no supported JSON fill operation';
   if(control){result.transport='native-ui';result.customAccessor=h.customAccessor(record);if(h.supported(record))result.fillModes=native instanceof HTMLTextAreaElement||native instanceof HTMLInputElement&&!['checkbox','number','range'].includes(native.type)?['paste','input']:['input'];}
   if(native instanceof HTMLSelectElement)result.options=h.options(native);
   if(form&&includeFields)result.fields=h.fields(record).map(field=>h.describe(field,false));return result;
  },
  async ready(node:HTMLElement,allowReadonly=false){if(!node.isConnected||!h.visible(node)||h.disabled(node)||!allowReadonly&&h.readonly(node))throw new Error('The application made this target unavailable, disabled, or readonly');node.scrollIntoView({block:'center',behavior:'auto'});for(let attempt=0;attempt<60;attempt++){if(!node.isConnected||!h.visible(node)||h.disabled(node)||!allowReadonly&&h.readonly(node))throw new Error('The application changed this target while it was being prepared');const rect=node.getBoundingClientRect(),top=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);if(top&&node.contains(top))return;await new Promise<void>(done=>setTimeout(done,25));}throw new Error('Another UI element is covering the target');},
  choicePointer(node:HTMLInputElement,record?:RecordEntry):HTMLElement{node.scrollIntoView({block:'center',behavior:'auto'});const rect=node.getBoundingClientRect(),top=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);if(!h.visible(node)||getComputedStyle(node).opacity==='0'||rect.width<2||rect.height<2||!top||!node.contains(top)){const associated=Array.from(node.labels||[]),labels=associated.filter(label=>h.visible(label));if(labels.length===1)return labels[0]!;if(!associated.length&&node.type==='checkbox'&&record&&record.ngControl&&record.node!==node&&h.native(record)===node){const roles=Array.from(record.node.querySelectorAll<HTMLElement>('[role="checkbox"]')).filter(role=>h.visible(role));if(roles.length===1)return roles[0]!;}throw new Error('The hidden checkbox or radio needs one visible associated label or an exact control-owned checkbox affordance');}return node;},
  async pending(record:RecordEntry,timeout:number){const until=Date.now()+timeout;while(h.validation(record).status==='pending'){if(Date.now()>=until)return false;await new Promise<void>(done=>setTimeout(done,20));}return true;},
  async render(){await new Promise<void>(done=>requestAnimationFrame(()=>requestAnimationFrame(()=>done())));},
  async fill(record:RecordEntry,value:any,changed:string[],mode?:string){
   if(!h.supported(record))throw new Error('Unsupported native control or custom value accessor; a UI adapter is required');
   if(mode!==undefined&&!['paste','input'].includes(mode))throw new Error('Fill mode must be paste or input');
   const node=h.native(record)!;if(h.disabled(record.node)||h.readonly(record.node)||h.disabled(node)||h.readonly(node)||h.control(record)&&h.control(record).disabled)throw new Error('The application disabled or made this control readonly');
   let pointer:HTMLElement=node;
   if(node instanceof HTMLInputElement&&node.type==='checkbox')pointer=h.choicePointer(node,record);
   await h.ready(pointer);
   if(node instanceof HTMLInputElement&&node.type==='checkbox'){if(typeof value!=='boolean')throw new Error('A checkbox value must be boolean');}
   else if(node instanceof HTMLInputElement&&['number','range'].includes(node.type)){if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)))throw new Error('A numeric input value must be a finite number or null');}
   else if(node instanceof HTMLSelectElement&&node.multiple){if(!Array.isArray(value)||value.some(item=>typeof item!=='string')||new Set(value).size!==value.length)throw new Error('A multiple select value must be distinct option strings');}
   else if(typeof value!=='string')throw new Error('This input requires a string');
   if(node instanceof HTMLSelectElement){const wanted=Array.isArray(value)?value:[value],options=h.options(node);for(const key of wanted){const matches=options.filter(option=>option.value===key);if(matches.length!==1||matches[0]!.disabled)throw new Error('A select option is unavailable, disabled, or ambiguous');}}
   if((node instanceof HTMLInputElement||node instanceof HTMLTextAreaElement)&&typeof value==='string'&&node.maxLength>=0&&value.length>node.maxLength)throw new Error('The current input maxlength refuses this value');
   node.focus();let pasted=false;
   if(node instanceof HTMLInputElement&&node.type==='checkbox'){
    if(node.checked!==value){if(!changed.includes(record.instanceId))changed.push(record.instanceId);pointer.click();}
    node.blur();await h.render();if(node.checked!==value)throw new Error('The application did not retain the requested checkbox state');return;
   }
   if((node instanceof HTMLTextAreaElement||node instanceof HTMLInputElement&&!['number','range'].includes(node.type))&&(mode||'paste')==='paste'){
    try{node.select();}catch{}const clipboard=new DataTransfer();clipboard.setData('text/plain',value);
    if(!changed.includes(record.instanceId))changed.push(record.instanceId);
    const unhandled=node.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
    if(!unhandled){node.blur();await h.render();return;}
    if(!node.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertFromPaste',data:value})))throw new Error('The application refused the paste before input');
    pasted=true;
   }
   if(node instanceof HTMLSelectElement&&node.multiple){for(const option of Array.from(node.options))option.selected=value.indexOf(option.value)>=0;}
   else{const prototype=node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:node instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;const key=node instanceof HTMLInputElement&&node.type==='checkbox'?'checked':'value',setter=Object.getOwnPropertyDescriptor(prototype,key)&&Object.getOwnPropertyDescriptor(prototype,key)!.set;if(!setter)throw new Error('No native input setter is available');setter.call(node,value===null?'':value);}
   if(!changed.includes(record.instanceId))changed.push(record.instanceId);
   const accepted=h.value(record);if(node instanceof HTMLInputElement&&node.type==='password'){if(node.value!==value)throw new Error('The browser did not accept the requested value');}
   else if(node instanceof HTMLSelectElement&&node.multiple){if(JSON.stringify((accepted as string[]).slice().sort())!==JSON.stringify(value.slice().sort()))throw new Error('The browser did not accept the requested options');}
   else if(JSON.stringify(accepted)!==JSON.stringify(value))throw new Error('The browser did not accept the requested input value');
   node.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:pasted?'insertFromPaste':'insertReplacementText',data:typeof value==='string'?value:null}));node.dispatchEvent(new Event('change',{bubbles:true}));node.blur();
   await h.render();
   if(!node.isConnected)throw new Error('The application replaced the input; inspect current instances before continuing');
  },
  async activate(record:RecordEntry,event?:string,key?:string){const node=record.node;if(h.disabled(node)||h.control(record)&&h.control(record).disabled)throw new Error('The application disabled this target');const selected=event||'click',pointer=selected==='click'&&node instanceof HTMLInputElement&&['checkbox','radio'].includes(node.type)?h.choicePointer(node):node;await h.ready(pointer,true);
   if(selected==='click'){if(!h.clickable(node)&&!record.events.includes('click'))throw new Error('The source does not expose a click action on this target');pointer.click();return;}
   if(!record.events.includes(selected))throw new Error('This event is not an authored action on this target');
   if(['dblclick','mousedown','mouseup','pointerdown','pointerup'].includes(selected)){node.dispatchEvent(new MouseEvent(selected,{bubbles:true,cancelable:true,view:window,button:0}));return;}
   const keyboard=/^(keyup|keydown)(?:\.(enter|escape|tab|space))?$/i.exec(selected);if(keyboard){const names:any={enter:'Enter',escape:'Escape',tab:'Tab',space:' '};if(key!==undefined&&(typeof key!=='string'||key.length>100))throw new Error('A keyboard key must be a bounded string');const actual=keyboard[2]?names[keyboard[2].toLowerCase()]:key||'Unidentified';const code=actual===' '?'Space':/^[a-z]$/i.test(actual)?'Key'+actual.toUpperCase():/^[0-9]$/.test(actual)?'Digit'+actual:actual;node.focus();node.dispatchEvent(new KeyboardEvent(keyboard[1]!,{key:actual,code,bubbles:true,cancelable:true}));return;}
   if(selected==='blur'){node.focus();node.blur();return;}throw new Error('This authored event needs an explicit UI adapter');
  },
  async submit(record:RecordEntry,submitter?:Target){const form=record.node;if(!(form instanceof HTMLFormElement))throw new Error('Submit needs a form target');
   const buttons=Array.from(form.elements).filter(element=>(element instanceof HTMLButtonElement||element instanceof HTMLInputElement)&&element.type==='submit'&&element.form===form) as (HTMLButtonElement|HTMLInputElement)[];
   let button:HTMLButtonElement|HTMLInputElement|undefined;
   if(submitter){const selected=h.resolve(submitter).node;if(!(selected instanceof HTMLButtonElement||selected instanceof HTMLInputElement)||selected.type!=='submit'||selected.form!==form)throw new Error('The submitter does not belong to this exact form');button=selected;}
   else{const visible=buttons.filter(button=>h.visible(button));if(visible.length!==1)throw new Error('The form needs one visible submit button or an explicit submitter target');button=visible[0]!;}
   await h.ready(button);let dispatched=false;const observed=(event:Event)=>{if(event.target===form)dispatched=true;};form.addEventListener('submit',observed,true);
   // The original submitter's click handlers are part of the UI workflow too. Its native default action submits once.
   try{button.click();}finally{form.removeEventListener('submit',observed,true);}return dispatched;
  }
 };
 const api:any={version:1,profile:'development',mode:/* INTEGRATION_MODE */,
  subscribe(listener:()=>void){if(typeof listener!=='function')throw new Error('A registry listener must be a function');listeners.add(listener);return ()=>{listeners.delete(listener);};},
  notifyChanged(){notify();},
  list(){return h.all().map(record=>h.describe(record));},
  describe(target:Target){return h.describe(h.resolve(target));},
  readModel(target:Target){return h.readModel(h.resolve(target));},
  element(target:Target):HTMLElement{return h.resolve(target).node;},
  async execute(request:any){
   if(busy)throw new Error('Another bridge operation is in progress');if(!request||!['fill','activate','submit'].includes(request.operation))throw new Error('Unknown bridge operation');
   const record=h.resolve(request.target),changed:string[]=[],timeout=request.timeoutMs===undefined?5000:request.timeoutMs;if(!Number.isSafeInteger(timeout)||timeout<0||timeout>30000)throw new Error('timeoutMs must be an integer from zero through 30000');
   const result=(status:string,reason?:string)=>({status,operation:request.operation,target:{sourceId:record.sourceId,instanceId:record.instanceId},changed:changed.slice(),values:changed.map(id=>records.get(id)).filter((field):field is RecordEntry=>!!field&&h.live(field)).map(field=>{const value=h.value(field);return {sourceId:field.sourceId,instanceId:field.instanceId,...value!==undefined?{value}:{}};}),validation:h.validation(record),url:location.href,businessStatus:'unknown',...reason?{reason}:{}});
   busy=true;let dispatched=false;
   try{
    const values=request.values||[];if(!Array.isArray(values)||values.length>1000)throw new Error('Form values must be a bounded array of target/value pairs');
    if(values.length&&request.operation!=='submit')throw new Error('Only a form submit can include multiple field values');
    const fields=values.map((entry:any)=>({record:h.resolve(entry.target),value:entry.value,mode:entry.mode||request.mode}));if(new Set(fields.map((entry:any)=>h.native(entry.record)||entry.record.node)).size!==fields.length)throw new Error('A field or its delegated native input was supplied more than once');
    if(fields.length){const allowed=new Set(h.fields(record).map(field=>field.instanceId));for(const field of fields)if(!allowed.has(field.record.instanceId))throw new Error('A supplied field does not belong to this exact form');}
    for(const field of fields)await h.fill(field.record,field.value,changed,field.mode);
    if(request.operation==='fill'){await h.fill(record,request.value,changed,request.mode);dispatched=true;}
    else{
     if(!await h.pending(record,timeout))return result(changed.length?'partial':'not-dispatched','Angular validation is still pending; the action was not dispatched');
     await h.render();
     if(request.operation==='submit')dispatched=await h.submit(record,request.submitter);else{await h.activate(record,request.event,request.key);dispatched=true;}
    }
    const settled=await h.pending(record,timeout);return result(dispatched?'ui-dispatched':changed.length?'partial':'not-dispatched',!dispatched?'The original UI action did not submit the form; validation or an authored handler prevented it':!settled?'Action dispatched; Angular validation is still pending':undefined);
   }catch(error){return result(changed.length||dispatched?'partial':'not-dispatched',error instanceof Error?error.message:String(error));}finally{busy=false;notify();}
  },
  register(sourceId:string,node:HTMLElement,ngControl:any,ngForm:any,group:any,signal?:any,signalRoot?:any){const record:RecordEntry={sourceId,instanceId:sourceId+'@'+nonce+':'+(++sequence),node,events:[],ngControl,ngForm,group,signal,signalRoot};records.set(record.instanceId,record);node.setAttribute('data-angular-mcp-instance',record.instanceId);notify();return record;},
  remove(record:RecordEntry){records.delete(record.instanceId);if(record.node.getAttribute('data-angular-mcp-instance')===record.instanceId)record.node.removeAttribute('data-angular-mcp-instance');notify();}
 };return api;
}
function bridge():any{if(typeof window==='undefined')return undefined;const w=window as any;if(w.__angularMcpBridge&&w.__angularMcpBridge.version!==1)throw new Error('An incompatible Angular MCP bridge is already installed');return w.__angularMcpBridge||(w.__angularMcpBridge=createBridge());}
@Directive({selector:'[angularMcpSource]',standalone:true})
export class AngularMcpSourceDirective implements OnDestroy{
 private entry:any;private events='';
 constructor(@Inject(ElementRef) private element:ElementRef<HTMLElement>,@Optional() @Self() @Inject(NgControl) private control:NgControl,@Optional() @Self() @Inject(NgForm) private form:NgForm,@Optional() @Self() @Inject(FormGroupDirective) private group:FormGroupDirective/* SIGNAL_INJECTION */){}
 @Input('angularMcpSource')set source(value:string){if(this.entry)bridge().remove(this.entry);if(typeof value!=='string'||!value)throw new Error('angularMcpSource needs a stable source ID');const api=bridge(),node=this.element.nativeElement;if(api&&node&&node.nodeType===1){this.entry=api.register(value,node,this.control,this.form,this.group/* SIGNAL_REGISTER */);this.entry.events=this.events.split(',').map(event=>event.trim()).filter(Boolean);}}
 @Input('angularMcpEvents')set eventNames(value:string){this.events=value||'';if(this.entry){this.entry.events=this.events.split(',').map(event=>event.trim()).filter(Boolean);bridge().notifyChanged();}}
 ngOnDestroy(){if(this.entry)bridge().remove(this.entry);}
}
@NgModule({imports:[AngularMcpSourceDirective],exports:[AngularMcpSourceDirective]})
export class AngularMcpBridgeModule{}
`;
