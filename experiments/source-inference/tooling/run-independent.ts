// Runs an independently authored app + oracles (oracles.mjs) against the compiler's tools.
// usage: tsx tooling/run-independent.ts <app-dir> <routes-entry e.g. src/app/app.routes.ts#routes> [base-url]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { Ajv } from 'ajv';
import { compile } from '../src/compiler.js';
import { browserAdapter } from '../src/browser-adapter.js';
import { representatives } from '../evaluation/metrics.js';
import type { Capability } from '../src/model.js';

const [, , appDir, routes, base = 'http://127.0.0.1:4411'] = process.argv;
const oracles = await import(pathToFileURL(resolve(appDir, 'oracles.mjs')).href) as { cases: any[]; reset: (page: any, base: string) => Promise<void> };
const manifest = compile(resolve(appDir, 'tsconfig.app.json'), routes);
console.log(`compiled: ${manifest.routes.length} routes, ${manifest.capabilities.length} capabilities (${manifest.capabilities.filter(c => c.status === 'candidate').length} runnable)`);
const browser = await chromium.launch();
const rows: string[] = [];
const tally: Record<string, number> = {};
const note = (status: string, id: string, detail = '') => { tally[status] = (tally[status] ?? 0) + 1; rows.push(`${status.padEnd(13)} ${id} ${detail}`.trimEnd()); };
for (const c of oracles.cases) {
  const caps = representatives(manifest.capabilities.filter(x => x.component === c.component && x.handler === c.handler && (x.route === c.route || c.route.startsWith(x.route))) as Capability[]);
  const accepts = (x: Capability) => new Ajv({ strict: false }).compile(x.inputSchema as object)(c.input);
  const cap = caps.find(accepts) ?? caps[0];
  if (!cap) { note('MISSING', c.id, `${c.component}.${c.handler}@${c.route}`); continue; }
  if (cap.status !== 'candidate') { note('BLOCKED', c.id, cap.issues.join('; ')); continue; }
  const ajv = new Ajv({ strict: false, allErrors: true });
  const validate = ajv.compile(cap.inputSchema as object);
  // Names are a design choice of the contract, so retry once with the obvious renames (a lone value, or `pageIndex` -> `page`) and report those as renamed.
  let input = c.input as Record<string, unknown>;
  let renamed = false;
  if (!validate(input)) {
    const props = Object.keys((cap.inputSchema as any).properties ?? {});
    const keys = Object.keys(input);
    const norm = (k: string) => k.toLowerCase().replace(/(index|number|idx)$/, '');
    const mapped: Record<string, unknown> = {};
    for (const k of keys) {
      const v = input[k];
      // `{ item: { id } }` -> `{ id }`: an identifying object is just its identity here.
      if (!props.includes(k) && v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).every(x => props.includes(x))) { Object.assign(mapped, v); continue; }
      const target = props.includes(k) ? k : (props.length === 1 && keys.length === 1 ? props[0] : props.find(p => norm(p) === norm(k) && !keys.includes(p)));
      mapped[target ?? k] = input[k];
    }
    if (validate(mapped)) { input = mapped; renamed = true; }
  }
  if (!validate(input)) { note('CONTRACT-REJECT', c.id, ajv.errorsText(validate.errors).slice(0, 160) + ' | schema props: ' + Object.keys((cap.inputSchema as any).properties ?? {}).join(',')); continue; }
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(base); await page.waitForLoadState('networkidle');
    await oracles.reset(page, base);
    if (c.setup) await c.setup(page, base);
    const adapter = browserAdapter(page, manifest, [{ id: cap.id, fingerprint: cap.fingerprint, description: 'independent holdout', effect: 'write' }], base);
    let refused = '';
    try { await adapter.invoke(adapter.tools[0].name, input); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
    if (c.expectRefused) { refused ? await c.verify(page, base).then(() => note('PASS', c.id, '(refused as expected)'), e => note('FAIL', c.id, 'refused but state changed: ' + String(e).slice(0, 120))) : note('FAIL', c.id, 'tool did not refuse a confirmation-gated action'); continue; }
    if (refused) { note('TOOL-ERROR', c.id, refused.slice(0, 200)); continue; }
    if (c.humanSteps) await c.humanSteps(page, base); // what a person must do (e.g. confirm a dialog) after the tool acts
    await page.waitForTimeout(300);
    await c.verify(page, base);
    note(renamed ? 'PASS-renamed' : errors.length ? 'PASS+pageerror' : 'PASS', c.id, (renamed ? 'input renamed: ' + JSON.stringify(input) + ' ' : '') + errors.slice(0, 1).join(''));
  } catch (e) { note('FAIL', c.id, String(e instanceof Error ? e.message : e).split('\n')[0].slice(0, 220)); }
  finally { await context.close(); }
}
await browser.close();
console.log(rows.join('\n'));
console.log('\n' + Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join('  ') + `  (of ${oracles.cases.length})`);
