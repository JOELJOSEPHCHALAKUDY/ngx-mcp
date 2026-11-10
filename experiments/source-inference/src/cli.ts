#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { compile } from './compiler.js';
import { reviewedTools } from './approval.js';
import { generate } from './codegen.js';
import type { Approval } from './model.js';

const { values } = parseArgs({ options: {
  project: { type: 'string' },
  routes: { type: 'string' },
  out: { type: 'string', default: 'artifacts/capabilities.json' },
  approvals: { type: 'string' },
  generate: {type:'string'},
  help: {type:'boolean',short:'h'},
} });
if(values.help) { console.log('angular-mcp-compiler --project <tsconfig> --routes <file#symbol> [--out <manifest.json>] [--approvals <review.json>] [--generate <directory>]'); process.exit(0); }
try {
  if(!values.project || !values.routes) throw new Error('--project and --routes are required. Use --help for usage.');
  const manifest = compile(values.project, values.routes);
  const output = resolve(values.out);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
  const approvals=values.approvals ? JSON.parse(readFileSync(values.approvals, 'utf8')) as Approval[] : [];
  const tools = reviewedTools(manifest, approvals);
  if(values.generate) await generate(manifest,approvals,values.generate);
  writeFileSync(output.replace(/\.json$/, '') + '.tools.json', JSON.stringify({ tools: tools.map(t => t.tool) }, null, 2) + '\n');
  console.log(`${manifest.routes.length} routes; ${manifest.capabilities.length} UI capabilities; ${tools.length} reviewed tools.\n${output}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
