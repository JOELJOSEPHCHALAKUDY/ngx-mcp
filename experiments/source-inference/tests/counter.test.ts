import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium,type Browser,type Page} from 'playwright';
import {executeDom} from '../src/browser-runtime.js';
import type {Capability,CounterBinding} from '../src/model.js';

let browser:Browser;
before(async()=>{browser=await chromium.launch();});
after(async()=>{await browser?.close();});
const binding:CounterBinding={param:'quantity',selector:'app-counter',increment:{selector:'button.inc'},decrement:{selector:'button.dec'},valueSelector:'.quantity'};
const html=(initial:number,maximum=99,step=1,ignore=false)=>`<!doctype html><style>article{display:block;padding:15px}app-counter{display:inline-flex;gap:10px;align-items:center}button{width:50px;height:40px}.quantity{display:inline-block;width:40px}</style><article id="first"><app-counter><button class="dec">-</button><span class="quantity">9</span><button class="inc">+</button></app-counter></article><article id="selected"><app-counter><button class="dec" aria-label="Decrease">-</button><span class="quantity">${initial}</span><button class="inc" aria-label="Increase">+</button></app-counter></article><script>
window.updates=[];window.clicks=0;
for(const root of document.querySelectorAll('app-counter')){
 const span=root.querySelector('.quantity'),increase=root.querySelector('.inc'),decrease=root.querySelector('.dec');
 function render(){increase.disabled=Number(span.textContent)>=${maximum};decrease.disabled=Number(span.textContent)<=1;}
 for(const [button,delta]of [[increase,${step}],[decrease,-${step}]])button.onclick=()=>{window.clicks++;if(${ignore})return;span.textContent=String(Number(span.textContent)+delta);window.updates.push({row:root.parentElement.id,value:Number(span.textContent)});render();};render();
}
</script>`;
async function pageWith(initial=1,maximum=99,step=1,ignore=false){const page=await browser.newPage({viewport:{width:1000,height:700}});await page.setContent(html(initial,maximum,step,ignore));return page;}
async function drive(page:Page,args:Record<string,unknown>,counter=binding,scope='#selected'){
 return page.evaluate(async({source,args,binding,scope})=>{
  const execute=new Function('return ('+source+')')() as typeof executeDom;
  const capability:Capability={id:'counter-fixture',fingerprint:'',route:'/',global:true,component:'CounterFixture',componentSelector:scope==='body'?'body':'#selected',action:{kind:'button',selector:scope,label:'Counter',event:'click',expression:'counter()',source:{file:'counter-fixture',line:1}},drive:{counter:binding},fields:[],handler:'counter',callPath:[],bindings:[],inputSchema:{type:'object'},outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'};
  const before=(window as any).clicks;
  const result=await execute({capability,args});
  if(result.status!=='ui-dispatched')throw new Error('Counter action did not dispatch');
  return {value:Number(document.querySelector('#selected .quantity')?.textContent),steps:(window as any).clicks-before};
 },{source:executeDom.toString(),args,binding:counter,scope});
}
test('serialized counter driver changes only the selected row through actual increment buttons',async()=>{
 const page=await pageWith(2);try{
  assert.deepEqual(await drive(page,{quantity:5}),{value:5,steps:3});assert.equal(await page.locator('#first .quantity').textContent(),'9');
  assert.deepEqual(await page.evaluate(()=>(window as any).updates),[{row:'selected',value:3},{row:'selected',value:4},{row:'selected',value:5}]);
 }finally{await page.close();}
});
test('a preselected counter supports nested DTO quantity paths and decrements',async()=>{
 const page=await pageWith(4);try{
  assert.deepEqual(await drive(page,{params:{quantity:1}},{...binding,param:'params',path:['quantity'],selector:undefined},'#selected app-counter'),{value:1,steps:3});
  assert.deepEqual(await page.evaluate(()=>(window as any).updates.map((update:any)=>update.value)),[3,2,1]);
 }finally{await page.close();}
});
test('disabled controls refuse quantity changes without dispatching a click',async()=>{
 const page=await pageWith(3,3);try{await assert.rejects(drive(page,{quantity:4}),/disabled/);assert.equal(await page.evaluate(()=>(window as any).clicks),0);}finally{await page.close();}
});
test('covered controls are not force-clicked',{timeout:10000},async()=>{
 const page=await pageWith();try{
  await page.evaluate(()=>{const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;z-index:9999';document.body.append(overlay);});
  await assert.rejects(drive(page,{quantity:2}),/covering/);assert.equal(await page.evaluate(()=>(window as any).clicks),0);
 }finally{await page.close();}
});
test('ambiguous counter scope is rejected before touching another row',async()=>{
 const page=await pageWith();try{await assert.rejects(drive(page,{quantity:2},binding,'body'),/ambiguous/);assert.equal(await page.evaluate(()=>(window as any).clicks),0);}finally{await page.close();}
});
test('counter changes beyond the 100-step bound and fractional requests are refused before mutation',async()=>{
 const page=await pageWith();try{await assert.rejects(drive(page,{quantity:102}),/100-step/);await assert.rejects(drive(page,{quantity:1.5}),/safe integer/);assert.equal(await page.evaluate(()=>(window as any).clicks),0);}finally{await page.close();}
});
test('an already matching visible quantity produces no click even when the upper control is disabled',async()=>{
 const page=await pageWith(3,3);try{assert.deepEqual(await drive(page,{quantity:3}),{value:3,steps:0});assert.equal(await page.evaluate(()=>(window as any).clicks),0);}finally{await page.close();}
});
test('a counter that overshoots an unavailable value stops without corrective retries',async()=>{
 const page=await pageWith(1,99,2);try{await assert.rejects(drive(page,{quantity:2}),/stepped past.*1 counter click\(s\).*visible quantity: 3/);assert.equal(await page.evaluate(()=>(window as any).clicks),1);assert.equal(await page.locator('#selected .quantity').textContent(),'3');}finally{await page.close();}
});
test('a control that makes no progress is clicked once and reported as unsuccessful',{timeout:10000},async()=>{
 const page=await pageWith(1,99,1,true);try{await assert.rejects(drive(page,{quantity:2}),/did not move/);assert.equal(await page.evaluate(()=>(window as any).clicks),1);}finally{await page.close();}
});
test('counter locators can distinguish controls by their accessible labels',async()=>{
 const page=await pageWith(2);try{assert.deepEqual(await drive(page,{quantity:3},{...binding,increment:{selector:'button',label:'Increase'},decrement:{selector:'button',label:'Decrease'}}),{value:3,steps:1});}finally{await page.close();}
});
test('a scalar add action fills the scoped counter before clicking its original submit button once',async()=>{
 const page=await pageWith(1);try{
  await page.evaluate(()=>{const button=document.createElement('button');button.className='submit';button.textContent='Add to cart';button.onclick=()=>{(window as any).submits=((window as any).submits??0)+1;(window as any).savedQuantity=Number(document.querySelector('#selected .quantity')?.textContent);};document.querySelector('#selected')!.append(button);});
  assert.deepEqual(await drive(page,{quantity:4},{...binding,submitAction:true},'#selected .submit'),{value:4,steps:3});
  assert.equal(await page.evaluate(()=>(window as any).submits),1);assert.equal(await page.evaluate(()=>(window as any).savedQuantity),4);
 }finally{await page.close();}
});
test('omitting a source-defaulted scalar quantity preserves the current counter and clicks submit',async()=>{
 const page=await pageWith(3);try{
  await page.evaluate(()=>{const button=document.createElement('button');button.className='submit';button.textContent='Add to cart';button.onclick=()=>{(window as any).submits=((window as any).submits??0)+1;(window as any).savedQuantity=Number(document.querySelector('#selected .quantity')?.textContent);};document.querySelector('#selected')!.append(button);});
  assert.deepEqual(await drive(page,{}, {...binding,submitAction:true},'#selected .submit'),{value:3,steps:0});
  assert.equal(await page.evaluate(()=>(window as any).submits),1);assert.equal(await page.evaluate(()=>(window as any).savedQuantity),3);
 }finally{await page.close();}
});
test('a missing required DTO quantity is rejected without moving the counter',async()=>{
 const page=await pageWith(3);try{
  await assert.rejects(drive(page,{params:{}},{...binding,param:'params',path:['quantity']}),/safe integer/);
  assert.equal(await page.evaluate(()=>(window as any).clicks),0);
 }finally{await page.close();}
});

