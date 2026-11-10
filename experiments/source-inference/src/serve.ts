#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {Ajv} from 'ajv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { browserAdapter } from './browser-adapter.js';
import { createMcpServer } from './mcp.js';
import type { Approval,Manifest } from './model.js';

const {values}=parseArgs({options:{manifest:{type:'string'},project:{type:'string'},routes:{type:'string'},approvals:{type:'string'},'base-url':{type:'string'},context:{type:'string'},headed:{type:'boolean',default:false},refine:{type:'boolean',default:false},hash:{type:'boolean',default:false},help:{type:'boolean',short:'h'}}});
if(values.help) {console.log('angular-mcp-browser --manifest <manifest.json> --approvals <review.json> --base-url <local-url> [--context <context.json>] [--headed] [--refine] [--hash]\nAlternatively use --project <tsconfig> --routes <file#symbol> for source analysis.\nContext is a JSON object for explicit host-bound UI selection (for example sourceStatus). Required context is validated before browser launch; it is separate from tool arguments.');process.exit(0);}
if((!values.manifest&&(!values.project||!values.routes))||!values.approvals||!values['base-url']) throw new Error('Provide --manifest (or --project and --routes), --approvals and --base-url.');
const manifest:Manifest=values.manifest ? JSON.parse(readFileSync(values.manifest,'utf8')) : (await import('./compiler.js')).compile(values.project!,values.routes!);
if(manifest.formatVersion!==1||!Array.isArray(manifest.capabilities))throw new Error('Unsupported manifest format');
const approvals=JSON.parse(readFileSync(values.approvals,'utf8')) as Approval[];
const runtimeContext:unknown=values.context?JSON.parse(readFileSync(values.context,'utf8')):{};
if(!runtimeContext||typeof runtimeContext!=='object'||Array.isArray(runtimeContext))throw new Error('--context must contain a JSON object');
if(!Array.isArray(approvals))throw new Error('Approvals must be an array');
const approved=new Set(approvals.map(a=>a.id)),contextValidator=new Ajv({strict:false,allErrors:true});
for(const capability of manifest.capabilities)if(approved.has(capability.id)&&capability.contextSchema){const validate=contextValidator.compile(capability.contextSchema);if(!validate(runtimeContext))throw new Error(`--context does not satisfy ${capability.id}: ${contextValidator.errorsText(validate.errors)}`);}
const {chromium}=await import('playwright');
const browser=await chromium.launch({headless:!values.headed});
const context=await browser.newContext({serviceWorkers:'block'});
const origin=new URL(values['base-url']).origin;
await context.route('**/*',route=>new URL(route.request().url()).origin===origin ? route.continue() : route.abort('blockedbyclient'));
const page=await context.newPage();
// Option lists loaded at run time (e.g. categories from an API) are read from the live app; reviews must match these fingerprints.
const served=values.refine?await (await import('./refine.js')).refineManifest(page,manifest,values['base-url']):manifest;
const server=createMcpServer(browserAdapter(page,served,approvals,values['base-url'],{hash:values.hash,context:runtimeContext as Record<string,unknown>}));
await server.connect(new StdioServerTransport());
console.error('MCP browser adapter ready; off-origin network requests are blocked.');
const close=async()=>{await server.close();await browser.close();process.exit(0);};
process.once('SIGINT',close);process.once('SIGTERM',close);process.stdin.once('end',close);
