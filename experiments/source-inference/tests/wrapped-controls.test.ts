import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createServer,type Server} from 'node:http';
import {parseTemplate} from '@angular/compiler';
import {Ajv} from 'ajv';
import {chromium,type Browser,type Page} from 'playwright';
import {Project} from '../src/project.js';
import {allElements} from '../src/workflow-compiler.js';
import {wrappedControls} from '../src/wrapped-controls.js';
import {refineManifest} from '../src/refine.js';
import {executeDom} from '../src/browser-runtime.js';
import type {Capability,Field,Manifest} from '../src/model.js';

const directory=mkdtempSync(join(tmpdir(),'angular-wrapper-regression-'));
symlinkSync(resolve('node_modules'),join(directory,'node_modules'),'dir');
writeFileSync(join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'ESNext',moduleResolution:'bundler',experimentalDecorators:true,skipLibCheck:true},files:['app.ts']}));
writeFileSync(join(directory,'app.ts'),`import {Component,Input,input} from '@angular/core';
@Component({selector:'leaf-select',template:'<nz-select [formControl]="form" nzMode="multiple">@for (choice of choices; track choice.id) { <nz-option [nzValue]="choice.id" [nzLabel]="choice.id" /> }</nz-select>'})
class Leaf { @Input('control') form:any; choices:{id:'red'|'blue'}[]=[]; }
@Component({selector:'forward-control',template:'<leaf-select [control]="field()" />'})
class Forward { field=input.required<any>({alias:'control'}); }
@Component({selector:'single-control',template:'<input [formControl]="field" minlength="2" maxlength="9" />'})
class Single { @Input('control') field:any; }
@Component({selector:'unsupported-control',template:'<color-widget [formControl]="field" />'})
class Unsupported { @Input() field:any; }
@Component({selector:'duplicate-control',template:'<input [formControl]="field" /><input [formControl]="field" />'})
class Duplicate { @Input() field:any; }
@Component({selector:'parent-form',template:'<form [formGroup]="form"><forward-control [control]="f.choices"/><single-control [control]="form.get(\\'nickname\\')"/><unsupported-control [field]="f.color"/><duplicate-control [field]="f.name"/><single-control [control]="unrelated"/></form>'})
class Parent { form:any; unrelated:any; get f(){return this.form.controls;} }
`);
const project=new Project(join(directory,'tsconfig.json')),classes=new Map(project.classes.map(cls=>[cls.name!.text,cls]));
const selectors=new Map<string,typeof project.classes>();for(const cls of classes.values()){const selector=project.string(project.property(project.metadata(cls,'Component'),'selector'));if(selector)selectors.set(selector,[cls]);}
const parent=classes.get('Parent')!,template=project.template(parent)!;
const nodes=parseTemplate(template.text,template.file).nodes,hosts=allElements(nodes);
function extraction(tag:string,index=0){return wrappedControls(project,parent,hosts.filter(host=>host.name===tag)[index],'form',selectors,nodes);}
after(()=>rmSync(directory,{recursive:true,force:true}));
test('typed FormControls traverse aliased and signal inputs with a scoped child selector',()=>{
 const result=extraction('forward-control')!;assert.deepEqual(result.issues,[]);assert.equal(result.fields.length,1);const field=result.fields[0];
 assert.equal(field.name,'choices');assert.equal(field.selector,'forward-control leaf-select nz-select');assert.equal(field.adapter,'aria-select');assert.deepEqual(field.schema,{type:'array',items:{type:'string',enum:['red','blue']}});assert.equal(field.dynamicOptions,false);
});
test('parent get control references retain native template constraints',()=>{
 const field=extraction('single-control')!.fields[0];assert.equal(field.name,'nickname');assert.equal(field.adapter,'native');assert.equal(field.supported,true);const accepts=new Ajv({strict:false}).compile(field.schema);assert(accepts(''));assert(accepts('ok'));assert(!accepts('x'));assert(!accepts('0123456789'));
});
test('unsupported widgets and duplicate mappings remain explicit issues',()=>{
 const unsupported=extraction('unsupported-control')!;assert.equal(unsupported.fields[0].supported,false);assert(unsupported.issues.length);
 const duplicate=extraction('duplicate-control')!;assert.equal(duplicate.fields.length,2);assert.equal(new Set(duplicate.fields.map(field=>field.selector)).size,2);assert(duplicate.issues.some(issue=>issue.includes('maps to 2')));
});
test('unproven parent control references do not silently become editable fields',()=>{
 const result=extraction('single-control',1)!;assert.equal(result.fields.length,0);assert(result.issues.some(issue=>issue.includes('cannot be resolved')));
});

