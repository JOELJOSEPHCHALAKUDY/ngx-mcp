import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn,type ChildProcess} from 'node:child_process';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium,type Browser,type Page} from 'playwright';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {compile} from '../src/compiler.js';
import {browserAdapter} from '../src/browser-adapter.js';
import {createMcpServer} from '../src/mcp.js';
import type {Capability,Manifest} from '../src/model.js';

// Source-frozen Modern Store development regression: setup is through DOM, action through actual MCP, oracle is read-only.
const source=resolve('test-apps/fresh-modern-store');
const base=process.env.SHOP_COUNTER_BASE_URL??'http://127.0.0.1:4331';
let manifest:Manifest,browser:Browser,child:ChildProcess|undefined;
async function ready(){try{return (await fetch(base,{signal:AbortSignal.timeout(1000)})).ok;}catch{return false;}}
before(async()=>{
 assert(existsSync(resolve(source,'node_modules/@angular/cli/bin/ng.js')),'Prepare the pinned Modern Store sample dependencies first');
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),'5bface390202c117a30bb7de06839735d3b9f013');
 execFileSync('git',['diff','--exit-code','HEAD','--','src'],{cwd:source,stdio:'pipe'});
 manifest=compile(resolve(source,'tsconfig.app.json'),'src/app/app.routes.ts#routes');
 if(!await ready()){
  const url=new URL(base);assert.equal(url.hostname,'127.0.0.1');let log='';child=spawn(process.execPath,['node_modules/@angular/cli/bin/ng.js','serve','--host','127.0.0.1','--port',url.port,'--no-live-reload'],{cwd:source,env:{...process.env,CI:'true',NG_CLI_ANALYTICS:'false',NG_BUILD_MAX_WORKERS:'2'},stdio:['ignore','pipe','pipe']});
  child.stdout?.on('data',data=>{log=(log+data).slice(-7000);});child.stderr?.on('data',data=>{log=(log+data).slice(-7000);});
  const deadline=Date.now()+100000;while(!await ready()){if(child.exitCode!==null||Date.now()>deadline||/Application bundle generation failed/.test(log))throw new Error(`Modern Store did not start: ${log}`);await delay(300);}
 }
 browser=await chromium.launch();
},{timeout:120000});
after(async()=>{await browser?.close();child?.kill();execFileSync('git',['diff','--exit-code','HEAD','--','src'],{cwd:source,stdio:'pipe'});});
function action(component:string,method:string){const cap=manifest.capabilities.find(c=>c.component===component&&c.status==='candidate'&&c.bindings.some(b=>b.method===method)&&c.drive?.counter);assert(cap,`${component}.${method} needs a source-derived counter binding`);return cap;}
const state=(page:Page)=>page.evaluate(()=>{const store=(window as any).ng.getComponent(document.querySelector('app-header-actions')).store;return {items:store.cartItems(),count:store.cartCount(),storage:JSON.parse(localStorage.getItem('modern-store')??'null')};});
async function until(page:Page,check:(value:Awaited<ReturnType<typeof state>>)=>boolean){for(let n=0;n<60;n++){const value=await state(page);if(check(value))return value;await page.waitForTimeout(50);}throw new Error('Cart did not reach the source-defined business effect');}
const card=(page:Page,name:string)=>page.locator('app-product-card').filter({has:page.getByRole('heading',{name,exact:true})});
async function context(cap:Capability,run:(page:Page,call:(args:Record<string,unknown>)=>Promise<void>)=>Promise<void>){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1100}});await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());const page=await context.newPage();page.setDefaultTimeout(7000);
 const adapter=browserAdapter(page,manifest,[{id:cap.id,fingerprint:cap.fingerprint,effect:'write',description:'Isolated Modern Store quantity regression'}],base);
 const client=new Client({name:'shop-counter-regression',version:'1'}),server=createMcpServer(adapter);const [a,b]=InMemoryTransport.createLinkedPair();
 try{await Promise.all([client.connect(a),server.connect(b)]);const tools=await client.listTools();assert.equal(tools.tools.length,1);await page.goto(base+'/products/all');await page.locator('app-product-card').first().waitFor();
  await run(page,async args=>{const result=await client.callTool({name:tools.tools[0].name,arguments:args});assert(!result.isError,JSON.stringify(result));});
 }finally{await client.close();await server.close();await context.close();}
}
async function detail(page:Page,cap:Capability){
 await card(page,'Wireless Headphones').getByRole('heading',{name:'Wireless Headphones',exact:true}).click();await page.locator('app-product-info').waitFor();
 const product=await page.evaluate(()=>(window as any).ng.getComponent(document.querySelector('app-product-info')).product());
 const args:Record<string,unknown>={product};const parts=new URL(page.url()).pathname.split('/');for(const [index,part]of cap.route.split('/').entries())if(part.startsWith(':'))args[part.slice(1)]=decodeURIComponent(parts[index]);return args;
}
async function addCard(page:Page,name:string){await card(page,name).getByRole('button',{name:/Add to Cart/}).click();await until(page,s=>s.items.some((item:any)=>item.product.name===name));}
test('source ProductInfo scalar quantity drives the existing counter then adds that quantity through MCP',{timeout:45000},async()=>{
 const cap=action('ProductInfo','addToCart');await context(cap,async(page,call)=>{
  const args=await detail(page,cap);await call({...args,quantity:3});const saved=await until(page,s=>s.items.length===1&&s.items[0].quantity===3);
  assert.equal(saved.items[0].product.id,'1');assert.equal(saved.count,3);await page.reload();const restored=await until(page,s=>s.items[0]?.quantity===3);assert.equal(restored.storage.cartItems[0].quantity,3);
 });
});
test('omitted ProductInfo quantity preserves the user-selected counter and still performs Add to Cart',{timeout:45000},async()=>{
 const cap=action('ProductInfo','addToCart');await context(cap,async(page,call)=>{
  const args=await detail(page,cap);await page.locator('app-product-info app-qty-selector').locator('button:has(mat-icon:text-is("add"))').click();await call(args);
  const saved=await until(page,s=>s.items[0]?.quantity===2);assert.equal(saved.count,2);assert.equal(saved.items[0].product.id,'1');
 });
});
test('source cart DTO quantity updates only its selected product row through MCP counter events',{timeout:45000},async()=>{
 const cap=action('ShowCartItem','setItemQuantity');await context(cap,async(page,call)=>{
  await addCard(page,'Wireless Headphones');await page.locator('app-back-button button').filter({hasText:'Continue Shopping'}).click();await page.locator('app-product-card').first().waitFor();await addCard(page,'Professional Camera');
  await page.locator('app-header-actions button[routerlink="/cart"]').click();await page.locator('app-show-cart-item').first().waitFor();
  await call({params:{productId:'1',quantity:4}});const saved=await until(page,s=>s.items.find((item:any)=>item.product.id==='1')?.quantity===4);
  assert.equal(saved.items.length,2);assert.equal(saved.items.find((item:any)=>item.product.id==='2').quantity,1);assert.equal(saved.count,5);
  await call({params:{productId:'1',quantity:2}});const reduced=await until(page,s=>s.items.find((item:any)=>item.product.id==='1')?.quantity===2);assert.equal(reduced.items.find((item:any)=>item.product.id==='2').quantity,1);assert.equal(reduced.count,3);assert.equal(reduced.storage.cartItems.find((item:any)=>item.product.id==='1').quantity,2);
 });
});

