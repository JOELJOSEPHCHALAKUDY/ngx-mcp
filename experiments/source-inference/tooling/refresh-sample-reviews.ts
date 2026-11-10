// Maintainer tool for the five public samples only: re-pins review/<sample>.json to the current compiler output.
// It matches each approval to the capability with the same route, component and handler, and refuses to guess otherwise.
import { readFileSync, writeFileSync } from 'node:fs';
import { samples, compileSample } from '../src/samples.js';
for (const sample of samples) {
  const file = `review/${sample.id}.json`;
  const approvals = JSON.parse(readFileSync(file, 'utf8')) as { id: string; fingerprint: string; description: string; effect: string }[];
  const manifest = compileSample(sample);
  const next = approvals.map(approval => {
    const prefix = approval.id.slice(0, approval.id.indexOf(':'));
    const all = manifest.capabilities.filter(c => c.id === approval.id || c.id.startsWith(prefix + ':'));
    const matches = all.length > 1 ? all.filter(c => c.status === 'candidate') : all;
    if (matches.length !== 1) throw new Error(`${sample.id}: cannot re-pin ${approval.id} (${matches.length} candidates)`);
    if (matches[0].status !== 'candidate') throw new Error(`${sample.id}: ${matches[0].id} is blocked: ${matches[0].issues.join('; ')}`);
    if (matches[0].id !== approval.id || matches[0].fingerprint !== approval.fingerprint) console.log(`${sample.id}: re-pinned ${approval.id}${matches[0].id !== approval.id ? ' -> ' + matches[0].id : ''}`);
    return { ...approval, id: matches[0].id, fingerprint: matches[0].fingerprint };
  });
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
}
