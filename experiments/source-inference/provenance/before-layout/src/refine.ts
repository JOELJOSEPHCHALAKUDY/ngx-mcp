import type { Page } from 'playwright';
import { hash } from './hash.js';
import type { Capability, Field, Manifest, Schema } from './model.js';
type Choice={value:string|number|boolean;label:string};

/** Read complete live option sets. A partial viewport or unknown model value never becomes an enum. */
async function choices(page:Page,root:ReturnType<Page['locator']>,field:Field):Promise<Choice[]|undefined>{
 const control=root.locator(field.selector);if(await control.count()!==1)return;
 const labelTransport=field.adapter==='material-select'&&typeof field.schema==='object'&&field.schema.description==='The visible option label in the current application.';
 if(!['material-select','aria-select'].includes(field.adapter??''))return control.locator('option').evaluateAll(options=>options.filter(option=>!(option as HTMLOptionElement).disabled).map(option=>({value:(option as HTMLOptionElement).value,label:(option.textContent??'').replace(/\s+/g,' ').trim()})));
 const before=await page.locator('[role="listbox"],nz-option-container').evaluateAll(elements=>elements.filter(element=>!!element.getClientRects().length).length);
 if(before)return;
 await control.click();
 const panels=page.locator('[role="listbox"]:visible,nz-option-container:visible');
 try{
  await panels.first().waitFor({state:'visible',timeout:3000});if(await panels.count()!==1)return;
  const panel=panels.first(),all=new Map<string,Choice>();let expected:number|undefined,invalid=false;
  for(let attempt=0;attempt<60;attempt++){
   const modelTotal=await control.evaluate(element=>{const debug=(window as unknown as {ng?:{getComponent?(el:Element):Record<string,unknown>|null}}).ng;try{const model=debug?.getComponent?.(element);return Array.isArray(model?.listOfContainerItem)?model.listOfContainerItem.length:undefined;}catch{return;}});
   const part=await panel.evaluate((element,{modelTotal,labelTransport})=>{
    const debug=(window as unknown as {ng?:{getComponent?(el:Element):Record<string,unknown>|null}}).ng;
    const options=Array.from(element.querySelectorAll<HTMLElement>('[role="option"],nz-option-item')).filter(option=>!!option.getClientRects().length);
    const values=options.map(option=>{
     let component:Record<string,unknown>|null|undefined;try{component=debug?.getComponent?.(option);}catch{/* Missing debug values remain unknown. */}
     const authored=option.getAttribute('value')??option.getAttribute('data-value'),label=(option.textContent??'').replace(/\s+/g,' ').trim();
     // Preserve an explicitly declared visible-label tool contract; other widgets keep their raw model values.
     const value=labelTransport?label:component?.value??component?.nzValue??authored;
     return {value:typeof value==='string'||typeof value==='number'||typeof value==='boolean'?value:null,label,disabled:option.getAttribute('aria-disabled')==='true'||option.classList.contains('ant-select-item-option-disabled'),size:Number(option.getAttribute('aria-setsize'))||undefined};
    });
    const viewport=element.querySelector<HTMLElement>('.cdk-virtual-scroll-viewport');
    const scrollable=viewport&&viewport.scrollHeight>viewport.clientHeight+1;
    const done=!scrollable||viewport!.scrollTop+viewport!.clientHeight>=viewport!.scrollHeight-1;
    if(scrollable&&!done){viewport!.scrollTop=Math.min(viewport!.scrollHeight,viewport!.scrollTop+Math.max(1,viewport!.clientHeight));viewport!.dispatchEvent(new Event('scroll',{bubbles:true}));}
    return {values,total:modelTotal??values.find(value=>value.size)?.size,scrollable:!!scrollable,done};
   },{modelTotal,labelTransport});
   if(part.total!==undefined){if(expected!==undefined&&expected!==part.total)invalid=true;expected=part.total;}
   if(new Set(part.values.map(option=>option.label)).size!==part.values.length)invalid=true;
   for(const option of part.values){if(option.value===null||!option.label){invalid=true;continue;}const key=JSON.stringify(option.value),previous=all.get(key);if(previous&&previous.label!==option.label)invalid=true;all.set(key,{value:option.value,label:option.label,...(option.disabled?{disabled:true}:{})});}
   if(part.done){if(part.scrollable&&expected===undefined)invalid=true;break;}
   if(attempt===59)invalid=true;await page.waitForTimeout(50);
  }
  const values=[...all.values()];if(invalid||!values.length||expected!==undefined&&values.length!==expected||new Set(values.map(value=>value.label)).size!==values.length)return;
  return values.filter(value=>!(value as Choice&{disabled?:boolean}).disabled);
 }finally{
  // Escape is sent only to this select, so a containing dialog is never dismissed by refinement.
  const input=control.locator('input');if(await input.count())await input.first().evaluate(input=>{(input as HTMLElement).blur();input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));});else await control.press('Escape');
  await panels.first().waitFor({state:'hidden',timeout:2000}).catch(()=>{});
 }
}
function withOptions(schema:Schema,values:Choice[]):Schema{
 if(typeof schema!=='object')return schema;
 // Source enums are already complete evidence and must never be narrowed to a runtime snapshot.
 if(schema.type==='array'){const items=schema.items as Schema|undefined;return {...schema,items:items&&typeof items==='object'&&!items.enum?{...items,enum:values.map(value=>value.value)}:items};}
 return schema.enum?schema:{...schema,enum:values.map(value=>value.value)};
}

