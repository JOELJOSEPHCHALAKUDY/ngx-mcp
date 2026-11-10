import { build } from 'esbuild';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { reviewedTools } from './approval.js';
import type { Approval, Manifest } from './model.js';

export async function generate(manifest: Manifest, approvals: Approval[], output: string) {
  const entries = reviewedTools(manifest, approvals);
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, 'mcp.tools.json'), JSON.stringify({ tools: entries.map(e => e.tool) }, null, 2) + '\n');
  const runtime = fileURLToPath(new URL('./browser-runtime.js',import.meta.url));
  const source = `import {installWebMcp} from ${JSON.stringify(runtime)};\nexport const install = (options = {}) => installWebMcp(${JSON.stringify(entries)},options);\n`;
  await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, minify:true, platform: 'browser', format: 'esm', target: 'es2022', outfile: resolve(output, 'webmcp.mjs') });
}
