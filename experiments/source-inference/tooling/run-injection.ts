// Full pipeline on synthetic apps with known truth: generate -> build host app -> static compile -> probe the running app -> score both.
// usage: tsx tooling/run-injection.ts <workdir> <toolchain-node_modules> <node-binary> <count> <seed> [<seed> ...]
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { SCORING_VERSION, treeDigest, digest } from '../evaluation/metrics.js';
import { compile } from '../src/compiler.js';
import { applyProbes, probeCapability, type ProbeReport } from '../src/probe.js';
import { emptyTotals, idiomTable, scoreManifest, summary, type ByIdiom } from './injection-lib.js';
const [, , work, modules, node, countArg, ...seeds] = process.argv;
const port = 4421, base = `http://127.0.0.1:${port}`;
const budget = Number(process.env.PROBE_BUDGET ?? 30), pool = Number(process.env.PROBE_POOL ?? 4);
const staticTotals = emptyTotals(), probedTotals = emptyTotals();
const staticIdiom: ByIdiom = new Map(), probedIdiom: ByIdiom = new Map();
const staticMisses: string[] = [], probedMisses: string[] = [];
const effects = { write: 0, read: 0, navigation: 0, overlay: 0, uiState: 0, none: 0, skipped: 0 };
let agreementSum = 0, agreementN = 0, learnedCount = 0;
const skippedWhy = new Map<string, number>();
const measuredAt=new Date().toISOString(),compilerDigest=treeDigest('src'),generatorDigest=digest(readFileSync('evaluation/injection/generate.mjs'));
for (const seed of seeds) {
  const host = resolve(work, `host-s${seed}`);
  rmSync(host, { recursive: true, force: true }); mkdirSync(host, { recursive: true });
  cpSync(resolve('evaluation/injection/host'), host, { recursive: true });
  symlinkSync(modules, resolve(host, 'node_modules'));
  const injected = resolve(host, 'src/app/injected');
  mkdirSync(injected, { recursive: true });
  execFileSync(process.execPath, [resolve('evaluation/injection/generate.mjs'), injected, seed, countArg], { stdio: 'pipe' });
  const truth = JSON.parse(readFileSync(resolve(injected, 'truth.json'), 'utf8')), decoys = JSON.parse(readFileSync(resolve(injected, 'decoys.json'), 'utf8'));
  const manifest = compile(resolve(host, 'tsconfig.app.json'), 'src/app/injected/injected.routes.ts#routes');
  scoreManifest(manifest, truth, decoys, `s${seed}`, staticTotals, staticIdiom, staticMisses);
  const server = spawn(node, ['node_modules/@angular/cli/bin/ng.js', 'serve', '--host', '127.0.0.1', '--port', String(port), '--no-live-reload'], { cwd: host, env: { ...process.env, NG_CLI_ANALYTICS: 'false' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 180; i++) { try { if ((await fetch(base)).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 1000)); }
    const browser = await chromium.launch();
    const caps = manifest.capabilities.filter(c => c.status === 'candidate');
    const reports: ProbeReport[] = []; let next = 0;
    await Promise.all(Array.from({ length: pool }, async () => { while (next < caps.length) { const c = caps[next++]; console.log(`seed ${seed}: probing ${c.component}.${c.handler}`); reports.push(await probeCapability(browser, manifest, c, { baseUrl: base, budget })); } }));
    await browser.close();
    for (const r of reports) {
      ({ write: () => effects.write++, read: () => effects.read++, navigation: () => effects.navigation++, 'opens-overlay': () => effects.overlay++, 'ui-state': () => effects.uiState++, 'none-observed': () => effects.none++ })[r.effectClass]();
      if (r.skipped) { effects.skipped++; skippedWhy.set(r.skipped.replace(/"[^"]*"/g, '"…"').slice(0, 70), (skippedWhy.get(r.skipped.replace(/"[^"]*"/g, '"…"').slice(0, 70)) ?? 0) + 1); continue; }
      if (r.agreement !== null) { agreementSum += r.agreement; agreementN++; }
      learnedCount += Object.keys(r.learned).length;
    }
    scoreManifest(applyProbes(manifest, reports), truth, decoys, `s${seed}`, probedTotals, probedIdiom, probedMisses);
    writeFileSync(resolve(work, `probe-s${seed}.json`), JSON.stringify(reports, null, 2));
  } finally { server.kill(); }
}
console.log(idiomTable(probedIdiom));
console.log('\nSTATIC misses (first 40):\n' + staticMisses.filter(m => /CONTRACT/.test(m)).slice(0, 40).join('\n'));
console.log('\nPROBED misses (first 40):\n' + probedMisses.filter(m => /CONTRACT/.test(m)).slice(0, 40).join('\n'));
console.log('\nprobe outcomes:', JSON.stringify(effects), 'skipped because:', JSON.stringify([...skippedWhy]));
console.log(`mean contract-vs-app agreement ${(100 * agreementSum / Math.max(agreementN, 1)).toFixed(1)}% over ${agreementN} probed contracts; ${learnedCount} fields had constraints re-learned from the app`);
console.log('\n' + summary(`STATIC , seeds ${seeds.join(',')} x ${countArg}`, staticTotals));
console.log(summary(`PROBED , seeds ${seeds.join(',')} x ${countArg}`, probedTotals));
if(process.env.INJECTION_REPORT)writeFileSync(resolve(process.env.INJECTION_REPORT),JSON.stringify({scoringVersion:SCORING_VERSION,evaluatorDigest:treeDigest('evaluation'),measuredAt,compilerDigest,generatorDigest,seeds,count:Number(countArg),budget,pool,static:staticTotals,probed:probedTotals,effects,skipped:[...skippedWhy],staticByIdiom:[...staticIdiom],probedByIdiom:[...probedIdiom],staticMisses,probedMisses,scope:'Seeded synthetic instances of previously developed idioms; one-way first-pass comparison of static and probed contracts, not unseen-project accuracy.'},null,2)+String.fromCharCode(10));
