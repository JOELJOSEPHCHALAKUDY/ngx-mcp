#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {digest,treeDigest} from '../evaluation/digest.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const {values}=parseArgs({options:{report:{type:'string'}}});
const path=resolve(values.report??'artifacts/webmcp/native-conformance.json');
const bytes=readFileSync(path),report=JSON.parse(bytes),pointer=JSON.parse(readFileSync(path+'.sha256.json','utf8'));
assert.equal(pointer.path,basename(path),'Native report pointer does not identify this report');
assert.equal(pointer.sha256,digest(bytes),'Native WebMCP report bytes changed');
assert.equal(report.formatVersion,1);assert.equal(report.kind,'native-webmcp-conformance');
assert.equal(report.nativeVerified,true,'Skipped, emulated, failed, or unsupported native execution is not release evidence');
assert.equal(report.resourcesClosed,true,'Native conformance resources were not closed');
assert.equal(report.compilerStable,true,'Compiler source changed during native execution');
assert.equal(report.compilerDigestBefore,report.compilerDigestAfter);
assert.equal(report.compilerDigestAfter,treeDigest('src'),'Native WebMCP evidence is stale');
assert.equal(report.harnessStable,true,'Native test harness changed during execution');
assert.deepEqual(report.harnessSha256Before,report.harnessSha256After);
const harness=['tests/integration-webmcp-browser.test.ts','evaluation/digest.mjs','tooling/check-webmcp-evidence.mjs'];
assert.deepEqual(Object.keys(report.harnessSha256After).sort(),harness.slice().sort(),'Native test harness coverage is incomplete');
for(const name of harness)assert.equal(report.harnessSha256After[name],digest(readFileSync(name)),'Missing or changed native test harness: '+name);
const started=Date.parse(report.startedAt),finished=Date.parse(report.finishedAt);
assert(Number.isFinite(started)&&Number.isFinite(finished)&&finished>started,'Native evidence timestamps are invalid');
assert.match(report.browserVersion,/^\d+\.\d+\.\d+\.\d+$/,'Native browser version is missing');
assert(['chrome','custom executable'].includes(report.browserChannel),'Native browser launch is not identified');
assert.deepEqual(report.browserFlags,['--enable-features=WebMCP','--enable-blink-features=WebMCP'],'Native browser feature scope changed');
assert.equal(report.capability?.secure,true);assert.equal(report.capability?.current,true);
assert.equal(report.capability?.nativeMethods,true,'An emulated WebMCP host is not native browser evidence');
for(const name of ['register','getTools','executeTool'])assert.equal(report.capability[name],'function','Missing native API: '+name);
assert.equal(report.modes?.length,3,'Native conformance must cover all three modes');
assert.deepEqual(report.modes.map(item=>item.mode).sort(),['both','mcp','webmcp'],'Native mode coverage is missing, duplicated, or unsupported');
for(const item of report.modes){
 assert.equal(item.productionAot,true);assert.equal(item.sourcePreserved,true);
 assert.equal(item.nativePublished,item.mode!=='mcp');assert.equal(item.nodeAvailable,item.mode!=='webmcp');
 assert.equal(item.nativeEffectsVerified,item.mode!=='mcp');assert.equal(item.sharedPageParity,item.mode==='both');
 assert.equal(item.pageLifecycle,item.mode!=='mcp','Native publisher lifecycle was not verified');
}
assert.equal(typeof report.scope,'string');
assert(report.scope.includes('no claim of ChatGPT or Claude product interoperability'),'Native browser evidence must retain its product-interoperability limit');
assert(report.scope.includes('not actual BFCache navigation'),'Native lifecycle evidence must retain its event-driven scope');
console.log(JSON.stringify({integrity:'passed',nativeWebMcp:true,compilerDigest:report.compilerDigestAfter,browserVersion:report.browserVersion,modes:report.modes.map(item=>item.mode),scope:report.scope},null,2));
