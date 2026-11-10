import { Ajv } from 'ajv';
import type { Dialog, Page, Request } from 'playwright';
import { setTimeout } from 'node:timers/promises';
import { executeDom } from './browser-runtime.js';
import { reviewedTools } from './approval.js';
import type { Approval, Manifest } from './model.js';

export interface AdapterOptions {
  /** Explicit embedding context for actions whose source UI container is outside the tool payload. */
  context?:Record<string,unknown>;
  /** The application uses hash routing (`useHash: true`): routes live after `#`. */
  hash?: boolean;
  /** Validate arguments against the capability's schema before acting (default). The prober turns this off to test the schema itself. */
  validate?: boolean;
  /** Called after navigation and before the UI is acted on (the prober arms its instrumentation here). */
  beforeAct?: (page: Page) => Promise<void>;
}

export function browserAdapter(page: Page, manifest: Manifest, approvals: Approval[], baseUrl: string, options: AdapterOptions = {}) {
  const base = new URL(baseUrl);
  // A deployed <base href> (e.g. http://localhost:4200/app/) prefixes every route.
  const basePath = base.pathname.replace(/\/$/, '');
  const hash = options.hash === true;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.protocol !== 'http:') throw new Error('This experiment only executes against a local HTTP app');
  const ajv = new Ajv({ allErrors: true, strict: false });
  // One unusable schema (for example an unsupported regex) must not take the other reviewed tools down with it.
  const entries = reviewedTools(manifest, approvals).flatMap(entry => {
    try { return [{ ...entry, validate: ajv.compile(entry.tool.inputSchema) }]; }
    catch (error) { console.error(`Skipping ${entry.capability.id}: its input schema cannot be compiled (${error instanceof Error ? error.message : String(error)})`); return []; }
  });
  let busy = false;
  return {
    tools: entries.map(e => e.tool),
    async invoke(name: string, args: Record<string, unknown>) {
      if (busy) throw new Error('Another UI operation is in progress');
      const entry = entries.find(e => e.tool.name === name);
      if (!entry) throw new Error(`Tool is not reviewed: ${name}`);
      if (options.validate !== false && !entry.validate(args)) throw new Error(ajv.errorsText(entry.validate.errors));
      if(entry.capability.contextSchema){const validate=ajv.compile(entry.capability.contextSchema);if(!validate(options.context??{}))throw new Error(`Required runtime context is missing or invalid: ${ajv.errorsText(validate.errors)}`);}
      busy = true;
      try {
        const params = entry.capability.routeParams ?? [];
        const onOrigin=page.url().startsWith(base.origin+'/');
        const active=onOrigin?new URL(page.url()):undefined;
        const activePath=active?(hash?active.hash.replace(/^#/,'').split('?')[0]:active.pathname.slice(basePath.length)):'';
        const layoutAction=entry.capability.allowedRoutes?.some(pattern=>{const expected=pattern.split('/'),actual=activePath.replace(/\/$/,'').split('/');return expected.length===actual.length&&expected.every((part,index)=>part.startsWith(':')?!!actual[index]:part===actual[index]);});
        const globalAction = onOrigin&&(entry.capability.global === true||layoutAction===true);
        if (params.some(name => ['.', '..'].includes(String(args[name])))) throw new Error('Route parameters cannot be "." or ".."');
        const route = params.reduce((path, name) => path.replace(new RegExp(`:${name}(?![\\w])`), encodeURIComponent(String(args[name]))), entry.capability.route);
        const tgt = entry.capability.target ?? entry.capability.reveal?.target;
        const rest = Object.fromEntries(Object.entries(args).filter(([key]) => !params.includes(key) && (tgt?.literalValue!==undefined||tgt?.keepInput||key !== tgt?.param) && !(entry.capability.queryParams ?? []).includes(key)));
        const queryNames = entry.capability.queryParams ?? [];
        const query = new URLSearchParams(queryNames.map(name => [name, String(args[name])]));
        const url = globalAction ? new URL(page.url()) : hash
          ? new URL(`${base.origin}${basePath}/#${route}${query.size ? '?' + query : ''}`)
          : new URL(`${base.origin}${basePath}${route}${query.size ? '?' + query : ''}`);
        if (!hash && !globalAction && entry.capability.route.includes(':') && url.pathname.split('/').length !== new URL(`${base.origin}${basePath}${entry.capability.route}`).pathname.split('/').length) throw new Error('A route parameter changed the shape of the approved route');
        // A form that is already on screen may hold values from an earlier call or from the user; start submitting actions fresh.
        const submitsForm = entry.capability.action.kind === 'form' || entry.capability.plan?.mode === 'submit';
        // Only needed when some field is left to its current value, which may be stale; a fully specified call overwrites everything.
        const leavesFieldsUntouched = entry.capability.fields.some(f => f.supported && !(f.name in args));
        if (page.url() === url.href && submitsForm && leavesFieldsUntouched) { await page.reload(); await page.waitForLoadState('networkidle'); }
        if (page.url() !== url.href || entry.capability.action.kind === 'navigation') {
          await page.goto(url.href);
          await page.waitForLoadState('networkidle');
        }
        // Navigation uses the real router and its guards. Failure never falls back to a service call.
        if (entry.capability.action.kind === 'navigation') {
          // The signed link itself is the action; the application runs its page-load workflow on arrival.
          if (new URL(page.url()).origin !== base.origin) throw new Error('The application left the approved origin');
          const quiet = Date.now() + 1500;
          while (Date.now() < quiet) await setTimeout(50);
          await page.waitForLoadState('networkidle');
          return { status: 'ui-dispatched', url: page.url() };
        }
        if(entry.capability.drive?.drag){
          const spec=entry.capability.drive.drag,id=spec.sourceId??(spec.sourceContext?options.context?.[spec.sourceContext]:undefined);
          await page.waitForFunction(({selector,id})=>Array.from(document.querySelectorAll<HTMLElement>(selector)).some(el=>el.id===id&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden'),{selector:spec.listSelector,id},{timeout:5000});
        }else await page.locator(entry.capability.reveal?.trigger ?? entry.capability.action.selector).first().waitFor({ state: entry.capability.drive?.file||entry.capability.target||entry.capability.reveal?.target ? 'attached' : 'visible', timeout: 5000 });
        if (new URL(page.url()).origin !== base.origin) throw new Error('The application left the approved origin');
        await options.beforeAct?.(page);
        // A completed document's networkidle load state can stay satisfied during SPA work.
        // Observe fresh activity around this action instead of reusing that earlier load state.
        const pending = new Set<Request>();
        let lastActivity = Date.now();
        const started = (request: Request) => { pending.add(request); lastActivity = Date.now(); };
        const finished = (request: Request) => { pending.delete(request); lastActivity = Date.now(); };
        const navigated = () => { lastActivity = Date.now(); };
        // Native confirm()/alert() cannot be answered by a tool: dismiss it, then report that the action was not completed.
        const dialogs: string[] = [];
        const onDialog = (dialog: Dialog) => { dialogs.push(dialog.message()); dialog.dismiss().catch(() => undefined); };
        const embedderHandlesDialogs = ((page as unknown as { listenerCount?(event: string): number }).listenerCount?.('dialog') ?? 0) > 0;
        if (!embedderHandlesDialogs) page.on('dialog', onDialog);
        page.on('request', started).on('requestfinished', finished).on('requestfailed', finished).on('framenavigated', navigated);
        try {
          const result = await page.evaluate(executeDom, { capability: entry.capability, args: rest, context:options.context, route, routing: { hash, basePath }, targetValue: tgt&&tgt.literalValue===undefined ? args[tgt.param] : undefined });
          const deadline = Date.now() + 10000;
          while (pending.size || Date.now() - lastActivity < 500) {
            if (Date.now() > deadline) throw new Error('UI action was dispatched but did not settle; inspect the application before retrying');
            await setTimeout(25);
          }
          if (dialogs.length) throw new Error(`The application asked for confirmation ("${dialogs[0].slice(0, 80)}"). A person must confirm it in the application; the action was not completed.`);
          return { ...result, url: page.url() };
        } finally {
          page.off('dialog', onDialog);
          page.off('request', started).off('requestfinished', finished).off('requestfailed', finished).off('framenavigated', navigated);
        }
      } finally { busy = false; }
    },
  };
}