let browser:Browser,server:Server,base:string;
const options=[{value:'u1',label:'First User'},{value:'u2',label:'Second User'},{value:'u3',label:'Third User'}];
const html=(partial=false)=>`<!doctype html><style>x-form{display:block;padding:10px}x-select{display:block;padding:12px;width:220px;border:1px solid} [role=listbox]{position:absolute;background:white;z-index:3;width:220px} [role=option]{padding:10px}</style><x-form><x-select id="single" role="combobox" aria-controls="single-popup" aria-expanded="false" tabindex="0">Choose one</x-select><x-select id="multi" role="combobox" aria-controls="multi-popup" aria-expanded="false" tabindex="0">Choose several</x-select><button id="save">Save</button></x-form><script>
window.values={single:'u1',multi:['u1']};window.selections=0;window.saved=null;
for(const control of document.querySelectorAll('x-select')){
 function close(){document.getElementById(control.id+'-popup')?.remove();control.setAttribute('aria-expanded','false');}
 control.onkeydown=e=>{if(e.key==='Escape'){e.stopPropagation();close();}};
 control.onclick=()=>{if(document.getElementById(control.id+'-popup'))return;const popup=document.createElement('div');popup.id=control.id+'-popup';popup.setAttribute('role','listbox');control.setAttribute('aria-expanded','true');
 for(const data of ${JSON.stringify(options)}){const option=document.createElement('div');option.setAttribute('role','option');option.setAttribute('value',data.value);option.setAttribute('aria-setsize','${partial?4:3}');option.textContent=data.label;function render(){option.setAttribute('aria-selected',String(control.id==='multi'?window.values.multi.includes(data.value):window.values.single===data.value));}render();option.onclick=e=>{e.stopPropagation();window.selections++;if(control.id==='multi'){window.values.multi=window.values.multi.includes(data.value)?window.values.multi.filter(x=>x!==data.value):[...window.values.multi,data.value];render();}else{window.values.single=data.value;close();}};popup.append(option);}control.insertAdjacentElement('afterend',popup);};
}
document.querySelector('#save').onclick=()=>window.saved=structuredClone(window.values);
</script>`;
before(async()=>{server=createServer((request,response)=>{response.setHeader('content-type','text/html');response.end(html(request.url?.includes('partial')));});await new Promise<void>((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;browser=await chromium.launch();});
after(async()=>{await browser?.close();await new Promise<void>(done=>server.close(()=>done()));});
function fixture(path='/selects',known=false){
 const fields:Field[]=['single','multi'].map(name=>({name,selector:'#'+name,element:'x-select',type:'text',required:false,supported:true,adapter:'aria-select',schema:name==='multi'?{type:'array',items:{type:'string'}}:{type:'string'},dynamicOptions:true,...(known?{options:[...options,{value:'u4',label:'Unavailable now'}]}:{})}));
 const capability:Capability={id:'select-regression',fingerprint:'source',route:path,component:'SelectFixture',componentSelector:'x-form',action:{kind:'workflow',selector:'x-form',label:'Save',event:'click',expression:'save()',source:{file:'fixture',line:1}},plan:{mode:'submit',root:'x-form',submit:{selector:'#save'},repeats:[]},fields,handler:'save',callPath:[],bindings:[],inputSchema:{type:'object',properties:Object.fromEntries(fields.map(field=>[field.name,field.schema])),additionalProperties:false},outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'};
 const manifest:Manifest={formatVersion:1,compilerVersion:'0.1.0',sourceDigest:'fixture',routes:[],capabilities:[capability],diagnostics:[]};return {capability,manifest};
}
async function live(page:Page,capability:Capability,args:Record<string,unknown>){return page.evaluate(async({source,capability,args})=>{const run=new Function('return ('+source+')')() as typeof executeDom;return run({capability,args});},{source:executeDom.toString(),capability,args});}
test('complete live raw values refine scalar enums and array items without submitting the form',async()=>{
 const page=await browser.newPage();try{const {manifest}=fixture();const cap=(await refineManifest(page,manifest,base)).capabilities[0];assert.notEqual(cap.fingerprint,'source');assert.deepEqual(cap.fields[0].options,options);const schema=cap.inputSchema as any;assert.deepEqual(schema.properties.single.enum,['u1','u2','u3']);assert.deepEqual(schema.properties.multi.items.enum,['u1','u2','u3']);assert.equal(schema.properties.multi.enum,undefined);assert.equal(await page.evaluate(()=>(window as any).saved),null);assert.equal(await page.locator('[role=listbox]').count(),0);}finally{await page.close();}
});
test('an explicit Material visible-label contract keeps labels as tool inputs while the UI stores raw codes',async()=>{
 const page=await browser.newPage();try{
  const {manifest,capability}=fixture();const field=capability.fields[0];field.adapter='material-select';field.schema={type:'string',description:'The visible option label in the current application.'};(capability.inputSchema as any).properties.single=field.schema;
  const cap=(await refineManifest(page,manifest,base)).capabilities[0],labels=options.map(option=>option.label);
  assert.deepEqual(cap.fields[0].options,labels.map(label=>({value:label,label})));assert.deepEqual((cap.fields[0].schema as any).enum,labels);assert.deepEqual((cap.inputSchema as any).properties.single.enum,labels);
  const accepts=new Ajv({strict:false}).compile(cap.inputSchema);assert(accepts({single:'Second User'}));assert(!accepts({single:'u2'}));
  await live(page,cap,{single:'Second User'});assert.equal(await page.evaluate(()=>(window as any).saved.single),'u2');
 }finally{await page.close();}
});
test('ARIA select contracts retain raw IDs independently of Material label-contract descriptions',async()=>{
 const page=await browser.newPage();try{const {manifest,capability}=fixture();(capability.fields[0].schema as any).description='The visible option label in the current application.';const cap=(await refineManifest(page,manifest,base)).capabilities[0];assert.deepEqual(cap.fields[0].options,options);assert.deepEqual((cap.inputSchema as any).properties.single.enum,options.map(option=>option.value));}finally{await page.close();}
});
test('ambiguous Material visible labels cannot collapse into a supposedly complete refined enum',async()=>{
 const page=await browser.newPage();try{await page.route(base+'/**',route=>route.fulfill({contentType:'text/html',body:html().replaceAll('Second User','First User')}));const {manifest,capability}=fixture();const field=capability.fields[0];field.adapter='material-select';field.schema={type:'string',description:'The visible option label in the current application.'};(capability.inputSchema as any).properties.single=field.schema;const cap=(await refineManifest(page,manifest,base)).capabilities[0];assert.equal(cap.fingerprint,'source');assert.equal(cap.fields[0].options,undefined);}finally{await page.close();}
});
test('partial live option sets cannot constrain either scalar or array schema',async()=>{
 const page=await browser.newPage();try{const {manifest}=fixture('/partial');const cap=(await refineManifest(page,manifest,base)).capabilities[0];assert.equal(cap.fingerprint,'source');assert.equal(cap.fields[0].options,undefined);assert.equal((cap.inputSchema as any).properties.multi.items.enum,undefined);}finally{await page.close();}
});
test('full source option lists survive an incomplete runtime snapshot unchanged',async()=>{
 const page=await browser.newPage();try{const {manifest}=fixture('/selects',true);const cap=(await refineManifest(page,manifest,base)).capabilities[0];assert.deepEqual(cap.fields[0].options,[...options,{value:'u4',label:'Unavailable now'}]);assert.equal(cap.fingerprint,'source');}finally{await page.close();}
});
test('serialized select driver maps raw IDs and reconciles a multiple select as an absolute set',async()=>{
 const page=await browser.newPage();try{const {manifest}=fixture();const cap=(await refineManifest(page,manifest,base)).capabilities[0];await live(page,cap,{single:'u2',multi:['u2','u3']});assert.deepEqual(await page.evaluate(()=>(window as any).saved),{single:'u2',multi:['u2','u3']});const clicks=await page.evaluate(()=>(window as any).selections);await live(page,cap,{single:'u2',multi:['u2','u3']});assert.equal(await page.evaluate(()=>(window as any).selections),clicks);assert.equal(await page.locator('[role=listbox]').count(),0);}finally{await page.close();}
});
test('an unknown select ID is rejected before clearing the existing multiple selection',async()=>{
 const page=await browser.newPage();try{const {manifest}=fixture();const cap=(await refineManifest(page,manifest,base)).capabilities[0];await assert.rejects(live(page,cap,{multi:['missing']}),/missing|Unknown/);assert.deepEqual(await page.evaluate(()=>(window as any).values.multi),['u1']);assert.equal(await page.evaluate(()=>(window as any).selections),0);}finally{await page.close();}
});
