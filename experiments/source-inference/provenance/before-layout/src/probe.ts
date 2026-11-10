import { Ajv } from 'ajv';
import type { Browser, Dialog, Page, Request } from 'playwright';
import { browserAdapter } from './browser-adapter.js';
import { hash } from './hash.js';
import { learnFieldsConstraints, operationEvidence, repeatsOperation } from './probe-learning.js';
import { watchForms, type LiveForm } from './live-forms.js';
import { livePatch, repairFromLive } from './live-rules.js';
import type { Capability, Manifest, Schema } from './model.js';

/**
 * Dynamic probing: the running application is treated as an oracle. Each capability is executed in a sandbox (network mocked,
 * fresh profile), its observable effects are recorded, and its input contract is checked and corrected by asking the app's own
 * validators which values they accept (membership queries). Static analysis proposes; the app decides.
 */
export interface Effects {
  http: { method: string; path: string; bodyKeys: string[]; body?: string }[];
  storage: string[];
  navigated: boolean;
  overlay: boolean;
  domChanged: boolean;
  dialogs: string[];
  /** Calls to the service methods the static analysis traced, seen at run time (dev mode): the effect of in-memory services. */
  calls: { method: string; args: unknown }[];
}
export type EffectClass = 'write' | 'read' | 'navigation' | 'opens-overlay' | 'ui-state' | 'none-observed';
export interface Probe {
  args: Record<string, unknown>; accepted: boolean; staticAccepts: boolean; note: string;
  /** The application's own rule that refused the value. No schema can state it, so the probe is not held against the contract. */
  rule?: string;
}
export interface ProbeReport {
  id: string;
  effectClass: EffectClass;
  effects: Effects;
  confirmationRequired: boolean;
  probes: Probe[];
  agreement: number | null;
  learned: Record<string, Record<string, unknown>>;
  disagreements: string[];
  /** Queries that could not justify a contract change (budget, format or idempotent UI state). */
  uncertainties?: string[];
  /** Option values learned by clicking each live option and watching what the app received (value-change widgets). */
  options?: Record<string, { value: string; label: string }[]>;
  skipped?: string;
  /** Fields the application only accepts when they equal another field (dependent -> source), checked by submitting unequal values. */
  sameAs?: Record<string, string>;
  /** Rules of the application's own that refused schema-valid values; the runtime enforces them when the tool is called. */
  ownRules?: string[];
  /** Inputs found by watching the app (none were visible to static analysis); the capability with fields, plan and contract filled in. */
  synthesized?: Capability;
  /** The input the app accepted. Kept in memory to run the action again as a step toward another one; never written out. */
  example?: Record<string, unknown>;
  /** What the sandbox supplied in the host's place: that the action was confirmed, the list a drag starts in. A served tool takes it from its own host. */
  context?: Record<string, unknown>;
  /** What the app lacked when the action could not run: the page stayed closed, no record to act on, the control was not shown, or nothing happened. */
  needs?: 'page' | 'record' | 'control' | 'effect';
}
/** Browser storage (cookies and localStorage) as Playwright saves it: a file, or the saved state itself. */
export type StorageState = NonNullable<NonNullable<Parameters<Browser['newContext']>[0]>['storageState']>;
/** An action run before a probe so that the app is in the state it leaves behind. */
export interface Step { capability: Capability; args: Record<string, unknown>; context?: Record<string, unknown> }
export interface ProbeOptions {
  baseUrl: string; hash?: boolean; params?: Record<string, string>; budget?: number; log?: (line: string) => void;
  /** Let the app's read requests (GET, HEAD) reach its backend, so it runs on real records. Every other request stays in the sandbox. */
  liveReads?: boolean;
  /** Origins read requests may reach with `liveReads`, besides the app's own origin and other local hosts. */
  readOrigins?: string[];
  /** Browser storage every attempt starts from: a signed-in session saved to a file, or state an earlier action left behind. */
  storageState?: StorageState;
  /** Actions every attempt runs first, in the same page, when the state they leave is not kept in browser storage. */
  prelude?: Step[];
  /** Names the state the attempts start in; what is learned about the app (its links) is kept per state. */
  world?: string;
  /** Only establish whether the action runs with an example input; no search for other inputs, no contract checks. */
  quick?: boolean;
  /** What one certification run has learned about the running app and shares between capabilities. */
  shared?: { links?: Record<string, string[]>; stubbedReads?: boolean; ownFiles?: string[] };
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
/** Files an app ships with itself and fetches at run time (configuration, translations, seed data, icons). */
const OWN_FILE = /\.(json|txt|csv|tsv|xml|ya?ml|md|html?|svg|geojson|webmanifest|properties|po|arb)$/i;
/** Every route the manifest knows, as a path from the application root. */
const knownRoutes = (manifest: Manifest): string[] => [...new Set(['/', ...manifest.capabilities.map(c => c.route), ...manifest.routes.map(r => `/${r.path.replace(/^\/+/, '')}`)])];
const fixedRoute = (route: string) => !/[:*]/.test(route);

/**
 * A fresh browser profile in which the app can change nothing outside the page: every request that is not a read is answered
 * by the sandbox with an empty document, other origins are not navigated to, and sockets are closed. The dev server still
 * serves the app's own files, the ones it fetches as well as the ones it loads. Backend reads get the same empty answer as
 * writes unless `liveReads` lets them through.
 */
export async function sandbox(browser: Browser, options: ProbeOptions) {
  const origin = new URL(options.baseUrl).origin;
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block', ...(options.storageState ? { storageState: options.storageState } : {}) });
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    if (!['fetch', 'xhr'].includes(request.resourceType())) return url.origin === origin ? route.fallback() : route.abort('blockedbyclient');
    if (options.liveReads && (url.origin === origin || LOCAL_HOSTS.includes(url.hostname) || (options.readOrigins ?? []).includes(url.origin))) return route.fallback();
    if (url.origin === origin && OWN_FILE.test(url.pathname)) {
      const served = options.shared ? options.shared.ownFiles ??= [] : [];
      if (!served.includes(url.pathname)) served.push(url.pathname);
      return route.fallback();
    }
    if (options.shared) options.shared.stubbedReads = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  return context;
}

/** Values for a route pattern's parameters taken from the first path that matches it. `taken` are the app's own fixed routes. */
export function routeValues(pattern: string, paths: string[], taken: string[] = [], fixed: Record<string, string> = {}): Record<string, string> | undefined {
  const names: string[] = [];
  const source = pattern.split('/').map(segment => segment.startsWith(':') ? (names.push(segment.slice(1)), '([^/]+)') : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/');
  const regex = new RegExp(`^${source}$`);
  for (const path of paths) {
    const match = taken.includes(path) ? null : regex.exec(path);
    if (!match) continue;
    try {
      const values = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      if (names.every(name => fixed[name] === undefined || fixed[name] === values[name])) return values;
    } catch { /* a malformed escape is not a usable identifier */ }
  }
  return undefined;
}

/** Runs the actions a probe starts after, in the page the probe will use and through the runtime a served tool uses. */
async function replay(page: Page, manifest: Manifest, options: ProbeOptions): Promise<void> {
  if (!options.prelude?.length) return;
  // The app may ask for a native confirmation on the way; the sandbox agrees, as it does while it observes an action.
  const onDialog = (dialog: Dialog) => { dialog.accept().catch(() => undefined); };
  page.on('dialog', onDialog);
  try {
    for (const step of options.prelude) {
      try {
        const adapter = browserAdapter(page, { ...manifest, capabilities: [step.capability] }, [{ id: step.capability.id, fingerprint: step.capability.fingerprint, description: 'state', effect: 'write' }], options.baseUrl, { hash: options.hash, validate: false, context: step.context });
        let args = step.args;
        // State that is built again may name its rows anew (a generated identifier): the row is looked up where it now is.
        const row = step.capability.target?.param ?? step.capability.reveal?.target?.param;
        // Earlier steps may have left state that lives only in the page: the route is changed inside the app, not by loading it again.
        if (!step.capability.global && step.capability.action.kind !== 'navigation') await openRoute(page, { ...options, prelude: options.prelude }, routeOf(step.capability, args));
        if (row && args[row] !== undefined) {
          const key = await rowKey(page, step.capability, args[row]);
          if (key !== undefined) args = { ...args, [row]: rowArg((step.capability.target ?? step.capability.reveal?.target)!, args[row], key) };
        }
        await adapter.invoke(adapter.tools[0].name, args);
      } catch { /* a step that does not run leaves the app as it was; the probe that follows reports what is missing */ }
      await page.waitForTimeout(250);
    }
  } finally { page.off('dialog', onDialog); }
}

/**
 * Runs actions in a fresh sandbox, from the state the options describe, and returns the browser storage they leave behind
 * when every one of them left something there. State that lives only in the page's memory is in no saved storage: such
 * actions are run again before each attempt.
 */
export async function settle(browser: Browser, manifest: Manifest, steps: Step[], options: ProbeOptions): Promise<Exclude<StorageState, string> | undefined> {
  const context = await sandbox(browser, options);
  try {
    const page = await context.newPage();
    await page.goto(options.baseUrl).catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(500);
    // The state these actions start from may itself be held in memory; storage saved after them would then lack it.
    await replay(page, manifest, options);
    let kept = steps.length > 0 && !options.prelude?.length, last = JSON.stringify(await context.storageState());
    for (const step of steps) {
      await replay(page, manifest, { ...options, prelude: [step] });
      const now = JSON.stringify(await context.storageState());
      if (now === last) kept = false;
      last = now;
    }
    return kept ? JSON.parse(last) as Exclude<StorageState, string> : undefined;
  } finally { await context.close(); }
}

/** Whether the app stays on a route when it is opened: a guard that sends the visitor elsewhere means it does not. */
export async function opens(browser: Browser, manifest: Manifest, route: string, options: ProbeOptions): Promise<boolean> {
  const context = await sandbox(browser, options);
  try {
    const page = await context.newPage();
    if (options.prelude?.length) {
      await page.goto(options.baseUrl).catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await replay(page, manifest, options);
    }
    await openRoute(page, options, route);
    await page.waitForTimeout(400);
    return decoded(pathOf(page.url())) === decoded(route.replace(/(.)\/+$/, '$1'));
  } finally { await context.close(); }
}

/**
 * Paths the running application links to. Real identifiers (a record's id, an article's slug) are found in the app's own links,
 * so a route with parameters can be visited without anyone writing fixtures: the plain routes are read first, then one page of
 * each parameterised route they lead to (an article links on to its author).
 */
export async function harvestLinks(browser: Browser, manifest: Manifest, options: ProbeOptions): Promise<string[]> {
  const origin = new URL(options.baseUrl).origin, found = new Set<string>();
  const routes = knownRoutes(manifest);
  const plain = routes.filter(fixedRoute), patterns = routes.filter(route => route.includes(':') && !route.includes('*'));
  const context = await sandbox(browser, options);
  try {
    const page = await context.newPage();
    if (options.prelude?.length) {
      await page.goto(options.baseUrl).catch(() => undefined);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await replay(page, manifest, options);
    }
    const visit = async (route: string) => {
      await openRoute(page, options, route);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      await page.waitForTimeout(400);
      const seen = await page.evaluate(() => {
        const ng = (window as any).ng, out: string[] = [];
        for (const el of Array.from(document.querySelectorAll('a[href]'))) out.push((el as HTMLAnchorElement).href);
        // A router link on an element that is not an anchor has no href, and a bound one leaves no attribute to select it by;
        // its directive still knows the address.
        if (ng?.getDirectives) for (const el of Array.from(document.querySelectorAll('body *:not(a[href])')).slice(0, 5000)) {
          try { for (const d of ng.getDirectives(el)) if (d?.urlTree) out.push('route:' + String(d.urlTree)); } catch { /* not a router link */ }
        }
        // Records the page shows without linking to them (a card that opens a dialog): a component that holds a record under
        // a name ("issue", "issues") tells which identifiers exist for a route that asks for one by that name (":issueId").
        if (ng?.getComponent) {
          const records = new Set<string>();
          const note = { of(name: string, value: any): void {
            for (const row of (Array.isArray(value) ? value.slice(0, 3) : [value])) {
              if (!row || typeof row !== 'object') continue;
              for (const key of ['id', '_id', 'slug', 'uuid', 'key']) if ((typeof row[key] === 'string' && row[key].length < 80) || typeof row[key] === 'number') records.add(`record:${name}\t${key}\t${row[key]}`);
            }
          } };
          for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 5000)) {
            let comp: any; try { comp = ng.getComponent(el); } catch { comp = undefined; }
            if (!comp) continue;
            for (const name of Object.keys(comp).slice(0, 60)) {
              try {
                let value = comp[name];
                if (typeof value === 'function' && Object.getOwnPropertySymbols(value).some(symbol => symbol.description === 'SIGNAL')) value = value();
                if (value && typeof value === 'object') note.of(name, value);
              } catch { /* a property that cannot be read is not a record */ }
            }
            if (records.size > 200) break;
          }
          out.push(...records);
        }
        return out;
      }).catch(() => [] as string[]);
      for (const link of seen) {
        if (link.startsWith('record:')) { found.add(link); continue; }
        let path: string | undefined;
        if (link.startsWith('route:')) path = link.slice(6);
        else { try { const url = new URL(link); if (url.origin === origin) path = options.hash ? (url.hash.startsWith('#/') ? url.hash.slice(1) : undefined) : url.pathname; } catch { /* not a URL */ } }
        path = path?.split(/[?#]/)[0].replace(/(.)\/+$/, '$1');
        if (path?.startsWith('/')) found.add(path);
      }
    };
    for (const route of plain.slice(0, 12)) await visit(route);
    const visited = new Set<string>();
    for (let depth = 0; depth < 2; depth++) for (const pattern of patterns) {
      if (visited.has(pattern) || visited.size >= 8) continue;
      const values = routeValues(pattern, [...found], plain);
      if (!values) continue;
      visited.add(pattern);
      await visit(pattern.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(values[name])));
    }
  } finally { await context.close(); }
  return [...found];
}

/** The application path a URL shows, with either routing style. */
const pathOf = (href: string): string => { try { const u = new URL(href); return (u.hash.startsWith('#/') ? u.hash.slice(1) : u.pathname).split('?')[0].replace(/(.)\/+$/, '$1'); } catch { return ''; } };
const decoded = (path: string) => { try { return decodeURIComponent(path); } catch { return path; } };
/** Whether a path is a page beneath a route: an app that sends a section on to its first page has not left the section. */
const beneath = (at: string, route: string) => { const r = decoded(route.replace(/(.)\/+$/, '$1')); return r !== '/' && decoded(at).startsWith(`${r}/`); };
const urlOf = (options: ProbeOptions, route: string) => options.hash ? `${new URL(options.baseUrl).origin}/#${route}` : new URL(route, options.baseUrl).href;
/**
 * Opens a route unless the app is already on it. Loading the page again drops whatever state the app keeps only in memory,
 * so when the probe has just rebuilt such state (a session from the app's own login form) the route is changed inside the
 * running app, the way the browser's back button changes it: the address moves and the router is told.
 */
async function openRoute(page: Page, options: ProbeOptions, route: string): Promise<void> {
  if (decoded(pathOf(page.url())) !== decoded(route.replace(/(.)\/+$/, '$1'))) {
    const url = urlOf(options, route);
    const inApp = !!options.prelude?.length && (() => { try { return new URL(page.url()).origin === new URL(url).origin; } catch { return false; } })();
    const moved = inApp && await page.evaluate(({ url, route, hash }) => {
      if (hash) { location.hash = route; return true; }
      history.pushState({}, '', url); window.dispatchEvent(new PopStateEvent('popstate', { state: {} })); return true;
    }, { url, route, hash: options.hash === true }).catch(() => false);
    if (moved) await page.waitForTimeout(400); else await page.goto(url).catch(() => undefined);
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
}
const routeOf = (capability: Capability, args: Record<string, unknown>) => (capability.routeParams ?? []).reduce((path, name) => path.replace(new RegExp(`:${name}(?![\\w])`), encodeURIComponent(String(args[name] ?? '1'))), capability.route);
type RowSpec = NonNullable<Capability['target']>;
/** The key inside the argument that names a row: the argument itself, or one property of a typed object (a product, by its id). */
const keyIn = (spec: RowSpec, value: unknown): unknown => (spec.valuePath ?? []).reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], value);
/** The argument that names the row with this key: the example keeps its shape and takes the key where the runtime reads it. */
function rowArg(spec: RowSpec, current: unknown, key: string, schema?: Schema): unknown {
  const place = (holder: unknown, path: string[], at: Schema | undefined): unknown => {
    if (!path.length) return ['integer', 'number'].includes(String((at as { type?: unknown } | undefined)?.type)) && Number.isFinite(Number(key)) ? Number(key) : key;
    const object = holder && typeof holder === 'object' ? holder as Record<string, unknown> : {};
    return { ...object, [path[0]]: place(object[path[0]], path.slice(1), (at as { properties?: Record<string, Schema> } | undefined)?.properties?.[path[0]]) };
  };
  return spec.valuePath?.length ? place(current, spec.valuePath, schema) : key;
}
/**
 * The identifier of a repeated row the action's control is rendered in, read where the runtime reads it: the row's own template
 * context, or the component that renders the row. The one asked for when the page has it, else the first.
 */
