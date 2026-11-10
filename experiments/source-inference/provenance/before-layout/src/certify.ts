#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { certify, certificationReport } from './certification.js';
import type { Manifest } from './model.js';

const { values } = parseArgs({ options: {
  manifest: { type: 'string' }, project: { type: 'string' }, routes: { type: 'string' }, 'base-url': { type: 'string' },
  out: { type: 'string', default: 'artifacts/certified' }, hash: { type: 'boolean', default: false }, budget: { type: 'string' },
  param: { type: 'string', multiple: true }, 'live-reads': { type: 'boolean', default: false }, 'read-origin': { type: 'string', multiple: true },
  'storage-state': { type: 'string' }, explore: { type: 'string' }, help: { type: 'boolean', short: 'h' },
} });
if (values.help) {
  console.log('angular-mcp-certify --project <tsconfig> --routes <file#symbol> --base-url <local-dev-url> [--out <directory>] [--hash] [--budget <n>]\n' +
    '                    [--param name=value ...] [--live-reads] [--read-origin <origin> ...] [--storage-state <file>]\n' +
    '                    [--explore <n>]\n' +
    'Runs every discovered action against the running development build in a sandbox, repairs contracts from what the app\n' +
    'accepts, and writes manifest.json, approvals.json and REPORT.md. Only actions whose effect was observed are proposed in\n' +
    'approvals.json. Use a local development build.\n\n' +
    'By default no request reaches a backend: the sandbox answers every one with an empty document. The dev server still\n' +
    'serves the app\'s own files (the JSON, text and markup files it fetches as well as the ones it loads).\n' +
    'An action that cannot run on a freshly opened page is tried again in the state other certified actions leave behind\n' +
    '(signed in by the app\'s own login form, a record added by its own form); REPORT.md names the actions that led there.\n' +
    '  --live-reads           let GET and HEAD requests through to the app\'s own origin and other local hosts, so the app\n' +
    '                         shows real records (rows, links, identifiers). Writes still never leave the sandbox.\n' +
    '  --read-origin <origin> also let reads through to this origin (a development API on another host). Implies --live-reads.\n' +
    '  --storage-state <file> start every attempt from a saved browser session (cookies and localStorage), for actions behind\n' +
    '                         a login. Sign in yourself and save it, for example with\n' +
    '                         npx playwright codegen --save-storage=state.json <local-dev-url>\n' +
    '  --param name=value     a route or row identifier the app\'s own pages do not link to.\n' +
    '  --explore <n>          how many times an action that could not run is tried in a state left by other actions\n' +
    '                         (default 80; 0 runs every action on a freshly opened page only).');
  process.exit(0);
}
try {
  if ((!values.manifest && (!values.project || !values.routes)) || !values['base-url']) throw new Error('Provide --project and --routes (or --manifest) and --base-url. Use --help for usage.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(values['base-url']).hostname)) throw new Error('Certification executes actions; --base-url must be a local development build.');
  const readOrigins = (values['read-origin'] ?? []).map(value => { try { return new URL(value).origin; } catch { throw new Error(`--read-origin must be an origin such as https://api.example.test, not "${value}".`); } });
  const storageState = values['storage-state'] ? resolve(values['storage-state']) : undefined;
  if (storageState && !existsSync(storageState)) throw new Error(`--storage-state: no file at ${storageState}.`);
  const source: Manifest = values.manifest ? JSON.parse(readFileSync(values.manifest, 'utf8')) : (await import('./compiler.js')).compile(values.project!, values.routes!);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const result = await certify(browser, source, { baseUrl: values['base-url'], hash: values.hash, budget: values.budget ? Number(values.budget) : undefined,
      params: Object.fromEntries((values.param ?? []).map(p => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; })),
      liveReads: values['live-reads'] || readOrigins.length > 0, readOrigins, storageState,
      explore: values.explore === undefined ? undefined : Math.max(0, Number(values.explore) || 0) });
    const out = resolve(values.out);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'manifest.json'), JSON.stringify(result.manifest, null, 2) + '\n');
    writeFileSync(join(out, 'approvals.json'), JSON.stringify(result.approvals, null, 2) + '\n');
    writeFileSync(join(out, 'certification.json'), JSON.stringify(result.entries, null, 2) + '\n');
    writeFileSync(join(out, 'REPORT.md'), certificationReport(result));
    const n = (v: string) => result.entries.filter(e => e.verdict === v).length;
    const staged = result.entries.filter(e => e.after?.length && (e.verdict === 'proven' || e.verdict === 'executed')).length;
    console.log(`${result.entries.length} actions: ${n('proven')} proven, ${n('executed')} executed, ${n('unverified')} unverified, ${n('blocked')} blocked.` +
      `${staged ? ` ${staged} ran only after another action had put the app in the state they need.` : ''}\n${join(out, 'REPORT.md')}`);
    // The commonest thing an action lacks is a record, and the commonest reason is that the app's records come from a backend.
    const starved = result.entries.filter(e => e.verdict === 'unverified' && /--live-reads/.test(e.reason ?? '')).length;
    if (starved && !result.conditions.liveReads) console.log(`${starved} actions had no record to act on. If the app reads its records from a backend you run locally, add --live-reads (reads only; writes stay in the sandbox).`);
  } finally { await browser.close(); }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
