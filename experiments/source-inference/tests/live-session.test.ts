import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium,type Browser} from 'playwright';
import {hash} from '../src/hash.js';
import {certify,certificationReport} from '../src/certification.js';
import {routeValues} from '../src/probe.js';
import type {Capability,Manifest} from '../src/model.js';

// An app with a backend and a login, as a development server shows it: the item list is read from /api/items and links to
// each record, deleting a record needs the identifier of one, the account form is behind a guard that sends a visitor
// without a token to /login, and the shell has a link home, a button that does nothing, and a sign-out button it shows only
// to a visitor who has a token.
let server:Server,browser:Browser,baseUrl:string,directory:string,reads=0,mutations=0;
const page=`<!doctype html><html><body><app-shell><nav><a class="home" href="/">Home</a> <a class="items" href="/items">Items</a> <button class="refresh" type="button">Refresh</button></nav></app-shell><main></main><script>
const main=document.querySelector('main');
const go=path=>{history.pushState({},'',path);render();};
function render(){
 const path=location.pathname;
 if(path==='/items'){main.innerHTML='<app-items><ul></ul></app-items>';fetch('/api/items').then(r=>r.json()).then(list=>{if(Array.isArray(list))main.querySelector('ul').innerHTML=list.map(item=>'<li><a href="/items/'+item.id+'">'+item.name+'</a></li>').join('');});}
 else if(path.startsWith('/items/')){main.innerHTML='<app-item><button class="delete" type="button">Delete</button></app-item>';main.querySelector('button').onclick=()=>fetch('/api/items/'+path.split('/')[2],{method:'DELETE'});}
 else if(path==='/account'){
  if(!localStorage.getItem('token')){go('/login');return;}
  main.innerHTML='<app-account><form><input name="displayName"><button type="submit">Save</button></form></app-account>';
  main.querySelector('form').onsubmit=event=>{event.preventDefault();fetch('/api/account',{method:'PUT',body:JSON.stringify({displayName:main.querySelector('input').value})});};
 }
 else if(path==='/login')main.innerHTML='<app-login><p>Sign in</p></app-login>';
 else main.innerHTML='<app-home><p>Welcome</p></app-home>';
}
document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link&&link.origin===location.origin){event.preventDefault();go(link.pathname);}});
window.addEventListener('popstate',render);
if(localStorage.getItem('token')){const out=document.createElement('button');out.className='signout';out.type='button';out.textContent='Sign out';out.onclick=()=>{localStorage.removeItem('token');go('/login');};document.querySelector('app-shell nav').append(out);}
render();
</script></body></html>`;
before(async()=>{
 server=createServer((request,response)=>{
  if(request.method!=='GET'){mutations++;response.writeHead(200,{'content-type':'application/json'});response.end('{}');return;}
  if(request.url==='/api/items'){reads++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify([{id:'k7',name:'Seven'},{id:'k9',name:'Nine'}]));return;}
  response.writeHead(200,{'content-type':'text/html'});response.end(page);
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 directory=mkdtempSync(join(tmpdir(),'live-session-'));
 browser=await chromium.launch();
});
after(async()=>{await browser?.close();await new Promise<void>(done=>server?.close(()=>done()));if(directory)rmSync(directory,{recursive:true,force:true});});

function app():Manifest{
 const source={file:'live-session-fixture',line:1};
 const common=():Pick<Capability,'fingerprint'|'fields'|'callPath'|'bindings'|'outputSchema'|'guards'|'workflow'|'issues'|'status'>=>({fingerprint:'',fields:[],callPath:[],bindings:[],outputSchema:{type:'object'},guards:[],workflow:{confirmation:'not-observed',evidence:[]},issues:[],status:'candidate'});
 const none={type:'object',properties:{},additionalProperties:false};
 const capabilities:Capability[]=[
  {...common(),id:'fixture/deleteItem',route:'/items/:id',component:'ItemFixture',componentSelector:'app-item',handler:'remove',routeParams:['id'],
   action:{kind:'button',selector:'app-item button.delete',label:'Delete',event:'click',expression:'remove()',source},
   inputSchema:{type:'object',properties:{id:{type:'string',minLength:1}},required:['id'],additionalProperties:false}},
  {...common(),id:'fixture/saveAccount',route:'/account',component:'AccountFixture',componentSelector:'app-account',handler:'save',guards:['requireAuth'],
   action:{kind:'form',selector:'app-account form',label:'Save',event:'submit',expression:'save()',source},
   fields:[{name:'displayName',selector:'input[name="displayName"]',element:'input',type:'text',required:true,supported:true,schema:{type:'string'},adapter:'native'}],
   inputSchema:{type:'object',properties:{displayName:{type:'string'}},required:['displayName'],additionalProperties:false}},
  {...common(),id:'fixture/goHome',route:'/',component:'ShellFixture',componentSelector:'app-shell',handler:'navigate',global:true,
   action:{kind:'workflow',selector:'app-shell',label:'Navigate through authored links',event:'click',expression:'routerLink',source},
   drive:{buttons:{param:'route',choices:[{value:'/',selector:'app-shell a.home'}]}},
   inputSchema:{type:'object',properties:{route:{type:'string',enum:['/']}},required:['route'],additionalProperties:false}},
  {...common(),id:'fixture/refresh',route:'/',component:'ShellFixture',componentSelector:'app-shell',handler:'refresh',global:true,
   action:{kind:'button',selector:'app-shell button.refresh',label:'Refresh',event:'click',expression:'refresh()',source},inputSchema:none},
  {...common(),id:'fixture/signOut',route:'/',component:'ShellFixture',componentSelector:'app-shell',handler:'signOut',global:true,
   action:{kind:'button',selector:'app-shell button.signout',label:'Sign out',event:'click',expression:'signOut()',source},inputSchema:none},
 ];
 const manifest:Manifest={formatVersion:1,compilerVersion:'0.1.0',sourceDigest:'live-session-fixture',diagnostics:[],capabilities,
  routes:[{path:'/',component:'HomeFixture',guards:[]},{path:'/items',component:'ItemsFixture',guards:[]},{path:'/items/:id',component:'ItemFixture',guards:[]},{path:'/account',component:'AccountFixture',guards:['requireAuth']},{path:'/login',component:'LoginFixture',guards:[]}]};
 for(const capability of capabilities)capability.fingerprint=hash(JSON.stringify({sourceDigest:manifest.sourceDigest,capability}));
 return manifest;
}

test('a route identifier is taken from a link that matches the route, never from one of the app\'s own fixed routes',()=>{
 assert.deepEqual(routeValues('/users/edit/:id',['/users','/users/add','/users/edit/42']),{id:'42'});
 assert.equal(routeValues('/users/:id',['/users/add'],['/users/add']),undefined);
 assert.deepEqual(routeValues('/users/:id',['/users/add','/users/a%20b'],['/users/add']),{id:'a b'});
 assert.deepEqual(routeValues('/shop/:shop/item/:item',['/shop/s1/item/i1','/shop/s2/item/i2'],[],{shop:'s2'}),{shop:'s2',item:'i2'});
 assert.equal(routeValues('/article/:slug',['/article/%E0%A4%A','/articles/x']),undefined);
});

test('by default nothing reaches the backend, and what could not run says what it needs',{timeout:300000},async()=>{
 const result=await certify(browser,app(),{baseUrl,budget:6});
 const entry=(id:string)=>result.entries.find(candidate=>candidate.id===`fixture/${id}`)!;
 assert.equal(entry('deleteItem').verdict,'unverified');
 assert.match(entry('deleteItem').reason??'',/^needs a fixture value for "id" \(pass --param id=\.\.\., or --live-reads so the app can load its own records\)$/);
 assert.equal(entry('saveAccount').verdict,'unverified');
 assert.match(entry('saveAccount').reason??'',/^the app left \/account for \/login before the action could run \(route guard: requireAuth\); if it needs a signed-in session, pass --storage-state/);
 // The link home shows nothing from the home page; it is certified from another page, and only because it navigates.
 assert.equal(entry('goHome').verdict,'executed',JSON.stringify(entry('goHome')));assert.equal(entry('goHome').effectClass,'navigation');
 // An action of the shell with no effect is not certified from any page.
 assert.equal(entry('refresh').verdict,'unverified',JSON.stringify(entry('refresh')));
 // A control the app shows only to a signed-in visitor is reported as a state the sandbox was not in, with what would put it there.
 assert.equal(entry('signOut').verdict,'unverified');
 assert.match(entry('signOut').reason??'',/^the action's control was not on the page at \/; the app shows it only in a state the sandbox did not reach \(signed in: --storage-state, records loaded: --live-reads\) \[/);
 assert.deepEqual(result.approvals.map(approval=>approval.id),['fixture/goHome']);
 assert.match(certificationReport(result),/Sandbox: no request reached a backend/);
 assert.deepEqual([reads,mutations],[0,0]);
});

test('with live reads and a saved session the app runs on its own records, and writes still never leave the sandbox',{timeout:300000},async()=>{
 const storageState=join(directory,'state.json');
 writeFileSync(storageState,JSON.stringify({cookies:[],origins:[{origin:baseUrl,localStorage:[{name:'token',value:'fixture-session'}]}]}));
 const result=await certify(browser,app(),{baseUrl,budget:6,liveReads:true,storageState});
 const entry=(id:string)=>result.entries.find(candidate=>candidate.id===`fixture/${id}`)!;
 const observed=(id:string)=>result.manifest.capabilities.find(candidate=>candidate.id===`fixture/${id}`)!.observed;
 // The identifier came from a link the item list rendered out of the backend's answer.
 assert.equal(entry('deleteItem').verdict,'executed',JSON.stringify(entry('deleteItem')));
 assert.deepEqual(observed('deleteItem')?.http.filter(call=>call.method!=='GET'),[{method:'DELETE',path:'/api/items/k7',bodyKeys:[]}]);
 assert.equal(entry('saveAccount').verdict,'proven',JSON.stringify(entry('saveAccount')));
 assert.deepEqual(observed('saveAccount')?.http.filter(call=>call.method!=='GET'),[{method:'PUT',path:'/api/account',bodyKeys:['displayName']}]);
 assert.equal(entry('signOut').verdict,'proven',JSON.stringify(entry('signOut')));
 assert.deepEqual(result.approvals.map(approval=>[approval.id,approval.effect]),[['fixture/deleteItem','write'],['fixture/saveAccount','write'],['fixture/goHome','write'],['fixture/signOut','write']]);
 assert.match(certificationReport(result),/Sandbox: read requests \(GET, HEAD\) reached the app's own origin and other local hosts; every other request was answered by the sandbox\. Every attempt started from the saved browser session/);
 assert.ok(reads>0,'the item list was read from the backend');
 assert.equal(mutations,0);
});
