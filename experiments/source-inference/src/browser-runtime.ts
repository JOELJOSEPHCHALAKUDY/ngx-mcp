import { Ajv } from 'ajv';
import type { Capability, Field, ToolDefinition, UiLocator } from './model.js';

/** This function is deliberately self-contained: Playwright and WebMCP execute the same code. */
export async function executeDom({ capability, args, context, route, routing, targetValue }: { capability: Capability; args: Record<string, unknown>; context?:Record<string,unknown>; route?: string; routing?: { hash: boolean; basePath: string }; targetValue?: unknown }): Promise<{ status: 'ui-dispatched'; url: string }> {
  const state = window as Window & { __angularMcpBusy?: boolean };
  if (state.__angularMcpBusy) throw new Error('Another UI action is in progress');
  state.__angularMcpBusy = true;
  let revealed = false;
  try {
    if(capability.workflow.requiresConfirmation&&context?.confirmedCapability!==capability.id)throw new Error('This confirmation action requires host confirmation for this exact capability');
    if (capability.action.kind === 'navigation') {
      const url = new URL(route ?? capability.route, location.origin);
      for (const name of capability.queryParams ?? []) url.searchParams.set(name, String(args[name]));
      location.assign(url.href);
      return { status: 'ui-dispatched', url: url.href };
    }
    if (routing && !routing.hash && routing.basePath && !location.pathname.startsWith(routing.basePath)) throw new Error('The page is outside the approved base path');
    const here = routing?.hash ? location.hash.replace(/^#/, '').split('?')[0] : location.pathname.slice(routing?.basePath.length ?? 0);
    const normalized = here.replace(/\/$/, '') || '/';
    const inLayout=capability.allowedRoutes?.some(pattern=>{const expected=pattern.split('/'),actual=normalized.split('/');return expected.length===actual.length&&expected.every((part,index)=>part.startsWith(':')?!!actual[index]:part===actual[index]);});
    if (!capability.global && !inLayout&&normalized !== ((route ?? capability.route).replace(/\/$/, '') || '/')) throw new Error('The approved route is not active; navigate through the application first');
    // Row targeting: pick the element whose data item (loop context or owning component) has the requested key.
    // Methods on an object, not const arrows, so a transpiler's name-keeping helper is never injected into this serialized function.
    const rows = {
      clickable(el:HTMLElement):HTMLElement{if(!el.tagName.includes('-'))return el;const buttons=Array.from(el.querySelectorAll<HTMLElement>('button,input[type="button"],input[type="submit"]'));if(buttons.length>1)throw new Error('The custom action has more than one native control');return buttons[0]??el;},
      shown(el: HTMLElement): boolean { return !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert],[aria-hidden="true"]'); },
      texted(elements: HTMLElement[], text: string | string[]): HTMLElement[] { const wanted = ([] as string[]).concat(text); return elements.filter(el => wanted.includes((el.textContent ?? '').replace(/\s+/g, ' ').trim())); },
      // Angular marks a template's elements with `_ngcontent-<id>` and its host with `_nghost-<id>`; that names the declaring component.
      owned(elements: HTMLElement[], owner: string): HTMLElement[] {
        return elements.filter(el => {
          const host = el.closest(owner);
          if (!host) return false;
          if (host === el) return true; // the owner's own host element is the container, not part of its template
          const ids = host.getAttributeNames().filter(n => n.startsWith('_nghost-')).map(n => n.slice(8));
          return !ids.length || el.getAttributeNames().filter(n => n.startsWith('_ngcontent-')).some(n => ids.includes(n.slice(11)));
        });
      },
      walk(spec: NonNullable<Capability['target']>, item: unknown): unknown { let v = item;const seen:string[]=[]; for (const k of spec.path){v = (v as Record<string, unknown> | undefined)?.[k];seen.push(k);if(spec.signals?.includes(seen.join('.'))){if(typeof v!=='function')return undefined;v=v();}} return v; },
      keyOf(ng: { getOwningComponent(el: Element): unknown; getContext(el: Element): unknown }, spec: NonNullable<Capability['target']>, el: HTMLElement): unknown {
        if (spec.source === 'component') return rows.walk(spec, ng.getOwningComponent(el));
        for (let a: Element | null = el; a; a = a.parentElement) {
          let ctx: { $implicit?: unknown } | null = null;
          try { ctx = ng.getContext(a) as { $implicit?: unknown } | null; } catch { ctx = null; }
          if (ctx && typeof ctx === 'object' && '$implicit' in ctx) return rows.walk(spec, ctx.$implicit);
        }
        return undefined;
      },
      select(elements: HTMLElement[], spec: NonNullable<Capability['target']>, value: unknown): HTMLElement[] {
        const ng = (window as unknown as { ng?: { getOwningComponent(el: Element): unknown; getContext(el: Element): unknown } }).ng;
        if (!ng?.getOwningComponent) throw new Error('Targeting a repeated item needs the Angular debug APIs (development build)');
        // Only a present scalar key can match: "undefined", "null" and objects never identify a row.
        let selected=spec.literalValue??value;for(const key of spec.valuePath??[])selected=(selected as Record<string,unknown>|undefined)?.[key];
        const wanted = typeof selected === 'string' || typeof selected === 'number' ? String(selected) : undefined;
        if(!spec.projected)return elements.filter(el => { const key = rows.keyOf(ng, spec, el); return wanted !== undefined && (typeof key === 'string' || typeof key === 'number') && String(key) === wanted; });
        if(wanted===undefined)return [];
        const projection=spec.projected,debug=ng as typeof ng&{getComponent?(el:Element):unknown};
        if(!debug.getComponent)throw new Error('Projected row targeting needs the Angular component debug API');
        const hosts=Array.from(document.querySelectorAll<HTMLElement>(projection.owner)).filter(el=>rows.shown(el));
        const instances=hosts.map(host=>debug.getComponent!(host)).filter((value):value is object=>!!value&&typeof value==='object');
        const owning=new Set<object>();
        for(const element of elements)for(let a:Element|null=element;a;a=a.parentElement){try{const context=ng.getContext(a);if(context&&typeof context==='object'&&instances.includes(context))owning.add(context);}catch{/* Projected embedded views need not expose their own context. */}}
        const owners=owning.size?[...owning]:instances;
        if(owners.length!==1)throw new Error('Projected row owner is missing or ambiguous');
        // Read own data properties only. A target must never execute an application getter or callback.
        const data={
          read(item:unknown,path:string[]):unknown{let value=item;for(const key of path){if(!value||typeof value!=='object')return undefined;const property=Object.getOwnPropertyDescriptor(value,key);if(!property||!('value' in property))return undefined;value=property.value;}return value;},
          scalar(value:unknown){return typeof value==='string'||typeof value==='number'?String(value):undefined;},
        };
        const collection=data.read(owners[0],projection.collection);
        if(!Array.isArray(collection))throw new Error('Projected row collection is unavailable');
        const items=collection.filter(item=>data.scalar(data.read(item,spec.path))===wanted);
        if(items.length!==1)throw new Error('Projected item identity is missing or ambiguous in the source collection');
        const label=data.scalar(data.read(items[0],projection.labelPath))?.replace(/\s+/g,' ').trim();
        if(!label||collection.filter(item=>data.scalar(data.read(item,projection.labelPath))?.replace(/\s+/g,' ').trim()===label).length!==1)throw new Error('Projected item label is missing or ambiguous in the source collection');
        const visible=elements.filter(el=>{
          if(!rows.shown(el))return false;
          const row=projection.rowSelector?el.closest<HTMLElement>(projection.rowSelector):el;if(!row||!rows.shown(row))return false;
          if(projection.rowInputPath){
            if(!projection.rowSelector)return false;
            let component:unknown;try{component=debug.getComponent!(row);}catch{return false;}
            // The source host binds this exact item to the child's input. It remains identifiable while an edit view hides its label.
            return data.read(component,projection.rowInputPath)===items[0];
          }
          return (row.textContent??'').replace(/\s+/g,' ').trim()===label;
        });
        if(visible.length>1)throw new Error('Projected item label or input identity is missing or ambiguous in visible rows');
        return visible;
      },
    };
    if (capability.reveal) {
      const rv = capability.reveal;
      const inlineTarget=rv.target??(rv.kind==='inline'?capability.target:undefined);
      const inlinePanels=rv.kind==='inline'?Array.from(document.querySelectorAll<HTMLElement>(rv.panel)).filter(el=>rows.shown(el)):[];
      const selectedInline=inlinePanels.length&&inlineTarget?rows.select(inlinePanels,inlineTarget,targetValue):inlinePanels;
      const activeInline=rv.kind==='inline'&&selectedInline.length===1;
      if(rv.kind==='inline'&&inlinePanels.length&&!activeInline)throw new Error('Another inline editor is active; the requested row is not open');
      // Never dismiss or stack on top of a person's dialog; menus are transient and may be closed.
      if (rv.kind==='dialog'&&document.querySelector('mat-dialog-container,.ant-modal')) throw new Error('A dialog is already open; a person must close it first');
      for (let i = 0; !activeInline&&i < 20 && document.querySelector(rv.panel); i++) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        await new Promise<void>(r => setTimeout(r, 50));
      }
      if (!activeInline&&document.querySelector(rv.panel)) throw new Error('Another menu is open and could not be closed');
      let triggers = Array.from(document.querySelectorAll<HTMLElement>(rv.trigger));
      if (rv.matchText) triggers = rows.texted(triggers, rv.matchText);
      if (rv.owner) triggers = rows.owned(triggers, rv.owner);
      if (inlineTarget) triggers = rows.select(triggers, inlineTarget, targetValue);
      const usable = triggers.filter(el => rows.shown(el));
      if(!activeInline){
      if (usable.length !== 1) throw new Error(`Expected one visible menu or dialog trigger; found ${usable.length}`);
      const trigger = rows.clickable(usable[0]);
      if (trigger.matches(':disabled') || trigger.getAttribute('aria-disabled') === 'true') throw new Error('The application disabled this action');
      trigger.scrollIntoView({ block: 'center', behavior: 'instant' });
      const box = trigger.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!top || !trigger.contains(top)) throw new Error('Another UI element is covering the trigger');
      if(rv.event==='dblclick')trigger.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,detail:2}));
      else trigger.click();
      revealed = true;
      }
      for (let i = 0; i < 60 && !document.querySelector(rv.panel); i++) await new Promise<void>(r => setTimeout(r, 50));
      if (!document.querySelector(rv.panel)) throw new Error('The menu or dialog did not open');
      // Optional instrumentation hook (the prober re-arms its service-call observers now that the dialog's components exist).
      (window as unknown as { __angularMcpAfterReveal?: () => void }).__angularMcpAfterReveal?.();
      await new Promise<void>(r => setTimeout(r, 120));
    }
    if(capability.drive?.drag){
      const spec=capability.drive.drag;
      const sourceId=spec.sourceId??(spec.sourceContext?context?.[spec.sourceContext]:undefined);
      if(typeof sourceId!=='string'||!sourceId)throw new Error(`CDK drag requires explicit runtime context ${spec.sourceContext??'sourceContainerId'}; no source column is guessed`);
      const destinationId=spec.mode==='reorder'?sourceId:args[spec.targetParam!];
      if(typeof destinationId!=='string'||!destinationId)throw new Error('CDK drag destination container is missing');
      if(spec.mode==='transfer'&&destinationId===sourceId)throw new Error('A transfer needs distinct source and destination containers');
      if(document.querySelector('.cdk-drag-preview,.cdk-drag-placeholder'))throw new Error('A drag operation is already active');
      const drag={
        sleep(ms:number){return new Promise<void>(resolve=>setTimeout(resolve,ms));},
        list(id:string){const found=Array.from(document.querySelectorAll<HTMLElement>(spec.listSelector)).filter(el=>el.id===id);if(found.length!==1)throw new Error(`CDK container is missing or ambiguous: ${id}`);return found[0];},
        items(list:HTMLElement,placeholder=false){return Array.from(list.querySelectorAll<HTMLElement>(spec.itemSelector)).filter(el=>el.closest('.cdk-drop-list')===list&&!el.classList.contains('cdk-drag-preview')&&(placeholder||!el.classList.contains('cdk-drag-placeholder')));},
        key(el:HTMLElement){return spec.itemAttribute?el.getAttribute(spec.itemAttribute)??'':(el.textContent??'').replace(/\s+/g,' ').trim();},
        enabled(el:HTMLElement){return rows.shown(el)&&!el.matches(':disabled,.cdk-drag-disabled,.cdk-drop-list-disabled')&&el.getAttribute('aria-disabled')!=='true'&&el.getAttribute('aria-readonly')!=='true'&&getComputedStyle(el).pointerEvents!=='none';},
        point(el:HTMLElement){const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},
        inside(point:{x:number;y:number}){return point.x>0&&point.y>0&&point.x<innerWidth&&point.y<innerHeight;},
        destination(list:HTMLElement,index:number,ignore?:HTMLElement){
          const items=drag.items(list).filter(el=>el!==ignore),box=list.getBoundingClientRect();
          if(index<items.length){const r=items[index].getBoundingClientRect();return spec.orientation==='horizontal'?{x:r.left+Math.min(8,r.width/4),y:r.top+r.height/2}:{x:r.left+r.width/2,y:r.top+Math.min(8,r.height/4)};}
          if(items.length){const r=items.at(-1)!.getBoundingClientRect();return spec.orientation==='horizontal'?{x:Math.min(box.right-3,r.right-3),y:r.top+r.height/2}:{x:r.left+r.width/2,y:Math.min(box.bottom-3,r.bottom-3)};}
          return {x:box.left+box.width/2,y:box.top+Math.min(20,box.height/2)};
        },
        event(type:string,point:{x:number;y:number},target:EventTarget=document){target.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,composed:true,view:window,detail:1,button:0,buttons:type==='mouseup'?0:1,clientX:point.x,clientY:point.y}));},
        async move(from:{x:number;y:number},to:{x:number;y:number},steps=24){if(!drag.inside(to))throw new Error('CDK drag destination is outside the visible viewport');for(let i=1;i<=steps;i++){drag.event('mousemove',{x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps});await drag.sleep(16);}},
        placeholder(list:HTMLElement){return drag.items(list,true).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return spec.orientation==='horizontal'?x.left-y.left:x.top-y.top;}).findIndex(el=>el.classList.contains('cdk-drag-placeholder'));},
      };
      const source=drag.list(sourceId),destination=drag.list(destinationId);
      if(!drag.enabled(source)||!drag.enabled(destination))throw new Error('The application disabled a CDK drop container');
      if(spec.mode==='reorder'&&source.classList.contains('cdk-drop-list-sorting-disabled'))throw new Error('The application disabled CDK sorting');
      const sourceItems=drag.items(source),destinationItems=source===destination?sourceItems:drag.items(destination);
      const previousIndex=args[spec.previousIndex],currentIndex=args[spec.currentIndex];
      if(!Number.isInteger(previousIndex)||Number(previousIndex)<0||Number(previousIndex)>=sourceItems.length)throw new Error('CDK source index is outside the current list');
      if(!Number.isInteger(currentIndex)||Number(currentIndex)<0||Number(currentIndex)>(source===destination?destinationItems.length-1:destinationItems.length))throw new Error('CDK destination index is outside the current list');
      const item=sourceItems[Number(previousIndex)],identity=drag.key(item);
      const allItems=source===destination?sourceItems:[...sourceItems,...destinationItems];
      if(!identity||allItems.filter(el=>drag.key(el)===identity).length!==1)throw new Error('The dragged item has no unique rendered identity');
      if(context?.expectedItemIdentity!==undefined&&String(context.expectedItemIdentity)!==identity)throw new Error('The CDK source index no longer identifies the expected item');
      if(!drag.enabled(item))throw new Error('The application disabled the draggable item');
      const handles=spec.handleSelector?Array.from(item.querySelectorAll<HTMLElement>(spec.handleSelector)).filter(el=>drag.enabled(el)):[item];
      if(handles.length!==1)throw new Error('The CDK drag handle is missing, disabled or ambiguous');
      const handle=handles[0];handle.scrollIntoView({block:'nearest',inline:'nearest'});
      const from=drag.point(handle),to=drag.destination(destination,Number(currentIndex),source===destination?item:undefined);
      if(!drag.inside(from)||!drag.inside(to))throw new Error('CDK dragging requires visible source and destination positions');
      const hit=document.elementFromPoint(from.x,from.y),dropHit=document.elementFromPoint(to.x,to.y);
      if(!hit||!handle.contains(hit)||!dropHit||!destination.contains(dropHit))throw new Error('Another UI element is covering the CDK drag source or destination');
      const beforeSource=sourceItems.map(el=>drag.key(el)),beforeDestination=destinationItems.map(el=>drag.key(el));
      let pointer=from,started=false,released=false;
      try{
        drag.event('mousedown',from,hit);started=true;
        await drag.sleep((spec.startDelayMs??0)+25);
        pointer={x:from.x+8,y:from.y+8};drag.event('mousemove',pointer);await drag.sleep(40);
        await drag.move(pointer,to);pointer=to;await drag.sleep(120);
        for(let correction=0;correction<5&&drag.placeholder(destination)!==currentIndex;correction++){
          const next=drag.destination(destination,Number(currentIndex));await drag.move(pointer,next,10);pointer=next;await drag.sleep(80);
        }
        if(drag.placeholder(destination)!==currentIndex)throw new Error('The application refused the requested CDK drop position');
        drag.event('mouseup',pointer);released=true;
        for(let i=0;i<150;i++){if(!document.querySelector('.cdk-drag-preview,.cdk-drag-placeholder'))break;await drag.sleep(20);}
        if(document.querySelector('.cdk-drag-preview,.cdk-drag-placeholder'))throw new Error('CDK drag did not settle');
        const expected=[...beforeSource];expected.splice(Number(previousIndex),1);expected.splice(Number(currentIndex),0,identity);
        let reflected=false;
        for(let i=0;i<100;i++){
          const sourceKeys=drag.items(drag.list(sourceId)).map(el=>drag.key(el)),destinationKeys=drag.items(drag.list(destinationId)).map(el=>drag.key(el));
          reflected=source===destination?JSON.stringify(sourceKeys)===JSON.stringify(expected):!sourceKeys.includes(identity)&&destinationKeys.includes(identity)&&JSON.stringify([...sourceKeys,...destinationKeys].sort())===JSON.stringify([...beforeSource,...beforeDestination].sort());
          if(reflected)break;await drag.sleep(20);
        }
        if(!reflected)throw new Error('CDK drop was dispatched but the requested item movement was not reflected in the UI');
        return {status:'ui-dispatched',url:location.href};
      }catch(error){
        // Return to the original slot before releasing a rejected drag. Never release into an unverified other column.
        if(started&&!released&&document.querySelector('.cdk-drag-placeholder')){
          try{const back=drag.placeholder(source)===previousIndex?from:drag.destination(source,Number(previousIndex));await drag.move(pointer,back,24);await drag.sleep(100);if(drag.placeholder(source)===previousIndex){drag.event('mouseup',back);released=true;}}catch{/* A person must inspect a drag that cannot be safely restored. */}
        }else if(started&&!released)drag.event('mouseup',from);
        if(started&&!released&&document.querySelector('.cdk-drag-placeholder'))throw new Error(`${error instanceof Error?error.message:String(error)}; drag could not be safely restored, inspect the application before retrying`);
        throw error;
      }
    }
    const buttonChoice=capability.drive?.buttons?.choices.find(choice=>choice.value===args[capability.drive!.buttons!.param]);
    if(capability.drive?.buttons&&!buttonChoice)throw new Error('No authored button represents this argument');
    let targets = Array.from(document.querySelectorAll<HTMLElement>(buttonChoice?.selector??capability.action.selector));
    // A descendant selector can also match look-alike elements in nested components; keep only the owning component's.
    if (buttonChoice?.matchText) targets=rows.texted(targets,buttonChoice.matchText);
    else if (capability.action.matchText) targets = rows.texted(targets, capability.action.matchText);
    if (capability.action.owner) targets = rows.owned(targets, capability.action.owner);
    if (capability.target) targets = rows.select(targets, capability.target, targetValue);
    // Transitional duplicates (a tab or route animation keeps the old view briefly): the one a person can see is the one.
    if (targets.length > 1) {
      const shown = targets.filter(el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert],[aria-hidden="true"]'));
      if (shown.length === 1) targets = shown;
    }
    if (targets.length > 1 && capability.action.allowDuplicates) targets = targets.filter(el => !!el.getClientRects().length).slice(0, 1);
    if (targets.length !== 1) throw new Error(`Expected one UI action; found ${targets.length}`);
    const target = targets[0];
    const dom = {
      visible(el: HTMLElement) { return !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[inert],[aria-hidden="true"]'); },
      async waitForClick(el: HTMLElement) {
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        for (let attempt = 0; attempt < 60; attempt++) {
          const rect = el.getBoundingClientRect();
          const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          // Material draws a touch-target overlay inside the same form field; clicking it reaches the control.
          const field = top?.closest('mat-form-field');
          if (top && (el.contains(top) || (field && field === el.closest('mat-form-field')))) return;
          // Loading overlays and layout animations must finish; never force a click through them.
          await new Promise<void>(r => setTimeout(r, 50));
        }
        throw new Error('Another UI element is covering the action');
      },
      find(root:ParentNode,locator:UiLocator):HTMLElement{
        let elements=Array.from(root.querySelectorAll<HTMLElement>(locator.selector));
        if(root instanceof HTMLElement&&root.matches(locator.selector))elements.unshift(root);
        if(locator.label){const expected=locator.label.replace(/\s+/g,' ').trim();elements=elements.filter(el=>{
          const label=el.closest('mat-form-field')?.querySelector('mat-label')?.textContent;
          return label?.replace(/\s+/g,' ').trim()===expected||el.textContent?.replace(/\s+/g,' ').trim()===expected;
        });}
        if(elements.length!==1)throw new Error(`UI binding is missing or ambiguous: ${locator.selector}${locator.label?' ('+locator.label+')':''}`);
        return elements[0];
      },
      async settle(root:ParentNode){
        await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())));
        for(let i=0;i<100;i++){
          if(!root.querySelector('.ng-pending,[aria-busy="true"]'))return;
          await new Promise<void>(r=>setTimeout(r,50));
        }
        throw new Error('Application validation is still pending');
      },
      async click(el:HTMLElement){
        el=rows.clickable(el);
        if(!dom.visible(el)||el.matches(':disabled')||el.getAttribute('aria-disabled')==='true')throw new Error('The application disabled this action');
        await dom.waitForClick(el);
        if(el.matches(':disabled')||!dom.visible(el))throw new Error('The application disabled this action');
        el.click();
      },
      async fill(root:ParentNode,field:Field,value:unknown){
        if(!field.supported)throw new Error(`Unsupported form field: ${field.name}`);
        const control=dom.find(root,field);
        if(!dom.visible(control)||control.matches(':disabled')||control.getAttribute('aria-disabled')==='true'||'readOnly' in control&&control.readOnly)throw new Error(`Form control is unavailable: ${field.name}`);
        if(field.adapter==='material-select'){
          await dom.click(control);
          let panel:HTMLElement|null=null;
          for(let i=0;i<60;i++){
            const id=control.getAttribute('aria-controls');panel=id?document.getElementById(id):null;
            if(panel&&dom.visible(panel))break;await new Promise<void>(r=>setTimeout(r,50));
          }
          if(!panel)throw new Error(`Select panel did not open: ${field.name}`);
          const expected=field.options?.find(o=>o.value===String(value))?.label??String(value);
          const options=Array.from(panel.querySelectorAll<HTMLElement>('[role="option"]')).filter(o=>o.textContent?.replace(/\s+/g,' ').trim()===expected);
          if(options.length!==1)throw new Error(`Select option is missing or ambiguous: ${expected}`);
          await dom.click(options[0]);
        }else if(field.adapter==='aria-select'){
          // ARIA selects plus the rendered NgZorro select surface (which has no ARIA option roles in some pinned versions).
          if(control.classList.contains('ant-select-disabled'))throw new Error(`Select is disabled: ${field.name}`);
          const multiple=typeof field.schema==='object'&&field.schema.type==='array';
          if(multiple!==Array.isArray(value))throw new Error(`Select value has the wrong cardinality: ${field.name}`);
          const values=multiple?value as unknown[]:[value];
          if(values.length>200||values.some(item=>!['string','number','boolean'].includes(typeof item)))throw new Error(`Unsupported select value: ${field.name}`);
          const labels=values.map(item=>field.options?.find(option=>option.value===String(item))?.label??String(item));
          if(new Set(labels).size!==labels.length)throw new Error(`Select values are duplicated or ambiguous: ${field.name}`);
          let panel:HTMLElement|undefined;
          const select={
            panels():HTMLElement[]{return Array.from(document.querySelectorAll<HTMLElement>('[role="listbox"],nz-option-container')).filter(element=>dom.visible(element));},
            options(root:HTMLElement):HTMLElement[]{return Array.from(root.querySelectorAll<HTMLElement>('[role="option"],nz-option-item')).filter(element=>dom.visible(element));},
            label(option:HTMLElement):string{return (option.textContent??'').replace(/\s+/g,' ').trim();},
            selected(option:HTMLElement):boolean{return option.getAttribute('aria-selected')==='true'||option.classList.contains('ant-select-item-option-selected');},
            async open():Promise<HTMLElement>{
              if(panel?.isConnected&&dom.visible(panel))return panel;
              const comboboxes=Array.from(control.querySelectorAll<HTMLElement>('[role="combobox"]')).filter(element=>dom.visible(element));
              if(control.matches('[role="combobox"]'))comboboxes.unshift(control);
              if(comboboxes.length>1)throw new Error('Select combobox is ambiguous');
              const combo=comboboxes[0]??control;
              const before=new Set(select.panels());
              const already=combo.getAttribute('aria-expanded')==='true'||control.classList.contains('ant-select-open');
              if(!already){await dom.waitForClick(control);control.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));control.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));control.click();}
              for(let attempt=0;attempt<60;attempt++){
                const ids=(combo.getAttribute('aria-controls')??combo.getAttribute('aria-owns')??'').split(/\s+/).filter(Boolean);
                const linked=ids.map(id=>document.getElementById(id)).filter((element):element is HTMLElement=>!!element&&dom.visible(element));
                if(linked.length===1){panel=linked[0];return panel;}
                const visible=select.panels(),fresh=visible.filter(element=>!before.has(element));
                if(fresh.length===1){panel=fresh[0];return panel;}
                if(already&&visible.length===1){panel=visible[0];return panel;}
                if(attempt===5){const input=control.querySelector<HTMLElement>('input')??combo;input.focus();input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',keyCode:40,which:40,bubbles:true,cancelable:true}));}
                await new Promise<void>(resolve=>setTimeout(resolve,50));
              }
              throw new Error(`Select popup did not open uniquely: ${field.name}`);
            },
            async option(label:string):Promise<HTMLElement>{
              const root=await select.open();const viewport=root.querySelector<HTMLElement>('.cdk-virtual-scroll-viewport');
              if(viewport){viewport.scrollTop=0;viewport.dispatchEvent(new Event('scroll',{bubbles:true}));await new Promise<void>(resolve=>setTimeout(resolve,30));}
              for(let attempt=0;attempt<40;attempt++){
                const found=select.options(root).filter(option=>select.label(option)===label);
                if(found.length===1)return found[0];if(found.length>1)throw new Error(`Select option is ambiguous: ${label}`);
                if(!viewport||viewport.scrollTop+viewport.clientHeight>=viewport.scrollHeight-1)break;
                const old=viewport.scrollTop;viewport.scrollTop=Math.min(viewport.scrollHeight,old+Math.max(1,viewport.clientHeight));viewport.dispatchEvent(new Event('scroll',{bubbles:true}));
                await new Promise<void>(resolve=>setTimeout(resolve,40));if(viewport.scrollTop===old)break;
              }
              throw new Error(`Select option is missing: ${label}`);
            },
            async toggle(label:string,wanted:boolean):Promise<void>{
              const option=await select.option(label);if(select.selected(option)===wanted)return;
              if(option.matches(':disabled,[aria-disabled="true"],.ant-select-item-option-disabled'))throw new Error(`Select option is disabled: ${label}`);
              await dom.click(option);await dom.settle(root);
              if(multiple&&select.selected(await select.option(label))!==wanted)throw new Error(`The application did not change the select option: ${label}`);
            },
            async close():Promise<void>{
              if(!panel?.isConnected||!dom.visible(panel))return;
              if(document.activeElement instanceof HTMLElement&&control.contains(document.activeElement))document.activeElement.blur();
              for(let n=0;n<8&&panel.isConnected&&dom.visible(panel);n++)await new Promise<void>(resolve=>setTimeout(resolve,25));
              if(panel.isConnected&&dom.visible(panel)){
                const input=control.querySelector<HTMLElement>('input,[role="combobox"]')??control;
                input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true}));
                for(let n=0;n<40&&panel.isConnected&&dom.visible(panel);n++)await new Promise<void>(resolve=>setTimeout(resolve,25));
              }
              if(panel.isConnected&&dom.visible(panel))throw new Error(`Select popup did not close: ${field.name}`);
            },
          };
          await select.open();
          // Resolve every requested label before changing anything; unknown IDs cannot clear existing selections first.
          for(const label of labels)await select.option(label);
          if(multiple){
            const viewport=panel!.querySelector<HTMLElement>('.cdk-virtual-scroll-viewport');
            if(!field.options&&viewport&&viewport.scrollHeight>viewport.clientHeight+1)throw new Error(`Multiple select needs complete refined options: ${field.name}`);
            const all=field.options?.map(option=>option.label)??select.options(panel!).map(option=>select.label(option));
            for(const label of all)await select.toggle(label,labels.includes(label));
          }else await select.toggle(labels[0],true);
          await select.close();
        }else if(field.adapter==='material-choice'){
          // Button-toggle groups and radio groups: press the choice whose value attribute or label matches.
          // A group's labels can differ from the values the app receives; the reviewed option list maps one to the other.
          const wanted=field.options?.find(o=>o.value===String(value))?.label??String(value);
          const choices=Array.from(control.querySelectorAll<HTMLElement>('mat-button-toggle, mat-radio-button')).filter(c=>c.getAttribute('value')===wanted||c.textContent?.replace(/\s+/g,' ').trim()===wanted);
          if(choices.length!==1)throw new Error(`Choice is missing or ambiguous: ${wanted}`);
          await dom.click(dom.find(choices[0],{selector:choices[0].tagName==='MAT-RADIO-BUTTON'?'input[type="radio"]':'button'}));
        }else if(field.adapter==='material-toggle'){
          const toggle=dom.find(control,{selector:'button[role="switch"], input[type="checkbox"]'}) as HTMLElement;
          const on=toggle instanceof HTMLInputElement?toggle.checked:toggle.getAttribute('aria-checked')==='true';
          if(on!==Boolean(value))await dom.click(toggle);
        }else if(field.adapter==='material-checkbox'){
          const checkbox=dom.find(control,{selector:'input[type="checkbox"]'}) as HTMLInputElement;
          if(checkbox.checked!==Boolean(value))await dom.click(checkbox);
        }else if(field.adapter==='contenteditable'){
          const editable=control.matches('[contenteditable="true"]')?control:dom.find(control,{selector:'.ql-editor[contenteditable="true"], [contenteditable="true"]'});
          if(!dom.visible(editable)||!editable.isContentEditable||editable.getAttribute('aria-disabled')==='true')throw new Error(`Rich-text control is unavailable: ${field.name}`);
          await dom.waitForClick(editable);
          editable.focus();
          // Select the existing document and paste through the editor's own DOM listener/CVA.
          // Quill normalizes HTML itself; no private editor instance or Angular control setter is called.
          const selection=getSelection();
          if(!selection)throw new Error(`Rich-text selection is unavailable: ${field.name}`);
          const range=document.createRange();range.selectNodeContents(editable);selection.removeAllRanges();selection.addRange(range);
          document.dispatchEvent(new Event('selectionchange'));
          await new Promise<void>(r=>requestAnimationFrame(()=>r()));
          const text=String(value),clipboard=new DataTransfer();
          const fragment=document.createElement('template');fragment.innerHTML=text;
          clipboard.setData('text/plain',fragment.content.textContent??text);
          clipboard.setData('text/html',text);
          const unhandled=editable.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard}));
          if(unhandled){
            // Plain contenteditable controls use ordinary editing events; honor a cancelled beforeinput.
            if(!editable.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertFromPaste',data:text})))throw new Error(`The editor rejected the value: ${field.name}`);
            editable.textContent=text;
            editable.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:text}));
          }
          await dom.settle(root);
          editable.dispatchEvent(new Event('change',{bubbles:true}));editable.blur();
        }else{
          const native=control as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement;
          const prototype=native instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:native instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
          const setter=Object.getOwnPropertyDescriptor(prototype,field.type==='checkbox'?'checked':'value')?.set;
          if(!setter)throw new Error(`No native control setter: ${field.name}`);
          setter.call(native,field.type==='checkbox'?Boolean(value):String(value));
          native.dispatchEvent(new Event('input',{bubbles:true}));native.dispatchEvent(new Event('change',{bubbles:true}));if(!capability.plan?.commit)native.dispatchEvent(new Event('blur',{bubbles:true}));
          // The browser may sanitize a value (invalid date, no matching option); never continue with a silently different value.
          if(field.type!=='checkbox'&&native.value!==String(value))throw new Error(`The control did not accept the value: ${field.name}`);
        }
        await dom.settle(root);
      },
    };
    // Development builds expose the application's own form model. Its validators, not the generated schema, decide
    // whether the filled values are acceptable. Without the debug API this is a no-op and the native checks remain.
    const forms = {
      at(node: Element): { control?: any; state?: any } | undefined {
        const ng = (window as any).ng; if (!ng?.getDirectives) return undefined;
        let directives: any[] = []; try { directives = ng.getDirectives(node) ?? []; } catch { return undefined; }
        for (const d of directives) {
          try {
            const c = d?.control;
            if (c && typeof c === 'object' && typeof c.updateValueAndValidity === 'function' && typeof c.setValue === 'function' && !('controls' in c)) return { control: c };
            if (d && typeof d.state === 'function' && ('field' in d || 'formField' in d)) { const s = d.state(); if (s && typeof s.invalid === 'function' && typeof s.errors === 'function') return { state: s }; }
          } catch { /* not a form directive */ }
        }
        return undefined;
      },
      of(el: Element, boundary: Element): { control?: any; state?: any } | undefined {
        const self = forms.at(el); if (self) return self;
        const inner: { control?: any; state?: any }[] = [];
        for (const child of Array.from(el.querySelectorAll('*'))) { const m = forms.at(child); if (m && !inner.some(x => (x.control ?? x.state) === (m.control ?? m.state))) inner.push(m); }
        if (inner.length) return inner.length === 1 ? inner[0] : undefined;
        for (let a = el.parentElement; a; a = a.parentElement) { const m = forms.at(a); if (m) return m; if (a === boundary) break; }
        return undefined;
      },
      own(root: ParentNode, boundary: Element): { name: string; control?: any; state?: any }[] {
        const list: { name: string; control?: any; state?: any }[] = [];
        for (const field of capability.fields) { try { const m = forms.of(dom.find(root, field), boundary); if (m) list.push({ name: field.name, ...m }); } catch { /* the fill step reports absent controls */ } }
        for (const repeat of capability.plan?.repeats ?? []) {
          const rowElements = Array.from(target.querySelectorAll<HTMLElement>(repeat.rowSelector));
          for (let i = 0; i < rowElements.length; i++) for (const field of repeat.fields) { try { const m = forms.of(dom.find(rowElements[i], field), boundary); if (m) list.push({ name: `${repeat.name}.${i}.${field.name}`, ...m }); } catch { /* not rendered in this row */ } }
        }
        return list;
      },
      label(key: string, detail: any): string { const n = detail && typeof detail === 'object' ? detail.requiredLength ?? detail[key] : undefined; return typeof n === 'number' ? `${key} ${n}` : key; },
      rejected(list: { name: string; control?: any; state?: any }[]): string[] {
        const out: string[] = [], seen = new Set<unknown>();
        for (const item of list) {
          try {
            if (item.control) {
              const c = item.control;
              // A pending asynchronous validator is the application's business; only a settled rejection blocks.
              if (c.status === 'INVALID' && c.updateOn !== 'submit' && c.errors) out.push(`${item.name} (${Object.keys(c.errors).map(k => forms.label(k, c.errors[k])).join(', ')})`);
              for (let p = c.parent; p && !seen.has(p); p = p.parent) { seen.add(p); if (p.status === 'INVALID' && p.updateOn !== 'submit' && p.errors) out.push(`form (${Object.keys(p.errors).join(', ')})`); }
            } else if (item.state) {
              const s = item.state;
              if (s.hidden?.() || s.disabled?.() || s.readonly?.()) continue;
              if (s.invalid()) { const kinds = (s.errors() ?? []).map((e: any) => forms.label(String(e?.kind ?? 'invalid'), e)); if (kinds.length) out.push(`${item.name} (${kinds.join(', ')})`); }
              for (let p = s.structure?.parent; p && !seen.has(p); p = p.structure?.parent) { seen.add(p); const errors = p.errors?.() ?? []; if (errors.length) out.push(`form (${errors.map((e: any) => String(e?.kind ?? 'invalid')).join(', ')})`); }
            }
          } catch { /* an unreadable form model is not evidence of rejection */ }
        }
        return out;
      },
      /** Refuse to dispatch values the application's own model has already marked invalid. */
      gate(root: ParentNode, boundary: Element): void {
        const own = forms.own(root, boundary);
        try { (window as unknown as { __angularMcpBeforeDispatch?: (own: unknown) => void }).__angularMcpBeforeDispatch?.(own); } catch { /* observers never change dispatch */ }
        // A control the caller left alone and the contract does not require is the application's to judge: some apps
        // declare a rule in the form model and submit regardless (a password that is only sent when it is filled in).
        const needed = new Set<string>([...Object.keys(args), ...(((capability.inputSchema as { required?: string[] }).required) ?? [])]);
        const rejected = forms.rejected(own.filter((item: { name: string }) => needed.has(item.name)));
        if (rejected.length) throw new Error(`The application rejected the form values: ${rejected.join('; ')}`);
      },
    };
    if (capability.drive) {
      const d = capability.drive;
      if(d.counter){
        const counter={
          async run(scope:HTMLElement,args:Record<string,unknown>,binding:NonNullable<NonNullable<Capability['drive']>['counter']>):Promise<{value:number;steps:number}>{
            let desired:unknown=args[binding.param];
            for(const key of binding.path??[])desired=desired&&typeof desired==='object'?(desired as Record<string,unknown>)[key]:undefined;
            if(typeof desired!=='number'||!Number.isSafeInteger(desired))throw new Error('Counter quantity must be a safe integer');
            if(!(scope instanceof HTMLElement)||!scope.isConnected)throw new Error('Counter scope is unavailable');
            const dom={
              visible(element:HTMLElement):boolean{return !!element.getClientRects().length&&getComputedStyle(element).visibility!=='hidden'&&!element.closest('[hidden],[inert],[aria-hidden="true"]');},
              find(root:HTMLElement,locator:UiLocator):HTMLElement{
                let elements=Array.from(root.querySelectorAll<HTMLElement>(locator.selector));
                if(root.matches(locator.selector))elements.unshift(root);
                if(locator.label){const label=locator.label.replace(/\s+/g,' ').trim();elements=elements.filter(element=>[element.textContent,element.getAttribute('aria-label'),element.getAttribute('title')].some(value=>value?.replace(/\s+/g,' ').trim()===label));}
                if(elements.length!==1)throw new Error(`Counter binding is missing or ambiguous: ${locator.selector}`);
                return elements[0];
              },
              read(root:HTMLElement):number{
                if(!root.isConnected||!dom.visible(root))throw new Error('Counter target is unavailable');
                const element=dom.find(root,{selector:binding.valueSelector});
                if(!dom.visible(element))throw new Error('Counter value is not visible');
                const raw=(element instanceof HTMLInputElement||element instanceof HTMLTextAreaElement?element.value:element.textContent?.trim()||element.getAttribute('aria-valuenow')||'').trim();
                const value=Number(raw);
                if(!/^[+-]?\d+(?:\.0+)?$/.test(raw)||!Number.isSafeInteger(value))throw new Error('Counter value is not an unambiguous integer');
                return value;
              },
              available(element:HTMLElement):boolean{return element.isConnected&&dom.visible(element)&&!element.matches(':disabled')&&!element.closest('[aria-disabled="true"]');},
              pause(ms:number):Promise<void>{return new Promise(resolve=>setTimeout(resolve,ms));},
              async click(element:HTMLElement,root:HTMLElement,current:number):Promise<void>{
                if(!dom.available(element))throw new Error('The application disabled this counter action');
                element.scrollIntoView({block:'center',behavior:'instant'});
                let uncovered=false;
                for(let attempt=0;attempt<60;attempt++){
                  if(!dom.available(element))throw new Error('The application disabled this counter action');
                  const rect=element.getBoundingClientRect(),top=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
                  if(top&&element.contains(top)){uncovered=true;break;}
                  await dom.pause(50);
                }
                if(!uncovered)throw new Error('Another UI element is covering the counter action');
                if(dom.read(root)!==current)throw new Error('Counter value changed before the action could be clicked');
                if(!dom.available(element))throw new Error('The application disabled this counter action');
                element.click();
                await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
              },
            };
            const root=binding.selector?dom.find(scope,{selector:binding.selector}):scope;
            let current=dom.read(root),steps=0;
            if(Math.abs(desired-current)>100)throw new Error('Counter change exceeds the 100-step bound');
            try{while(current!==desired){
              if(steps>=100)throw new Error('Counter did not reach the desired quantity within 100 steps');
              const direction=desired>current?1:-1;
              const button=dom.find(root,direction===1?binding.increment:binding.decrement);
              await dom.click(button,root,current);steps++;
              const deadline=Date.now()+2000;let next=dom.read(root);
              while(next===current&&Date.now()<deadline){await dom.pause(25);next=dom.read(root);}
              if((next-current)*direction<=0)throw new Error('The counter did not move in the requested direction');
              if((next-desired)*direction>0)throw new Error('The counter stepped past the requested quantity');
              current=next;
            }}catch(error){
              if(!steps)throw error;
              let visible:string='unavailable';try{visible=String(dom.read(root));}catch{}
              throw new Error(`${error instanceof Error?error.message:String(error)}; ${steps} counter click(s) were dispatched; visible quantity: ${visible}`);
            }
            return {value:current,steps};
          },
        };
        // A source-defaulted scalar input may be omitted: keep the UI's current quantity and perform its original action.
        // DTO counters without a submit action remain required, so missing nested input is rejected by the driver.
        if(Object.hasOwn(args,d.counter.param)||!d.counter.submitAction){
          const scope=d.counter.selector?target.closest<HTMLElement>(capability.componentSelector):target;
          if(!scope)throw new Error('Counter owning component is unavailable');
          await counter.run(scope,args,d.counter);
        }
        if(d.counter.submitAction)await dom.click(target);
        return {status:'ui-dispatched',url:location.href};
      }
      if(d.buttons){await dom.click(target);return {status:'ui-dispatched',url:location.href};}
      // Object methods (not const arrows) so a transpiler's name-keeping helper is never injected into the serialized function.
      const u = {
        sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); },
        one(selector: string) { const found = document.querySelectorAll<HTMLElement>(selector); if (found.length !== 1) throw new Error(`UI binding is missing or ambiguous: ${selector}`); return found[0]; },
        label(root: HTMLElement) { return /(\d+)\s*[\u2013-]\s*(\d+)\s+of\s+(\d+)/.exec(root.querySelector('.mat-mdc-paginator-range-label')?.textContent ?? ''); },
        // Widgets disable themselves while data reloads; wait for them like a person would, never force a click.
        async press(el: HTMLElement) {
          for (let i = 0; i < 60; i++) {
            if (dom.visible(el) && !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true') { await dom.click(el); return; }
            await new Promise<void>(r => setTimeout(r, 50));
          }
          throw new Error('The application kept this control disabled');
        },
        sizeNow(root: HTMLElement) { const t = root.querySelector('.mat-mdc-paginator-page-size mat-select')?.textContent?.trim(); return t ? Number(t) : undefined; },
      };
      const widgets = {
        async file(spec: { name: string; mimeType: string; base64: string }) {
          // The native file chooser cannot be scripted from the page; this sets the same FileList the chooser would.
          const input = u.one(d.file!.selector) as HTMLInputElement;
          if (input.disabled) throw new Error('The file input is disabled');
          const bytes = Uint8Array.from(atob(spec.base64), c => c.charCodeAt(0));
          const transfer = new DataTransfer();
          transfer.items.add(new File([bytes], spec.name, { type: spec.mimeType }));
          input.files = transfer.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        },
        async search(value: string) {
          const input = u.one(d.search!.selector) as HTMLInputElement;
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (!setter) throw new Error('No native control setter');
          setter.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
        },
        async sort(direction: string, column?: string) {
          const wanted = direction === '' ? 'none' : direction === 'desc' ? 'descending' : 'ascending';
          const root = u.one(d.sort!.selector);
          for (let i = 0; i < 5; i++) {
            const all = Array.from(root.querySelectorAll<HTMLElement>('[aria-sort]'));
            const mine = column ? all.filter(h => h.classList.contains(`mat-column-${column}`)) : all.filter(h => h.getAttribute('aria-sort') !== 'none');
            if (mine.length === 1 && mine[0].getAttribute('aria-sort') === wanted) return;
            if (column && !mine.length) throw new Error(`No sortable column: ${column}`);
            // Without a named column only the currently sorted one is toggled; never pick a different column on a guess.
            const header = mine[0];
            if (!header) throw new Error('No sortable column header was found');
            await u.press(header);
            await u.sleep(100);
          }
          throw new Error('The sort direction could not be set');
        },
        async tab(index: number) {
          const root = u.one(d.tabs!.selector);
          const headers = Array.from(root.querySelectorAll<HTMLElement>('[role="tab"]'));
          if (!Number.isInteger(index) || index < 0 || index >= headers.length) throw new Error(`There is no tab ${index}`);
          if (headers[index].getAttribute('aria-selected') !== 'true') await u.press(headers[index]);
          await u.sleep(300);
        },
        async paginate(page: number | undefined, size: number | undefined) {
          const root = u.one(d.paginator!.selector);
          if (size !== undefined && u.sizeNow(root) !== size) {
            const select = root.querySelector<HTMLElement>('.mat-mdc-paginator-page-size mat-select');
            if (!select) throw new Error('The paginator has no page-size selector');
            await u.press(select);
            let panel: HTMLElement | null = null;
            for (let i = 0; i < 60; i++) { const id = select.getAttribute('aria-controls'); panel = id ? document.getElementById(id) : null; if (panel && dom.visible(panel)) break; await u.sleep(50); }
            if (!panel) throw new Error('The page-size panel did not open');
            const option = Array.from(panel.querySelectorAll<HTMLElement>('[role="option"]')).filter(o => o.textContent?.trim() === String(size));
            if (option.length !== 1) throw new Error(`Page size is not offered: ${size}`);
            await u.press(option[0]);
            await u.sleep(150);
          }
          if (page === undefined) return;
          for (let i = 0; i < 200; i++) {
            // The list may re-render while it reloads, so the paginator is looked up again each time.
            await u.sleep(50);
            const live = u.one(d.paginator!.selector);
            const m = u.label(live);
            const sized = u.sizeNow(live);
            const length = Number.isFinite(sized) && sized ? sized : (m ? Number(m[2]) - Number(m[1]) + 1 : 1);
            const index = m ? Math.floor((Number(m[1]) - 1) / length) : 0;
            if (index === page) return;
            const button = live.querySelector<HTMLElement>(index < page ? '.mat-mdc-paginator-navigation-next' : '.mat-mdc-paginator-navigation-previous');
            if (!button || button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true') throw new Error(`Page ${page} is not reachable`);
            await u.press(button);
            await u.sleep(100);
          }
          throw new Error('The page could not be reached');
        },
      };
      if (d.file) await widgets.file(args[d.file.param] as { name: string; mimeType: string; base64: string });
      if (d.search && args[d.search.param] !== undefined) await widgets.search(String(args[d.search.param]));
      if (d.sort && args[d.sort.param] !== undefined) await widgets.sort(String(args[d.sort.param]), d.sort.columnParam ? String(args[d.sort.columnParam]) : undefined);
      if (d.tabs && args[d.tabs.param] !== undefined) await widgets.tab(Number(args[d.tabs.param]));
      if (d.paginator) await widgets.paginate(d.paginator.page ? args[d.paginator.page] as number | undefined : undefined, d.paginator.pageSize ? args[d.paginator.pageSize] as number | undefined : undefined);
      return { status: 'ui-dispatched', url: location.href };
    }
    if (!dom.visible(target)) throw new Error('UI action is hidden or unavailable');
    if(capability.plan){
      const root=capability.plan.targetRoot?target.closest<HTMLElement>(capability.plan.targetRoot):dom.find(document,{selector:capability.plan.root});
      if(!root)throw new Error('The selected action has no authored input container');
      const fieldRoot=capability.plan.targetRoot?root:target;
      for(const [name,value] of Object.entries(args)){
        const list=capability.plan.lists?.find(l=>l.name===name);
        if(list){
          if(!Array.isArray(value))throw new Error(`Invalid list field: ${name}`);
          for(const item of value){
            const input=dom.find(root,list.input) as HTMLInputElement;
            const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
            if(!setter)throw new Error('No native control setter');
            setter.call(input,String(item));input.dispatchEvent(new Event('input',{bubbles:true}));
            input.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',bubbles:true}));
            await dom.settle(root);
          }
          continue;
        }
        const repeat=capability.plan.repeats.find(r=>r.name===name);
        if(repeat){
          if(!Array.isArray(value)||value.length>repeat.maxItems)throw new Error(`Invalid repeated field size: ${name}`);
          let rows=Array.from(target.querySelectorAll<HTMLElement>(repeat.rowSelector));
          if(rows.length>repeat.maxItems)throw new Error(`Existing row count exceeds the reviewed bound: ${name}`);
          while(rows.length!==value.length){
            const before=rows.length;
            if(before<value.length)await dom.click(dom.find(root,repeat.add));
            else{if(!repeat.remove)throw new Error(`No remove-row action for ${name}`);await dom.click(dom.find(rows.at(-1)!,repeat.remove));}
            await dom.settle(root);rows=Array.from(target.querySelectorAll<HTMLElement>(repeat.rowSelector));
            if(rows.length==before)throw new Error(`The application did not change the row count: ${name}`);
          }
          for(let i=0;i<value.length;i++){
            if(!value[i]||typeof value[i]!=='object'||Array.isArray(value[i]))throw new Error(`Invalid repeated row: ${name}`);
            for(const [key,item] of Object.entries(value[i])){
              const field=repeat.fields.find(f=>f.name===key);if(!field)throw new Error(`Unsupported repeated field: ${name}.${key}`);
              await dom.fill(rows[i],field,item);
            }
          }
        }else{
          const field=capability.fields.find(f=>f.name===name);if(!field)throw new Error(`Unsupported form field: ${name}`);
          await dom.fill(fieldRoot,field,value);
        }
      }
      await dom.settle(root);
      if(capability.plan.commit){
        const commit=capability.plan.commit;
        if(capability.fields.length!==1)throw new Error('An event commit needs exactly one source-bound control');
        const control=dom.find(fieldRoot,capability.fields[0]);
        if(!dom.visible(control)||control.matches(':disabled')||control.getAttribute('aria-disabled')==='true')throw new Error('The application disabled the event control');
        await dom.waitForClick(control);
        control.focus();
        if(commit.event==='keyup')control.dispatchEvent(new KeyboardEvent('keyup',{key:commit.key,code:commit.key,bubbles:true,cancelable:true}));
        else control.blur();
        await dom.settle(root);
      }
      if(capability.plan.mode==='submit'){
        if(!capability.plan.submit)throw new Error('Workflow has no submit action');
        forms.gate(fieldRoot,root);
        if(target instanceof HTMLFormElement&&!target.checkValidity())throw new Error('The application rejected the form values');
        await dom.click(capability.plan.targetRoot?target:dom.find(root,capability.plan.submit));
      }
    } else if (capability.action.kind === 'form') {
      if (!(target instanceof HTMLFormElement)) throw new Error('The compiled form no longer matches the UI');
      for (const [name, value] of Object.entries(args)) {
        const field = capability.fields.find(f => f.name === name && f.supported);
        if (!field) throw new Error(`Unsupported form field: ${name}`);
        await dom.fill(target,field,value);
      }
      // Let Angular run the same validation/change detection as it does for human input.
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      forms.gate(target, target);
      const buttons = target.querySelectorAll<HTMLButtonElement>(capability.action.submitSelector ?? 'button[type="submit"]');
      if (buttons.length !== 1) throw new Error('Submit control is ambiguous or absent');
      const button = buttons[0];
      if (button.disabled || button.getAttribute('aria-disabled') === 'true' || !dom.visible(button) || !target.checkValidity()) throw new Error('The application disabled submission or rejected the form values');
      await dom.waitForClick(button);
      if (button.disabled || !dom.visible(button)) throw new Error('The application disabled submission');
      button.click();
    } else {
      if ('disabled' in target && target.disabled || target.getAttribute('aria-disabled') === 'true') throw new Error('The application disabled this action');
      await dom.waitForClick(target);
      if ('disabled' in target && target.disabled || !dom.visible(target)) throw new Error('The application disabled this action');
      target.click();
    }
    // Dispatch is not a claim that the backend accepted an operation.
    return { status: 'ui-dispatched', url: location.href };
  } catch (error) {
    // Close what this call opened so a failure does not leave a menu or dialog open in front of the person.
    if (revealed) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    throw error;
  } finally {
    state.__angularMcpBusy = false;
  }
}