async function rowKey(page: Page, capability: Capability, prefer?: unknown): Promise<string | undefined> {
  const spec = capability.target ?? capability.reveal?.target;
  if (!spec) return undefined;
  const wanted = prefer === undefined ? undefined : keyIn(spec, prefer);
  return page.evaluate(({ selector, path, signals, component, prefer }) => {
    const ng = (window as any).ng; if (!ng?.getContext) return undefined;
    const keys: string[] = [];
    const rows = {
      walk(item: any): unknown {
        let v = item; const seen: string[] = [];
        for (const k of path) { v = v?.[k]; seen.push(k); if (signals.includes(seen.join('.'))) { if (typeof v !== 'function') return undefined; v = v(); } }
        return v;
      },
    };
    for (const el of Array.from(document.querySelectorAll(selector))) {
      let v: unknown;
      if (component) { try { v = rows.walk(ng.getOwningComponent(el)); } catch { v = undefined; } }
      else for (let a: Element | null = el; a; a = a.parentElement) {
        let ctx: any = null; try { ctx = ng.getContext(a); } catch { ctx = null; }
        if (ctx && typeof ctx === 'object' && '$implicit' in ctx) { try { v = rows.walk(ctx.$implicit); } catch { v = undefined; } break; }
      }
      if (typeof v === 'string' || typeof v === 'number') keys.push(String(v));
    }
    return prefer !== undefined && keys.includes(prefer) ? prefer : keys[0];
  }, { selector: capability.reveal?.trigger ?? capability.action.selector, path: spec.path, signals: spec.signals ?? [], component: spec.source === 'component',
    prefer: typeof wanted === 'string' || typeof wanted === 'number' ? String(wanted) : undefined }).catch(() => undefined);
}
/** The runtime found nothing to act on: the control is rendered only in some state of the app. */
const absent = (error: string) => /Expected one UI action; found 0|Timeout \d+ms exceeded/.test(error);
const keysOf = (body: string | null | undefined): string[] => { try { const v = JSON.parse(body ?? ''); return v && typeof v === 'object' ? Object.keys(v).sort() : []; } catch { return []; } };
const classify = (e: Effects): EffectClass =>
  e.http.some(h => !['GET', 'HEAD', 'OPTIONS'].includes(h.method)) || e.storage.length || mutatingCalls(e).length ? 'write' : e.http.length || e.calls.length ? 'read' : e.navigated ? 'navigation' : e.overlay ? 'opens-overlay' : e.domChanged ? 'ui-state' : 'none-observed';
