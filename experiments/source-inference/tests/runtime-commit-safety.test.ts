import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Browser} from 'playwright';
import {executeDom,installWebMcp} from '../src/browser-runtime.js';
import type {Capability} from '../src/model.js';
let browser:Browser;before(async()=>{browser=await chromium.launch();});after(async()=>{await browser?.close();});
const capability:Capability={id:'blur-safety',fingerprint:'',route:'/',global:true,component:'BlurSafety',componentSelector:'x-form',action:{kind:'workflow',selector:'#value',label:'Save on blur',event:'blur',expression:'save()',source:{file:'fixture',line:1}},plan:{mode:'edit',root:'x-form',repeats:[],commit:{event:'blur'}},fields:[{name:'value',selector:'#value',element:'input',type:'text',required:true,supported:true,schema:{type:'string'}}],handler:'save',callPath:[],bindings:[],inputSchema:{type:'object'},outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'};
test('an explicit blur commit releases focus and cannot save a second time on the next real focus change',async()=>{
 const page=await browser.newPage();try{await page.setContent('<x-form style="display:block;padding:20px"><input id="value"><button id="other">Continue</button></x-form><script>window.saves=[];document.querySelector("#value").onblur=e=>window.saves.push(e.target.value);</script>');
 await page.evaluate(async({source,capability})=>{const run=new Function('return ('+source+')')() as typeof executeDom;return run({capability,args:{value:'Saved once'}});},{source:executeDom.toString(),capability});
 assert.deepEqual(await page.evaluate(()=>(window as any).saves),['Saved once']);await page.locator('#other').focus();assert.deepEqual(await page.evaluate(()=>(window as any).saves),['Saved once']);assert.equal(await page.locator('#value').evaluate(input=>document.activeElement===input),false);
 }finally{await page.close();}
});
test('WebMCP tools are registered and removed the way the current draft specifies, and arguments are checked before the page is touched',async()=>{
 // The draft's ModelContext has no unregisterTool: a tool leaves when the signal it was registered with is aborted.
 const tools=new Map<string,{execute(args:Record<string,unknown>):Promise<string>;annotations?:object}>();
 const modelContext={async registerTool(tool:{name:string;execute(args:Record<string,unknown>):Promise<string>},options?:{signal?:AbortSignal}){tools.set(tool.name,tool);options?.signal?.addEventListener('abort',()=>tools.delete(tool.name));}};
 (globalThis as {document?:unknown}).document={modelContext};
 try{
  const remove=await installWebMcp([{capability,tool:{name:'save_value',description:'Save',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},outputSchema:{type:'object'},annotations:{readOnlyHint:false,destructiveHint:true,openWorldHint:true}}}]);
  assert.deepEqual([...tools.keys()],['save_value']);assert.deepEqual(tools.get('save_value')!.annotations,{readOnlyHint:false});
  await assert.rejects(tools.get('save_value')!.execute({value:7}),/must be string/);
  remove();assert.equal(tools.size,0);
 }finally{delete (globalThis as {document?:unknown}).document;}
});
