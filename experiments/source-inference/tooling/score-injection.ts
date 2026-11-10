// Scores the compiler (static only) on synthetic apps whose operations are known by construction (generator authored independently of the compiler).
// usage: tsx tooling/score-injection.ts <workdir-with-node_modules> <count> <seed> [<seed> ...]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '../src/compiler.js';
import { emptyTotals, idiomTable, scoreManifest, summary, type ByIdiom } from './injection-lib.js';
const [, , work, countArg, ...seeds] = process.argv;
const generator = resolve('evaluation/injection/generate.mjs');
const totals = emptyTotals(); const byIdiom: ByIdiom = new Map(); const misses: string[] = [];
for (const seed of seeds) {
  const out = resolve(work, 'out', `s${seed}`);
  rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  execFileSync(process.execPath, [generator, out, seed, countArg], { stdio: 'pipe' });
  const tsconfig = resolve(work, `tsconfig.s${seed}.json`);
  writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', moduleResolution: 'bundler', experimentalDecorators: true, strict: false, skipLibCheck: true, noEmit: true, lib: ['ES2022', 'dom'], types: [] }, include: [`out/s${seed}/**/*.ts`] }));
  const manifest = compile(tsconfig, `out/s${seed}/injected.routes.ts#routes`);
  scoreManifest(manifest, JSON.parse(readFileSync(resolve(out, 'truth.json'), 'utf8')), JSON.parse(readFileSync(resolve(out, 'decoys.json'), 'utf8')), `s${seed}`, totals, byIdiom, misses);
}
console.log(idiomTable(byIdiom)); console.log('\n' + misses.slice(0, 80).join('\n'));
console.log('\n' + summary(`static, seeds ${seeds.join(',')} x ${countArg}`, totals));