const READ_LIKE = /^(get|list|find|search|load|fetch|query|read|check|view|count|lookup|retrieve|select|is|has)/i;
const mutatingCalls = (e: Effects) => e.calls.filter(c => !READ_LIKE.test(c.method));
const accepted = (e: Effects) => e.http.some(h => !['GET', 'HEAD', 'OPTIONS'].includes(h.method)) || e.storage.length > 0 || e.navigated || mutatingCalls(e).length > 0;
const okRun = (r: { effects: Effects; error?: string }) => !r.error && accepted(r.effects);
/** Error keys of Angular's built-in validators: the rules a JSON Schema can state. */
const STANDARD_ERRORS = ['required', 'minlength', 'maxlength', 'min', 'max', 'pattern', 'email'];

export function exampleFor(schema: Schema): unknown {
  if (typeof schema !== 'object') return undefined;
  const s = schema as Record<string, any>;
  if ('const' in s) return s.const;
  if (s.enum) return s.enum[0];
  // A value the application was seen to accept is a better example than one built from the constraints.
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
  if (s.anyOf) return exampleFor(s.anyOf[s.anyOf.length - 1]);
  if (s.type === 'object') return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, exampleFor(v as Schema)]));
  if (s.type === 'array') return Array.from({ length: Math.max(1, s.minItems ?? 1) }, () => exampleFor(s.items));
  if (s.type === 'boolean') return true;
  if (s.type === 'integer' || s.type === 'number') return Math.max(s.minimum ?? 1, 1);
  if (typeof s.pattern === 'string' && s.pattern.includes('@')) return 'probe@example.test';
  return 'a'.repeat(Math.max(s.minLength ?? 1, 3));
}

async function storageOf(page: Page): Promise<Record<string, string>> {
  try { return await page.evaluate(() => ({ ...Object.fromEntries(Object.entries(localStorage)), ...Object.fromEntries(Object.entries(sessionStorage).map(([k, v]) => ['session:' + k, v])) })); } catch { return {}; }
}

async function domSnapshot(page:Page):Promise<string>{
  return page.evaluate(() => JSON.stringify({text:document.body.innerText,controls:Array.from(document.querySelectorAll('input,textarea,select')).map(el=>({value:(el as HTMLInputElement).value,checked:(el as HTMLInputElement).checked})),states:Array.from(document.querySelectorAll('[aria-selected],[aria-expanded],[aria-checked]')).map(el=>[el.getAttribute('aria-selected'),el.getAttribute('aria-expanded'),el.getAttribute('aria-checked')])})).catch(() => '');
}

async function observe(page: Page, act: () => Promise<unknown>, expectedTail: string, readCalls = true, beforeActSnapshot?: () => string | undefined, actedAt?: () => string | undefined): Promise<{ effects: Effects; error?: string; form?: LiveForm; at?: string }> {
  const http: Effects['http'] = [];
  const tail = (href: string) => { try { const u = new URL(href); return u.hash.startsWith('#/') ? u.hash.slice(1) : u.pathname; } catch { return ''; } };
  const where = () => tail(page.url());
  // An action with no route of its own (the application shell) has navigated when the page is no longer where it started.
  const from = expectedTail || where().split('?')[0];
  const dialogs: string[] = [];
  const onRequest = (r: Request) => { if (['fetch', 'xhr'].includes(r.resourceType()) || !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) http.push({ method: r.method(), path: new URL(r.url()).pathname, bodyKeys: keysOf(r.postData()), body: (r.postData() ?? '').slice(0, 2000) }); };
  // The sandbox accepts native confirmations so their effect is observable, and records that one was asked for.
  const onDialog = (d: Dialog) => { dialogs.push(d.message()); d.accept().catch(() => undefined); };
  const before = await storageOf(page);
  const text = () => domSnapshot(page);
  const domBefore = await text();
  page.on('request', onRequest); page.on('dialog', onDialog);
  let error: string | undefined;
  try { await act(); await page.waitForTimeout(350); } catch (e) { error = e instanceof Error ? e.message.split('\n')[0] : String(e); }
  finally { page.off('request', onRequest); page.off('dialog', onDialog); }
  const after = await storageOf(page);
  const storage = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]).sort();
  const calls = readCalls ? await page.evaluate(() => (window as any).__probeCalls ?? []).catch(() => []) : [];
  const form = readCalls ? await page.evaluate(() => (window as any).__probeForm as LiveForm | undefined).catch(() => undefined) : undefined;
  const overlay = (await page.locator('mat-dialog-container, .cdk-overlay-pane').count().catch(() => 0)) > 0;
  // Navigation only counts when the app moved away from the page the action lives on. An app that sends a route on to
  // another page when it is opened did that before the action: the action is measured from the page it acted on.
  const here = where(), acted = actedAt?.();
  return { effects: { http, storage, navigated: !!here && here.split('?')[0] !== (acted ? tail(acted).split('?')[0] : from), overlay, domChanged: (beforeActSnapshot?.() ?? domBefore) !== '' && (beforeActSnapshot?.() ?? domBefore) !== (await text()), dialogs, calls }, error, form, at: here.split('?')[0] };
}


/** Dev-mode instrumentation: wrap the traced service methods on every live component so a call to an in-memory service is observable. */
export async function arm(page: Page, methods: string[]) {
  await page.evaluate(names => {
    const w = window as any;
    w.__probeNames = names;
    w.__angularMcpAfterReveal = () => { for (const f of w.__probeArm ?? []) f(); };
    w.__probeArm = [() => {
        const ng = (window as any).ng; if (!ng?.getComponent) return;
        w.__probeCalls = w.__probeCalls ?? [];
        const seen = new Set<unknown>();
        for (const el of Array.from(document.querySelectorAll('*'))) {
          let comp: any; try { comp = ng.getComponent(el); } catch { comp = undefined; }
          if (!comp || seen.has(comp)) continue; seen.add(comp);
          for (const key of Object.keys(comp)) {
            const svc = comp[key]; if (!svc || typeof svc !== 'object') continue;
            for (const m of names) {
              const original = svc[m];
              if (typeof original === 'function' && !original.__probed) {
                // An anonymous function in an argument (not a named const) keeps a transpiler's name helper out of this serialized code.
                svc[m] = Object.assign(function (this: unknown, ...args: unknown[]) { try { w.__probeCalls.push({ method: m, args: JSON.parse(JSON.stringify(args)) }); } catch { w.__probeCalls.push({ method: m, args: null }); } return original.apply(this, args); }, { __probed: true });
              }
            }
          }
        }
      }];
    for (const f of w.__probeArm) f();
  }, methods).catch(e => { console.error('probe instrumentation failed:', String(e).split('\n')[0]); });
}

