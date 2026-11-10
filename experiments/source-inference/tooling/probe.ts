// Probes a running app: executes each runnable capability in a sandbox, records observed effects, and checks the static contract against the app.
// usage: tsx tooling/probe.ts <tsconfig> <routes-entry> <base-url> [--hash] [--only handler] [--param name=value ...] [--out report.json] [--budget n]
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { compile } from '../src/compiler.js';
import { probeCapability, type ProbeReport } from '../src/probe.js';
const { values, positionals } = parseArgs({ allowPositionals: true, options: { hash: { type: 'boolean' }, only: { type: 'string' }, param: { type: 'string', multiple: true }, out: { type: 'string' }, budget: { type: 'string' } } });
const [tsconfig, routes, base] = positionals;
const params = Object.fromEntries((values.param ?? []).map(p => p.split('=') as [string, string]));
const manifest = compile(tsconfig, routes);
const caps = manifest.capabilities.filter(c => c.status === 'candidate' && (!values.only || c.handler === values.only));
console.log(`${manifest.capabilities.length} capabilities, probing ${caps.length}`);
const browser = await chromium.launch();
const reports: ProbeReport[] = [];
for (const c of caps) {
  const r = await probeCapability(browser, manifest, c, { baseUrl: base, hash: values.hash, params, budget: values.budget ? Number(values.budget) : undefined });
  reports.push(r);
  const eff = r.effects.http.map(h => `${h.method} ${h.path}`).concat(r.effects.storage.map(k => `store:${k}`)).join(', ');
  console.log(`${(r.skipped ? 'SKIP' : r.effectClass).padEnd(14)} ${c.component}.${c.handler}`.padEnd(64), r.skipped ? r.skipped : `${eff || '-'} | agreement ${r.agreement === null ? 'n/a' : Math.round(r.agreement * 100) + '%'} (${r.probes.length})${r.confirmationRequired ? ' CONFIRM' : ''}`);
  for (const d of r.disagreements.slice(0, 4)) console.log('      ≠', d);
  for (const uncertainty of (r.uncertainties ?? []).slice(0, 2)) console.log('      ?', uncertainty);
  if (Object.keys(r.learned).length) console.log('      learned', JSON.stringify(r.learned));
}
await browser.close();
const measured = reports.filter(r => r.agreement !== null);
console.log(`\nobserved effects: ${reports.filter(r => r.effectClass !== 'none-observed').length}/${reports.length}; contracts probed: ${measured.length}; mean agreement ${measured.length ? (100 * measured.reduce((a, r) => a + (r.agreement ?? 0), 0) / measured.length).toFixed(1) : 'n/a'}%`);
if (values.out) writeFileSync(values.out, JSON.stringify(reports, null, 2) + '\n');
