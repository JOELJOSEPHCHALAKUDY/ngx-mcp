// Rescore captured probes after an evaluator correction, without rerunning the app or changing generated labels.
// usage: tsx tooling/rescore-injection.ts <run.json> <workdir> <output.json>
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {compile} from '../src/compiler.js';
import {applyProbes,type ProbeReport} from '../src/probe.js';
import {SCORING_VERSION,treeDigest,digest} from '../evaluation/metrics.js';
import {scoreManifest,emptyTotals,summary,type ByIdiom} from './injection-lib.js';
const [,,input,work,output]=process.argv;
const original=JSON.parse(readFileSync(input,'utf8'));
assert.equal(treeDigest('src'),original.compilerDigest,'Compiler changed: these observations cannot be rescored as the same compiler run');
assert.equal(digest(readFileSync('evaluation/injection/generate.mjs')),original.generatorDigest,'Generator changed');
const staticTotals=emptyTotals(),probedTotals=emptyTotals(),staticIdiom:ByIdiom=new Map(),probedIdiom:ByIdiom=new Map(),staticMisses:string[]=[],probedMisses:string[]=[];
const effects:Record<string,number>={},skipped=new Map<string,number>();
for(const seed of original.seeds){
 const host=resolve(work,`host-s${seed}`),injected=resolve(host,'src/app/injected');
 const truth=JSON.parse(readFileSync(resolve(injected,'truth.json'),'utf8')),decoys=JSON.parse(readFileSync(resolve(injected,'decoys.json'),'utf8'));
 const manifest=compile(resolve(host,'tsconfig.app.json'),'src/app/injected/injected.routes.ts#routes');
 const reports:ProbeReport[]=JSON.parse(readFileSync(resolve(work,`probe-s${seed}.json`),'utf8'));
 for(const report of reports){effects[report.effectClass]=(effects[report.effectClass]??0)+1;if(report.skipped)skipped.set(report.skipped,(skipped.get(report.skipped)??0)+1);}
 scoreManifest(manifest,truth,decoys,`s${seed}`,staticTotals,staticIdiom,staticMisses);
 scoreManifest(applyProbes(manifest,reports),truth,decoys,`s${seed}`,probedTotals,probedIdiom,probedMisses);
}
const result={...original,scoringVersion:SCORING_VERSION,rescoredAt:new Date().toISOString(),evaluatorDigest:treeDigest('evaluation'),previousScore:{version:original.scoringVersion??1,static:original.static,probed:original.probed},scoringCorrection:'Non-email regexes no longer receive email-only expected payloads. Constraint interactions use the authored full gold schema as the reference. Standard formats and typed numeric enum witnesses are validated. This changes scoring, not compiler behavior or runtime observations.',static:staticTotals,probed:probedTotals,effects,skipped:[...skipped],staticByIdiom:[...staticIdiom],probedByIdiom:[...probedIdiom],staticMisses,probedMisses};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(summary('STATIC (scorer v2)',staticTotals));console.log(summary('PROBED (scorer v2)',probedTotals));