export async function probeCapability(browser: Browser, manifest: Manifest, capability: Capability, options: ProbeOptions): Promise<ProbeReport> {
  const log = options.log ?? (() => undefined);
  const blank = (skipped: string): ProbeReport => ({ id: capability.id, effectClass: 'none-observed', effects: { http: [], storage: [], navigated: false, overlay: false, domChanged: false, dialogs: [], calls: [] }, confirmationRequired: false, probes: [], agreement: null, learned: {}, disagreements: [], skipped });
  const schema = capability.inputSchema as { properties?: Record<string, Schema>; required?: string[] };
  const ajv = new Ajv({ strict: false });
  let validateStatic: ((x: unknown) => boolean) | undefined;
  try { validateStatic = ajv.compile(capability.inputSchema as object); } catch { /* an uncompilable schema is itself a finding */ }
  const budget = options.budget ?? 40;
  if (!Number.isSafeInteger(budget) || budget < 0) return blank('budget must be a nonnegative integer');
  const reserved = new Set([...(capability.routeParams ?? []), capability.target?.param, capability.reveal?.target?.param, ...(capability.queryParams ?? [])].filter((x): x is string => !!x));
  // Every attempt gets a fresh profile (so state never accumulates), the app is loaded and allowed to seed itself, and only then is
  // the action observed. Backends are sandboxed: every fetch/XHR is answered with an empty JSON document and recorded.
  let scratch: { close(): Promise<void> } | undefined;
  // The form model's validators are questioned while an accepted example is being established, not on every membership query.
  let liveTrials = true;
  const shared = options.shared ??= {};
  const urlFor = (route: string) => urlOf(options, route);
  // An action of the application shell runs wherever the page is; `start` is the route it is observed from.
  let start: string | undefined;
  // What a host passes beside the arguments: that a person confirmed this action, which list a drag starts in. The sandbox
  // stands in for the host, and the report says with what.
  const host: Record<string, unknown> = capability.workflow.requiresConfirmation ? { confirmedCapability: capability.id } : {};
  const fresh = async (beforeAct?: (page:Page)=>Promise<void>) => {
    await scratch?.close();
    const context = await sandbox(browser, options);
    scratch = context;
    const page = await context.newPage();
    const methods = [...new Set(capability.bindings.map(b => b.method))];
    const adapter = browserAdapter(page, manifest, [{ id: capability.id, fingerprint: capability.fingerprint, description: 'probe', effect: 'write' }], options.baseUrl, {
      hash: options.hash, validate: false, context: host,
      // Dev-mode instrumentation: wrap the traced service methods on every live component so a call to an in-memory service is observable.
      beforeAct: async p => { await arm(p, methods); await watchForms(p, liveTrials).catch(() => undefined); await beforeAct?.(p); },
    });
    const staged = !!options.prelude?.length;
    await page.goto(start && !staged ? urlFor(start) : options.baseUrl).catch(() => undefined);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(500);
    if (staged) {
      await replay(page, manifest, options);
      if (start) await open(page, start);
    }
    return { page, adapter };
  };
  const open = (page: Page, route: string) => openRoute(page, options, route);
  const rowSpec = capability.target ?? capability.reveal?.target, rowParam = rowSpec?.param;
  const run = async (args: Record<string, unknown>) => {
    let domBefore: string | undefined, acted: string | undefined;
    const { page, adapter } = await fresh(async page => { domBefore = await domSnapshot(page); acted = page.url(); });
    const expected = (capability.routeParams ?? []).reduce((path, name) => path.replace(new RegExp(`:${name}(?![\\w])`), encodeURIComponent(String(args[name]))), capability.route);
    // State that is built again before each attempt may name its rows anew (a generated identifier): the row is looked up where it now is.
    if (options.prelude?.length && !capability.global && (capability.routeParams ?? []).every(name => args[name] !== undefined)) await open(page, expected);
    if (rowParam && args[rowParam] !== undefined && options.prelude?.length && options.params?.[rowParam] === undefined) {
      const key = await rowKey(page, capability, args[rowParam]);
      if (key !== undefined) args = { ...args, [rowParam]: rowArg(rowSpec!, args[rowParam], key) };
    }
    return observe(page, () => adapter.invoke(adapter.tools[0].name, args), capability.global ? '' : expected, true, () => domBefore, () => acted);
  };
  const discover = async (base: Record<string, unknown>): Promise<Capability | undefined> => {
    const { page, adapter } = await fresh();
    const route = (capability.routeParams ?? []).reduce((path, name) => path.replace(new RegExp(`:${name}(?![\\w])`), encodeURIComponent(String(base[name] ?? '1'))), capability.route);
    await open(page, route);
    await page.waitForTimeout(300);
    const methods = [...new Set(capability.bindings.map(b => b.method))];
    await arm(page, methods);
    const controls = await page.evaluate(hostSelector => {
      const host = document.querySelector(hostSelector);
      if (!host) return [];
      const found: { tag: string; type: string; name: string; label: string; selector: string; options: string[];required:boolean;schema:Record<string,unknown> }[] = [];
      const seenTags: Record<string, number> = {};
      for (const el of Array.from(host.querySelectorAll('input, textarea, select'))) {
        const e = el as HTMLInputElement;
        const tag = e.tagName.toLowerCase();
        seenTags[tag] = (seenTags[tag] ?? 0) + 1;
        const type = (e.type || '').toLowerCase();
        if (['hidden', 'file', 'button', 'submit', 'radio'].includes(type) || !e.getClientRects().length || e.disabled || e.readOnly) continue;
        const name = e.getAttribute('name') || e.getAttribute('formcontrolname') || e.id || '';
        const label = (e.getAttribute('aria-label') || e.getAttribute('placeholder') || (e.closest('label')?.textContent ?? '') || name).replace(/\s+/g, ' ').trim();
        // Structural path from the component host: stable inside one template even when the control has no id or name.
        const parts: string[] = [];
        for (let n: Element | null = e; n && n !== host; n = n.parentElement) {
          const siblings = n.parentElement ? Array.from(n.parentElement.children).filter(c => c.tagName === n!.tagName) : [n];
          parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(n) + 1})`);
        }
        const selector = e.id && /^[A-Za-z][\w-]*$/.test(e.id) ? `#${e.id}` : e.getAttribute('name') ? `${tag}[name="${e.getAttribute('name')}"]` : e.getAttribute('formcontrolname') ? `${tag}[formcontrolname="${e.getAttribute('formcontrolname')}"]` : `${hostSelector} > ${parts.join(' > ')}`;
        const schema:Record<string,unknown>={type:type==='number'?'number':'string'};
        if(type==='number'){
          for(const [attribute,key]of [['min','minimum'],['max','maximum']]){
            const authored=e.getAttribute(attribute);if(authored!==null&&authored.trim()!==''&&Number.isFinite(Number(authored)))schema[key]=Number(authored);
          }
        }else{
          for(const [attribute,key]of [['minlength','minLength'],['maxlength','maxLength']]){
            const authored=e.getAttribute(attribute);if(authored!==null&&/^\d+$/.test(authored))schema[key]=Number(authored);
          }
          const pattern=e.getAttribute('pattern');
          if(pattern&&!pattern.includes('&&')&&!pattern.includes('--')&&!pattern.includes('\\q{'))try{new RegExp(pattern,'u');schema.pattern=`^(?:${pattern})$`;}catch{}
          if(e.required&&!schema.minLength)schema.minLength=1;
          if(!e.required&&(schema.minLength||schema.pattern)){
            const nonempty:Record<string,unknown>={type:'string'};
            for(const key of ['minLength','pattern'])if(schema[key]!==undefined){nonempty[key]=schema[key];delete schema[key];}
            schema.anyOf=[{const:''},nonempty];
          }
        }
        found.push({ tag, type, name, label, selector, options: tag === 'select' ? Array.from((e as unknown as HTMLSelectElement).options).map(o => o.value).filter(Boolean) : [],required:e.required,schema });
      }
      return found;
    }, capability.componentSelector).catch(() => []);
    if (process.env.PROBE_DEBUG) console.error('controls', JSON.stringify(controls));
    if (!controls.length) return undefined;
    // Forms guard their handlers (ranges, formats), so numeric tokens are tried at several magnitudes until the app acts.
    let tokens: string[] = [];
    let result: Awaited<ReturnType<typeof observe>> | undefined;
    for (const magnitude of [1, 3, 10, 100, 7000]) {
      const attempt = await fresh();
      await open(attempt.page, route);
      await attempt.page.waitForTimeout(300);
      await arm(attempt.page, methods);
      tokens = [];
      for (const [i, c] of controls.entries()) {
        const loc = attempt.page.locator(c.selector.startsWith(capability.componentSelector) ? c.selector : `${capability.componentSelector} ${c.selector}`).first();
        const token = c.type === 'number' ? String(magnitude + i) : c.type === 'email' || /mail/i.test(c.name + c.label) ? `zq${i}@example.test` : `ZQ${i}X`;
        tokens.push(token);
        try {
          if (c.tag === 'select') await loc.selectOption({ index: Math.min(1, Math.max(0, c.options.length - 1)) }, { timeout: 3000 });
          else if (c.type === 'checkbox') await loc.check({ timeout: 3000 });
          else await loc.fill(token, { timeout: 3000 });
        } catch { /* a control we cannot drive is simply not part of the contract */ }
      }
      const expectedRoute = capability.global ? '' : route;
      result = await observe(attempt.page, () => attempt.adapter.invoke(attempt.adapter.tools[0].name, base), expectedRoute, true);
      if (process.env.PROBE_DEBUG) console.error('discovery run', magnitude, JSON.stringify({ error: result.error, calls: result.effects.calls, http: result.effects.http.length, storage: result.effects.storage }));
      if (!result.error && accepted(result.effects)) break;
      result = undefined;
    }
    if (!result) return undefined;
    // Where did each token end up in what the app did? The key it landed under names the parameter.
    const sources: { where: string; value: unknown }[] = [
      ...result.effects.calls.map(c => ({ where: c.method, value: c.args })),
      ...result.effects.http.map(h => ({ where: h.path, value: (() => { try { return JSON.parse(h.body ?? ''); } catch { return h.body; } })() })),
    ];
    const findPath = (value: unknown, token: string, path: (string | number)[] = []): (string | number)[] | undefined => {
      if (typeof value === 'string' || typeof value === 'number') return (/^\d+$/.test(token) ? String(value) === token : String(value).toLowerCase().includes(token.toLowerCase())) ? path : undefined;
      if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { const hit = findPath(v, token, [...path, Array.isArray(value) ? Number(k) : k]); if (hit) return hit; }
      return undefined;
    };
    const fields: Capability['fields'] = [];
    for (const [i, c] of controls.entries()) {
      if (c.tag === 'select' || c.type === 'checkbox') continue; // enumerated or boolean inputs are learned by the option/boolean probes
      let name = '';
      for (const src of sources) {
        const path = findPath(src.value, tokens[i]);
        if (!path) continue;
        const last = [...path].reverse().find(p => typeof p === 'string') as string | undefined;
        const binding = capability.bindings.find(b => b.method === src.where);
        const positional = typeof path[0] === 'number' ? Object.keys((binding?.inputSchema as { properties?: object } | undefined)?.properties ?? {})[path[0] as number] : undefined;
        name = last ?? positional ?? '';
        break;
      }
      if (!name) continue;
      fields.push({ name, selector: c.selector, element: c.tag, type: c.type === 'number' ? 'number' : 'text', required: c.required, supported: true, schema: { ...c.schema, ...(c.label ? { description: c.label } : {}) }, adapter: 'native' });
    }
    if (!fields.length) return undefined;
    const working: Capability = {
      ...capability,
      fields,
      plan: { mode: 'submit', root: capability.componentSelector, submit: { selector: capability.action.selector }, repeats: [] },
      // The host element is the container of the inputs; it is not inside its own template, so no owner marker applies to it.
      action: { ...Object.fromEntries(Object.entries(capability.action).filter(([k]) => k !== 'owner' && k !== 'matchText')) as Capability['action'], kind: 'form', selector: capability.componentSelector },
      inputSchema: { type: 'object', properties: Object.fromEntries(fields.map(f => [f.name, f.schema])), required: fields.filter(f=>f.required).map(f => f.name), additionalProperties: false },
      fingerprint: '',
    };
    working.fingerprint = hash(JSON.stringify({ sourceDigest: manifest.sourceDigest, capability: working }));
    return working;
  };
  try {
    const base = (exampleFor(capability.inputSchema) ?? {}) as Record<string, unknown>;
    // Identifiers of routes and repeated rows come from the application's own data, never from the schema.
    const routeNames = capability.routeParams ?? [];
    // The route as far as its parameters are known: resolved ones first, then anything passed in, then a placeholder.
    const routeSoFar = () => capability.route.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(String(base[name] ?? options.params?.[name] ?? '1')));
    let linked: Record<string, string> | undefined, looked = false;
    // Where the app went instead when the action's page was opened to look for an identifier (a guard sending a visitor to sign in).
    let strayed: string | undefined;
    const lookAt = async (page: Page) => {
      await open(page, routeSoFar());
      const at = pathOf(page.url());
      if (!capability.global && at && decoded(at) !== decoded(routeSoFar().replace(/(.)\/+$/, '$1')) && !beneath(at, routeSoFar())) strayed = at;
    };
    const lacking = (needs: ProbeReport['needs'], skipped: string): ProbeReport => ({ ...blank(skipped), needs });
    // What a developer can pass so that the app is in the state an action needs.
    const stateHints = () => {
      const hints = [options.storageState ? '' : 'signed in: --storage-state', shared.stubbedReads && !options.liveReads ? 'records loaded: --live-reads' : ''].filter(Boolean);
      return hints.length ? ` (${hints.join(', ')})` : '';
    };
    const guardNote = capability.guards.length ? ` (route guard: ${capability.guards.map(guard => guard.length > 40 ? `${guard.slice(0, 40)}...` : guard).join(', ')})` : '';
    for (const name of reserved) {
      const given = options.params?.[name];
      if (given !== undefined) { base[name] = rowSpec?.param === name ? rowArg(rowSpec, base[name], given, schema.properties?.[name]) : given; continue; }
      if (routeNames.includes(name)) {
        // The app's own links are the first place a real identifier is found.
        if (!looked) {
          looked = true;
          // A record linked to in the state this one extends is still there; only otherwise is the app walked again in this state.
          const cache = shared.links ??= {}, fixed = knownRoutes(manifest).filter(fixedRoute);
          for (let key = options.world ?? ''; !linked; key = key.includes('\n') ? key.slice(0, key.lastIndexOf('\n')) : '') {
            if (cache[key]) linked = routeValues(capability.route, cache[key], fixed, options.params);
            if (!key) break;
          }
          linked ??= routeValues(capability.route, cache[options.world ?? ''] ??= await harvestLinks(browser, manifest, options), fixed, options.params);
        }
        if (linked?.[name] !== undefined) { base[name] = linked[name]; continue; }
        // No page links to one: a record the app shows under the same name (":issueId" and a card's "issue") names one that exists.
        const asked = /^(.+?)_?(id|slug|uuid|key)$/i.exec(name);
        if (asked) {
          const stem = asked[1].toLowerCase(), idKeys = asked[2].toLowerCase() === 'id' ? ['id', '_id'] : [asked[2].toLowerCase()];
          const shown = [...(shared.links?.[options.world ?? ''] ?? []), ...(shared.links?.[''] ?? [])].filter(link => link.startsWith('record:')).map(link => link.slice(7).split('\t'))
            .find(([holder, key]) => idKeys.includes(key) && [stem, `${stem}s`, `_${stem}`, `${stem}$`, `${stem}s$`].includes(holder.toLowerCase()));
          if (shown) { base[name] = shown[2]; continue; }
        }
      }
      if (capability.target?.param === name || capability.reveal?.target?.param === name) {
        const { page } = await fresh();
        await lookAt(page);
        const key = await rowKey(page, capability);
        if (key !== undefined) { base[name] = rowArg(rowSpec!, base[name], key, schema.properties?.[name]); continue; }
      }
      // Identifiers the app already holds: ask its own read methods (list/all/find...) what records exist, in dev mode.
      const { page } = await fresh();
      await lookAt(page);
      await page.waitForTimeout(300);
      const ids = await page.evaluate(async () => {
        const ng = (window as any).ng; if (!ng?.getComponent) return [];
        const found: string[] = [];
        for (const el of Array.from(document.querySelectorAll('*'))) {
          let comp: any; try { comp = ng.getComponent(el); } catch { comp = undefined; }
          if (!comp) continue;
          for (const key of Object.keys(comp)) {
            const svc = comp[key]; if (!svc || typeof svc !== 'object') continue;
            for (const m of Object.getOwnPropertyNames(Object.getPrototypeOf(svc))) {
              if (!/^(list|all|getall|find|load|query|items|records|get\w*s)$/i.test(m) || typeof svc[m] !== 'function' || svc[m].length > 0) continue;
              try {
                const res = await Promise.resolve(svc[m]());
                for (const row of Array.isArray(res) ? res : []) { const id = row?.id ?? row?._id ?? row?.slug; if (typeof id === 'string' || typeof id === 'number') found.push(String(id)); }
              } catch { /* a read method that needs arguments is skipped */ }
            }
          }
        }
        return [...new Set(found)].slice(0, 3);
      }).catch(() => [] as string[]);
      if (ids.length) { base[name] = rowSpec?.param === name ? rowArg(rowSpec, base[name], ids[0], schema.properties?.[name]) : ids[0]; continue; }
      // The sandbox answered the app's read requests with nothing, so it had no records to take an identifier from.
      const starved = shared.stubbedReads && !options.liveReads;
      // An item of a list is not something a parameter can supply: the list has to have one.
      const row = capability.target?.param === name || capability.reveal?.target?.param === name;
      const session = options.storageState ? '' : '; if it needs a signed-in session, pass --storage-state';
      if (strayed) return await finish(lacking('page', `needs ${row ? 'an item to act on' : `a fixture value for "${name}"`}, and the app left ${capability.route} for ${strayed} when the page was opened to find one${guardNote}${session}`));
      if (row) return await finish(lacking('record', `needs an item to act on ("${name}"), and the list it belongs to was empty on ${capability.route} in the sandbox${starved ? '; pass --live-reads so the app can load its own records' : '; it can be exercised once the app has an item (--storage-state restores saved browser storage)'}`));
      return await finish(lacking('record', `needs a fixture value for "${name}" (pass --param ${name}=...${starved ? ', or --live-reads so the app can load its own records' : ''})`));
    }
    // A drag starts in one of the app's lists and moves one of its items: both are read from the page.
    const drag = capability.drive?.drag;
    if (drag) {
      const { page } = await fresh();
      await lookAt(page);
      await page.waitForTimeout(400);
      const lists = await page.evaluate(spec => Array.from(document.querySelectorAll<HTMLElement>(spec.listSelector))
        .filter(el => el.id && el.getClientRects().length > 0)
        .map(el => ({ id: el.id, items: Array.from(el.querySelectorAll(spec.itemSelector)).filter(item => item.closest('.cdk-drop-list') === el).length })), drag).catch(() => [] as { id: string; items: number }[]);
      const named = (holder: Schema | undefined, name: string | undefined) => name ? ((holder as { properties?: Record<string, { enum?: unknown[] }> } | undefined)?.properties?.[name]?.enum) : undefined;
      const may = (allowed: unknown[] | undefined, id: string) => !allowed || allowed.includes(id);
      const from = drag.sourceId ? [drag.sourceId] : named(capability.contextSchema, drag.sourceContext), to = named(capability.inputSchema, drag.targetParam);
      const others = (id: string) => lists.filter(list => list.id !== id && may(to, list.id));
      const source = lists.find(list => may(from, list.id) && (drag.mode === 'reorder' ? list.items > 1 : list.items > 0 && others(list.id).length > 0));
      if (!source) {
        if (strayed) return await finish(lacking('page', `needs a list to drag in, and the app left ${capability.route} for ${strayed} when the page was opened to find one${guardNote}${options.storageState ? '' : '; if it needs a signed-in session, pass --storage-state'}`));
        const starved = shared.stubbedReads && !options.liveReads;
        return await finish(lists.length
          ? lacking('record', `needs ${drag.mode === 'reorder' ? 'a list with two items to reorder' : 'an item to move and a second list to move it to'}, and the lists on ${capability.route} held ${lists.map(list => list.items).join(', ')} in the sandbox${starved ? '; pass --live-reads so the app can load its own records' : ''}`)
          : lacking('control', `no list to drag in was on the page at ${capability.route}; the app shows it only in a state the sandbox did not reach${stateHints()}`));
      }
      if (drag.sourceContext) host[drag.sourceContext] = source.id;
      base[drag.previousIndex] = 0;
      base[drag.currentIndex] = drag.mode === 'reorder' ? 1 : 0;
      if (drag.mode === 'transfer' && drag.targetParam) base[drag.targetParam] = others(source.id)[0].id;
    }
    // Inputs static analysis could not see (fields outside any form, values read from template references): find them by watching.
    if (!options.quick && !capability.fields.length && capability.action.kind === 'button' && !capability.drive && !capability.reveal && !capability.global && !capability.target) {
      const working = await discover(base);
      if (working) {
        const sub = await probeCapability(browser, { ...manifest, capabilities: [working] }, working, { ...options, budget });
        sub.synthesized = working;
        return await finish(sub);
      }
    }
    // Choice widgets whose option values are bound at run time: click each live option and watch what the app receives.
    const learnedOptions: Record<string, { value: string; label: string }[]> = {};
    const optionUncertainties:string[]=[];
    const choice = capability.fields.length === 1 && capability.plan?.mode === 'edit' && ['material-choice', 'material-select'].includes(capability.fields[0].adapter ?? '') && !capability.fields[0].options?.length && !(schema.properties?.[capability.fields[0].name] as { enum?: unknown } | undefined)?.enum ? capability.fields[0] : undefined;
    if (choice && !options.quick) {
      const { page } = await fresh();
      await open(page, capability.route.replace(/:\w+/g, o => String(base[o.slice(1)] ?? '1')));
      await page.waitForTimeout(300);
      const root = page.locator(capability.plan!.root).first();
      let labels: string[] = [];
      let offered:{label:string;value?:string}[]=[];
      try {
        const control=root.locator(choice.selector);
        if(await root.count()!==1||await control.count()!==1)throw new Error('Choice root is ambiguous');
        const options=choice.adapter==='material-choice'?control.locator('mat-radio-button, mat-button-toggle'):undefined;
        if (options) offered=await options.evaluateAll(elements=>elements.map(el=>{
          let value:unknown;try{value=(window as any).ng?.getComponent(el)?.value;}catch{}
          if(typeof value!=='string')value=el.getAttribute('value');
          return {label:(el.textContent??'').replace(/\s+/g,' ').trim(),...(typeof value==='string'?{value}:{})};
        }));
        else {
          await control.click({ timeout: 3000 });
          const panel = page.locator('[role="listbox"]').last();
          await panel.waitFor({ state: 'visible', timeout: 3000 });
          offered=await panel.locator('[role="option"]').evaluateAll(elements=>elements.map(el=>{
            let value:unknown;try{value=(window as any).ng?.getComponent(el)?.value;}catch{}
            if(typeof value!=='string')value=el.getAttribute('value');
            return {label:(el.textContent??'').replace(/\s+/g,' ').trim(),...(typeof value==='string'?{value}:{})};
          }));
          await page.keyboard.press('Escape');
        }
      } catch { labels = []; }
      labels = [...new Set(offered.map(o=>o.label).filter(Boolean))];
      const complete=offered.length>0&&offered.length<=200&&offered.every(o=>o.value!==undefined&&o.label)&&new Set(offered.map(o=>o.label)).size===offered.length&&new Set(offered.map(o=>o.value)).size===offered.length;
      if(complete){
        learnedOptions[choice.name]=offered.map(o=>({value:o.value!,label:o.label}));
        base[choice.name]=offered[Math.min(1,offered.length-1)].label;
      }
      const seen: { label: string; args: unknown }[] = [];
      for (const label of complete?[]:labels.slice(0,8)) {
        const attempt = await run({ ...base, [choice.name]: label });
        if (okRun(attempt) && attempt.effects.calls[0]) seen.push({ label, args: attempt.effects.calls[0].args });
      }
      // The value is the primitive in the call arguments: the lone argument, or the property that differs between options.
      const flat = (args: unknown): Record<string, unknown> => Array.isArray(args) && args.length === 1 && (args[0] === null || typeof args[0] !== 'object') ? { 0: args[0] } : Object.fromEntries(Object.entries(Array.isArray(args) && args.length === 1 ? args[0] as object : { ...(args as object) }).filter(([, v]) => v === null || typeof v !== 'object'));
      const keys = seen.length ? Object.keys(flat(seen[0].args)).filter(k => seen.every(x=>typeof flat(x.args)[k]==='string')&&(new Set(seen.map(x => JSON.stringify(flat(x.args)[k]))).size === seen.length || seen.length === 1)) : [];
      if (!complete&&seen.length===labels.length&&seen.length>0&&keys.length) {
        learnedOptions[choice.name] = seen.map(x => ({ value: String(flat(x.args)[keys[0]]), label: x.label }));
        base[choice.name] = seen[0].label;
      }else if(!complete){
        optionUncertainties.push(`${choice.name}: not every offered option had an observable value; no partial enum was published.`);
        if(seen.length)base[choice.name]=seen[0].label;
      }
    }
    // Fields the contract already records as equal start out equal.
    const mirrors: Record<string, string> = {};
    for (const field of capability.fields) if (field.sameAs && typeof base[field.sameAs] === 'string') { mirrors[field.name] = field.sameAs; base[field.name] = base[field.sameAs]; }
    let baseline = await run(base);
    // The page the action lives on was left before the action finished (a route guard, or a redirect of the app's own).
    // No other input value changes that, so nothing below searches for one.
    const left = baseline.error && !capability.global && baseline.effects.navigated && baseline.at ? baseline.at : undefined;
    // When the form model rejected the example it also said why: repair it from the application's own rules before guessing.
    const properties = (schema.properties ?? {}) as Record<string, Record<string, any>>;
    const ownNames = capability.fields.filter(field => field.supported && !reserved.has(field.name)).map(field => field.name);
    const refused: Record<string, unknown[]> = {};
    for (let attempt = 0; attempt < 6 && !okRun(baseline) && !left && baseline.form; attempt++) {
      const next = repairFromLive(ownNames, properties, base, baseline.form, mirrors, refused);
      if (!Object.keys(next.values).length) break;
      Object.assign(base, next.values); Object.assign(mirrors, next.mirrors);
      baseline = await run(base);
    }
    // Choosing the value that is already selected changes nothing (no event fires): try the other options of enumerated fields.
    // The same holds for a choice that is not a form field: a link to the page the action is already on.
    if (!okRun(baseline) && !left) {
      for (const name of new Set([...capability.fields.map(field => field.name), ...Object.keys(properties)])) {
        const field = capability.fields.find(candidate => candidate.name === name);
        for (const option of (properties[name]?.enum ?? learnedOptions[name]?.map(o=>o.label) ?? field?.options?.map(o=>o.value) ?? []).slice(0, 5)) {
          if (okRun(baseline) || reserved.has(name)) break;
          if (!field && option === base[name]) continue;
          const attempt = await run({ ...base, [name]: option });
          if (okRun(attempt)) { base[name] = option; baseline = attempt; }
        }
      }
    }
    // An action of the application shell that leads to the page the probe starts on shows nothing from there: it is watched
    // again from another page of the app, one that needs no parameters and no guard.
    if (!okRun(baseline) && !baseline.error && capability.global) {
      const guarded = new Set(manifest.routes.filter(route => route.guards.length).map(route => `/${route.path.replace(/^\/+/, '')}`));
      const others = knownRoutes(manifest).filter(route => fixedRoute(route) && route !== '/' && route !== baseline.at).sort((a, b) => Number(guarded.has(a)) - Number(guarded.has(b)));
      for (const route of others.slice(0, 3)) {
        start = route;
        const again = await run(base);
        if (okRun(again)) { baseline = again; break; }
        start = undefined;
      }
    }
    // If the schema's example is not accepted, the contract is looser than the app: search for an input the app does accept,
    // one field at a time, from realistic candidates. (The candidates are generic; the app is the judge.)
    // No input value puts a control on the page that the app did not render.
    if (!okRun(baseline) && !left && capability.fields.length && !options.quick && !absent(baseline.error ?? '')) {
      const candidates = (name: string, schemaProp: any): unknown[] => {
        const n = name.toLowerCase();
        const text = ['Alex Example', 'alex@example.test', '+15551234567', '5551234567', '12345', 'https://example.test', '2030-01-15', 'Example123!', 'abcdefgh', '10'];
        const hints = n.includes('mail') ? ['alex@example.test'] : n.includes('phone') || n.includes('tel') ? ['+15551234567', '5551234567', '555-123-4567'] : n.includes('pass') ? ['Example123!', 'abcdef12'] : n.includes('url') || n.includes('site') ? ['https://example.test'] : n.includes('zip') || n.includes('postal') ? ['12345'] : n.includes('date') ? ['2030-01-15'] : [];
        return [...hints, ...(schemaProp?.type === 'number' || schemaProp?.type === 'integer' ? [1, 5, 10, 100] : text)];
      };
      // First guess: every field gets the most realistic value for its name, all at once (forms need all fields valid together).
      for (let k = 0; k < 4 && !okRun(baseline); k++) {
        const joint = { ...base };
        for (const field of capability.fields) {
          const prop = (schema.properties?.[field.name] ?? {}) as Record<string, any>;
          if (field.supported && !reserved.has(field.name) && !prop.enum && prop.type !== 'boolean') { const c = candidates(field.name, prop); joint[field.name] = c[Math.min(k, c.length - 1)]; }
        }
        const attempt = await run(joint);
        if (okRun(attempt)) { Object.assign(base, joint); baseline = attempt; }
      }
      let tries = 0;
      for (const field of okRun(baseline) ? [] : capability.fields) {
        if (!field.supported || reserved.has(field.name) || tries > budget) continue;
        const prop = (schema.properties?.[field.name] ?? {}) as Record<string, any>;
        if (prop.enum || prop.type === 'boolean') continue;
        for (const candidate of candidates(field.name, prop)) {
          tries++;
          const attempt = await run({ ...base, [field.name]: candidate });
          if (okRun(attempt)) { base[field.name] = candidate; baseline = attempt; break; }
          if (tries > budget) break;
        }
        if (okRun(baseline)) break;
      }
    }
    const effectClass = classify(baseline.effects);
    const report: ProbeReport = { options: Object.keys(learnedOptions).length ? learnedOptions : undefined, id: capability.id, effectClass, effects: baseline.effects, confirmationRequired: !!capability.workflow.requiresConfirmation || baseline.effects.dialogs.length > 0 || (baseline.effects.overlay && effectClass === 'opens-overlay'), probes: [], agreement: null, learned: {}, disagreements: [], ...(Object.keys(host).length ? { context: { ...host } } : {}) };
    if (baseline.error) {
      // A section that sends the visitor on to one of its own pages is still open; what is missing there is the control.
      const onward = left && beneath(left, routeSoFar());
      report.needs = left && !onward ? 'page' : left || absent(baseline.error) ? 'control' : undefined;
      report.skipped = left && !onward
        ? `the app left ${capability.route} for ${left} before the action could run${guardNote}` +
          `${options.storageState ? '' : '; if it needs a signed-in session, pass --storage-state'} [${baseline.error.slice(0, 80)}]`
        : left
          ? `the app sent ${capability.route} on to ${left}, and the action's control was not on that page; the app shows it only in a state the sandbox did not reach${stateHints()} [${baseline.error.slice(0, 80)}]`
          : absent(baseline.error)
            ? `the action's control was not on the page${baseline.at ? ` at ${baseline.at}` : ''}; the app shows it only in a state the sandbox did not reach${stateHints()} [${baseline.error.slice(0, 80)}]`
            : `baseline call failed: ${baseline.error.slice(0, 160)}`;
    }
    // A form the application still considers invalid cannot have been submitted by it. Calls seen anyway (clearing an alert,
    // marking the form submitted) come before its validation; they are not evidence that the action works.
    const live = baseline.form;
    const decisive = baseline.effects.http.some(h => !['GET', 'HEAD', 'OPTIONS'].includes(h.method)) || baseline.effects.storage.length > 0 || baseline.effects.navigated;
    if (okRun(baseline) && live?.invalid && live.unfilled.length && !decisive) {
      report.skipped = `the form was still invalid when submitted (${live.unfilled.join(', ')} not filled by this action); the calls observed come before its validation`;
      return await finish(report);
    }
    if (!okRun(baseline)) {
      // Something that only changed what the page shows is not an effect another state would turn into one.
      if (!report.skipped) { report.skipped = 'no observable effect to use as an oracle'; report.needs = effectClass === 'none-observed' ? 'effect' : undefined; }
      return await finish(report);
    }
    report.example = { ...base };
    if (options.quick) return await finish(report);

    // A validation request or audit write alone does not show that the same operation was reached.
    // Every membership answer must reproduce the baseline operation's effects; observations are not backend success.
    // An action whose only effect is a navigation has no such evidence to compare: it is repeated when it navigates again.
    liveTrials = false;
    const evidence = operationEvidence(baseline.effects).length > 0;
    const repeats = (result: { effects: Effects; error?: string }) => !result.error && (evidence ? repeatsOperation(baseline.effects, result.effects) : result.effects.navigated);
    // The contract is the schema together with the equalities recorded on its fields.
    const contractAccepts = (args: Record<string, unknown>) => !!validateStatic?.(args) && capability.fields.every(field => !field.sameAs || args[field.name] === args[field.sameAs]);
    // A refusal for which the form model names only rules of the application's own (two fields that must match, a reserved
    // name) is one no schema can state. The runtime enforces such a rule at call time; it is reported, not counted as a wrong contract.
    const complaints = (form: LiveForm | undefined): string[] => form ? [...new Set([...form.fields.flatMap(field => field.errors), ...form.group])] : [];
    const standard = (key: string) => STANDARD_ERRORS.includes(key.toLowerCase());
    const ownRules = (form: LiveForm | undefined): string[] => { const keys = complaints(form); return keys.some(standard) ? [] : keys; };
    const record = (args: Record<string, unknown>, shown: Record<string, unknown>, result: { effects: Effects; error?: string; form?: LiveForm }, note: string): boolean => {
      const ok = repeats(result), staticAccepts = contractAccepts(args), rules = !ok && staticAccepts ? ownRules(result.form) : [];
      report.probes.push({ args: shown, accepted: ok, staticAccepts, note, ...(rules.length ? { rule: rules.join(', ') } : {}) });
      return ok;
    };
    let spent = 0;
    // Two fields are treated as one value: the contract says so, or their names did while the example was repaired.
    // Either link is kept only while the application refuses unequal values, and not when its form model explains that
    // refusal by a length or format rule, which says nothing about the two fields being equal.
    const linkRules = new Set<string>();
    for (const [dependent, source] of Object.entries(mirrors)) {
      if (base[dependent] !== base[source] || typeof base[source] !== 'string' || spent >= budget) { delete mirrors[dependent]; continue; }
      spent++;
      const args = { ...base, [dependent]: `${base[source]}x` }, result = await run(args);
      if (record(args, { [dependent]: args[dependent] }, result, `differs from ${source}`) || complaints(result.form).some(standard)) delete mirrors[dependent];
      else for (const rule of ownRules(result.form)) linkRules.add(rule);
    }
    const ask = async (name: string, value: unknown, note: string): Promise<boolean | undefined> => {
      if (spent >= budget) return undefined;
      spent++;
      const args: Record<string, unknown> = { ...base, [name]: value };
      for (const [dependent, source] of Object.entries(mirrors)) if (source === name) args[dependent] = value;
      return record(args, { [name]: value }, await run(args), note);
    };
    report.uncertainties = optionUncertainties;
    const liveFields = new Map((live?.fields ?? []).map(field => [field.name, field]));
    const stated: Record<string, Record<string, unknown>> = {};
    const learners:{name:string;schema:Schema;current:unknown}[]=[];
    for (const field of capability.fields) {
      if (!field.supported || reserved.has(field.name)) continue;
      const prop = (schema.properties?.[field.name] ?? {}) as Record<string, any>;
      // Idempotent choices can emit no event when selecting the initial value: lack of an effect is not rejection.
      if (capability.plan?.mode === 'edit' && (prop.type === 'boolean' || prop.enum || field.adapter==='material-choice'||field.adapter==='material-select')) {
        report.uncertainties.push(`${field.name}: choice idempotence prevents inferring validation from an absent event.`);
        continue;
      }
      if (mirrors[field.name]) {
        report.uncertainties.push(`${field.name}: must equal ${mirrors[field.name]}; it was varied together with that field, not on its own.`);
        continue;
      }
      // What the form model states about the field is a hypothesis: the queries below confirm or refute it.
      const known = liveFields.get(field.name), fromModel = known ? livePatch(prop, known.rules) : { patch: {}, notes: [] };
      if (Object.keys(fromModel.patch).length) stated[field.name] = fromModel.patch;
      report.uncertainties.push(...fromModel.notes.map(note => `${field.name}: ${note}.`));
      if (prop.enum || (prop.anyOf && !prop.anyOf.some((x: any) => x.type === 'string' && !x.const))) continue;
      learners.push({name:field.name,schema:{...prop,...fromModel.patch},current:base[field.name]});
    }
    const learnedFields=await learnFieldsConstraints(learners,ask);
    for(const field of learners){
      const learned=learnedFields[field.name];
      if(Object.keys(learned.patch).length)report.learned[field.name]=learned.patch;
      report.uncertainties.push(...learned.uncertainties.map(message=>`${field.name}: ${message}`));
    }
    // A rule read from the form model is kept only while every value the application was seen to accept satisfies it.
    for (const [name, patch] of Object.entries(stated)) {
      const seen = [base[name], ...report.probes.filter(p => p.accepted && name in p.args).map(p => p.args[name])];
      let holds = false;
      try { const check = ajv.compile({ ...(properties[name] ?? {}), ...patch }); holds = seen.every(value => check(value) === true); } catch { /* a rule this schema dialect cannot carry is not published */ }
      if (holds) report.learned[name] = { ...patch, ...report.learned[name] };
      else report.uncertainties.push(`${name}: a rule read from the form model did not hold for a value the application accepted; it was not added.`);
    }
    // Equalities that held are recorded on the field and stated where a caller will read them.
    report.sameAs = { ...mirrors };
    for (const [dependent, source] of Object.entries(mirrors)) {
      const note = `Must equal the value of "${source}".`, described = properties[dependent]?.description;
      if (!String(described ?? '').includes(note)) report.learned[dependent] = { ...report.learned[dependent], description: described ? `${described} ${note}` : note };
    }
    // The accepted example is published, so that the next run and a calling agent start from a value the application takes.
    for (const field of capability.fields) {
      const prop = properties[field.name], value = base[field.name];
      if (!ownNames.includes(field.name) || !prop || field.type === 'password' || prop.enum || 'const' in prop || !(typeof value === 'number' || typeof value === 'string' && value)) continue;
      const next = { ...prop, ...report.learned[field.name] };
      if (next.examples?.[0] !== value && exampleFor({ ...next, examples: undefined }) !== value) report.learned[field.name] = { ...report.learned[field.name], examples: [value] };
    }
    const comparable = report.probes.filter(p => !p.rule), diffs = comparable.filter(p => p.accepted !== p.staticAccepts);
    // A rule that turned out to be an equality between two fields is reported as that equality, not as an unnamed rule.
    const refusedBy = [...new Set(report.probes.flatMap(p => p.rule ? p.rule.split(', ') : []))].filter(rule => !linkRules.has(rule));
    if (refusedBy.length) report.ownRules = refusedBy;
    report.agreement = comparable.length ? 1 - diffs.length / comparable.length : null;
    report.disagreements = diffs.map(p => `${p.note}: app ${p.accepted ? 'accepts' : 'rejects'}, contract ${p.staticAccepts ? 'accepts' : 'rejects'}`);
    log(`${capability.id}: ${effectClass}, agreement ${report.agreement === null ? 'n/a' : (report.agreement * 100).toFixed(0) + '%'} over ${report.probes.length} probes`);
    return await finish(report);
  } catch (error) {
    return await finish(blank(`probe error: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`));
  }
  async function finish(report: ProbeReport) { await scratch?.close(); return report; }
}

