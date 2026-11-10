import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from './compiler.js';
import type { Approval, Manifest } from './model.js';

export interface Sample {
  id: string; repository: string; revision: string; license: string; licenseFile: string; subdirectory: string;
  complexity: string; features: string[]; tsconfig: string; routes: string; angularProject: string; port: number;
  scenario: { route: string; component: string; handler: string; kind?: 'form'|'workflow'; args: Record<string, unknown>; expectedPath?: string; expectedLimitation?: string; upstreamLimitation?: string; storageKey?: string; preparePath?: string };
}
export const samples: Sample[] = JSON.parse(readFileSync(new URL('../samples/projects.json', import.meta.url), 'utf8'));
export function getSample(id: string) { const sample = samples.find(s => s.id === id); if (!sample) throw new Error(`Unknown sample: ${id}`); return sample; }
export const sampleDirectory = (sample: Sample) => resolve('test-apps',sample.id,sample.subdirectory);
export const sampleUrl = (sample: Sample) => `http://127.0.0.1:${sample.port}`;
export const compileSample = (sample: Sample) => compile(resolve(sampleDirectory(sample),sample.tsconfig),sample.routes);
export const sampleApprovals = (sample: Sample): Approval[] => JSON.parse(readFileSync(`review/${sample.id}.json`,'utf8'));
export function scenarioCapability(sample: Sample, manifest: Manifest) {
  return manifest.capabilities.find(c=>c.route===sample.scenario.route&&c.component===sample.scenario.component&&c.handler===sample.scenario.handler&&c.action.kind===(sample.scenario.kind??'form'));
}