/** Runtime options change the contract fingerprint and require a fresh review. */
export async function refineManifest(page: Page, manifest: Manifest, baseUrl: string): Promise<Manifest> {
 const base=new URL(baseUrl),refined:Capability[]=[];
 for(const capability of manifest.capabilities){
  const dynamic=capability.fields.filter(field=>{const schema=field.schema as Record<string,unknown>,items=schema.items as Record<string,unknown>|undefined;return field.dynamicOptions&&!field.options?.length&&!schema.enum&&!items?.enum;});
  if(!dynamic.length||capability.route.includes(':')||capability.route.includes('*')){refined.push(capability);continue;}
  await page.goto(new URL(capability.route,base).href);await page.waitForLoadState('networkidle');
  const root=page.locator(capability.plan?.root??capability.action.selector);let opened=false;
  try{
   if(await root.count()===0&&capability.reveal){
    const reveal=capability.reveal;let triggers=page.locator(reveal.trigger);
    if(reveal.owner)triggers=page.locator(reveal.owner).locator(reveal.trigger.startsWith(reveal.owner+' ')?reveal.trigger.slice(reveal.owner.length+1):reveal.trigger);
    let candidates=await triggers.all();
    if(reveal.matchText){const texts=[reveal.matchText].flat(),matches=[];for(const candidate of candidates)if(texts.includes((await candidate.innerText()).replace(/\s+/g,' ').trim()))matches.push(candidate);candidates=matches;}
    if(reveal.target){
     if(reveal.target.literalValue===undefined)throw new Error('Refinement needs an explicit target identity');const matches=[];
     for(const candidate of candidates)if(await candidate.evaluate((element,target)=>{const ng=(window as unknown as {ng?:{getContext(el:Element):unknown;getOwningComponent(el:Element):unknown}}).ng;if(!ng)return false;let item:unknown;if(target.source==='component')item=ng.getOwningComponent(element);else for(let node:Element|null=element;node;node=node.parentElement){let context:unknown;try{context=ng.getContext(node);}catch{continue;}if(context&&typeof context==='object'&&'$implicit'in context){item=(context as {$implicit:unknown}).$implicit;break;}}for(const key of target.path)item=(item as Record<string,unknown>|undefined)?.[key];return (typeof item==='string'||typeof item==='number')&&String(item)===String(target.literalValue);},reveal.target))matches.push(candidate);candidates=matches;
    }
    if(candidates.length!==1)throw new Error('Reveal is ambiguous');await candidates[0].click();opened=true;
   }
   if(await root.count()!==1)throw new Error('Control root is ambiguous');await root.waitFor({state:'visible',timeout:5000});
   const found=new Map<string,Choice[]>();for(const field of dynamic){try{const values=await choices(page,root,field);if(values?.length)found.set(field.name,values);}catch{/* Failure leaves the reviewed static contract intact. */}}
   if(!found.size){refined.push(capability);continue;}
   const fields=capability.fields.map(field=>{const values=found.get(field.name);return values?{...field,options:values.map(value=>({value:String(value.value),label:value.label})),schema:withOptions(field.schema,values),dynamicOptions:false}:field;});
   const inputSchema=capability.inputSchema as {properties?:Record<string,Schema>},properties={...inputSchema.properties};
   for(const [name,values]of found)if(properties[name]!==undefined)properties[name]=withOptions(properties[name],values);
   const next:Capability={...capability,fields,inputSchema:{...inputSchema,properties},fingerprint:''};next.fingerprint=hash(JSON.stringify({sourceDigest:manifest.sourceDigest,capability:next}));refined.push(next);
  }catch{refined.push(capability);}finally{if(opened)await page.keyboard.press('Escape');}
 }
 return {...manifest,capabilities:refined};
}
