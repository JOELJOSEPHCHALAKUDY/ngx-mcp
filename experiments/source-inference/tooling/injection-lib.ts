import { representatives, schemaScore } from '../evaluation/metrics.js';
import type { Capability, Manifest } from '../src/model.js';

const norm = (k: string) => k.toLowerCase().replace(/(id|index|number|idx)$/, '');
export interface Totals { ops: number; found: number; runnable: number; strict: number; lenient: number; decoys: number; decoyHits: number; extra: number }
export const emptyTotals = (): Totals => ({ ops: 0, found: 0, runnable: 0, strict: 0, lenient: 0, decoys: 0, decoyHits: 0, extra: 0 });
export type ByIdiom = Map<string, { ops: number; found: number; runnable: number; strict: number; lenient: number }>;
const relaxIntegers = (schema: any): any => JSON.parse(JSON.stringify(schema, (k, v) => (k === 'type' && v === 'integer' ? 'number' : v)));

/** Scores one manifest against operations known by construction. `lenient` also forgives parameter names and integer-vs-number. */
export function scoreManifest(manifest: Manifest, truth: any[], decoys: any[], tag: string, totals: Totals, byIdiom: ByIdiom, misses: string[]) {
  const hit = (t: any, c: Capability) => t.component === c.component && t.handler === c.handler && (t.routes.includes(c.route) || t.routes.length > 3 || c.global === true);
  for (const t of truth) {
    totals.ops++;
    const row = byIdiom.get(t.idiom) ?? { ops: 0, found: 0, runnable: 0, strict: 0, lenient: 0 }; byIdiom.set(t.idiom, row); row.ops++;
    const cap = representatives(manifest.capabilities.filter(c => hit(t, c)))[0];
    if (!cap) { misses.push(`${tag} MISSING ${t.idiom} ${t.component}.${t.handler}`); continue; }
    totals.found++; row.found++;
    if (cap.status !== 'candidate') { misses.push(`${tag} BLOCKED ${t.idiom} ${t.component}.${t.handler}: ${cap.issues[0]}`); continue; }
    totals.runnable++; row.runnable++;
    const schema = { ...t.inputSchema, additionalProperties: false, required: t.inputSchema.required ?? [] };
    const actual = Object.keys((cap.inputSchema as any).properties ?? {});
    const expected = Object.keys(schema.properties ?? {});
    const score = (rename: Record<string, string>, relax: boolean) => {
      const rn = (k: string) => rename[k] ?? k;
      const props = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [rn(k), relax ? relaxIntegers(v) : v]));
      const action = { ...t, project: 'x', evidence: [], inputSchema: { ...schema, properties: props, required: schema.required.map(rn) }, validInput: Object.fromEntries(Object.entries(t.validInput ?? {}).map(([k, v]) => [rn(k), v])) };
      try { return schemaScore(action as any, cap); } catch { return undefined; }
    };
    if (score({}, false)?.passed) { totals.strict++; totals.lenient++; row.strict++; row.lenient++; continue; }
    const rename: Record<string, string> = {};
    const free = actual.filter(a => !expected.includes(a));
    for (const e of expected.filter(e => !actual.includes(e))) { const m = free.find(a => norm(a) === norm(e) && !Object.values(rename).includes(a)); if (m) rename[e] = m; }
    const left = expected.filter(e => !actual.includes(e) && !rename[e]), right = free.filter(a => !Object.values(rename).includes(a));
    if (left.length === 1 && right.length === 1) rename[left[0]] = right[0];
    const lenient = score(rename, true);
    if (lenient?.passed) { totals.lenient++; row.lenient++; }
    else misses.push(`${tag} CONTRACT ${t.idiom} ${t.component}.${t.handler}: actual [${actual}] vs truth [${expected}]${lenient ? ' fails ' + lenient.cases.filter((c: any) => !c.passed).slice(0, 2).map((c: any) => c.name).join('; ') : ''}`);
  }
  for (const d of decoys) { totals.decoys++; if (manifest.capabilities.some(c => c.status === 'candidate' && c.effectKind !== 'ui-state' && c.component === d.component && c.handler === d.handler)) { totals.decoyHits++; misses.push(`${tag} FALSE-POSITIVE decoy ${d.component}.${d.handler} (${d.why})`); } }
  totals.extra += manifest.capabilities.filter(c => c.status === 'candidate' && c.effectKind !== 'ui-state' && !truth.some(t => hit(t, c)) && !decoys.some(d => d.component === c.component && d.handler === c.handler)).length;
}
const pct = (a: number, b: number) => b ? `${(100 * a / b).toFixed(1)}%` : 'n/a';
export const summary = (label: string, t: Totals) => `${label}: operations ${t.ops}; discovered ${pct(t.found, t.ops)}; runnable ${pct(t.runnable, t.ops)}; contracts correct ${pct(t.strict, t.found)} strict / ${pct(t.lenient, t.found)} lenient (of discovered); decoys reported ${t.decoyHits}/${t.decoys}; unlabelled runnable extras ${t.extra}`;
export const idiomTable = (byIdiom: ByIdiom) => [...byIdiom].map(([k, v]) => `${k.padEnd(30)} found ${v.found}/${v.ops}  runnable ${v.runnable}  contract strict ${v.strict} lenient ${v.lenient}`).join('\n');