/** Applies what the app taught us: observed effect class and learned constraints, with fingerprints recomputed. */
export function applyProbes(manifest: Manifest, reports: ProbeReport[]): Manifest {
  const byId = new Map(reports.map(r => [r.id, r]));
  const capabilities = manifest.capabilities.map(c0 => {
    let c = c0;
    const r = byId.get(c0.id);
    if (!r || r.skipped) return c;
    // Inputs the app taught us (none were visible statically) replace the empty contract; learned constraints apply on top.
    if (r.synthesized) c = { ...r.synthesized };
    const schema = c.inputSchema as { properties?: Record<string, Schema>; required?: string[] };
    const properties = { ...schema.properties };
    for (const [name, patch] of Object.entries(r.learned)) {
      const { emailNotEnforced, ...rest } = patch as Record<string, unknown>;
      if (properties[name] !== undefined && Object.keys(rest).length) properties[name] = { ...(properties[name] as object), ...rest } as Schema;
    }
    if (r.options) {
      for (const [name, opts] of Object.entries(r.options)) {
        properties[name] = { ...(properties[name] as object), enum: opts.map(o => o.value) } as Schema;
        c = { ...c, fields: c.fields.map(f => f.name === name ? { ...f, options: opts, schema: { ...(f.schema as object), enum: opts.map(o => o.value) } as Schema, dynamicOptions: undefined } : f) };
      }
    }
    // An equality between two fields is rewritten from each report that checked it: a link that no longer holds is dropped.
    const fields = c.fields.map(field0 => {
      const field = properties[field0.name] === undefined ? field0 : { ...field0, schema: properties[field0.name] };
      if (!r.sameAs) return field;
      const { sameAs, ...rest } = field;
      return r.sameAs[field.name] ? { ...rest, sameAs: r.sameAs[field.name] } : rest;
    });
    const next: Capability = { ...c, fields, inputSchema: { ...schema, properties } as Schema, observed: { effectClass: r.effectClass, http: r.effects.http.map(({method,path,bodyKeys})=>({method,path,bodyKeys})), storage: r.effects.storage, calls: r.effects.calls, confirmationRequired: r.confirmationRequired, agreement: r.agreement }, fingerprint: '' };
    next.fingerprint = hash(JSON.stringify({ sourceDigest: manifest.sourceDigest, capability: next }));
    return next;
  });
  return { ...manifest, capabilities };
}