// The WebMCP draft removes a tool by aborting the signal it was registered with; earlier drafts and polyfills have unregisterTool.
// The draft does not check arguments against inputSchema, so every call is validated here before anything is touched.
interface WebContext {
  registerTool(tool: { name: string; description: string; inputSchema: object; annotations?: { readOnlyHint: boolean }; execute: (args: Record<string, unknown>) => Promise<string> }, options?: { signal: AbortSignal }): void | Promise<void>;
  unregisterTool?(name: string): void;
}

export async function installWebMcp(entries: { capability: Capability; tool: ToolDefinition }[],options:{context?:Record<string,unknown>}={}) {
  const context = (document as Document & { modelContext?: WebContext }).modelContext ?? (navigator as Navigator & { modelContext?: WebContext }).modelContext;
  if (!context) throw new Error('This browser does not provide WebMCP; use the MCP browser adapter or install a WebMCP polyfill');
  const ajv = new Ajv({ allErrors: true });
  const installed: string[] = [], registration = new AbortController();
  const tools = { remove() {
    registration.abort();
    for (const name of installed.splice(0)) try { context.unregisterTool?.(name); } catch { /* the signal already removed it */ }
  } };
  try {
    for (const { capability, tool } of entries) {
      const validate = ajv.compile(tool.inputSchema);
      await context.registerTool({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as object, annotations: { readOnlyHint: tool.annotations?.readOnlyHint === true },
        execute: async args => {
          if (!validate(args)) throw new Error(ajv.errorsText(validate.errors));
          if(capability.contextSchema){const validateContext=ajv.compile(capability.contextSchema);if(!validateContext(options.context??{}))throw new Error(`Required runtime context is missing or invalid: ${ajv.errorsText(validateContext.errors)}`);}
          const params = capability.routeParams ?? [];
          const target=capability.target??capability.reveal?.target;
          const route = params.reduce((path, name) => path.replace(new RegExp(`:${name}(?![\\w])`), encodeURIComponent(String(args[name]))), capability.route);
          if (params.length && location.pathname !== route) throw new Error('Navigate through the application to the target route first');
          return JSON.stringify(await executeDom({ capability, args: Object.fromEntries(Object.entries(args).filter(([key]) => !params.includes(key) && (!target||target.literalValue!==undefined||target.keepInput||key!==target.param))), context:options.context, route, targetValue: target&&target.literalValue===undefined ? args[target.param] : undefined }));
        } }, { signal: registration.signal });
      installed.push(tool.name);
    }
  } catch (error) {
    tools.remove();
    throw error;
  }
  return () => tools.remove();
}
