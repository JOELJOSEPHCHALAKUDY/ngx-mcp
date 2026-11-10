import {chromium} from 'playwright';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {getSample,compileSample,sampleApprovals,sampleUrl} from '../src/samples.js';
import {browserAdapter} from '../src/browser-adapter.js';
import {createMcpServer} from '../src/mcp.js';
import {isolateSample,redact} from '../samples/isolation.js';
import {mkdirSync,writeFileSync} from 'node:fs';
const sample=getSample(process.argv[2]??'realworld');
const browser=await chromium.launch();const context=await browser.newContext({serviceWorkers:'block'});const fixture=await isolateSample(context,sample);
const page=await context.newPage();const manifest=compileSample(sample);const approvals=sampleApprovals(sample);
if(sample.scenario.preparePath){await page.goto(sampleUrl(sample)+sample.scenario.preparePath);await page.waitForLoadState('networkidle');}
const adapter=browserAdapter(page,manifest,approvals,sampleUrl(sample));
const server=createMcpServer({...adapter,async invoke(name,args){
 const result=await adapter.invoke(name,args);const effect=manifest.capabilities.find(c=>c.id===approvals[0]?.id)?.plan?.effect;
 const storage=effect?await page.evaluate(key=>JSON.parse(localStorage.getItem(key)??'null'),effect.key):undefined;
 mkdirSync(`artifacts/samples/${sample.id}`,{recursive:true});writeFileSync(`artifacts/samples/${sample.id}/stdio-runtime.json`,JSON.stringify(redact({result,writes:fixture.writes,storage}),null,2)+'\n');return result;
}});
await server.connect(new StdioServerTransport());
const close=async()=>{await server.close();await browser.close();process.exit(0);};process.stdin.once('end',close);process.once('SIGTERM',close);
